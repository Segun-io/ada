use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use tauri::AppHandle;

use crate::project::AdaProject;
use crate::daemon::client::DaemonClient;
use crate::daemon::tauri_commands::ConnectionState;
use crate::clients::ClientConfig;
use crate::error::{Error, Result};

pub struct AppState {
    pub projects: RwLock<HashMap<String, AdaProject>>,
    pub clients: RwLock<HashMap<String, ClientConfig>>,
    pub data_dir: PathBuf,
    /// Daemon client - Optional in production mode, connected with user consent
    pub daemon: RwLock<Option<Arc<DaemonClient>>>,
    /// Stored app handle for reconnection
    app_handle: RwLock<Option<AppHandle>>,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self> {
        let dir_name = if cfg!(debug_assertions) { "ada-dev" } else { "ada" };
        let data_dir = dirs::data_dir()
            .ok_or_else(|| Error::ConfigError("Could not find data directory".into()))?
            .join(dir_name);

        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(data_dir.join("projects"))?;

        // Always try to connect to daemon, spawn it if needed
        let daemon = match tauri::async_runtime::block_on(Self::ensure_daemon_and_connect(app_handle.clone())) {
            Ok(client) => Some(Arc::new(client)),
            Err(e) => {
                tracing::error!(error = %e, "failed to connect to daemon");
                None
            }
        };

        let state = Self {
            projects: RwLock::new(HashMap::new()),
            clients: RwLock::new(HashMap::new()),
            data_dir,
            daemon: RwLock::new(daemon),
            app_handle: RwLock::new(Some(app_handle)),
        };

        // Load persisted projects
        state.load_projects()?;

        // Initialize default clients
        state.init_default_clients();

        Ok(state)
    }

    /// Ensure daemon is running (spawn via CLI if needed) and connect to it
    async fn ensure_daemon_and_connect(app_handle: AppHandle) -> Result<DaemonClient> {
        use std::time::Duration;

        let dev_mode = cfg!(debug_assertions);
        let data_dir = Self::get_data_dir(dev_mode)?;
        let port_path = data_dir.join("daemon/port");

        // Check if daemon is already running
        if let Ok(port_str) = std::fs::read_to_string(&port_path) {
            if let Ok(port) = port_str.trim().parse::<u16>() {
                if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                    tracing::info!(port, "daemon already running, connecting");
                    return DaemonClient::connect(app_handle).await;
                }
            }
        }

        // Daemon not running, spawn it using CLI
        tracing::info!("daemon not running, spawning via CLI");
        Self::spawn_daemon_via_cli(dev_mode)?;

