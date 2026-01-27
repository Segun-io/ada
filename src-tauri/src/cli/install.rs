//! CLI installation to system PATH
//!
//! Provides functionality to install the ada CLI to /usr/local/bin
//! so users can run `ada daemon status` from anywhere.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Installation status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallStatus {
    /// Whether the CLI is installed in PATH
    pub installed: bool,
    /// Path where the CLI is installed (e.g., /usr/local/bin/ada)
    pub install_path: Option<String>,
    /// Path to the bundled CLI binary
    pub bundled_path: Option<String>,
    /// Whether the installed version matches the bundled version
    pub up_to_date: bool,
    /// Whether installation is available (false in dev mode)
    pub can_install: bool,
}

/// Default installation path
#[cfg(unix)]
const INSTALL_PATH: &str = "/usr/local/bin/ada";

#[cfg(windows)]
const INSTALL_PATH: &str = "C:\\Program Files\\Ada\\ada.exe";

/// Check if CLI is installed in PATH
#[tauri::command]
pub fn check_cli_installed() -> Result<CliInstallStatus> {
    let install_path = PathBuf::from(INSTALL_PATH);
    let bundled_path = get_bundled_cli_path();

    let installed = install_path.exists();

    // Check if it's a symlink pointing to our bundled binary
    let up_to_date = if installed {
        if let Ok(target) = std::fs::read_link(&install_path) {
            bundled_path.as_ref().map(|b| target == *b).unwrap_or(false)
        } else {
            // Not a symlink, might be a copy or different installation
            false
        }
    } else {
        false
    };

    Ok(CliInstallStatus {
        installed,
        install_path: Some(INSTALL_PATH.to_string()),
        bundled_path: bundled_path.map(|p| p.to_string_lossy().to_string()),
        up_to_date,
        can_install: !is_dev_mode(),
    })
}

/// Check if we're in dev mode (installation not available)
fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

/// Install CLI to system PATH
///
/// On macOS/Linux: Creates symlink at /usr/local/bin/ada
/// Requires admin privileges (will prompt for password)
///
/// Note: Disabled in dev mode - use a production build to test
#[tauri::command]
pub async fn install_cli() -> Result<CliInstallStatus> {
    if is_dev_mode() {
        return Err(Error::TerminalError(
            "CLI installation is only available in production builds".into()
        ));
    }

    let bundled_path = get_bundled_cli_path()
        .ok_or_else(|| Error::TerminalError("Could not find bundled CLI binary".into()))?;

    if !bundled_path.exists() {
        return Err(Error::TerminalError(format!(
            "Bundled CLI not found at: {}",
            bundled_path.display()
        )));
    }

    #[cfg(unix)]
    {
        install_cli_unix(&bundled_path)?;
    }

    #[cfg(windows)]
    {
        install_cli_windows(&bundled_path)?;
    }

    check_cli_installed()
}

/// Uninstall CLI from system PATH
#[tauri::command]
pub async fn uninstall_cli() -> Result<CliInstallStatus> {
    #[cfg(unix)]
    {
        uninstall_cli_unix()?;
    }

    #[cfg(windows)]
    {
        uninstall_cli_windows()?;
    }

    check_cli_installed()
}

