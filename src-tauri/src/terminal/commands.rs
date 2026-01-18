use tauri::State;
use chrono::Utc;
use std::sync::Arc;

use crate::error::{Error, Result};
use crate::state::AppState;
use crate::git;
use super::{Terminal, TerminalInfo, TerminalStatus, CreateTerminalRequest, ResizeTerminalRequest, TerminalOutputBuffer};
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
    
    // Determine working directory (worktree or project root)
    let (working_dir, worktree_path) = if request.use_worktree && request.branch.is_some() {
        let branch = request.branch.as_ref().unwrap();
        let worktree_base = project.settings.worktree_base_path
            .clone()
            .unwrap_or_else(|| project.path.join(".worktrees"));
        
        let worktree_path = worktree_base.join(branch.replace('/', "-"));
        
        // Create worktree if it doesn't exist
        if !worktree_path.exists() {
            git::create_worktree_internal(&project.path, branch, &worktree_path)?;
        }
        
        (worktree_path.clone(), Some(worktree_path))
    } else {
        (project.path.clone(), None)
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
        branch: request.branch,
        worktree_path,
        status: TerminalStatus::Running,
        created_at: Utc::now(),
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

    // Get or create output buffer
    let output_buffer = {
        let buffers = state.output_buffers.read();
        buffers.get(&terminal_id).cloned()
    }.unwrap_or_else(|| Arc::new(TerminalOutputBuffer::new()));

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
