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
        if self.resolve_via_shell().is_some() {
            self.installed = true;
            return;
        }

        // First try which (uses PATH)
        if which::which(&self.command).is_ok() {
            self.installed = true;
            return;
        }

        // Fallback: check common installation paths (macOS GUI apps don't inherit shell PATH)
        let common_paths = self.get_common_paths();
        self.installed = common_paths.iter().any(|p| p.exists());
    }

    fn resolve_via_shell(&self) -> Option<PathBuf> {
        let shell = crate::daemon::shell::ShellConfig::detect(None);
        let mut cmd = std::process::Command::new(&shell.path);
        cmd.args(&shell.login_args);
        cmd.arg("-c");
        cmd.arg(format!("command -v {}", shell_escape(&self.command)));
        let output = cmd.output().ok()?;
        if !output.status.success() {
            return None;
        }
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(|line| PathBuf::from(line.trim()))
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

fn shell_escape(input: &str) -> String {
    if input.is_empty() {
        return "''".to_string();
    }
    let escaped = input.replace('\'', r#"'\''"#);
    format!("'{escaped}'")
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
