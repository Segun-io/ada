//! Daemon lifecycle management commands
//!
//! Implements start, stop, status, restart, and logs commands for the CLI.

use std::fs;
use std::io::{self, BufRead, Seek, SeekFrom, Write};
use std::path::Path;
use std::process::Command;
use std::time::Duration;

use crate::cli::paths;

/// Daemon status information
#[derive(Debug)]
pub struct DaemonStatus {
    pub running: bool,
    pub pid: Option<u32>,
    pub port: Option<u16>,
}

/// Start the daemon
///
/// If `foreground` is true, runs in the current process (useful for debugging).
/// Otherwise spawns a detached daemon process.
pub fn start(dev_mode: bool, foreground: bool) -> Result<(), String> {
    // Check if already running
    let status = get_status(dev_mode);
    if status.running {
        return Err(format!(
            "Daemon already running (PID: {}, port: {})",
            status.pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into()),
            status.port.map(|p| p.to_string()).unwrap_or_else(|| "?".into())
        ));
    }

    // Clean up stale files
    cleanup_stale_files(dev_mode);

    if foreground {
        println!("Starting daemon in foreground (Ctrl+C to stop)...");
        run_daemon_foreground(dev_mode)?;
    } else {
        spawn_daemon_background(dev_mode)?;

        // Wait for daemon to start
        print!("Starting daemon");
        io::stdout().flush().ok();

        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(250));
            print!(".");
            io::stdout().flush().ok();

            let status = get_status(dev_mode);
            if status.running {
                println!(" started!");
                println!(
                    "Daemon running (PID: {}, port: {})",
                    status.pid.map(|p| p.to_string()).unwrap_or_else(|| "?".into()),
                    status.port.map(|p| p.to_string()).unwrap_or_else(|| "?".into())
                );
                return Ok(());
            }
        }

        println!(" failed!");
        return Err("Daemon did not start within 5 seconds".into());
    }

    Ok(())
}

/// Stop the daemon
pub fn stop(dev_mode: bool) -> Result<(), String> {
    let status = get_status(dev_mode);

    if !status.running {
        return Err("Daemon is not running".into());
    }

    // First try graceful shutdown via IPC
    if let Some(port) = status.port {
        if send_shutdown_request(port) {
            // Wait for process to exit
            print!("Stopping daemon");
            io::stdout().flush().ok();

            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(250));
                print!(".");
                io::stdout().flush().ok();

                let status = get_status(dev_mode);
                if !status.running {
                    println!(" stopped!");
                    cleanup_stale_files(dev_mode);
                    return Ok(());
                }
            }
        }
    }

    // Fall back to SIGTERM
    #[cfg(unix)]
    if let Some(pid) = status.pid {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;

        println!("Sending SIGTERM to PID {}...", pid);
        if kill(Pid::from_raw(pid as i32), Signal::SIGTERM).is_ok() {
            // Wait for process to exit
            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(250));
                if !is_process_running(pid) {
                    println!("Daemon stopped");
                    cleanup_stale_files(dev_mode);
                    return Ok(());
                }
            }

            // Force kill if still running
            println!("Daemon not responding, sending SIGKILL...");
            let _ = kill(Pid::from_raw(pid as i32), Signal::SIGKILL);
            std::thread::sleep(Duration::from_millis(500));
        }

        cleanup_stale_files(dev_mode);
        return Ok(());
    }

    cleanup_stale_files(dev_mode);
    Err("Could not stop daemon".into())
}

/// Show daemon status
pub fn status(dev_mode: bool) -> Result<(), String> {
    let status = get_status(dev_mode);

    let mode = if dev_mode { "development" } else { "production" };

    if status.running {
        println!("Daemon status: running ({})", mode);
        if let Some(pid) = status.pid {
            println!("  PID:  {}", pid);
        }
        if let Some(port) = status.port {
            println!("  Port: {}", port);
        }

        // Show data paths
        if let Some(data_dir) = paths::data_dir(dev_mode) {
            println!("  Data: {}", data_dir.display());
        }
        if let Some(log_path) = paths::daemon_log_path(dev_mode) {
            println!("  Logs: {}", log_path.display());
        }
    } else {
        println!("Daemon status: not running ({})", mode);

        // Check for stale files
        let has_stale_pid = paths::pid_path(dev_mode)
            .map(|p| p.exists())
            .unwrap_or(false);
        let has_stale_port = paths::port_path(dev_mode)
            .map(|p| p.exists())
            .unwrap_or(false);

        if has_stale_pid || has_stale_port {
            println!("  (stale files detected - will be cleaned on next start)");
        }
    }

    Ok(())
}

/// Restart the daemon
pub fn restart(dev_mode: bool) -> Result<(), String> {
    let status = get_status(dev_mode);

    if status.running {
        println!("Stopping daemon...");
        stop(dev_mode)?;
    }

    println!("Starting daemon...");
    start(dev_mode, false)
}

/// View daemon logs
pub fn logs(dev_mode: bool, follow: bool, lines: usize) -> Result<(), String> {
    let log_dir = paths::log_dir(dev_mode)
        .ok_or("Could not determine log directory")?;

    // Find the latest log file (tracing_appender creates rolling logs like ada-daemon.log.2026-01-27)
    let log_path = find_latest_log_file(&log_dir, "ada-daemon.log")
        .ok_or_else(|| format!("No log files found in: {}", log_dir.display()))?;

    if follow {
        tail_follow(&log_path, lines)?;
    } else {
        tail_file(&log_path, lines)?;
    }

    Ok(())
}

