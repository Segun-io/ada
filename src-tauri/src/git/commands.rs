use std::path::PathBuf;
use tauri::State;

use crate::error::{Error, Result};
use crate::state::AppState;
use super::{
    BranchInfo, WorktreeInfo,
    create_worktree_internal, remove_worktree_internal,
    list_worktrees_internal, get_branches_internal, get_current_branch_internal,
};

#[tauri::command]
pub async fn get_branches(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<BranchInfo>> {
    let projects = state.projects.read();
    let project = projects
        .get(&project_id)
        .ok_or_else(|| Error::ProjectNotFound(project_id))?;
    
    get_branches_internal(&project.path)
}

#[tauri::command]
pub async fn create_worktree(
    state: State<'_, AppState>,
    project_id: String,
    branch: String,
    worktree_path: Option<String>,
) -> Result<WorktreeInfo> {
    let projects = state.projects.read();
    let project = projects
        .get(&project_id)
        .ok_or_else(|| Error::ProjectNotFound(project_id))?;
    
    let wt_path = worktree_path
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            project.settings.worktree_base_path
                .clone()
                .unwrap_or_else(|| project.path.join(".worktrees"))
                .join(branch.replace('/', "-"))
        });
    
    create_worktree_internal(&project.path, &branch, &wt_path)?;
    
    Ok(WorktreeInfo {
        path: wt_path.to_string_lossy().to_string(),
        branch,
        head: String::new(),
        is_bare: false,
    })
}

#[tauri::command]
pub async fn remove_worktree(
    state: State<'_, AppState>,
    project_id: String,
    worktree_path: String,
) -> Result<()> {
    let projects = state.projects.read();
    let project = projects
        .get(&project_id)
        .ok_or_else(|| Error::ProjectNotFound(project_id))?;
    
    remove_worktree_internal(&project.path, &PathBuf::from(worktree_path))
}

#[tauri::command]
pub async fn list_worktrees(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<WorktreeInfo>> {
    let projects = state.projects.read();
    let project = projects
        .get(&project_id)
        .ok_or_else(|| Error::ProjectNotFound(project_id))?;
    
    list_worktrees_internal(&project.path)
}

#[tauri::command]
pub async fn get_current_branch(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<String> {
    let projects = state.projects.read();
    let project = projects
        .get(&project_id)
        .ok_or_else(|| Error::ProjectNotFound(project_id))?;
    
    get_current_branch_internal(&project.path)
}
