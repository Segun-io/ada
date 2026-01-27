//! Tauri commands for daemon management
//!
//! These commands allow the GUI to check daemon status, connect to it,
//! and optionally start it with user consent.

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::error::{Error, Result};
use crate::state::AppState;

/// Daemon status information returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonStatusInfo {
    pub running: bool,
    pub connected: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
    pub uptime_secs: Option<u64>,
    pub session_count: Option<usize>,
    pub version: Option<String>,
}

/// Connection state for the daemon
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ConnectionState {
    /// Daemon is connected and working
    Connected,
    /// Daemon is running but not connected
    Disconnected,
    /// Daemon is not running
    NotRunning,
    /// Connecting to daemon
    Connecting,
}

/// Check daemon status without connecting
#[tauri::command]
pub async fn check_daemon_status() -> Result<DaemonStatusInfo> {
    let dev_mode = cfg!(debug_assertions);
    let port = read_port(dev_mode);
    let pid = read_pid(dev_mode);

    // Check if port is responding
    let running = port.map(probe_port).unwrap_or(false);

    if running {
        // Try to get detailed status via IPC
        if let Some(port) = port {
            if let Ok(status) = query_daemon_status(port) {
                return Ok(status);
            }
        }
    }

    Ok(DaemonStatusInfo {
        running,
        connected: false,
        pid,
        port,
        uptime_secs: None,
        session_count: None,
        version: None,
    })
}

/// Connect to the daemon (state will hold the connection)
#[tauri::command]
pub async fn connect_to_daemon(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<DaemonStatusInfo> {
    // Try to connect
    state.connect_daemon(app_handle).await?;

    // Return status
    check_daemon_status().await
}

/// Start the daemon process
#[tauri::command]
pub async fn start_daemon() -> Result<()> {
    let daemon_path = resolve_daemon_path()?;

    if !daemon_path.exists() {
        return Err(Error::TerminalError(format!(
            "Daemon binary not found at {}",
            daemon_path.display()
        )));
    }

    let mut cmd = Command::new(&daemon_path);

    // Set dev mode via environment variable if needed
    if cfg!(debug_assertions) {
        cmd.env("ADA_DEV_MODE", "1");
    }

    // Forward logging environment variables
    for var in ["ADA_LOG_LEVEL", "ADA_LOG_STDERR", "ADA_LOG_DIR", "ADA_LOG_DISABLE"] {
        if let Ok(value) = std::env::var(var) {
            cmd.env(var, value);
        }
    }

    // Detach from current process
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            cmd.pre_exec(|| {
                // Create new session to detach from terminal
                let _ = nix::libc::setsid();
                Ok(())
            });
        }
    }

    cmd.spawn()
        .map_err(|e| Error::TerminalError(format!("Failed to spawn daemon: {}", e)))?;

    // Wait for daemon to start
    for _ in 0..20 {
        std::thread::sleep(Duration::from_millis(250));

        let port = read_port(cfg!(debug_assertions));
        if let Some(port) = port {
            if probe_port(port) {
                return Ok(());
            }
        }
    }

    Err(Error::TerminalError("Daemon did not start within 5 seconds".into()))
}

/// Get connection state
#[tauri::command]
pub fn get_connection_state(state: State<'_, AppState>) -> ConnectionState {
    state.get_connection_state()
}

// Helper functions

fn daemon_data_dir(dev_mode: bool) -> Option<PathBuf> {
    let dir_name = if dev_mode { "ada-dev" } else { "ada" };
    dirs::data_dir().map(|d| d.join(dir_name))
}

fn read_port(dev_mode: bool) -> Option<u16> {
    let port_path = daemon_data_dir(dev_mode)?.join("daemon/port");
    let content = std::fs::read_to_string(port_path).ok()?;
    content.trim().parse().ok()
}

fn read_pid(dev_mode: bool) -> Option<u32> {
    let pid_path = daemon_data_dir(dev_mode)?.join("daemon/pid");
    let content = std::fs::read_to_string(pid_path).ok()?;
    content.trim().parse().ok()
}

fn probe_port(port: u16) -> bool {
    TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

fn resolve_daemon_path() -> Result<PathBuf> {
    let exe_name = if cfg!(windows) {
        "ada-daemon.exe"
    } else {
        "ada-daemon"
    };

    // First, check next to current executable
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let candidate = parent.join(exe_name);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Then check PATH
    which::which(exe_name)
        .map_err(|_| Error::TerminalError(format!("Could not find {} in PATH", exe_name)))
}

fn query_daemon_status(port: u16) -> Result<DaemonStatusInfo> {
    use std::io::{BufRead, BufReader, Write};

    let addr = format!("127.0.0.1:{}", port);
    let mut stream = TcpStream::connect(&addr)
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let request = serde_json::json!({
        "type": "request",
        "id": uuid::Uuid::new_v4().to_string(),
        "request": { "type": "status" }
    });

    let json = serde_json::to_string(&request)?;
    stream.write_all(json.as_bytes())
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    stream.write_all(b"\n")
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    let mut reader = BufReader::new(&stream);
    let mut response = String::new();
    reader.read_line(&mut response)
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    // Parse response
    let parsed: serde_json::Value = serde_json::from_str(&response)?;

    if let Some(resp) = parsed.get("response") {
        if resp.get("type").and_then(|t| t.as_str()) == Some("daemon_status") {
            return Ok(DaemonStatusInfo {
                running: true,
                connected: false, // Will be updated by caller
                pid: resp.get("pid").and_then(|v| v.as_u64()).map(|v| v as u32),
                port: Some(port),
                uptime_secs: resp.get("uptime_secs").and_then(|v| v.as_u64()),
                session_count: resp.get("session_count").and_then(|v| v.as_u64()).map(|v| v as usize),
                version: resp.get("version").and_then(|v| v.as_str()).map(|s| s.to_string()),
            });
        }
    }

    Ok(DaemonStatusInfo {
        running: true,
        connected: false,
        pid: None,
        port: Some(port),
        uptime_secs: None,
        session_count: None,
        version: None,
    })
}