/// Get path to the bundled CLI binary
fn get_bundled_cli_path() -> Option<PathBuf> {
    let target_triple = get_target_triple();
    let sidecar_name = format!("ada-cli-{}", target_triple);

    if let Ok(current_exe) = std::env::current_exe() {
        // For bundled macOS apps: Ada.app/Contents/MacOS/Ada -> Ada.app/Contents/Resources/binaries/
        #[cfg(target_os = "macos")]
        {
            if let Some(macos_dir) = current_exe.parent() {
                if let Some(contents_dir) = macos_dir.parent() {
                    let resources_path = contents_dir.join("Resources/binaries").join(&sidecar_name);
                    if resources_path.exists() {
                        return Some(resources_path);
                    }
                }
            }
        }

        // For Windows/Linux: next to executable
        if let Some(parent) = current_exe.parent() {
            let candidate = parent.join(&sidecar_name);
            if candidate.exists() {
                return Some(candidate);
            }

            // Also check without target triple (dev mode)
            let plain_name = if cfg!(windows) { "ada-cli.exe" } else { "ada-cli" };
            let candidate = parent.join(plain_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(unix)]
fn install_cli_unix(bundled_path: &PathBuf) -> Result<()> {
    let install_path = INSTALL_PATH;
    let bundled_str = bundled_path.to_string_lossy();

    // Use osascript to run with admin privileges (will prompt for password)
    let script = format!(
        r#"do shell script "mkdir -p /usr/local/bin && ln -sf '{}' '{}'" with administrator privileges"#,
        bundled_str, install_path
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| Error::TerminalError(format!("Failed to run osascript: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err(Error::TerminalError("Installation cancelled by user".into()));
        }
        return Err(Error::TerminalError(format!(
            "Failed to install CLI: {}",
            stderr
        )));
    }

    tracing::info!(
        bundled = %bundled_str,
        install_path = install_path,
        "CLI installed successfully"
    );

    Ok(())
}

#[cfg(unix)]
fn uninstall_cli_unix() -> Result<()> {
    let install_path = INSTALL_PATH;

    // Check if it exists first
    if !PathBuf::from(install_path).exists() {
        return Ok(());
    }

    // Use osascript to run with admin privileges
    let script = format!(
        r#"do shell script "rm -f '{}'" with administrator privileges"#,
        install_path
    );

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| Error::TerminalError(format!("Failed to run osascript: {}", e)))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("canceled") {
            return Err(Error::TerminalError("Uninstallation cancelled by user".into()));
        }
        return Err(Error::TerminalError(format!(
            "Failed to uninstall CLI: {}",
            stderr
        )));
    }

    tracing::info!(install_path = install_path, "CLI uninstalled successfully");

    Ok(())
}

#[cfg(windows)]
fn install_cli_windows(bundled_path: &PathBuf) -> Result<()> {
    // On Windows, we copy the file instead of symlinking
    // and add to PATH via registry
    let install_dir = PathBuf::from("C:\\Program Files\\Ada");
    let install_path = install_dir.join("ada.exe");

    // Create directory and copy file (requires elevation)
    let bundled_str = bundled_path.to_string_lossy();
    let install_dir_str = install_dir.to_string_lossy();
    let install_path_str = install_path.to_string_lossy();

    let script = format!(
        r#"
        New-Item -ItemType Directory -Force -Path "{}"
        Copy-Item -Path "{}" -Destination "{}" -Force
        "#,
        install_dir_str, bundled_str, install_path_str
    );

    let output = Command::new("powershell")
        .arg("-Command")
        .arg(format!("Start-Process powershell -Verb RunAs -ArgumentList '-Command', '{}'", script.replace("'", "''")))
        .output()
        .map_err(|e| Error::TerminalError(format!("Failed to run PowerShell: {}", e)))?;

    if !output.status.success() {
        return Err(Error::TerminalError(format!(
            "Failed to install CLI: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(())
}

#[cfg(windows)]
fn uninstall_cli_windows() -> Result<()> {
    let install_path = PathBuf::from(INSTALL_PATH);

    if !install_path.exists() {
        return Ok(());
    }

    let script = format!(
        r#"Remove-Item -Path "{}" -Force"#,
        install_path.to_string_lossy()
    );

    let output = Command::new("powershell")
        .arg("-Command")
        .arg(format!("Start-Process powershell -Verb RunAs -ArgumentList '-Command', '{}'", script.replace("'", "''")))
        .output()
        .map_err(|e| Error::TerminalError(format!("Failed to run PowerShell: {}", e)))?;

    if !output.status.success() {
        return Err(Error::TerminalError(format!(
            "Failed to uninstall CLI: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }

    Ok(())
}

fn get_target_triple() -> &'static str {
    #[cfg(all(target_arch = "x86_64", target_os = "macos"))]
    return "x86_64-apple-darwin";

    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    return "aarch64-apple-darwin";

    #[cfg(all(target_arch = "x86_64", target_os = "linux"))]
    return "x86_64-unknown-linux-gnu";

    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    return "aarch64-unknown-linux-gnu";

    #[cfg(all(target_arch = "x86_64", target_os = "windows"))]
    return "x86_64-pc-windows-msvc";

    #[cfg(not(any(
        all(target_arch = "x86_64", target_os = "macos"),
        all(target_arch = "aarch64", target_os = "macos"),
        all(target_arch = "x86_64", target_os = "linux"),
        all(target_arch = "aarch64", target_os = "linux"),
        all(target_arch = "x86_64", target_os = "windows"),
    )))]
    return "unknown-unknown-unknown";
}
