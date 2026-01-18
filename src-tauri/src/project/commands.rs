use std::path::{Path, PathBuf};
use tauri::State;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::state::AppState;
use super::{AdaProject, CreateProjectRequest, ProjectSummary, ProjectSettings};

/// Check if a git repository has at least one commit
fn has_commits(repo_path: &Path) -> bool {
    std::process::Command::new("git")
        .args(["rev-parse", "--verify", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Create an initial commit with a .gitkeep file
fn create_initial_commit(repo_path: &Path) -> Result<()> {
    // Create a .gitkeep file if the directory is empty or has no tracked files
    let gitkeep_path = repo_path.join(".gitkeep");
    if !gitkeep_path.exists() {
        std::fs::write(&gitkeep_path, "# This file ensures the repository has an initial commit\n")?;
    }

    // Stage the file
    let output = std::process::Command::new("git")
        .args(["add", ".gitkeep"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        return Err(Error::GitError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    // Create the commit
    let output = std::process::Command::new("git")
        .args(["commit", "-m", "Initial commit (created by Ada)"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        // Check if the error is because there's nothing to commit (files already committed)
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("nothing to commit") {
            return Err(Error::GitError(stderr.to_string()));
        }
    }

    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectSettingsRequest {
    pub project_id: String,
    pub default_client: Option<String>,
    pub auto_create_worktree: bool,
    pub worktree_base_path: Option<String>,
}

/// Create a new project - creates directory, initializes git, and makes initial commit
#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    request: CreateProjectRequest,
) -> Result<AdaProject> {
    let path = PathBuf::from(&request.path);

    // Check if path already exists
    if path.exists() {
        // If it exists, check if it's empty or has a .git folder
        let git_dir = path.join(".git");
        if git_dir.exists() {
            return Err(Error::GitError(
                "This folder is already a git repository. Use 'Open Existing Project' instead.".into()
            ));
        }

        // Check if directory is empty (allow creating in empty directories)
        let is_empty = path.read_dir()?.next().is_none();
        if !is_empty {
            return Err(Error::GitError(
                "This folder is not empty. Please choose an empty folder or a new location.".into()
            ));
        }
    } else {
        // Create directory
        std::fs::create_dir_all(&path)?;
    }

    // Initialize git repository
    let output = std::process::Command::new("git")
        .args(["init"])
        .current_dir(&path)
        .output()?;

    if !output.status.success() {
        return Err(Error::GitError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    // Create initial commit
    create_initial_commit(&path)?;

    let project = AdaProject::new(path);

    // Save project
    state.save_project(&project)?;

    // Add to state
    state.projects.write().insert(project.id.clone(), project.clone());

    Ok(project)
}

/// Open an existing git repository as a project
#[tauri::command]
pub async fn open_project(
    state: State<'_, AppState>,
    path: String,
) -> Result<AdaProject> {
    let path = PathBuf::from(&path);

    // Verify path exists
    if !path.exists() {
        return Err(Error::GitError("The selected folder does not exist.".into()));
    }

    // Verify it's a git repository
    let git_dir = path.join(".git");
    if !git_dir.exists() {
        return Err(Error::GitError(
            "Selected folder is not a git repository. Use 'New Project' to create one.".into()
        ));
    }

    // Verify it has at least one commit
    if !has_commits(&path) {
        return Err(Error::GitError(
            "The git repository has no commits. Please make an initial commit first, or use 'New Project' to create a fresh project.".into()
        ));
    }

    // Check if project already exists for this path
    {
        let projects = state.projects.read();
        for project in projects.values() {
            if project.path == path {
                return Ok(project.clone());
            }
        }
    }

    let project = AdaProject::new(path);

    // Save project
    state.save_project(&project)?;

    // Add to state
    state.projects.write().insert(project.id.clone(), project.clone());

    Ok(project)
}

#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
) -> Result<Vec<ProjectSummary>> {
    let projects = state.projects.read();
    let summaries: Vec<ProjectSummary> = projects.values().map(|p| p.into()).collect();
    Ok(summaries)
}

#[tauri::command]
pub async fn get_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<AdaProject> {
    let projects = state.projects.read();
    projects
        .get(&project_id)
        .cloned()
        .ok_or_else(|| Error::ProjectNotFound(project_id))
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<()> {
    // Remove from state
    let project = state.projects.write().remove(&project_id);

    if project.is_none() {
        return Err(Error::ProjectNotFound(project_id));
    }

    // Delete persisted file
    state.delete_project_file(&project_id)?;

    Ok(())
}

#[tauri::command]
pub async fn update_project_settings(
    state: State<'_, AppState>,
    request: UpdateProjectSettingsRequest,
) -> Result<AdaProject> {
    let mut projects = state.projects.write();
    let project = projects
        .get_mut(&request.project_id)
        .ok_or_else(|| Error::ProjectNotFound(request.project_id.clone()))?;

    // Update settings
    project.settings = ProjectSettings {
        default_client: request.default_client,
        auto_create_worktree: request.auto_create_worktree,
        worktree_base_path: request.worktree_base_path.map(PathBuf::from),
    };
    project.updated_at = chrono::Utc::now();

    let updated_project = project.clone();

    // Save to disk
    drop(projects); // Release lock before saving
    state.save_project(&updated_project)?;

    Ok(updated_project)
}
