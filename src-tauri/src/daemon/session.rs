use chrono::Utc;
use parking_lot::{Mutex, RwLock};
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use tokio::sync::broadcast;
use tracing::{error, info, warn};

use crate::daemon::env::build_terminal_env;
use crate::daemon::persistence::{SessionMeta, SessionPersistence};
use crate::daemon::protocol::{CreateSessionRequest, DaemonEvent};
use crate::daemon::shell::ShellConfig;
use crate::daemon::shell_wrapper::setup_shell_wrappers;
use crate::daemon::wrappers::{ensure_claude_settings, setup_agent_wrappers};
use crate::error::{Error, Result};
use crate::terminal::{AgentStatus, CommandSpec, PtyHandle, Terminal, TerminalInfo, TerminalStatus};

pub struct SessionEntry {
    pub terminal: Terminal,
    pub pty: Option<PtyHandle>,
    pub persistence: Arc<Mutex<SessionPersistence>>,
    pub cols: u16,
    pub rows: u16,
    /// Shutdown signal for the PTY reader thread
    pub shutdown: Arc<AtomicBool>,
    /// Handle to the PTY reader thread for cleanup
    pub reader_handle: Option<JoinHandle<()>>,
}

#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, SessionEntry>>>,
    /// Broadcast channel for all events (output + status)
    /// Buffer is large enough for high-throughput terminals
    event_tx: broadcast::Sender<DaemonEvent>,
    sessions_dir: PathBuf,
    wrapper_dir: PathBuf,
    ada_bin_dir: PathBuf,
    ada_home: PathBuf,
    notification_port: u16,
    shell_override: Arc<RwLock<Option<String>>>,
}

impl SessionManager {
    pub fn new(
        data_dir: &Path,
        ada_home: &Path,
        event_tx: broadcast::Sender<DaemonEvent>,
        notification_port: u16,
        shell_override: Arc<RwLock<Option<String>>>,
    ) -> Result<Self> {
        let sessions_dir = data_dir.join("sessions");
        std::fs::create_dir_all(&sessions_dir)?;

        let ada_home = ada_home.to_path_buf();
        let wrapper_dir = setup_shell_wrappers(&ada_home)?;
        let wrappers = setup_agent_wrappers(&ada_home)?;

        let manager = Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            event_tx,
            sessions_dir,
            wrapper_dir,
            ada_bin_dir: wrappers.bin_dir,
            ada_home,
            notification_port,
            shell_override,
        };

