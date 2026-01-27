use tauri::State;
use std::path::PathBuf;

use crate::clients::ClientConfig;
use crate::daemon::protocol::CreateSessionRequest;
use crate::error::{Error, Result};
use crate::git;
use crate::state::AppState;
use crate::terminal::{CommandSpec, TerminalInfo, TerminalMode, CreateTerminalRequest, ResizeTerminalRequest};

fn build_command_spec(client: &ClientConfig) -> CommandSpec {
    CommandSpec {
        command: client.command.clone(),
        args: client.args.clone(),
        env: client.env.clone(),
    }
}

#[tauri::command]
pub async fn create_terminal(
    state: State<'_, AppState>,
    request: CreateTerminalRequest,
) -> Result<TerminalInfo> {
    let project = {
        let projects = state.projects.read();
        projects
            .get(&request.project_id)
            .cloned()
            .ok_or_else(|| Error::ProjectNotFound(request.project_id.clone()))?
    };

    let client = {
        let clients = state.clients.read();
        clients
            .get(&request.client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(request.client_id.clone()))?
    };

    let terminal_id = uuid::Uuid::new_v4().to_string();

    let (working_dir, worktree_path, branch, folder_path) = match request.mode {
        TerminalMode::Main | TerminalMode::CurrentBranch => {
            (project.path.clone(), None, None, None)
        }
        TerminalMode::Folder => {
            let folder = request.folder_path.as_ref().ok_or_else(|| {
                Error::InvalidRequest("Folder mode requires folder_path".into())
            })?;
            let folder_path_buf = PathBuf::from(folder);
            let working_dir = project.path.join(&folder_path_buf);
            if !working_dir.exists() {
                return Err(Error::InvalidRequest(format!("Folder does not exist: {}", folder)));
            }
            (working_dir, None, None, Some(folder_path_buf))
        }
        TerminalMode::Worktree => {
            let branch_spec = request.worktree_branch.as_ref().ok_or_else(|| {
                Error::InvalidRequest("Worktree mode requires worktree_branch".into())
            })?;

            let actual_branch = if branch_spec.starts_with("wt-") {
                let rest = branch_spec.strip_prefix("wt-").unwrap();
                if let Some(slash_pos) = rest.find('/') {
                    rest[slash_pos + 1..].to_string()
                } else {
                    branch_spec.clone()
                }
            } else {
                branch_spec.clone()
            };

            let worktree_base = project.settings.worktree_base_path
                .clone()
                .unwrap_or_else(|| project.path.join(".worktrees"));

            let worktree_path = worktree_base.join(actual_branch.replace('/', "-"));

            if !worktree_path.exists() {
                git::create_worktree_internal(&project.path, branch_spec, &worktree_path)?;
            }

            (worktree_path.clone(), Some(worktree_path), Some(actual_branch), None)
        }
    };

    let create_request = CreateSessionRequest {
        terminal_id: terminal_id.clone(),
        project_id: request.project_id.clone(),
        name: request.name,
        client_id: request.client_id.clone(),
        working_dir: working_dir.to_string_lossy().to_string(),
        branch,
        worktree_path: worktree_path.as_ref().map(|p| p.to_string_lossy().to_string()),
        folder_path: folder_path.as_ref().map(|p| p.to_string_lossy().to_string()),
        is_main: false,
        mode: request.mode,
        command: build_command_spec(&client),
        cols: 120,
        rows: 30,
    };

    let terminal_info = state.get_daemon()?.create_session(create_request).await?;

    Ok(terminal_info)
}

pub async fn create_main_terminal_internal(
    state: &AppState,
    project_id: &str,
    client_id: &str,
) -> Result<TerminalInfo> {
    let existing_main = state
        .get_daemon()?
        .list_sessions()
        .await?
        .into_iter()
        .find(|session| session.project_id == project_id && session.is_main);

    if let Some(existing) = existing_main {
        return Ok(existing);
    }

    let project = {
        let projects = state.projects.read();
        projects
            .get(project_id)
            .cloned()
            .ok_or_else(|| Error::ProjectNotFound(project_id.to_string()))?
    };

    let client = {
        let clients = state.clients.read();
        clients
            .get(client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(client_id.to_string()))?
    };

    if !client.installed {
        return Err(Error::InvalidRequest(format!(
            "Client '{}' is not installed",
            client.name
        )));
    }

    let terminal_id = uuid::Uuid::new_v4().to_string();

    let create_request = CreateSessionRequest {
        terminal_id: terminal_id.clone(),
        project_id: project_id.to_string(),
        name: "main".to_string(),
        client_id: client_id.to_string(),
        working_dir: project.path.to_string_lossy().to_string(),
        branch: None,
        worktree_path: None,
        folder_path: None,
        is_main: true,
        mode: TerminalMode::Main,
        command: build_command_spec(&client),
        cols: 120,
        rows: 30,
    };

    let terminal_info = state.get_daemon()?.create_session(create_request).await?;

    Ok(terminal_info)
}

#[tauri::command]
pub async fn create_main_terminal(
    state: State<'_, AppState>,
    project_id: String,
    client_id: String,
) -> Result<TerminalInfo> {
    create_main_terminal_internal(&state, &project_id, &client_id).await
}

#[tauri::command]
pub async fn list_terminals(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TerminalInfo>> {
    let sessions = state.get_daemon()?.list_sessions().await?;
    Ok(sessions
        .into_iter()
        .filter(|t| t.project_id == project_id)
        .collect())
}

#[tauri::command]
pub async fn get_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalInfo> {
    state.get_daemon()?.get_session(&terminal_id).await
}

#[tauri::command]
pub async fn write_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<()> {
    state.get_daemon()?.write_to_session(&terminal_id, &data).await
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    request: ResizeTerminalRequest,
) -> Result<()> {
    state.get_daemon()?.resize_session(&request.terminal_id, request.cols, request.rows).await
}

#[tauri::command]
pub async fn close_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<()> {
    let terminal = state.get_daemon()?.get_session(&terminal_id).await?;
    if terminal.is_main {
        return Err(Error::InvalidRequest("Cannot close the main terminal".into()));
    }

    state.get_daemon()?.close_session(&terminal_id).await?;

    Ok(())
}

#[tauri::command]
pub async fn get_terminal_history(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Vec<String>> {
    state.get_daemon()?.get_history(&terminal_id).await
}

#[tauri::command]
pub async fn mark_terminal_stopped(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalInfo> {
    let _status = state.get_daemon()?.mark_session_stopped(&terminal_id).await?;
    state.get_daemon()?.get_session(&terminal_id).await
}

#[tauri::command]
pub async fn switch_terminal_agent(
    state: State<'_, AppState>,
    terminal_id: String,
    new_client_id: String,
) -> Result<TerminalInfo> {
    let client = {
        let clients = state.clients.read();
        clients
            .get(&new_client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(new_client_id.clone()))?
    };

    state.get_daemon()?
        .switch_session_agent(&terminal_id, &new_client_id, build_command_spec(&client))
        .await
}

#[tauri::command]
pub async fn restart_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalInfo> {
    state.get_daemon()?.restart_session(&terminal_id).await
}
