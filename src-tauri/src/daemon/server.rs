use std::fs;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc as std_mpsc;
use std::time::Instant;

use parking_lot::RwLock as ParkingRwLock;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, mpsc, RwLock};

use crate::daemon::logging::init_daemon_logging;
use crate::daemon::notification::start_notification_server;
use crate::daemon::pid;
use crate::daemon::protocol::{DaemonEvent, DaemonMessage, DaemonRequest, DaemonResponse, RuntimeConfig};
use crate::daemon::session::SessionManager;
use crate::daemon::tray::{self, TrayCommand};
use crate::error::Result as AdaResult;
use tracing::{debug, error, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct RuntimeSettings {
    pub shell_override: Option<String>,
}

/// Buffer size for the event broadcast channel
/// Large enough to handle high-throughput terminal output without losing events
const EVENT_BUFFER_SIZE: usize = 4096;

/// Runs the daemon with system tray support.
///
/// On macOS, this must be called from the main thread because Cocoa requires
/// UI operations (like the system tray) to run on the main thread.
///
/// The function:
/// 1. Spawns the tokio runtime and IPC server on a background thread
/// 2. Runs the system tray event loop on the current (main) thread
///
/// This function never returns - it runs the event loop forever.
pub fn run_daemon_with_tray() -> ! {
    // Initialize logging on main thread
    let ada_home = ada_home_dir();
    let _log_guard = init_daemon_logging(&ada_home);
    info!("daemon starting with tray support");

    // Channel for tray commands
    let (tray_cmd_tx, tray_cmd_rx) = std_mpsc::channel();
    let (sessions_tx, sessions_rx) = std_mpsc::channel::<Vec<crate::terminal::TerminalInfo>>();

    // Spawn the async daemon on a background thread
    let tray_cmd_rx_clone = tray_cmd_rx;
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("failed to create tokio runtime");
        rt.block_on(async {
            if let Err(e) = run_daemon_async(tray_cmd_rx_clone, sessions_tx).await {
                error!("daemon error: {}", e);
            }
        });
    });

    // Wait for initial sessions from the daemon
    let initial_sessions = sessions_rx.recv().unwrap_or_default();

    // Run tray on main thread (required by macOS) - never returns
    tray::run_tray_on_main_thread(tray_cmd_tx, initial_sessions)
}

/// Internal async daemon implementation
async fn run_daemon_async(
    tray_cmd_rx: std_mpsc::Receiver<TrayCommand>,
    sessions_tx: std_mpsc::Sender<Vec<crate::terminal::TerminalInfo>>,
) -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let start_time = Instant::now();
    let data_dir = daemon_data_dir()?;
    let ada_home = ada_home_dir();

    info!(
        data_dir = %data_dir.display(),
        ada_home = %ada_home.display(),
        "daemon async starting"
    );

    fs::create_dir_all(&data_dir)?;
    fs::create_dir_all(&ada_home)?;

    let settings = load_runtime_settings(&ada_home);
    let shell_override = Arc::new(ParkingRwLock::new(settings.shell_override.clone()));

    // Single broadcast channel for all events with large buffer
    let (event_tx, _) = broadcast::channel(EVENT_BUFFER_SIZE);
    let notification_port = start_notification_server(event_tx.clone()).await?;
    info!(notification_port, "notification server started");

    let manager = SessionManager::new(
        &data_dir,
        &ada_home,
        event_tx.clone(),
        notification_port,
        shell_override.clone(),
    )?;

    // Send initial sessions to tray
    let initial_sessions = manager.list_sessions();
    let _ = sessions_tx.send(initial_sessions);

    // Task to update agent status in session manager and notify tray when events arrive
    {
        let manager_for_events = manager.clone();
        let mut agent_rx = event_tx.subscribe();
        tokio::spawn(async move {
            while let Ok(event) = agent_rx.recv().await {
                match event {
                    DaemonEvent::AgentStatus { terminal_id, status } => {
                        manager_for_events.update_agent_status(&terminal_id, status);
                        // Notify tray of session changes
                        let sessions = manager_for_events.list_sessions();
                        tray::notify_sessions_changed(sessions);
                    }
                    DaemonEvent::TerminalStatus { .. } => {
                        // Notify tray when terminal status changes
                        let sessions = manager_for_events.list_sessions();
                        tray::notify_sessions_changed(sessions);
                    }
                    _ => {}
                }
            }
        });
    }

    let runtime = RuntimeConfig {
        ada_home: ada_home.to_string_lossy().to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
        daemon_port: 0,
        notification_port,
        shell_override: settings.shell_override,
    };
    let runtime = Arc::new(RwLock::new(runtime));

    serve_ipc(data_dir, manager, runtime, event_tx, shell_override, tray_cmd_rx, start_time).await?;
    Ok(())
}

