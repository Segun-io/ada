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

/// Create a new project - creates directory and optionally initializes git
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
            return Err(Error::InvalidRequest(
                "This folder is already a git repository. Use 'Open Existing' instead.".into()
            ));
        }

        // Check if directory is empty (allow creating in empty directories)
        let is_empty = path.read_dir()?.next().is_none();
        if !is_empty {
            return Err(Error::InvalidRequest(
                "This folder is not empty. Please choose an empty folder or a new location.".into()
            ));
        }
    } else {
        // Create directory
        std::fs::create_dir_all(&path)?;
    }

    let is_git_repo = if request.init_git {
        // Initialize git with .worktrees in .gitignore
        init_git_with_worktree_ignore(&path)?;
        true
    } else {
        false
    };

    let project = AdaProject::new(path, is_git_repo);

    // Save project
    state.save_project(&project)?;

    // Add to state
    state.projects.write().insert(project.id.clone(), project.clone());

    Ok(project)
}

/// Initialize git in a folder with .gitignore containing .worktrees/
fn init_git_with_worktree_ignore(repo_path: &Path) -> Result<()> {
    // Initialize git repository
    let output = std::process::Command::new("git")
        .args(["init"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        return Err(Error::GitError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    // Create .gitignore with .worktrees/
    let gitignore_path = repo_path.join(".gitignore");
    let gitignore_content = if gitignore_path.exists() {
        let existing = std::fs::read_to_string(&gitignore_path)?;
        if !existing.contains(".worktrees") {
            format!("{}\n# Ada worktrees\n.worktrees/\n", existing.trim_end())
        } else {
            existing
        }
    } else {
        "# Ada worktrees\n.worktrees/\n".to_string()
    };
    std::fs::write(&gitignore_path, gitignore_content)?;

    // Stage .gitignore
    let output = std::process::Command::new("git")
        .args(["add", ".gitignore"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        return Err(Error::GitError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    // Create initial commit
    let output = std::process::Command::new("git")
        .args(["commit", "-m", "Initial commit (created by Ada)"])
        .current_dir(repo_path)
        .output()?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("nothing to commit") {
            return Err(Error::GitError(stderr.to_string()));
        }
    }

    Ok(())
}

/// Add .worktrees/ to .gitignore if not already present
fn add_worktrees_to_gitignore(repo_path: &Path) -> Result<()> {
    let gitignore_path = repo_path.join(".gitignore");
    let gitignore_content = if gitignore_path.exists() {
        let existing = std::fs::read_to_string(&gitignore_path)?;
        if existing.contains(".worktrees") {
            return Ok(()); // Already has .worktrees, nothing to do
        }
        format!("{}\n# Ada worktrees\n.worktrees/\n", existing.trim_end())
    } else {
        "# Ada worktrees\n.worktrees/\n".to_string()
    };
    std::fs::write(&gitignore_path, gitignore_content)?;
    Ok(())
}

/// Open any folder as a project (respects existing git status)
#[tauri::command]
pub async fn open_project(
    state: State<'_, AppState>,
    path: String,
) -> Result<AdaProject> {
    let path = PathBuf::from(&path);

    // Verify path exists
    if !path.exists() {
        return Err(Error::InvalidRequest("The selected folder does not exist.".into()));
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

    // Check if it's a git repository
    let git_dir = path.join(".git");
    let is_git_repo = git_dir.exists();

    if is_git_repo {
        // For git repos, add .worktrees to .gitignore if not present
        add_worktrees_to_gitignore(&path)?;
    }
    // For non-git folders, we just open them as-is

    let project = AdaProject::new(path, is_git_repo);

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
