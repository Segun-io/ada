use tauri::State;
use chrono::Utc;
use std::sync::Arc;
use std::path::PathBuf;

use crate::error::{Error, Result};
use crate::state::AppState;
use crate::git;
use super::{Terminal, TerminalInfo, TerminalStatus, TerminalMode, CreateTerminalRequest, ResizeTerminalRequest, TerminalOutputBuffer};
use super::pty::{spawn_pty, write_to_pty, resize_pty};

#[tauri::command]
pub async fn create_terminal(
    state: State<'_, AppState>,
    request: CreateTerminalRequest,
) -> Result<TerminalInfo> {
    // Get project
    let project = {
        let projects = state.projects.read();
        projects
            .get(&request.project_id)
            .cloned()
            .ok_or_else(|| Error::ProjectNotFound(request.project_id.clone()))?
    };

    // Get client configuration
    let client = {
        let clients = state.clients.read();
        clients
            .get(&request.client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(request.client_id.clone()))?
    };

    let terminal_id = uuid::Uuid::new_v4().to_string();

    // Determine working directory, worktree path, branch, and folder_path based on mode
    let (working_dir, worktree_path, branch, folder_path) = match request.mode {
        TerminalMode::Main | TerminalMode::CurrentBranch => {
            // Run at project root on current branch
            (project.path.clone(), None, None, None)
        }
        TerminalMode::Folder => {
            // Run in a subfolder of project
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
            // Run in an isolated worktree
            let branch_spec = request.worktree_branch.as_ref().ok_or_else(|| {
                Error::InvalidRequest("Worktree mode requires worktree_branch".into())
            })?;

            // Parse branch spec - could be "wt-baseBranch/newBranchName" or just a branch name
            let actual_branch = if branch_spec.starts_with("wt-") {
                // Extract the new branch name from the format
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

            // Use the actual branch name for the worktree path
            let worktree_path = worktree_base.join(actual_branch.replace('/', "-"));

            // Create worktree if it doesn't exist
            if !worktree_path.exists() {
                git::create_worktree_internal(&project.path, branch_spec, &worktree_path)?;
            }

            (worktree_path.clone(), Some(worktree_path), Some(actual_branch), None)
        }
    };

    // Create output buffer
    let output_buffer = Arc::new(TerminalOutputBuffer::new());

    // Spawn PTY
    let pty_handle = spawn_pty(
        &state.app_handle,
        &terminal_id,
        &working_dir,
        &client,
        120,
        30,
        output_buffer.clone(),
    )?;

    let terminal = Terminal {
        id: terminal_id.clone(),
        project_id: request.project_id.clone(),
        name: request.name,
        client_id: request.client_id,
        working_dir,
        branch,
        worktree_path,
        status: TerminalStatus::Running,
        created_at: Utc::now(),
        mode: request.mode,
        is_main: false,
        folder_path,
    };

    let terminal_info = TerminalInfo::from(&terminal);

    // Add terminal, pty handle, and output buffer to state
    state.terminals.write().insert(terminal_id.clone(), terminal);
    state.pty_handles.write().insert(terminal_id.clone(), pty_handle);
    state.output_buffers.write().insert(terminal_id.clone(), output_buffer);

    // Update project
    {
        let mut projects = state.projects.write();
        if let Some(project) = projects.get_mut(&request.project_id) {
            project.add_terminal(terminal_id.clone());
            let _ = state.save_project(project);
        }
    }

    // Save terminal to disk
    let _ = state.save_terminal(&terminal_id);

    Ok(terminal_info)
}

/// Create the main terminal for a project
#[tauri::command]
pub async fn create_main_terminal(
    state: State<'_, AppState>,
    project_id: String,
    client_id: String,
) -> Result<TerminalInfo> {
    // Get project
    let project = {
        let projects = state.projects.read();
        projects
            .get(&project_id)
            .cloned()
            .ok_or_else(|| Error::ProjectNotFound(project_id.clone()))?
    };

    // Check if main terminal already exists
    if let Some(main_id) = &project.main_terminal_id {
        let terminals = state.terminals.read();
        if let Some(terminal) = terminals.get(main_id) {
            return Ok(TerminalInfo::from(terminal));
        }
    }

    // Get client configuration
    let client = {
        let clients = state.clients.read();
        clients
            .get(&client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(client_id.clone()))?
    };

    let terminal_id = uuid::Uuid::new_v4().to_string();

    // Create output buffer
    let output_buffer = Arc::new(TerminalOutputBuffer::new());

    // Spawn PTY at project root
    let pty_handle = spawn_pty(
        &state.app_handle,
        &terminal_id,
        &project.path,
        &client,
        120,
        30,
        output_buffer.clone(),
    )?;

    let terminal = Terminal {
        id: terminal_id.clone(),
        project_id: project_id.clone(),
        name: "main".to_string(),
        client_id,
        working_dir: project.path.clone(),
        branch: None,
        worktree_path: None,
        status: TerminalStatus::Running,
        created_at: Utc::now(),
        mode: TerminalMode::Main,
        is_main: true,
        folder_path: None,
    };

    let terminal_info = TerminalInfo::from(&terminal);

    // Add terminal, pty handle, and output buffer to state
    state.terminals.write().insert(terminal_id.clone(), terminal);
    state.pty_handles.write().insert(terminal_id.clone(), pty_handle);
    state.output_buffers.write().insert(terminal_id.clone(), output_buffer);

    // Update project with main terminal ID
    {
        let mut projects = state.projects.write();
        if let Some(project) = projects.get_mut(&project_id) {
            project.add_terminal(terminal_id.clone());
            project.main_terminal_id = Some(terminal_id.clone());
            let _ = state.save_project(project);
        }
    }

    // Save terminal to disk
    let _ = state.save_terminal(&terminal_id);

    Ok(terminal_info)
}

#[tauri::command]
pub async fn list_terminals(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<TerminalInfo>> {
    let terminals = state.terminals.read();
    let infos: Vec<TerminalInfo> = terminals
        .values()
        .filter(|t| t.project_id == project_id)
        .map(|t| t.into())
        .collect();
    Ok(infos)
}

#[tauri::command]
pub async fn get_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalInfo> {
    let terminals = state.terminals.read();
    terminals
        .get(&terminal_id)
        .map(|t| t.into())
        .ok_or_else(|| Error::TerminalNotFound(terminal_id))
}

#[tauri::command]
pub async fn write_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
    data: String,
) -> Result<()> {
    let pty_handles = state.pty_handles.read();
    let pty_handle = pty_handles
        .get(&terminal_id)
        .ok_or_else(|| Error::TerminalNotFound(terminal_id.clone()))?;
    
    write_to_pty(pty_handle, data.as_bytes())?;
    
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    request: ResizeTerminalRequest,
) -> Result<()> {
    let pty_handles = state.pty_handles.read();
    let pty_handle = pty_handles
        .get(&request.terminal_id)
        .ok_or_else(|| Error::TerminalNotFound(request.terminal_id.clone()))?;
    
    resize_pty(pty_handle, request.cols, request.rows)?;
    
    Ok(())
}

#[tauri::command]
pub async fn close_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<()> {
    // Check if this is a main terminal - cannot be closed
    {
        let terminals = state.terminals.read();
        if let Some(terminal) = terminals.get(&terminal_id) {
            if terminal.is_main {
                return Err(Error::InvalidRequest("Cannot close the main terminal".into()));
            }
        }
    }

    // Remove terminal, pty handle, and output buffer
    let terminal = state.terminals.write().remove(&terminal_id);
    state.pty_handles.write().remove(&terminal_id);
    state.output_buffers.write().remove(&terminal_id);

    // Delete terminal file
    let _ = state.delete_terminal_file(&terminal_id);

    if let Some(terminal) = terminal {
        // Update project
        let mut projects = state.projects.write();
        if let Some(project) = projects.get_mut(&terminal.project_id) {
            project.remove_terminal(&terminal_id);
            let _ = state.save_project(project);
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_terminal_history(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<Vec<String>> {
    let output_buffers = state.output_buffers.read();
    let buffer = output_buffers
        .get(&terminal_id)
        .ok_or_else(|| Error::TerminalNotFound(terminal_id))?;

    Ok(buffer.get_history())
}

#[tauri::command]
pub async fn mark_terminal_stopped(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalInfo> {
    // Update terminal status to stopped
    {
        let mut terminals = state.terminals.write();
        if let Some(t) = terminals.get_mut(&terminal_id) {
            t.status = TerminalStatus::Stopped;
        }
    }

    // Remove pty handle since the process is no longer running
    state.pty_handles.write().remove(&terminal_id);

    // Save terminal to disk
    let _ = state.save_terminal(&terminal_id);

    let terminals = state.terminals.read();
    let terminal = terminals
        .get(&terminal_id)
        .ok_or_else(|| Error::TerminalNotFound(terminal_id))?;
    Ok(TerminalInfo::from(terminal))
}

#[tauri::command]
pub async fn switch_terminal_agent(
    state: State<'_, AppState>,
    terminal_id: String,
    new_client_id: String,
) -> Result<TerminalInfo> {
    // Get client configuration
    let client = {
        let clients = state.clients.read();
        clients
            .get(&new_client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(new_client_id.clone()))?
    };

    // Get or create output buffer (fresh for new agent)
    let output_buffer = Arc::new(TerminalOutputBuffer::new());

    // Get terminal and update client_id
    let working_dir = {
        let mut terminals = state.terminals.write();
        let terminal = terminals
            .get_mut(&terminal_id)
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.clone()))?;
        terminal.client_id = new_client_id;
        terminal.working_dir.clone()
    };

    // Spawn new PTY with new client
    let pty_handle = spawn_pty(
        &state.app_handle,
        &terminal_id,
        &working_dir,
        &client,
        120,
        30,
        output_buffer.clone(),
    )?;

    // Update terminal status
    {
        let mut terminals = state.terminals.write();
        if let Some(t) = terminals.get_mut(&terminal_id) {
            t.status = TerminalStatus::Running;
        }
    }

    // Store pty handle and output buffer
    state.pty_handles.write().insert(terminal_id.clone(), pty_handle);
    state.output_buffers.write().insert(terminal_id.clone(), output_buffer);

    // Save terminal to disk
    let _ = state.save_terminal(&terminal_id);

    let terminals = state.terminals.read();
    let terminal = terminals.get(&terminal_id).unwrap();
    Ok(TerminalInfo::from(terminal))
}

#[tauri::command]
pub async fn restart_terminal(
    state: State<'_, AppState>,
    terminal_id: String,
) -> Result<TerminalInfo> {
    // Get the existing terminal
    let terminal = {
        let terminals = state.terminals.read();
        terminals
            .get(&terminal_id)
            .cloned()
            .ok_or_else(|| Error::TerminalNotFound(terminal_id.clone()))?
    };

    // Get client configuration
    let client = {
        let clients = state.clients.read();
        clients
            .get(&terminal.client_id)
            .cloned()
            .ok_or_else(|| Error::ClientNotFound(terminal.client_id.clone()))?
    };

    // Kill existing PTY if running (allows restart of both stopped and running terminals)
    {
        let mut pty_handles = state.pty_handles.write();
        pty_handles.remove(&terminal_id);
        // PTY handle is dropped here, which closes file descriptors and sends SIGHUP
    }

    // Create fresh output buffer (clears history for clean restart)
    let output_buffer = Arc::new(TerminalOutputBuffer::new());

    // Spawn new PTY
    let pty_handle = spawn_pty(
        &state.app_handle,
        &terminal_id,
        &terminal.working_dir,
        &client,
        120,
        30,
        output_buffer.clone(),
    )?;

    // Update terminal status
    {
        let mut terminals = state.terminals.write();
        if let Some(t) = terminals.get_mut(&terminal_id) {
            t.status = TerminalStatus::Running;
        }
    }

    // Store pty handle and output buffer
    state.pty_handles.write().insert(terminal_id.clone(), pty_handle);
    state.output_buffers.write().insert(terminal_id.clone(), output_buffer);

    // Save terminal to disk
    let _ = state.save_terminal(&terminal_id);

    let terminals = state.terminals.read();
    let terminal = terminals.get(&terminal_id).unwrap();
    Ok(TerminalInfo::from(terminal))
}
