use tauri::State;

use crate::error::{Error, Result};
use crate::state::AppState;
use super::{ClientConfig, ClientSummary};

#[tauri::command]
pub async fn list_clients(
    state: State<'_, AppState>,
) -> Result<Vec<ClientSummary>> {
    let clients = state.clients.read();
    let summaries: Vec<ClientSummary> = clients.values().map(|c| c.into()).collect();
    Ok(summaries)
}

#[tauri::command]
pub async fn get_client(
    state: State<'_, AppState>,
    client_id: String,
) -> Result<ClientConfig> {
    let clients = state.clients.read();
    clients
        .get(&client_id)
        .cloned()
        .ok_or_else(|| Error::ClientNotFound(client_id))
}

#[tauri::command]
pub async fn detect_installed_clients(
    state: State<'_, AppState>,
) -> Result<Vec<ClientSummary>> {
    let mut clients = state.clients.write();
    
    for client in clients.values_mut() {
        client.detect_installation();
    }
    
    let summaries: Vec<ClientSummary> = clients.values().map(|c| c.into()).collect();
    Ok(summaries)
}
