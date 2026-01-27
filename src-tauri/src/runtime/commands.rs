use tauri::State;

use crate::daemon::protocol::RuntimeConfig;
use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub async fn get_runtime_config(
    state: State<'_, AppState>,
) -> Result<RuntimeConfig> {
    state.get_daemon()?.get_runtime_config().await
}

#[tauri::command]
pub async fn set_shell_override(
    state: State<'_, AppState>,
    shell: Option<String>,
) -> Result<RuntimeConfig> {
    state.get_daemon()?.set_shell_override(shell).await?;
    state.get_daemon()?.get_runtime_config().await
}