/// Original daemon entry point (without tray - for backwards compatibility)
pub async fn run_daemon() -> std::result::Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let start_time = Instant::now();
    let data_dir = daemon_data_dir()?;
    let ada_home = ada_home_dir();

    let _log_guard = init_daemon_logging(&ada_home);
    info!(
        data_dir = %data_dir.display(),
        ada_home = %ada_home.display(),
        "daemon starting"
    );

    fs::create_dir_all(&data_dir)?;
    fs::create_dir_all(&ada_home)?;

    let settings = load_runtime_settings(&ada_home);
    let shell_override = Arc::new(ParkingRwLock::new(settings.shell_override.clone()));

    // Single broadcast channel for all events with large buffer
    let (event_tx, _) = broadcast::channel(EVENT_BUFFER_SIZE);
    let notification_port = start_notification_server(event_tx.clone()).await?;
    info!(notification_port, "notification server started");

    let manager = SessionManager::new(
        &data_dir,
        &ada_home,
        event_tx.clone(),
        notification_port,
        shell_override.clone(),
    )?;

    // Task to update agent status in session manager when status events arrive
    {
        let manager_for_events = manager.clone();
        let mut agent_rx = event_tx.subscribe();
        tokio::spawn(async move {
            while let Ok(event) = agent_rx.recv().await {
                if let DaemonEvent::AgentStatus { terminal_id, status } = event {
                    manager_for_events.update_agent_status(&terminal_id, status);
                }
            }
        });
    }

    let runtime = RuntimeConfig {
        ada_home: ada_home.to_string_lossy().to_string(),
        data_dir: data_dir.to_string_lossy().to_string(),
        daemon_port: 0,
        notification_port,
        shell_override: settings.shell_override,
    };
    let runtime = Arc::new(RwLock::new(runtime));

    // No tray - create dummy receiver that never receives
    let (_tray_cmd_tx, tray_cmd_rx) = std_mpsc::channel();

    serve_ipc(data_dir, manager, runtime, event_tx, shell_override, tray_cmd_rx, start_time).await?;
    Ok(())
}

