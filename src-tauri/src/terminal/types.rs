use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use portable_pty::MasterPty;

/// Terminal mode determines how the terminal operates
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TerminalMode {
    /// Main terminal - unclosable, runs on current branch at project root
    #[default]
    Main,
    /// Runs in a subfolder of the project
    Folder,
    /// Runs on the current branch at project root
    CurrentBranch,
    /// Runs in an isolated worktree for branch work
    Worktree,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    #[default]
    Idle,
    Working,
    Permission,
    Review,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSpec {
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Terminal {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub client_id: String,
    pub working_dir: PathBuf,
    pub branch: Option<String>,
    pub worktree_path: Option<PathBuf>,
    pub status: TerminalStatus,
    pub created_at: DateTime<Utc>,
    pub command: CommandSpec,
    pub shell: Option<String>,
    #[serde(default)]
    pub agent_status: AgentStatus,
    /// Terminal mode (Main, Folder, CurrentBranch, Worktree)
    #[serde(default)]
    pub mode: TerminalMode,
    /// Whether this is the main terminal (cannot be closed)
    #[serde(default)]
    pub is_main: bool,
    /// For Folder mode: the subfolder path relative to project
    #[serde(default)]
    pub folder_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Starting,
    Running,
    Stopped,
    Error,
}

/// Handle to a running PTY - stored separately from Terminal for thread safety
pub struct PtyHandle {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,
}

// PtyHandle is Send + Sync because we wrap everything in Arc<Mutex<>>
unsafe impl Send for PtyHandle {}
unsafe impl Sync for PtyHandle {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTerminalRequest {
    pub project_id: String,
    pub name: String,
    pub client_id: String,
    /// Terminal mode
    #[serde(default)]
    pub mode: TerminalMode,
    /// For Folder mode: path relative to project root
    pub folder_path: Option<String>,
    /// For Worktree mode: branch to create/use worktree for
    pub worktree_branch: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub client_id: String,
    pub working_dir: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub status: TerminalStatus,
    pub created_at: DateTime<Utc>,
    pub command: CommandSpec,
    pub shell: Option<String>,
    #[serde(default)]
    pub agent_status: AgentStatus,
    pub mode: TerminalMode,
    pub is_main: bool,
    pub folder_path: Option<String>,
}

impl From<&Terminal> for TerminalInfo {
    fn from(terminal: &Terminal) -> Self {
        Self {
            id: terminal.id.clone(),
            project_id: terminal.project_id.clone(),
            name: terminal.name.clone(),
            client_id: terminal.client_id.clone(),
            working_dir: terminal.working_dir.to_string_lossy().to_string(),
            branch: terminal.branch.clone(),
            worktree_path: terminal.worktree_path.as_ref().map(|p| p.to_string_lossy().to_string()),
            status: terminal.status,
            created_at: terminal.created_at,
            command: terminal.command.clone(),
            shell: terminal.shell.clone(),
            agent_status: terminal.agent_status,
            mode: terminal.mode,
            is_main: terminal.is_main,
            folder_path: terminal.folder_path.as_ref().map(|p| p.to_string_lossy().to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizeTerminalRequest {
    pub terminal_id: String,
    pub cols: u16,
    pub rows: u16,
}
