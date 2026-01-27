use axum::{
    extract::{Query, State},
    response::Json,
    routing::get,
    Router,
};
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tracing::{debug, info};

use crate::daemon::protocol::DaemonEvent;
use crate::terminal::AgentStatus;

#[derive(Deserialize)]
pub struct AgentEventQuery {
    terminal_id: String,
    event: String,
    /// Agent name (claude, codex, opencode, gemini, cursor)
    #[serde(default)]
    agent: Option<String>,
    /// Project ID for context
    #[serde(default)]
    project_id: Option<String>,
    /// Raw JSON payload from the hook (URL-encoded)
    #[serde(default)]
    payload: Option<String>,
}

pub async fn start_notification_server(
    event_tx: broadcast::Sender<DaemonEvent>,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    let app = Router::new()
        .route("/hook/agent-event", get(handle_agent_event))
        .with_state(event_tx);

    let server = axum::serve(listener, app);
    tokio::spawn(async move {
        if let Err(err) = server.await {
            eprintln!("[Ada Daemon] Notification server error: {err}");
        }
    });

    Ok(port)
}

async fn handle_agent_event(
    Query(params): Query<AgentEventQuery>,
    State(event_tx): State<broadcast::Sender<DaemonEvent>>,
) -> Json<&'static str> {
    let agent = params.agent.clone().unwrap_or_else(|| "unknown".to_string());

    info!(
        agent = %agent,
        event = %params.event,
        terminal_id = %params.terminal_id,
        project_id = ?params.project_id,
        has_payload = params.payload.is_some(),
        "Received hook event"
    );

    // Always send raw HookEvent for all events (for frontend logging)
    let _ = event_tx.send(DaemonEvent::HookEvent {
        terminal_id: params.terminal_id.clone(),
        project_id: params.project_id.clone(),
        agent: agent.clone(),
        event: params.event.clone(),
        payload: params.payload,
    });

    // Also map known events to AgentStatus for UI state management
    let status = match params.event.as_str() {
        "Start" => Some(AgentStatus::Working),
        "Stop" => Some(AgentStatus::Idle),
        "Permission" => Some(AgentStatus::Permission),
        _ => None,
    };

    if let Some(status) = status {
        debug!(
            terminal_id = %params.terminal_id,
            status = ?status,
            "Mapped to AgentStatus"
        );
        let _ = event_tx.send(DaemonEvent::AgentStatus {
            terminal_id: params.terminal_id,
            status,
        });
    }

    Json("ok")
}
