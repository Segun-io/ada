use serde::{Deserialize, Serialize};

use crate::terminal::{AgentStatus, CommandSpec, TerminalInfo, TerminalMode, TerminalStatus};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub ada_home: String,
    pub data_dir: String,
    pub daemon_port: u16,
    pub notification_port: u16,
    pub shell_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    pub terminal_id: String,
    pub project_id: String,
    pub name: String,
    pub client_id: String,
    pub working_dir: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub folder_path: Option<String>,
    pub is_main: bool,
    pub mode: TerminalMode,
    pub command: CommandSpec,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DaemonRequest {
    /// Health check - daemon responds with Pong
    Ping,
    /// Get daemon status information
    Status,
    ListSessions,
    GetSession { terminal_id: String },
    CreateSession { request: CreateSessionRequest },
    MarkSessionStopped { terminal_id: String },
    CloseSession { terminal_id: String },
    WriteToSession { terminal_id: String, data: String },
    ResizeSession { terminal_id: String, cols: u16, rows: u16 },
    RestartSession { terminal_id: String },
    SwitchSessionAgent { terminal_id: String, client_id: String, command: CommandSpec },
    GetHistory { terminal_id: String },
    GetRuntimeConfig,
    SetShellOverride { shell: Option<String> },
    /// Shutdown the daemon (used in dev mode when GUI closes)
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DaemonResponse {
    Ok,
    /// Response to Ping request
    Pong,
    Error { message: String },
    Sessions { sessions: Vec<TerminalInfo> },
    Session { session: TerminalInfo },
    History { terminal_id: String, history: Vec<String> },
    RuntimeConfig { config: RuntimeConfig },
    /// Terminal status response (renamed from Status to avoid confusion with DaemonStatus)
    TerminalStatusResponse { terminal_id: String, status: TerminalStatus },
    /// Daemon status information
    DaemonStatus {
        pid: u32,
        port: u16,
        uptime_secs: u64,
        session_count: usize,
        version: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DaemonEvent {
    TerminalOutput { terminal_id: String, data: String },
    TerminalStatus { terminal_id: String, project_id: String, status: TerminalStatus },
    AgentStatus { terminal_id: String, status: AgentStatus },
    /// Raw hook event from any agent - forwarded to frontend for logging/debugging
    HookEvent {
        terminal_id: String,
        project_id: Option<String>,
        agent: String,
        event: String,
        payload: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DaemonMessage {
    Request { id: String, request: DaemonRequest },
    Response { id: String, response: DaemonResponse },
    Event { event: DaemonEvent },
}
