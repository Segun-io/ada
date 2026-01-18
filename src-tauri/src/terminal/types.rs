use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::collections::VecDeque;
use chrono::{DateTime, Utc};
use parking_lot::Mutex;
use portable_pty::MasterPty;

/// Maximum number of output chunks to store per terminal
const MAX_OUTPUT_HISTORY: usize = 1000;

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
}

/// Stored terminal data for persistence
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalData {
    pub terminal: Terminal,
    #[serde(default)]
    pub output_history: Vec<String>,
}

/// In-memory terminal output buffer
pub struct TerminalOutputBuffer {
    pub buffer: Mutex<VecDeque<String>>,
}

impl TerminalOutputBuffer {
    pub fn new() -> Self {
        Self {
            buffer: Mutex::new(VecDeque::with_capacity(MAX_OUTPUT_HISTORY)),
        }
    }

    pub fn append(&self, data: String) {
        let mut buffer = self.buffer.lock();
        if buffer.len() >= MAX_OUTPUT_HISTORY {
            buffer.pop_front();
        }
        buffer.push_back(data);
    }

    pub fn get_history(&self) -> Vec<String> {
        self.buffer.lock().iter().cloned().collect()
    }

    pub fn restore(&self, history: Vec<String>) {
        let mut buffer = self.buffer.lock();
        buffer.clear();
        for item in history.into_iter().take(MAX_OUTPUT_HISTORY) {
            buffer.push_back(item);
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Starting,
    Running,
    Stopped,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum AgentActivity {
    #[default]
    Idle,
    Active,
    Thinking,
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
    pub branch: Option<String>,
    pub use_worktree: bool,
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