async fn serve_ipc(
    data_dir: PathBuf,
    manager: SessionManager,
    runtime: Arc<RwLock<RuntimeConfig>>,
    event_tx: broadcast::Sender<DaemonEvent>,
    shell_override: Arc<ParkingRwLock<Option<String>>>,
    tray_cmd_rx: std_mpsc::Receiver<TrayCommand>,
    start_time: Instant,
) -> AdaResult<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    info!(daemon_port = addr.port(), "daemon listening");

    runtime.write().await.daemon_port = addr.port();

    // Write PID and port files
    let daemon_dir = data_dir.join("daemon");
    if let Err(e) = pid::write_pid(&daemon_dir) {
        warn!(error = %e, "failed to write PID file");
    }
    write_port_file(&data_dir, addr)?;

    // Spawn a blocking task to handle tray commands (std::sync::mpsc is blocking)
    let _tray_task = std::thread::spawn(move || {
        loop {
            match tray_cmd_rx.recv() {
                Ok(TrayCommand::Quit) => {
                    info!("quit command received from tray");
                    // Exit the daemon
                    std::process::exit(0);
                }
                Ok(TrayCommand::OpenApp) => {
                    tray::open_main_app();
                }
                Ok(TrayCommand::SelectSession(terminal_id)) => {
                    info!(terminal_id = %terminal_id, "session selected from tray");
                    // For now, just open the app - in the future could focus the terminal
                    tray::open_main_app();
                }
                Err(_) => {
                    // Channel closed (tray exited)
                    warn!("tray command channel closed");
                    break;
                }
            }
        }
    });

    // Accept connections in the main loop
    let daemon_port = addr.port();
    loop {
        let (stream, _) = listener.accept().await?;
        let peer = stream.peer_addr().ok();
        let manager = manager.clone();
        let runtime = runtime.clone();
        let event_tx = event_tx.clone();
        let shell_override = shell_override.clone();

        tokio::spawn(async move {
            info!(peer = ?peer, "ipc connection accepted");
            let (reader, writer) = stream.into_split();
            let mut reader = BufReader::new(reader).lines();

            let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

            let write_task = tokio::spawn(async move {
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

            // Forward all events to IPC
            let mut event_rx = event_tx.subscribe();
            let out_tx_events = out_tx.clone();
            let event_task = tokio::spawn(async move {
                loop {
                    match event_rx.recv().await {
                        Ok(event) => {
                            let message = DaemonMessage::Event { event };
                            if let Ok(json) = serde_json::to_string(&message) {
                                if out_tx_events.send(json).is_err() {
                                    break;
                                }
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            warn!(lagged = n, "IPC client lagged, some events were dropped");
                            // Continue receiving
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            break;
                        }
                    }
                }
            });

            while let Ok(Some(line)) = reader.next_line().await {
                let message: DaemonMessage = match serde_json::from_str(&line) {
                    Ok(msg) => msg,
                    Err(err) => {
                        warn!(error = %err, "ipc message parse failed");
                        continue;
                    }
                };

                let (id, request) = match message {
                    DaemonMessage::Request { id, request } => (id, request),
                    _ => continue,
                };

                debug!(request = request_kind(&request), request_id = %id, "ipc request");
                let response = handle_request(&manager, &runtime, request, &shell_override, start_time, daemon_port).await;
                let message = DaemonMessage::Response { id, response };
                if let Ok(json) = serde_json::to_string(&message) {
                    let _ = out_tx.send(json);
                }
            }

            event_task.abort();
            write_task.abort();
            warn!(peer = ?peer, "ipc connection closed");
        });
    }
}

async fn handle_request(
    manager: &SessionManager,
    runtime: &Arc<RwLock<RuntimeConfig>>,
    request: DaemonRequest,
    shell_override: &Arc<ParkingRwLock<Option<String>>>,
    start_time: Instant,
    daemon_port: u16,
) -> DaemonResponse {
    let kind = request_kind(&request);
    let response = match request {
        DaemonRequest::Ping => DaemonResponse::Pong,
        DaemonRequest::Status => {
            let uptime = start_time.elapsed().as_secs();
            let session_count = manager.list_sessions().len();
            DaemonResponse::DaemonStatus {
                pid: std::process::id(),
                port: daemon_port,
                uptime_secs: uptime,
                session_count,
                version: env!("CARGO_PKG_VERSION").to_string(),
            }
        }
        DaemonRequest::ListSessions => {
            let sessions = manager.list_sessions();
            DaemonResponse::Sessions { sessions }
        }
        DaemonRequest::GetSession { terminal_id } => {
            match manager.get_session(&terminal_id) {
                Ok(session) => DaemonResponse::Session { session },
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::CreateSession { request } => {
            match manager.create_session(request) {
                Ok(session) => {
                    // Notify tray of new session
                    tray::notify_sessions_changed(manager.list_sessions());
                    DaemonResponse::Session { session }
                }
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::MarkSessionStopped { terminal_id } => {
            match manager.mark_session_stopped(&terminal_id) {
                Ok(status) => {
                    // Notify tray of status change
                    tray::notify_sessions_changed(manager.list_sessions());
                    DaemonResponse::TerminalStatusResponse { terminal_id, status }
                }
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::CloseSession { terminal_id } => {
            match manager.close_session(&terminal_id) {
                Ok(()) => {
                    // Notify tray of closed session
                    tray::notify_sessions_changed(manager.list_sessions());
                    DaemonResponse::Ok
                }
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::WriteToSession { terminal_id, data } => {
            match manager.write_to_session(&terminal_id, &data) {
                Ok(()) => DaemonResponse::Ok,
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::ResizeSession { terminal_id, cols, rows } => {
            match manager.resize_session(&terminal_id, cols, rows) {
                Ok(()) => DaemonResponse::Ok,
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::RestartSession { terminal_id } => {
            info!(terminal_id = %terminal_id, "restart_session request received");
            match manager.restart_session(&terminal_id) {
                Ok(session) => {
                    info!(
                        terminal_id = %terminal_id,
                        status = ?session.status,
                        "restart_session completed successfully"
                    );
                    // Notify tray of restarted session
                    tray::notify_sessions_changed(manager.list_sessions());
                    DaemonResponse::Session { session }
                }
                Err(err) => {
                    error!(
                        terminal_id = %terminal_id,
                        error = %err,
                        "restart_session failed"
                    );
                    DaemonResponse::Error { message: err.to_string() }
                }
            }
        }
        DaemonRequest::SwitchSessionAgent { terminal_id, client_id, command } => {
            match manager.switch_session_agent(&terminal_id, &client_id, command) {
                Ok(session) => {
                    // Notify tray of agent switch
                    tray::notify_sessions_changed(manager.list_sessions());
                    DaemonResponse::Session { session }
                }
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::GetHistory { terminal_id } => {
            match manager.get_history(&terminal_id) {
                Ok(history) => DaemonResponse::History { terminal_id, history },
                Err(err) => DaemonResponse::Error { message: err.to_string() },
            }
        }
        DaemonRequest::GetRuntimeConfig => {
            let config = runtime.read().await.clone();
            DaemonResponse::RuntimeConfig { config }
        }
        DaemonRequest::SetShellOverride { shell } => {
            {
                let mut override_value = shell_override.write();
                *override_value = shell.clone();
            }
            {
                let mut config = runtime.write().await;
                config.shell_override = shell.clone();
                let _ = save_runtime_settings(&config, Path::new(&config.ada_home));
            }
            DaemonResponse::Ok
        }
        DaemonRequest::Shutdown => {
            info!("Shutdown request received, exiting daemon");
            // Spawn a task to exit after a short delay to allow response to be sent
            tokio::spawn(async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                std::process::exit(0);
            });
            DaemonResponse::Ok
        }
    };

    if let DaemonResponse::Error { ref message } = response {
        warn!(request = kind, error = %message, "ipc request failed");
    }

    response
}

fn request_kind(request: &DaemonRequest) -> &'static str {
    match request {
        DaemonRequest::Ping => "ping",
        DaemonRequest::Status => "status",
        DaemonRequest::ListSessions => "list_sessions",
        DaemonRequest::GetSession { .. } => "get_session",
        DaemonRequest::CreateSession { .. } => "create_session",
        DaemonRequest::MarkSessionStopped { .. } => "mark_session_stopped",
        DaemonRequest::CloseSession { .. } => "close_session",
        DaemonRequest::WriteToSession { .. } => "write_to_session",
        DaemonRequest::ResizeSession { .. } => "resize_session",
        DaemonRequest::RestartSession { .. } => "restart_session",
        DaemonRequest::SwitchSessionAgent { .. } => "switch_session_agent",
        DaemonRequest::GetHistory { .. } => "get_history",
        DaemonRequest::GetRuntimeConfig => "get_runtime_config",
        DaemonRequest::SetShellOverride { .. } => "set_shell_override",
        DaemonRequest::Shutdown => "shutdown",
    }
}

fn daemon_data_dir() -> AdaResult<PathBuf> {
    let dir_name = if cfg!(debug_assertions) { "ada-dev" } else { "ada" };
    Ok(dirs::data_dir()
        .ok_or_else(|| crate::error::Error::ConfigError("Could not find data directory".into()))?
        .join(dir_name))
}

fn ada_home_dir() -> PathBuf {
    let dir_name = if cfg!(debug_assertions) { ".ada-dev" } else { ".ada" };
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(dir_name)
}

fn runtime_settings_path(ada_home: &Path) -> PathBuf {
    ada_home.join("config/runtime.json")
}

fn load_runtime_settings(ada_home: &Path) -> RuntimeSettings {
    let path = runtime_settings_path(ada_home);
    if let Ok(content) = fs::read_to_string(&path) {
        match serde_json::from_str::<RuntimeSettings>(&content) {
            Ok(settings) => return settings,
            Err(e) => {
                tracing::warn!("Corrupt runtime settings {}: {}", path.display(), e);
            }
        }
    }
    RuntimeSettings::default()
}

fn save_runtime_settings(config: &RuntimeConfig, ada_home: &Path) -> std::io::Result<()> {
    let settings = RuntimeSettings {
        shell_override: config.shell_override.clone(),
    };
    let path = runtime_settings_path(ada_home);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(&settings)?;
    crate::util::atomic_write(&path, json.as_bytes())?;
    Ok(())
}

fn write_port_file(data_dir: &Path, addr: SocketAddr) -> std::io::Result<()> {
    let daemon_dir = data_dir.join("daemon");
    fs::create_dir_all(&daemon_dir)?;
    fs::write(daemon_dir.join("port"), addr.port().to_string())
}
