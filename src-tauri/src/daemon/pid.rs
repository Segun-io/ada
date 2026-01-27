//! PID file management for the daemon
//!
//! Provides functions to write, read, and cleanup PID files for daemon lifecycle management.

use std::fs;
use std::io;
use std::path::Path;

/// Write the current process PID to the PID file
pub fn write_pid(daemon_dir: &Path) -> io::Result<()> {
    fs::create_dir_all(daemon_dir)?;
    let pid_path = daemon_dir.join("pid");
    let pid = std::process::id();
    crate::util::atomic_write(&pid_path, pid.to_string().as_bytes())?;
    tracing::info!(pid = pid, path = %pid_path.display(), "wrote PID file");
    Ok(())
}

/// Read the PID from the PID file
pub fn read_pid(daemon_dir: &Path) -> Option<u32> {
    let pid_path = daemon_dir.join("pid");
    let content = fs::read_to_string(&pid_path).ok()?;
    content.trim().parse().ok()
}

/// Remove the PID file
pub fn remove_pid(daemon_dir: &Path) -> io::Result<()> {
    let pid_path = daemon_dir.join("pid");
    if pid_path.exists() {
        fs::remove_file(&pid_path)?;
        tracing::info!(path = %pid_path.display(), "removed PID file");
    }
    Ok(())
}

/// Check if a process with the given PID is running
#[cfg(unix)]
pub fn is_process_running(pid: u32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;

    // Signal 0 doesn't send a signal but checks if process exists
    kill(Pid::from_raw(pid as i32), None).is_ok()
}

#[cfg(not(unix))]
pub fn is_process_running(_pid: u32) -> bool {
    // On non-Unix systems, we can't easily check
    // Fall back to assuming it's not running
    false
}

/// Cleanup stale PID file if the process is no longer running
pub fn cleanup_stale_pid(daemon_dir: &Path) {
    if let Some(pid) = read_pid(daemon_dir) {
        if !is_process_running(pid) {
            let _ = remove_pid(daemon_dir);
            // Also remove stale port file
            let port_path = daemon_dir.join("port");
            if port_path.exists() {
                let _ = fs::remove_file(&port_path);
            }
            tracing::info!(pid = pid, "cleaned up stale PID file");
        }
    }
}
