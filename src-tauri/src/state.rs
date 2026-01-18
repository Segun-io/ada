use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use tauri::AppHandle;

use crate::project::AdaProject;
use crate::terminal::{Terminal, PtyHandle, TerminalOutputBuffer, TerminalData, TerminalStatus};
use crate::clients::ClientConfig;
use crate::error::{Error, Result};

pub struct AppState {
    pub projects: RwLock<HashMap<String, AdaProject>>,
    pub terminals: RwLock<HashMap<String, Terminal>>,
    pub pty_handles: RwLock<HashMap<String, PtyHandle>>,
    pub output_buffers: RwLock<HashMap<String, Arc<TerminalOutputBuffer>>>,
    pub clients: RwLock<HashMap<String, ClientConfig>>,
    pub data_dir: PathBuf,
    pub app_handle: AppHandle,
}

impl AppState {
    pub fn new(app_handle: AppHandle) -> Result<Self> {
        let data_dir = dirs::data_dir()
            .ok_or_else(|| Error::ConfigError("Could not find data directory".into()))?
            .join("ada");

        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(data_dir.join("projects"))?;
        std::fs::create_dir_all(data_dir.join("terminals"))?;

        let state = Self {
            projects: RwLock::new(HashMap::new()),
            terminals: RwLock::new(HashMap::new()),
            pty_handles: RwLock::new(HashMap::new()),
            output_buffers: RwLock::new(HashMap::new()),
            clients: RwLock::new(HashMap::new()),
            data_dir,
            app_handle,
        };

        // Load persisted projects
        state.load_projects()?;

        // Load persisted terminals
        state.load_terminals()?;

        // Initialize default clients
        state.init_default_clients();

        Ok(state)
    }
    
    fn load_projects(&self) -> Result<()> {
        let projects_dir = self.data_dir.join("projects");

        if projects_dir.exists() {
            for entry in std::fs::read_dir(&projects_dir)? {
                let entry = entry?;
                let path = entry.path();

                if path.extension().is_some_and(|ext| ext == "json") {
                    let content = std::fs::read_to_string(&path)?;
                    if let Ok(project) = serde_json::from_str::<AdaProject>(&content) {
                        self.projects.write().insert(project.id.clone(), project);
                    }
                }
            }
        }

        Ok(())
    }

    fn load_terminals(&self) -> Result<()> {
        let terminals_dir = self.data_dir.join("terminals");

        if terminals_dir.exists() {
            for entry in std::fs::read_dir(&terminals_dir)? {
                let entry = entry?;
                let path = entry.path();

                if path.extension().is_some_and(|ext| ext == "json") {
                    let content = std::fs::read_to_string(&path)?;
                    if let Ok(mut terminal_data) = serde_json::from_str::<TerminalData>(&content) {
                        // Mark terminal as stopped since the PTY is gone
                        terminal_data.terminal.status = TerminalStatus::Stopped;

                        let terminal_id = terminal_data.terminal.id.clone();

                        // Restore output buffer
                        let buffer = Arc::new(TerminalOutputBuffer::new());
                        buffer.restore(terminal_data.output_history);

                        self.terminals.write().insert(terminal_id.clone(), terminal_data.terminal);
                        self.output_buffers.write().insert(terminal_id, buffer);
                    }
                }
            }
        }

        Ok(())
    }

    pub fn save_project(&self, project: &AdaProject) -> Result<()> {
        let project_file = self.data_dir.join("projects").join(format!("{}.json", project.id));
        let content = serde_json::to_string_pretty(project)?;
        std::fs::write(project_file, content)?;
        Ok(())
    }

    pub fn save_terminal(&self, terminal_id: &str) -> Result<()> {
        let terminals = self.terminals.read();
        let terminal = terminals
            .get(terminal_id)
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.to_string()))?;

        let output_history = self.output_buffers
            .read()
            .get(terminal_id)
            .map(|b| b.get_history())
            .unwrap_or_default();

        let terminal_data = TerminalData {
            terminal: terminal.clone(),
            output_history,
        };

        let terminal_file = self.data_dir.join("terminals").join(format!("{}.json", terminal_id));
        let content = serde_json::to_string_pretty(&terminal_data)?;
        std::fs::write(terminal_file, content)?;
        Ok(())
    }

    pub fn delete_project_file(&self, project_id: &str) -> Result<()> {
        let project_file = self.data_dir.join("projects").join(format!("{}.json", project_id));
        if project_file.exists() {
            std::fs::remove_file(project_file)?;
        }
        Ok(())
    }

    pub fn delete_terminal_file(&self, terminal_id: &str) -> Result<()> {
        let terminal_file = self.data_dir.join("terminals").join(format!("{}.json", terminal_id));
        if terminal_file.exists() {
            std::fs::remove_file(terminal_file)?;
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
        for client in default_clients {
            clients.insert(client.id.clone(), client);
        }
    }
}
