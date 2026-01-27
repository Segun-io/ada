//! Shared path utilities for CLI and daemon
//!
//! These functions mirror the path logic in daemon/server.rs and daemon/client.rs
//! but can be called with an explicit dev_mode flag rather than relying on
//! cfg!(debug_assertions).

use std::path::PathBuf;

/// Get the data directory for Ada
///
/// - Dev: `~/Library/Application Support/ada-dev/` (macOS) or `~/.local/share/ada-dev/` (Linux)
/// - Prod: `~/Library/Application Support/ada/` (macOS) or `~/.local/share/ada/` (Linux)
pub fn data_dir(dev_mode: bool) -> Option<PathBuf> {
    let dir_name = if dev_mode { "ada-dev" } else { "ada" };
    dirs::data_dir().map(|d| d.join(dir_name))
}

/// Get the Ada home directory
///
/// - Dev: `~/.ada-dev/`
/// - Prod: `~/.ada/`
pub fn home_dir(dev_mode: bool) -> Option<PathBuf> {
    let dir_name = if dev_mode { ".ada-dev" } else { ".ada" };
    dirs::home_dir().map(|d| d.join(dir_name))
}

/// Get the daemon directory (inside data_dir)
pub fn daemon_dir(dev_mode: bool) -> Option<PathBuf> {
    data_dir(dev_mode).map(|d| d.join("daemon"))
}

/// Get the path to the PID file
pub fn pid_path(dev_mode: bool) -> Option<PathBuf> {
    daemon_dir(dev_mode).map(|d| d.join("pid"))
}

/// Get the path to the port file
pub fn port_path(dev_mode: bool) -> Option<PathBuf> {
    daemon_dir(dev_mode).map(|d| d.join("port"))
}

/// Get the log directory
///
/// - Dev: `~/.ada-dev/logs/`
/// - Prod: `~/.ada/logs/`
pub fn log_dir(dev_mode: bool) -> Option<PathBuf> {
    home_dir(dev_mode).map(|d| d.join("logs"))
}

/// Get the path to the daemon log file
pub fn daemon_log_path(dev_mode: bool) -> Option<PathBuf> {
    log_dir(dev_mode).map(|d| d.join("ada-daemon.log"))
}

/// Resolve the daemon binary path
///
/// Looks for the daemon binary in the following order:
/// 1. Next to the current executable
/// 2. In PATH (using which)
pub fn daemon_binary_path() -> Option<PathBuf> {
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
                return Some(candidate);
            }
        }
    }

    // Then check PATH
    which::which(exe_name).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dev_vs_prod_paths() {
        // Just ensure they differ
        let dev_data = data_dir(true);
        let prod_data = data_dir(false);
        assert_ne!(dev_data, prod_data);

        let dev_home = home_dir(true);
        let prod_home = home_dir(false);
        assert_ne!(dev_home, prod_home);
    }
}