        manager.load_from_disk()?;
        Ok(manager)
    }

    pub fn list_sessions(&self) -> Vec<TerminalInfo> {
        self.sessions
            .read()
            .values()
            .map(|entry| TerminalInfo::from(&entry.terminal))
            .collect()
    }

    pub fn get_session(&self, terminal_id: &str) -> Result<TerminalInfo> {
        let sessions = self.sessions.read();
        let entry = sessions
            .get(terminal_id)
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;
        Ok(TerminalInfo::from(&entry.terminal))
    }

    pub fn create_session(&self, request: CreateSessionRequest) -> Result<TerminalInfo> {
        let working_dir = PathBuf::from(&request.working_dir);
        if !working_dir.exists() {
            return Err(Error::InvalidRequest(format!(
                "Working directory does not exist: {}",
                request.working_dir
            )));
        }

        info!(
            terminal_id = %request.terminal_id,
            project_id = %request.project_id,
            client_id = %request.client_id,
            "creating terminal session"
        );

        let shell = ShellConfig::detect(self.shell_override.read().clone());
        let mut terminal = Terminal {
            id: request.terminal_id.clone(),
            project_id: request.project_id.clone(),
            name: request.name,
            client_id: request.client_id,
            working_dir: working_dir.clone(),
            branch: request.branch,
            worktree_path: request.worktree_path.map(PathBuf::from),
            status: TerminalStatus::Starting,
            created_at: Utc::now(),
            command: request.command,
            shell: Some(shell.path.to_string_lossy().to_string()),
            agent_status: AgentStatus::Idle,
            mode: request.mode,
            is_main: request.is_main,
            folder_path: request.folder_path.map(PathBuf::from),
        };

        let meta = SessionMeta {
            terminal_id: terminal.id.clone(),
            project_id: terminal.project_id.clone(),
            name: terminal.name.clone(),
            client_id: terminal.client_id.clone(),
            working_dir: terminal.working_dir.clone(),
            branch: terminal.branch.clone(),
            worktree_path: terminal.worktree_path.clone(),
            folder_path: terminal.folder_path.clone(),
            is_main: terminal.is_main,
            mode: terminal.mode,
            command: terminal.command.clone(),
            shell: terminal.shell.clone(),
            cols: request.cols,
            rows: request.rows,
            created_at: terminal.created_at,
            last_activity: terminal.created_at,
            ended_at: None,
            scrollback_bytes: 0,
        };

        let persistence = SessionPersistence::new(&self.sessions_dir, meta)?;
        let persistence = Arc::new(Mutex::new(persistence));

        let shutdown = Arc::new(AtomicBool::new(false));

        // Spawn PTY
        let (pty, reader_handle) = self.spawn_pty(
            &mut terminal,
            request.cols,
            request.rows,
            persistence.clone(),
            shutdown.clone(),
        )?;
        terminal.status = TerminalStatus::Running;

        let entry = SessionEntry {
            terminal: terminal.clone(),
            pty: Some(pty),
            persistence,
            cols: request.cols,
            rows: request.rows,
            shutdown,
            reader_handle: Some(reader_handle),
        };

        self.sessions.write().insert(terminal.id.clone(), entry);

        self.emit_status(&terminal)?;
        Ok(TerminalInfo::from(&terminal))
    }

    pub fn write_to_session(&self, terminal_id: &str, data: &str) -> Result<()> {
        // Clone the PTY handle under a short read lock, then release before I/O
        let pty_handle = {
            let sessions = self.sessions.read();
            let entry = sessions
                .get(terminal_id)
                .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

            let pty = entry
                .pty
                .as_ref()
                .ok_or_else(|| Error::TerminalError("Terminal PTY is not running".into()))?;

            // Clone the Arc<Mutex<>> handles - this is cheap
            PtyHandle {
                master: pty.master.clone(),
                writer: pty.writer.clone(),
            }
        };
        // Lock released here, now perform I/O without blocking other sessions
        crate::terminal::pty::write_to_pty(&pty_handle, data.as_bytes())
    }

    pub fn resize_session(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<()> {
        // Clone PTY handle and persistence under short lock, then perform I/O
        let (pty_handle, persistence) = {
            let sessions = self.sessions.read();
            let entry = sessions
                .get(terminal_id)
                .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

            let pty = entry
                .pty
                .as_ref()
                .ok_or_else(|| Error::TerminalError("Terminal PTY is not running".into()))?;

            (
                PtyHandle {
                    master: pty.master.clone(),
                    writer: pty.writer.clone(),
                },
                entry.persistence.clone(),
            )
        };

        // Perform resize I/O without holding session lock
        crate::terminal::pty::resize_pty(&pty_handle, cols, rows)?;

        // Update metadata under write lock
        {
            let mut sessions = self.sessions.write();
            if let Some(entry) = sessions.get_mut(terminal_id) {
                entry.cols = cols;
                entry.rows = rows;
            }
        }
        {
            let mut persistence = persistence.lock();
            persistence.meta.cols = cols;
            persistence.meta.rows = rows;
        }

        Ok(())
    }

    pub fn close_session(&self, terminal_id: &str) -> Result<()> {
        let entry = {
            let mut sessions = self.sessions.write();
            sessions
                .remove(terminal_id)
                .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?
        };

        // Signal the reader thread to stop
        entry.shutdown.store(true, Ordering::SeqCst);

        // Don't wait for reader thread - it will exit on its own when:
        // 1. The PTY master is dropped and read returns EOF/error, or
        // 2. It checks the shutdown flag after the next read completes
        // Joining here can block indefinitely if the read is blocked.
        drop(entry.reader_handle);

        {
            let mut persistence = entry.persistence.lock();
            let _ = persistence.mark_ended();
        }

        let _ = std::fs::remove_dir_all(
            self.sessions_dir.join(terminal_id)
        );

        self.emit_status(&Terminal {
            status: TerminalStatus::Stopped,
            ..entry.terminal
        })?;

        Ok(())
    }

    pub fn mark_session_stopped(&self, terminal_id: &str) -> Result<TerminalStatus> {
        let mut sessions = self.sessions.write();
        let entry = sessions
            .get_mut(terminal_id)
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

        entry.pty = None;
        entry.terminal.status = TerminalStatus::Stopped;

        {
            let mut persistence = entry.persistence.lock();
            let _ = persistence.mark_ended();
        }

        self.emit_status(&entry.terminal)?;
        Ok(entry.terminal.status)
    }

    pub fn update_agent_status(&self, terminal_id: &str, status: AgentStatus) {
        let mut sessions = self.sessions.write();
        if let Some(entry) = sessions.get_mut(terminal_id) {
            entry.terminal.agent_status = status;
        }
    }

    pub fn restart_session(&self, terminal_id: &str) -> Result<TerminalInfo> {
        info!(terminal_id = %terminal_id, "restart_session: starting");

        // First, signal the old reader thread to stop and get necessary data
        let (cols, rows, persistence, old_shutdown, old_handle) = {
            info!(terminal_id = %terminal_id, "restart_session: acquiring write lock");
            let mut sessions = self.sessions.write();
            info!(terminal_id = %terminal_id, "restart_session: write lock acquired");

            let entry = sessions
                .get_mut(terminal_id)
                .ok_or_else(|| {
                    error!(terminal_id = %terminal_id, "restart_session: terminal not found");
                    Error::TerminalNotFound(terminal_id.to_string())
                })?;

            info!(
                terminal_id = %terminal_id,
                current_status = ?entry.terminal.status,
                has_pty = entry.pty.is_some(),
                "restart_session: found terminal"
            );

            // Signal old reader to stop
            entry.shutdown.store(true, Ordering::SeqCst);
            entry.pty = None;

            let shell = ShellConfig::detect(self.shell_override.read().clone());
            info!(
                terminal_id = %terminal_id,
                shell = %shell.path.display(),
                "restart_session: detected shell"
            );

            entry.terminal.shell = Some(shell.path.to_string_lossy().to_string());
            entry.terminal.status = TerminalStatus::Starting;
            entry.terminal.created_at = Utc::now();

            let meta = SessionMeta {
                terminal_id: entry.terminal.id.clone(),
                project_id: entry.terminal.project_id.clone(),
                name: entry.terminal.name.clone(),
                client_id: entry.terminal.client_id.clone(),
                working_dir: entry.terminal.working_dir.clone(),
                branch: entry.terminal.branch.clone(),
                worktree_path: entry.terminal.worktree_path.clone(),
                folder_path: entry.terminal.folder_path.clone(),
                is_main: entry.terminal.is_main,
                mode: entry.terminal.mode,
                command: entry.terminal.command.clone(),
                shell: entry.terminal.shell.clone(),
                cols: entry.cols,
                rows: entry.rows,
                created_at: entry.terminal.created_at,
                last_activity: entry.terminal.created_at,
                ended_at: None,
                scrollback_bytes: 0,
            };

            info!(terminal_id = %terminal_id, "restart_session: resetting persistence");
            entry.persistence.lock().reset(meta)?;

            info!(terminal_id = %terminal_id, "restart_session: releasing write lock (phase 1)");
            (
                entry.cols,
                entry.rows,
                entry.persistence.clone(),
                std::mem::replace(&mut entry.shutdown, Arc::new(AtomicBool::new(false))),
                entry.reader_handle.take(),
            )
        };

        // Don't wait for old reader thread - it will exit on its own when:
        // 1. The PTY master is dropped and read returns EOF/error, or
        // 2. It checks the shutdown flag after the next read completes
        // Joining here can block indefinitely if the read is blocked.
        info!(terminal_id = %terminal_id, "restart_session: dropping old handles");
        drop(old_handle);
        drop(old_shutdown);

        let shutdown = Arc::new(AtomicBool::new(false));

        // Spawn new PTY
        info!(terminal_id = %terminal_id, "restart_session: acquiring write lock (phase 2)");
        let mut sessions = self.sessions.write();
        info!(terminal_id = %terminal_id, "restart_session: write lock acquired (phase 2)");

        let entry = sessions
            .get_mut(terminal_id)
            .ok_or_else(|| {
                error!(terminal_id = %terminal_id, "restart_session: terminal not found (phase 2)");
                Error::TerminalNotFound(terminal_id.to_string())
            })?;

        info!(
            terminal_id = %terminal_id,
            working_dir = %entry.terminal.working_dir.display(),
            command = %entry.terminal.command.command,
            "restart_session: spawning new PTY"
        );

        let (pty, reader_handle) = self.spawn_pty(
            &mut entry.terminal,
            cols,
            rows,
            persistence,
            shutdown.clone(),
        )?;

        info!(terminal_id = %terminal_id, "restart_session: PTY spawned successfully");

        entry.pty = Some(pty);
        entry.terminal.status = TerminalStatus::Running;
        entry.shutdown = shutdown;
        entry.reader_handle = Some(reader_handle);

        info!(terminal_id = %terminal_id, "restart_session: emitting status");
        self.emit_status(&entry.terminal)?;

        info!(terminal_id = %terminal_id, "restart_session: completed successfully");
        Ok(TerminalInfo::from(&entry.terminal))
    }

    pub fn switch_session_agent(
        &self,
        terminal_id: &str,
        client_id: &str,
        command: CommandSpec,
    ) -> Result<TerminalInfo> {
        // First, signal the old reader thread to stop and get necessary data
        let (cols, rows, persistence, old_shutdown, old_handle) = {
            let mut sessions = self.sessions.write();
            let entry = sessions
                .get_mut(terminal_id)
                .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

            // Signal old reader to stop
            entry.shutdown.store(true, Ordering::SeqCst);
            entry.pty = None;

            entry.terminal.client_id = client_id.to_string();
            entry.terminal.command = command;
            entry.terminal.status = TerminalStatus::Starting;
            entry.terminal.created_at = Utc::now();

            let meta = SessionMeta {
                terminal_id: entry.terminal.id.clone(),
                project_id: entry.terminal.project_id.clone(),
                name: entry.terminal.name.clone(),
                client_id: entry.terminal.client_id.clone(),
                working_dir: entry.terminal.working_dir.clone(),
                branch: entry.terminal.branch.clone(),
                worktree_path: entry.terminal.worktree_path.clone(),
                folder_path: entry.terminal.folder_path.clone(),
                is_main: entry.terminal.is_main,
                mode: entry.terminal.mode,
                command: entry.terminal.command.clone(),
                shell: entry.terminal.shell.clone(),
                cols: entry.cols,
                rows: entry.rows,
                created_at: entry.terminal.created_at,
                last_activity: entry.terminal.created_at,
                ended_at: None,
                scrollback_bytes: 0,
            };

            entry.persistence.lock().reset(meta)?;

            (
                entry.cols,
                entry.rows,
                entry.persistence.clone(),
                std::mem::replace(&mut entry.shutdown, Arc::new(AtomicBool::new(false))),
                entry.reader_handle.take(),
            )
        };

        // Don't wait for old reader thread - it will exit on its own when:
        // 1. The PTY master is dropped and read returns EOF/error, or
        // 2. It checks the shutdown flag after the next read completes
        // Joining here can block indefinitely if the read is blocked.
        drop(old_handle);
        drop(old_shutdown);

        let shutdown = Arc::new(AtomicBool::new(false));

        // Spawn new PTY
        let mut sessions = self.sessions.write();
        let entry = sessions
            .get_mut(terminal_id)
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

        let (pty, reader_handle) = self.spawn_pty(
            &mut entry.terminal,
            cols,
            rows,
            persistence,
            shutdown.clone(),
        )?;

        entry.pty = Some(pty);
        entry.terminal.status = TerminalStatus::Running;
        entry.terminal.agent_status = AgentStatus::Idle;
        entry.shutdown = shutdown;
        entry.reader_handle = Some(reader_handle);

        self.emit_status(&entry.terminal)?;
        Ok(TerminalInfo::from(&entry.terminal))
    }

    pub fn get_history(&self, terminal_id: &str) -> Result<Vec<String>> {
        let sessions = self.sessions.read();
        let entry = sessions
            .get(terminal_id)
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

        let scrollback = SessionPersistence::read_scrollback(entry.persistence.lock().session_dir())?;
        if scrollback.is_empty() {
            Ok(Vec::new())
        } else {
            Ok(vec![scrollback])
        }
    }

    fn spawn_pty(
        &self,
        terminal: &mut Terminal,
        cols: u16,
        rows: u16,
        persistence: Arc<Mutex<SessionPersistence>>,
        shutdown: Arc<AtomicBool>,
    ) -> Result<(PtyHandle, JoinHandle<()>)> {
        info!(terminal_id = %terminal.id, "spawn_pty: starting");

        self.ensure_claude_settings_file();

        let shell = ShellConfig::detect(self.shell_override.read().clone());
        terminal.shell = Some(shell.path.to_string_lossy().to_string());

        info!(
            terminal_id = %terminal.id,
            shell = %shell.path.display(),
            cols = cols,
            rows = rows,
            "spawn_pty: opening PTY"
        );

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| {
                error!(terminal_id = %terminal.id, error = %e, "spawn_pty: failed to open PTY");
                Error::TerminalError(e.to_string())
            })?;

        info!(terminal_id = %terminal.id, "spawn_pty: PTY opened");

        let mut cmd = CommandBuilder::new(&shell.path);
        cmd.args(&shell.login_args);

        if shell.name == "bash" {
            cmd.arg("--rcfile");
            cmd.arg(self.wrapper_dir.join("bash/.bashrc"));
        }

        let command_line = format_command_line(&terminal.command);
        cmd.arg("-c");
        cmd.arg(&command_line);

        info!(
            terminal_id = %terminal.id,
            working_dir = %terminal.working_dir.display(),
            command_line = %command_line,
            "spawn_pty: preparing command"
        );

        cmd.cwd(&terminal.working_dir);

        let env = build_terminal_env(
            &shell,
            &self.wrapper_dir,
            &self.ada_home,
            &self.ada_bin_dir,
            &terminal.id,
            &terminal.project_id,
            self.notification_port,
        );

        for (key, value) in &env {
            cmd.env(key, value);
        }

        for (key, value) in &terminal.command.env {
            cmd.env(key, value);
        }

        info!(terminal_id = %terminal.id, "spawn_pty: spawning command");

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| {
                error!(terminal_id = %terminal.id, error = %e, "spawn_pty: failed to spawn command");
                Error::TerminalError(e.to_string())
            })?;

        info!(terminal_id = %terminal.id, "spawn_pty: command spawned successfully");

        drop(pair.slave);

        info!(terminal_id = %terminal.id, "spawn_pty: cloning reader");

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| {
                error!(terminal_id = %terminal.id, error = %e, "spawn_pty: failed to clone reader");
                Error::TerminalError(e.to_string())
            })?;

        info!(terminal_id = %terminal.id, "spawn_pty: reader cloned, spawning reader thread");

        let terminal_id = terminal.id.clone();
        let project_id = terminal.project_id.clone();
        let event_tx = self.event_tx.clone();
        let sessions = self.sessions.clone();

        let reader_handle = thread::Builder::new()
            .name(format!("pty-reader-{}", terminal_id))
            .spawn(move || {
                info!(terminal_id = %terminal_id, "pty-reader: thread started");
                let mut buffer = [0u8; 4096];
                loop {
                    // Check shutdown flag before blocking on read
                    if shutdown.load(Ordering::SeqCst) {
                        info!(terminal_id = %terminal_id, "pty-reader: shutdown flag set, exiting");
                        break;
                    }

                    match reader.read(&mut buffer) {
                        Ok(0) => {
                            info!(terminal_id = %terminal_id, "pty-reader: EOF received, exiting");
                            break;
                        }
                        Ok(n) => {
                            let output = String::from_utf8_lossy(&buffer[..n]).to_string();
                            {
                                let mut persistence = persistence.lock();
                                if let Err(e) = persistence.write_output(output.as_bytes()) {
                                    warn!(terminal_id = %terminal_id, error = %e, "failed to write output to persistence");
                                }
                            }
                            // Send to broadcast channel - use send() which won't block
                            // If channel is full, old messages are dropped (lagged)
                            if let Err(e) = event_tx.send(DaemonEvent::TerminalOutput {
                                terminal_id: terminal_id.clone(),
                                data: output,
                            }) {
                                // No receivers or lagged - that's okay, output is persisted
                                if event_tx.receiver_count() == 0 {
                                    // No receivers at all, that's fine
                                } else {
                                    warn!(terminal_id = %terminal_id, error = %e, "failed to send terminal output event");
                                }
                            }
                        }
                        Err(e) => {
                            // Check if this is a normal shutdown
                            if !shutdown.load(Ordering::SeqCst) {
                                warn!(terminal_id = %terminal_id, error = %e, "PTY read error");
                            }
                            break;
                        }
                    }
                }

                // Update session status on exit
                info!(terminal_id = %terminal_id, "pty-reader: updating session status to Stopped");
                {
                    let mut sessions = sessions.write();
                    if let Some(entry) = sessions.get_mut(&terminal_id) {
                        entry.terminal.status = TerminalStatus::Stopped;
                        entry.pty = None;
                        let mut persistence = entry.persistence.lock();
                        let _ = persistence.mark_ended();
                        // Send status event
                        info!(terminal_id = %terminal_id, "pty-reader: sending TerminalStatus::Stopped event");
                        if let Err(e) = event_tx.send(DaemonEvent::TerminalStatus {
                            terminal_id: terminal_id.clone(),
                            project_id: project_id.clone(),
                            status: TerminalStatus::Stopped,
                        }) {
                            warn!(terminal_id = %terminal_id, error = %e, "failed to send terminal status event");
                        }
                    } else {
                        warn!(terminal_id = %terminal_id, "pty-reader: session not found on exit");
                    }
                }
                info!(terminal_id = %terminal_id, "pty-reader: thread exiting");
            })
            .map_err(|e| {
                error!(error = %e, "spawn_pty: failed to spawn reader thread");
                Error::TerminalError(format!("failed to spawn PTY reader thread: {}", e))
            })?;

        info!(terminal_id = %terminal.id, "spawn_pty: reader thread spawned, taking writer");

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| {
                error!(terminal_id = %terminal.id, error = %e, "spawn_pty: failed to take writer");
                Error::TerminalError(e.to_string())
            })?;

        info!(terminal_id = %terminal.id, "spawn_pty: completed successfully");

        Ok((
            PtyHandle {
                master: Arc::new(Mutex::new(pair.master)),
                writer: Arc::new(Mutex::new(writer)),
            },
            reader_handle,
        ))
    }

    fn ensure_claude_settings_file(&self) {
        if let Err(err) = ensure_claude_settings(&self.ada_home) {
            eprintln!("Warning: failed to ensure Claude settings: {err}");
        }
    }

    fn emit_status(&self, terminal: &Terminal) -> Result<()> {
        if let Err(e) = self.event_tx.send(DaemonEvent::TerminalStatus {
            terminal_id: terminal.id.clone(),
            project_id: terminal.project_id.clone(),
            status: terminal.status,
        }) {
            warn!(terminal_id = %terminal.id, error = %e, "failed to emit terminal status");
        }
        Ok(())
    }

    fn load_from_disk(&self) -> Result<()> {
        if !self.sessions_dir.exists() {
            return Ok(());
        }

        for dir_entry in std::fs::read_dir(&self.sessions_dir)? {
            let dir_entry = dir_entry?;
            let path = dir_entry.path();
            if !path.is_dir() {
                continue;
            }

            let meta = match SessionPersistence::load_meta(&path) {
                Some(meta) => meta,
                None => continue,
            };

            let mut terminal = Terminal {
                id: meta.terminal_id.clone(),
                project_id: meta.project_id.clone(),
                name: meta.name.clone(),
                client_id: meta.client_id.clone(),
                working_dir: meta.working_dir.clone(),
                branch: meta.branch.clone(),
                worktree_path: meta.worktree_path.clone(),
                status: TerminalStatus::Stopped,
                created_at: meta.created_at,
                command: meta.command.clone(),
                shell: meta.shell.clone(),
                agent_status: AgentStatus::Idle,
                mode: meta.mode,
                is_main: meta.is_main,
                folder_path: meta.folder_path.clone(),
            };

            let persistence = SessionPersistence::open_existing(&self.sessions_dir, meta.clone())?;
            let persistence = Arc::new(Mutex::new(persistence));

            let shutdown = Arc::new(AtomicBool::new(false));

            // Try to restart if session wasn't ended
            let (pty, reader_handle) = if meta.ended_at.is_none() {
                match self.spawn_pty(
                    &mut terminal,
                    meta.cols,
                    meta.rows,
                    persistence.clone(),
                    shutdown.clone(),
                ) {
                    Ok((pty, handle)) => {
                        terminal.status = TerminalStatus::Running;
                        (Some(pty), Some(handle))
                    }
                    Err(e) => {
                        warn!(terminal_id = %terminal.id, error = %e, "failed to restart session from disk");
                        (None, None)
                    }
                }
            } else {
                (None, None)
            };

            let entry = SessionEntry {
                terminal: terminal.clone(),
                pty,
                persistence,
                cols: meta.cols,
                rows: meta.rows,
                shutdown,
                reader_handle,
            };

            self.sessions.write().insert(terminal.id.clone(), entry);
        }

        Ok(())
    }
}

fn format_command_line(command: &CommandSpec) -> String {
    let mut parts = Vec::with_capacity(command.args.len() + 1);
    parts.push(shell_escape(&command.command));
    for arg in &command.args {
        parts.push(shell_escape(arg));
    }
    parts.join(" ")
}

fn shell_escape(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }
    let escaped = input.replace('\'', r#"'\''"#);
    format!("'{escaped}'")
}
