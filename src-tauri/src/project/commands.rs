use std::path::{Path, PathBuf};
use tauri::State;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::state::AppState;
use crate::terminal::create_main_terminal_internal;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateProjectSettingsRequest {
    pub project_id: String,
    pub default_client: Option<String>,
    pub auto_create_worktree: bool,
    pub worktree_base_path: Option<String>,
    #[serde(default)]
    pub last_visited_terminal_id: Option<String>,
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

/// Ensure a git repository is properly configured for Ada:
/// - Has at least one commit
/// - Has .worktrees/ in .gitignore
/// Returns Ok(true) if the repo is properly configured, Ok(false) if not a git repo
fn ensure_git_repo_configured(repo_path: &Path) -> Result<bool> {
    eprintln!("[Ada] ensure_git_repo_configured called for: {:?}", repo_path);

    let git_dir = repo_path.join(".git");
    // .git can be a directory (normal repo) or a file (worktree/submodule)
    if !git_dir.exists() {
        eprintln!("[Ada] .git does not exist at {:?}", git_dir);
        return Ok(false);
    }
    eprintln!("[Ada] .git exists (is_dir: {}, is_file: {})", git_dir.is_dir(), git_dir.is_file());

    // Add .worktrees to .gitignore
    eprintln!("[Ada] Adding .worktrees to .gitignore");
    add_worktrees_to_gitignore(repo_path)?;

    // Check if repo has commits - if not, create initial commit with all necessary files
    let has_existing_commits = has_commits(repo_path);
    eprintln!("[Ada] has_commits: {}", has_existing_commits);

    if !has_existing_commits {
        // Create .gitkeep to ensure we have something to commit
        let gitkeep_path = repo_path.join(".gitkeep");
        eprintln!("[Ada] Creating .gitkeep at {:?}", gitkeep_path);
        if !gitkeep_path.exists() {
            std::fs::write(&gitkeep_path, "# This file ensures the repository has an initial commit\n")?;
            eprintln!("[Ada] .gitkeep created successfully");
        } else {
            eprintln!("[Ada] .gitkeep already exists");
        }

        // Stage all Ada-related files
        eprintln!("[Ada] Staging .gitignore and .gitkeep");
        let output = std::process::Command::new("git")
            .args(["add", ".gitignore", ".gitkeep"])
            .current_dir(repo_path)
            .output()?;

        if !output.status.success() {
            let err_msg = format!("Failed to stage files: {}", String::from_utf8_lossy(&output.stderr));
            eprintln!("[Ada] {}", err_msg);
            return Err(Error::GitError(err_msg));
        }
        eprintln!("[Ada] Files staged successfully");

        // Create the initial commit
        eprintln!("[Ada] Creating initial commit");
        let output = std::process::Command::new("git")
            .args(["commit", "-m", "Initial commit (created by Ada)"])
            .current_dir(repo_path)
            .output()?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[Ada] Commit stderr: {}", stderr);
            // Ignore "nothing to commit" - means files are already committed
            if !stderr.contains("nothing to commit") {
                return Err(Error::GitError(
                    format!("Failed to create initial commit: {}", stderr)
                ));
            }
        } else {
            eprintln!("[Ada] Initial commit created successfully");
        }
    } else {
        // Repo already has commits - just ensure .gitignore changes are committed
        eprintln!("[Ada] Repo already has commits, checking .gitignore status");
        let output = std::process::Command::new("git")
            .args(["status", "--porcelain", ".gitignore"])
            .current_dir(repo_path)
            .output()?;

        let status = String::from_utf8_lossy(&output.stdout);
        eprintln!("[Ada] .gitignore status: '{}'", status.trim());
        if !status.is_empty() {
            // .gitignore has changes, stage and commit them
            eprintln!("[Ada] Committing .gitignore changes");
            let _ = std::process::Command::new("git")
                .args(["add", ".gitignore"])
                .current_dir(repo_path)
                .output();

            let _ = std::process::Command::new("git")
                .args(["commit", "-m", "Add .worktrees to .gitignore (Ada)"])
                .current_dir(repo_path)
                .output();
        }
    }

    eprintln!("[Ada] ensure_git_repo_configured completed successfully");
    Ok(true)
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

    // Check if it's a git repository and ensure it's properly configured
    let is_git_repo = ensure_git_repo_configured(&path)?;

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
    eprintln!("[Ada] get_project called for: {}", project_id);

    // First, get the project from state
    let project = {
        let projects = state.projects.read();
        projects
            .get(&project_id)
            .cloned()
            .ok_or_else(|| Error::ProjectNotFound(project_id.clone()))?
    };

    eprintln!("[Ada] Project found: {} at {:?}, is_git_repo: {}", project.name, project.path, project.is_git_repo);

    // Always check and configure git repo if .git exists
    // This handles both: transitioning from non-git to git, AND ensuring existing git repos are properly configured
    eprintln!("[Ada] Checking git configuration...");
    let is_now_git = ensure_git_repo_configured(&project.path)?;
    eprintln!("[Ada] ensure_git_repo_configured returned: {}", is_now_git);

    // Update state if git status changed
    if is_now_git && !project.is_git_repo {
        eprintln!("[Ada] Project is now a git repo, updating state...");
        let mut projects = state.projects.write();
        if let Some(p) = projects.get_mut(&project_id) {
            p.is_git_repo = true;
            p.updated_at = chrono::Utc::now();

            let updated_project = p.clone();
            drop(projects); // Release lock before saving

            // Persist the change
            state.save_project(&updated_project)?;
            eprintln!("[Ada] Project state updated and saved");

            return Ok(updated_project);
        }
    }

    Ok(project)
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
    // Check if we need to create main terminal before acquiring project lock
    let should_create_main = request.default_client.is_some();
    let client_id = request.default_client.clone();

    let updated_project = {
        let mut projects = state.projects.write();
        let project = projects
            .get_mut(&request.project_id)
            .ok_or_else(|| Error::ProjectNotFound(request.project_id.clone()))?;

        // Update settings, preserving last_visited_terminal_id if not provided
        let last_visited = request.last_visited_terminal_id.or_else(|| project.settings.last_visited_terminal_id.clone());

        project.settings = ProjectSettings {
            default_client: request.default_client,
            auto_create_worktree: request.auto_create_worktree,
            worktree_base_path: request.worktree_base_path.map(PathBuf::from),
            last_visited_terminal_id: last_visited,
        };
        project.updated_at = chrono::Utc::now();

        project.clone()
    };

    // Save to disk
    state.save_project(&updated_project)?;

    // Auto-create main terminal if default_client is set and no main terminal exists
    if should_create_main {
        if let Some(client_id) = client_id {
            // Check if main terminal already exists
            let needs_main_terminal = {
                match &updated_project.main_terminal_id {
                    None => true,
                    Some(main_id) => {
                        let terminals = state.terminals.read();
                        !terminals.contains_key(main_id)
                    }
                }
            };

            if needs_main_terminal {
                // Try to create main terminal, but don't fail if it errors
                // (e.g., client not installed)
                match create_main_terminal_internal(&state, &request.project_id, &client_id) {
                    Ok(_terminal_info) => {
                        eprintln!("[Ada] Auto-created main terminal for project {}", request.project_id);
                    }
                    Err(e) => {
                        eprintln!("[Ada] Failed to auto-create main terminal: {}", e);
                        // Don't propagate error - settings were still updated successfully
                    }
                }
            }
        }
    }

    // Re-read project to get updated main_terminal_id if it was created
    let final_project = {
        let projects = state.projects.read();
        projects
            .get(&request.project_id)
            .cloned()
            .unwrap_or(updated_project)
    };

    Ok(final_project)
}
