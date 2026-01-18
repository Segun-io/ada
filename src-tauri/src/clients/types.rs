use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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
        self.installed = which::which(&self.command).is_ok();
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
