use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClientType {
    ClaudeCode,
    OpenCode,
    Codex,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientConfig {
    pub id: String,
    pub name: String,
    pub client_type: ClientType,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub description: String,
    pub installed: bool,
}

impl ClientConfig {
    pub fn detect_installation(&mut self) {
        // First try which (uses PATH)
        if which::which(&self.command).is_ok() {
            self.installed = true;
            return;
        }

        // Fallback: check common installation paths (macOS GUI apps don't inherit shell PATH)
        let common_paths = self.get_common_paths();
        self.installed = common_paths.iter().any(|p| p.exists());
    }

    /// Get the full path to the command executable
    /// This is needed because macOS GUI apps don't inherit shell PATH
    pub fn get_command_path(&self) -> PathBuf {
        // First try which (uses PATH)
        if let Ok(path) = which::which(&self.command) {
            return path;
        }

        // Fallback: check common installation paths
        for path in self.get_common_paths() {
            if path.exists() {
                return path;
            }
        }

        // Last resort: return the command as-is (will likely fail)
        PathBuf::from(&self.command)
    }

    fn get_common_paths(&self) -> Vec<PathBuf> {
        let home = dirs::home_dir().unwrap_or_default();

        match self.client_type {
            ClientType::ClaudeCode => vec![
                home.join(".local/bin/claude"),
                home.join(".claude/local/claude"),
                PathBuf::from("/usr/local/bin/claude"),
                PathBuf::from("/opt/homebrew/bin/claude"),
            ],
            ClientType::OpenCode => vec![
                home.join(".local/bin/opencode"),
                PathBuf::from("/usr/local/bin/opencode"),
                PathBuf::from("/opt/homebrew/bin/opencode"),
            ],
            ClientType::Codex => vec![
                home.join(".local/bin/codex"),
                PathBuf::from("/usr/local/bin/codex"),
                PathBuf::from("/opt/homebrew/bin/codex"),
            ],
            ClientType::Custom => vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientSummary {
    pub id: String,
    pub name: String,
    pub client_type: ClientType,
    pub description: String,
    pub installed: bool,
}

impl From<&ClientConfig> for ClientSummary {
    fn from(client: &ClientConfig) -> Self {
        Self {
            id: client.id.clone(),
            name: client.name.clone(),
            client_type: client.client_type,
            description: client.description.clone(),
            installed: client.installed,
        }
    }
}