/// Find the latest log file matching a prefix (handles rolling logs with date suffixes)
fn find_latest_log_file(log_dir: &Path, prefix: &str) -> Option<std::path::PathBuf> {
    let entries = fs::read_dir(log_dir).ok()?;

    let mut log_files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|name| name.starts_with(prefix))
                .unwrap_or(false)
        })
        .collect();

    // Sort by modification time (newest first)
    log_files.sort_by(|a, b| {
        let a_time = a.metadata().and_then(|m| m.modified()).ok();
        let b_time = b.metadata().and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });

    log_files.first().map(|e| e.path())
}

/// Get current daemon status
pub fn get_status(dev_mode: bool) -> DaemonStatus {
    let pid = read_pid(dev_mode);
    let port = read_port(dev_mode);

    // Check if process is actually running
    let running = if let Some(pid) = pid {
        is_process_running(pid)
    } else if let Some(port) = port {
        // No PID file but port file exists - probe the port
        probe_port(port)
    } else {
        false
    };

    DaemonStatus { running, pid, port }
}

/// Read PID from file
fn read_pid(dev_mode: bool) -> Option<u32> {
    let pid_path = paths::pid_path(dev_mode)?;
    let content = fs::read_to_string(pid_path).ok()?;
    content.trim().parse().ok()
}

/// Read port from file
fn read_port(dev_mode: bool) -> Option<u16> {
    let port_path = paths::port_path(dev_mode)?;
    let content = fs::read_to_string(port_path).ok()?;
    content.trim().parse().ok()
}

/// Check if a process is running by PID
#[cfg(unix)]
fn is_process_running(pid: u32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;

    // Signal 0 doesn't send a signal but checks if process exists
    kill(Pid::from_raw(pid as i32), None).is_ok()
}

#[cfg(not(unix))]
fn is_process_running(_pid: u32) -> bool {
    // On non-Unix, fall back to port probing
    false
}

/// Probe if the daemon port is responding
fn probe_port(port: u16) -> bool {
    use std::net::TcpStream;
    TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok()
}

/// Send shutdown request via IPC
fn send_shutdown_request(port: u16) -> bool {
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpStream;

    let addr = format!("127.0.0.1:{}", port);
    let mut stream = match TcpStream::connect(&addr) {
        Ok(s) => s,
        Err(_) => return false,
    };

    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
    stream.set_write_timeout(Some(Duration::from_secs(5))).ok();

    let request = serde_json::json!({
        "type": "request",
        "id": uuid::Uuid::new_v4().to_string(),
        "request": { "type": "shutdown" }
    });

    let json = match serde_json::to_string(&request) {
        Ok(j) => j,
        Err(_) => return false,
    };

    if stream.write_all(json.as_bytes()).is_err() {
        return false;
    }
    if stream.write_all(b"\n").is_err() {
        return false;
    }

    // Try to read response (may timeout if daemon exits immediately)
    let mut reader = BufReader::new(&stream);
    let mut response = String::new();
    let _ = reader.read_line(&mut response);

    true
}

/// Clean up stale PID and port files
fn cleanup_stale_files(dev_mode: bool) {
    if let Some(pid_path) = paths::pid_path(dev_mode) {
        let _ = fs::remove_file(pid_path);
    }
    if let Some(port_path) = paths::port_path(dev_mode) {
        let _ = fs::remove_file(port_path);
    }
}

/// Spawn daemon as a background process
fn spawn_daemon_background(dev_mode: bool) -> Result<(), String> {
    let daemon_path = paths::daemon_binary_path()
        .ok_or("Could not find ada-daemon binary")?;

    if !daemon_path.exists() {
        return Err(format!(
            "Daemon binary not found at: {}\nRun 'cargo build --bin ada-daemon' to build it.",
            daemon_path.display()
        ));
    }

    let mut cmd = Command::new(&daemon_path);

    // Set dev mode via environment variable
    // The daemon uses cfg!(debug_assertions) but we need runtime control
    // So we'll check ADA_DEV_MODE env var in the daemon
    if dev_mode {
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
        .map_err(|e| format!("Failed to spawn daemon: {}", e))?;

    Ok(())
}

/// Run daemon in foreground (for --foreground flag)
fn run_daemon_foreground(_dev_mode: bool) -> Result<(), String> {
    // This directly runs the daemon code in the current process
    // Useful for debugging - logs go to stderr

    // Set environment so daemon knows to log to stderr
    std::env::set_var("ADA_LOG_STDERR", "1");

    // The daemon's run_daemon_with_tray() never returns
    crate::daemon::run_daemon_with_tray();
}

/// Show last N lines of a file
fn tail_file(path: &Path, lines: usize) -> Result<(), String> {
    let file = fs::File::open(path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    let reader = io::BufReader::new(file);
    let all_lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    let start = all_lines.len().saturating_sub(lines);
    for line in &all_lines[start..] {
        println!("{}", line);
    }

    Ok(())
}

/// Follow a file (like tail -f)
fn tail_follow(path: &Path, initial_lines: usize) -> Result<(), String> {
    // First show initial lines
    tail_file(path, initial_lines)?;

    // Then follow
    println!("--- Following log (Ctrl+C to stop) ---");

    let mut file = fs::File::open(path)
        .map_err(|e| format!("Failed to open log file: {}", e))?;

    // Seek to end
    file.seek(SeekFrom::End(0))
        .map_err(|e| format!("Failed to seek: {}", e))?;

    let mut reader = io::BufReader::new(file);

    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => {
                // No data - wait and retry
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(_) => {
                print!("{}", line);
                io::stdout().flush().ok();
            }
            Err(e) => {
                return Err(format!("Error reading log: {}", e));
            }
        }
    }
}
