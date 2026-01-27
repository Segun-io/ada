use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, info, warn};

use crate::daemon::protocol::{DaemonEvent, DaemonMessage, DaemonRequest, DaemonResponse, RuntimeConfig};
use crate::error::{Error, Result};
use crate::terminal::{TerminalInfo, TerminalOutput, TerminalStatus};

pub struct DaemonClient {
    out_tx: mpsc::UnboundedSender<String>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<DaemonResponse>>>>,
}

impl DaemonClient {
    pub async fn connect(app_handle: AppHandle) -> Result<Self> {
        let port = ensure_daemon_running().await?;
        let addr = format!("127.0.0.1:{port}");
        let stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| Error::TerminalError(e.to_string()))?;
        info!(addr = %addr, "daemon client connected");

        let (reader, writer) = stream.into_split();
        let mut reader = BufReader::new(reader).lines();

        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let pending: Arc<Mutex<HashMap<String, oneshot::Sender<DaemonResponse>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        let pending_for_read = pending.clone();
        let app_handle_for_read = app_handle.clone();

        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(line) = out_rx.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if writer.write_all(b"\n").await.is_err() {
                    break;
                }
            }
        });

        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                let message: DaemonMessage = match serde_json::from_str(&line) {
                    Ok(msg) => msg,
                    Err(err) => {
                        warn!(error = %err, "daemon message parse failed");
                        continue;
                    }
                };

                match message {
                    DaemonMessage::Response { id, response } => {
                        let sender = pending_for_read.lock().remove(&id);
                        if let Some(sender) = sender {
                            let _ = sender.send(response);
                        }
                    }
                    DaemonMessage::Event { event } => {
                        debug!(event = ?event, "daemon event");
                        emit_daemon_event(&app_handle_for_read, event);
                    }
                    _ => {}
                }
            }

            warn!("daemon connection closed");
        });

        Ok(Self { out_tx, pending })
    }

    pub async fn send_request(&self, request: DaemonRequest) -> Result<DaemonResponse> {
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().insert(id.clone(), tx);

        debug!(request_id = %id, request = ?request, "daemon request");
        let message = DaemonMessage::Request { id: id.clone(), request };
        let json = serde_json::to_string(&message)?;

        if let Err(_) = self.out_tx.send(json) {
            // Clean up pending entry on send failure
            self.pending.lock().remove(&id);
            return Err(Error::TerminalError("Daemon connection closed".into()));
        }

        match rx.await {
            Ok(response) => Ok(response),
            Err(_) => {
                // Clean up pending entry if response was dropped
                self.pending.lock().remove(&id);
                Err(Error::TerminalError("Daemon response dropped".into()))
            }
        }
    }

    pub async fn list_sessions(&self) -> Result<Vec<TerminalInfo>> {
        match self.send_request(DaemonRequest::ListSessions).await? {
            DaemonResponse::Sessions { sessions } => Ok(sessions),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn get_session(&self, terminal_id: &str) -> Result<TerminalInfo> {
        match self
            .send_request(DaemonRequest::GetSession { terminal_id: terminal_id.to_string() })
            .await?
        {
            DaemonResponse::Session { session } => Ok(session),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn create_session(
        &self,
        request: crate::daemon::protocol::CreateSessionRequest,
    ) -> Result<TerminalInfo> {
        match self
            .send_request(DaemonRequest::CreateSession { request })
            .await?
        {
            DaemonResponse::Session { session } => Ok(session),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn mark_session_stopped(&self, terminal_id: &str) -> Result<TerminalStatus> {
        match self
            .send_request(DaemonRequest::MarkSessionStopped { terminal_id: terminal_id.to_string() })
            .await?
        {
            DaemonResponse::TerminalStatusResponse { status, .. } => Ok(status),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn close_session(&self, terminal_id: &str) -> Result<()> {
        match self
            .send_request(DaemonRequest::CloseSession { terminal_id: terminal_id.to_string() })
            .await?
        {
            DaemonResponse::Ok => Ok(()),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn write_to_session(&self, terminal_id: &str, data: &str) -> Result<()> {
        match self
            .send_request(DaemonRequest::WriteToSession {
                terminal_id: terminal_id.to_string(),
                data: data.to_string(),
            })
            .await?
        {
            DaemonResponse::Ok => Ok(()),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn resize_session(&self, terminal_id: &str, cols: u16, rows: u16) -> Result<()> {
        match self
            .send_request(DaemonRequest::ResizeSession {
                terminal_id: terminal_id.to_string(),
                cols,
                rows,
            })
            .await?
        {
            DaemonResponse::Ok => Ok(()),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn restart_session(&self, terminal_id: &str) -> Result<TerminalInfo> {
        match self
            .send_request(DaemonRequest::RestartSession { terminal_id: terminal_id.to_string() })
            .await?
        {
            DaemonResponse::Session { session } => Ok(session),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn switch_session_agent(
        &self,
        terminal_id: &str,
        client_id: &str,
        command: crate::terminal::CommandSpec,
    ) -> Result<TerminalInfo> {
        match self
            .send_request(DaemonRequest::SwitchSessionAgent {
                terminal_id: terminal_id.to_string(),
                client_id: client_id.to_string(),
                command,
            })
            .await?
        {
            DaemonResponse::Session { session } => Ok(session),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn get_history(&self, terminal_id: &str) -> Result<Vec<String>> {
        match self
            .send_request(DaemonRequest::GetHistory { terminal_id: terminal_id.to_string() })
            .await?
        {
            DaemonResponse::History { history, .. } => Ok(history),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn get_runtime_config(&self) -> Result<RuntimeConfig> {
        match self.send_request(DaemonRequest::GetRuntimeConfig).await? {
            DaemonResponse::RuntimeConfig { config } => Ok(config),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    pub async fn set_shell_override(&self, shell: Option<String>) -> Result<()> {
        match self
            .send_request(DaemonRequest::SetShellOverride { shell })
            .await?
        {
            DaemonResponse::Ok => Ok(()),
            DaemonResponse::Error { message } => Err(Error::TerminalError(message)),
            _ => Err(Error::TerminalError("Unexpected daemon response".into())),
        }
    }

    /// Shutdown the daemon. Used in dev mode when GUI closes.
    pub async fn shutdown(&self) -> Result<()> {
        // Fire and forget - daemon will exit, so we may not get a response
        let _ = self.send_request(DaemonRequest::Shutdown).await;
        Ok(())
    }
}

fn emit_daemon_event(app_handle: &AppHandle, event: DaemonEvent) {
    match event {
        DaemonEvent::TerminalOutput { terminal_id, data } => {
            let _ = app_handle.emit(
                "terminal-output",
                TerminalOutput {
                    terminal_id,
                    data,
                },
            );
        }
        DaemonEvent::TerminalStatus { terminal_id, project_id, status } => {
            let _ = app_handle.emit(
                "terminal-status",
                serde_json::json!({
                    "terminal_id": terminal_id,
                    "project_id": project_id,
                    "status": status,
                }),
            );
        }
        DaemonEvent::AgentStatus { terminal_id, status } => {
            let _ = app_handle.emit(
                "agent-status-change",
                serde_json::json!({
                    "terminal_id": terminal_id,
                    "status": status,
                }),
            );
        }
        DaemonEvent::HookEvent { terminal_id, project_id, agent, event, payload } => {
            let _ = app_handle.emit(
                "hook-event",
                serde_json::json!({
                    "terminal_id": terminal_id,
                    "project_id": project_id,
                    "agent": agent,
                    "event": event,
                    "payload": payload,
                }),
            );
        }
    }
}

async fn ensure_daemon_running() -> Result<u16> {
    let data_dir = daemon_data_dir()?;
    let port_path = data_dir.join("daemon/port");

    if let Ok(port) = read_port(&port_path) {
        if probe_port(port).await {
            return Ok(port);
        }
    }

    spawn_daemon_process()?;

    let mut retries = 20;
    while retries > 0 {
        if let Ok(port) = read_port(&port_path) {
            if probe_port(port).await {
                return Ok(port);
            }
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        retries -= 1;
    }

    Err(Error::TerminalError("Daemon did not start".into()))
}

async fn probe_port(port: u16) -> bool {
    let addr = format!("127.0.0.1:{port}");
    TcpStream::connect(addr).await.is_ok()
}

fn read_port(path: &PathBuf) -> std::io::Result<u16> {
    let content = std::fs::read_to_string(path)?;
    content.trim().parse::<u16>().map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
}

fn daemon_data_dir() -> Result<PathBuf> {
    let dir_name = if cfg!(debug_assertions) { "ada-dev" } else { "ada" };
    Ok(dirs::data_dir()
        .ok_or_else(|| Error::ConfigError("Could not find data directory".into()))?
        .join(dir_name))
}

fn spawn_daemon_process() -> Result<()> {
    let mut daemon_path = resolve_daemon_path()?;
    if cfg!(debug_assertions) {
        let needs_build = if daemon_path.exists() {
            is_daemon_binary_stale(&daemon_path)
        } else {
            true
        };

        if needs_build {
            if let Ok(built_path) = build_daemon_in_dev() {
                daemon_path = built_path;
            }
        }
    }

    if !daemon_path.exists() {
        return Err(Error::TerminalError(format!(
            "Daemon binary not found at {}",
            daemon_path.display()
        )));
    }

    let mut cmd = Command::new(daemon_path);

    // Forward logging environment variables to the daemon
    for var in ["ADA_LOG_LEVEL", "ADA_LOG_STDERR", "ADA_LOG_DIR", "ADA_LOG_DISABLE"] {
        if let Ok(value) = std::env::var(var) {
            cmd.env(var, value);
        }
    }

    cmd.spawn()
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    Ok(())
}

fn resolve_daemon_path() -> Result<PathBuf> {
    let current_exe = std::env::current_exe()
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    let exe_name = if cfg!(windows) { "ada-daemon.exe" } else { "ada-daemon" };

    if let Some(parent) = current_exe.parent() {
        let candidate = parent.join(exe_name);
        if candidate.exists() {
            return Ok(candidate);
        }
    }

    Ok(PathBuf::from(exe_name))
}

fn is_daemon_binary_stale(binary_path: &PathBuf) -> bool {
    let binary_time = std::fs::metadata(binary_path)
        .and_then(|meta| meta.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
    let source_time = latest_daemon_source_mtime().unwrap_or(SystemTime::UNIX_EPOCH);
    source_time > binary_time
}

fn latest_daemon_source_mtime() -> Option<SystemTime> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let daemon_dir = manifest_dir.join("src/daemon");
    let entries = std::fs::read_dir(daemon_dir).ok()?;
    let mut latest = SystemTime::UNIX_EPOCH;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("rs") {
            continue;
        }
        if let Ok(modified) = std::fs::metadata(&path).and_then(|meta| meta.modified()) {
            if modified > latest {
                latest = modified;
            }
        }
    }

    Some(latest)
}

fn build_daemon_in_dev() -> Result<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let status = Command::new("cargo")
        .arg("build")
        .arg("--bin")
        .arg("ada-daemon")
        .current_dir(&manifest_dir)
        .status()
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    if !status.success() {
        return Err(Error::TerminalError("Failed to build ada-daemon".into()));
    }

    let exe_name = if cfg!(windows) { "ada-daemon.exe" } else { "ada-daemon" };
    let target_dir = std::env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| manifest_dir.join("target"));
    Ok(target_dir.join("debug").join(exe_name))
}