        // Wait for daemon to start
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(250)).await;

            if let Ok(port_str) = std::fs::read_to_string(&port_path) {
                if let Ok(port) = port_str.trim().parse::<u16>() {
                    if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                        tracing::info!(port, "daemon started, connecting");
                        return DaemonClient::connect(app_handle).await;
                    }
                }
            }
        }

        Err(Error::TerminalError("Daemon did not start within 5 seconds".into()))
    }

    /// Spawn daemon using the CLI binary
    fn spawn_daemon_via_cli(dev_mode: bool) -> Result<()> {
        use std::process::Command;

        // Find the CLI binary
        let cli_path = Self::resolve_cli_path()?;

        if !cli_path.exists() {
            return Err(Error::TerminalError(format!(
                "CLI binary not found at {}",
                cli_path.display()
            )));
        }

        let mut cmd = Command::new(&cli_path);
        cmd.arg("daemon").arg("start");

        if dev_mode {
            cmd.arg("--dev");
        }

        // Forward logging environment variables
        for var in ["ADA_LOG_LEVEL", "ADA_LOG_STDERR", "ADA_LOG_DIR", "ADA_LOG_DISABLE"] {
            if let Ok(value) = std::env::var(var) {
                cmd.env(var, value);
            }
        }

        tracing::info!(cli = %cli_path.display(), dev_mode, "spawning daemon via CLI");

        cmd.spawn()
            .map_err(|e| Error::TerminalError(format!("Failed to spawn daemon via CLI: {}", e)))?;

        Ok(())
    }

    /// Resolve path to the CLI binary (sidecar)
    fn resolve_cli_path() -> Result<std::path::PathBuf> {
        Self::resolve_sidecar_path("ada-cli")
    }

    /// Resolve path to a sidecar binary
    ///
    /// Tauri bundles sidecars with target triple suffix. This function checks:
    /// 1. Bundled app location (macOS: Resources/binaries/, others: next to exe)
    /// 2. Development location (target/debug/ or target/release/)
    /// 3. System PATH
    fn resolve_sidecar_path(name: &str) -> Result<std::path::PathBuf> {
        let target_triple = Self::get_target_triple();
        let exe_suffix = if cfg!(windows) { ".exe" } else { "" };
        let sidecar_name = format!("{}-{}{}", name, target_triple, exe_suffix);
        let plain_name = format!("{}{}", name, exe_suffix);

        if let Ok(current_exe) = std::env::current_exe() {
            // For bundled macOS apps: Ada.app/Contents/MacOS/Ada -> Ada.app/Contents/Resources/binaries/
            #[cfg(target_os = "macos")]
            {
                if let Some(macos_dir) = current_exe.parent() {
                    let resources_dir = macos_dir.parent().map(|p| p.join("Resources/binaries"));
                    if let Some(resources) = resources_dir {
                        let candidate = resources.join(&sidecar_name);
                        if candidate.exists() {
                            tracing::debug!(path = %candidate.display(), "found sidecar in app bundle");
                            return Ok(candidate);
                        }
                    }
                }
            }

            // For Windows/Linux or dev mode: next to executable
            if let Some(parent) = current_exe.parent() {
                // Check for sidecar with target triple (bundled)
                let candidate = parent.join(&sidecar_name);
                if candidate.exists() {
                    tracing::debug!(path = %candidate.display(), "found sidecar next to exe");
                    return Ok(candidate);
                }

                // Check for plain name (dev mode)
                let candidate = parent.join(&plain_name);
                if candidate.exists() {
                    tracing::debug!(path = %candidate.display(), "found binary next to exe");
                    return Ok(candidate);
                }
            }
        }

        // Development: check target/debug and target/release
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let target_dir = std::path::PathBuf::from(manifest_dir).join("target");
            for profile in ["debug", "release"] {
                let candidate = target_dir.join(profile).join(&plain_name);
                if candidate.exists() {
                    tracing::debug!(path = %candidate.display(), "found binary in target dir");
                    return Ok(candidate);
                }
            }
        }

        // Fallback: check PATH
        which::which(&plain_name)
            .map_err(|_| Error::TerminalError(format!("Could not find {} sidecar binary", name)))
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

    fn get_data_dir(dev_mode: bool) -> Result<std::path::PathBuf> {
        let dir_name = if dev_mode { "ada-dev" } else { "ada" };
        dirs::data_dir()
            .ok_or_else(|| Error::ConfigError("Could not find data directory".into()))
            .map(|d| d.join(dir_name))
    }

    /// Get the daemon client, returning an error if not connected
    pub fn get_daemon(&self) -> Result<Arc<DaemonClient>> {
        self.daemon
            .read()
            .clone()
            .ok_or_else(|| Error::TerminalError("Daemon not connected".into()))
    }

    /// Connect to the daemon
    pub async fn connect_daemon(&self, app_handle: AppHandle) -> Result<()> {
        let client = DaemonClient::connect(app_handle.clone()).await?;
        *self.daemon.write() = Some(Arc::new(client));
        *self.app_handle.write() = Some(app_handle);
        Ok(())
    }

    /// Get the connection state
    pub fn get_connection_state(&self) -> ConnectionState {
        if self.daemon.read().is_some() {
            ConnectionState::Connected
        } else {
            // Check if daemon is running but we're not connected
            let port_path = self.data_dir.join("daemon/port");
            if port_path.exists() {
                if let Ok(content) = std::fs::read_to_string(&port_path) {
                    if let Ok(port) = content.trim().parse::<u16>() {
                        if std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok() {
                            return ConnectionState::Disconnected;
                        }
                    }
                }
            }
            ConnectionState::NotRunning
        }
    }
    
    fn load_projects(&self) -> Result<()> {
        let projects_dir = self.data_dir.join("projects");

        if projects_dir.exists() {
            for entry in std::fs::read_dir(&projects_dir)? {
                let entry = entry?;
                let path = entry.path();

                if path.extension().is_some_and(|ext| ext == "json") {
                    let content = std::fs::read_to_string(&path)?;
                    match serde_json::from_str::<AdaProject>(&content) {
                        Ok(project) => {
                            self.projects.write().insert(project.id.clone(), project);
                        }
                        Err(e) => {
                            eprintln!("Warning: Corrupt project file {}: {}", path.display(), e);
                            // Backup corrupt file for potential recovery
                            let backup = path.with_extension("json.corrupt");
                            let _ = std::fs::rename(&path, &backup);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    pub fn save_project(&self, project: &AdaProject) -> Result<()> {
        let project_file = self.data_dir.join("projects").join(format!("{}.json", project.id));
        let content = serde_json::to_string_pretty(project)?;
        crate::util::atomic_write(&project_file, content.as_bytes())?;
        Ok(())
    }

    pub fn delete_project_file(&self, project_id: &str) -> Result<()> {
        let project_file = self.data_dir.join("projects").join(format!("{}.json", project_id));
        if project_file.exists() {
            std::fs::remove_file(project_file)?;
        }
        Ok(())
    }

    fn init_default_clients(&self) {
        use crate::clients::{ClientConfig, ClientType};
        
        let default_clients = vec![
            ClientConfig {
                id: "claude-code".into(),
                name: "Claude Code".into(),
                client_type: ClientType::ClaudeCode,
                command: "claude".into(),
                args: vec![],
                env: HashMap::new(),
                description: "Anthropic's Claude Code CLI agent".into(),
                installed: false,
            },
            ClientConfig {
                id: "opencode".into(),
                name: "OpenCode".into(),
                client_type: ClientType::OpenCode,
                command: "opencode".into(),
                args: vec![],
                env: HashMap::new(),
                description: "OpenCode AI coding assistant".into(),
                installed: false,
            },
            ClientConfig {
                id: "codex".into(),
                name: "Codex".into(),
                client_type: ClientType::Codex,
                command: "codex".into(),
                args: vec![],
                env: HashMap::new(),
                description: "OpenAI Codex CLI agent".into(),
                installed: false,
            },
        ];
        
        let mut clients = self.clients.write();
        for mut client in default_clients {
            client.detect_installation();
            clients.insert(client.id.clone(), client);
        }
    }
}
