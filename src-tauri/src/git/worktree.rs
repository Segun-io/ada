use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub branch: String,
    pub head: String,
    pub is_bare: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
}

pub fn create_worktree_internal(repo_path: &Path, branch: &str, worktree_path: &Path) -> Result<()> {
    // Ensure parent directory exists
    if let Some(parent) = worktree_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Check if branch exists
    let branch_exists = Command::new("git")
        .args(["rev-parse", "--verify", branch])
        .current_dir(repo_path)
        .output()?
        .status
        .success();

    let output = if branch_exists {
        // Use existing branch
        Command::new("git")
            .args(["worktree", "add", &worktree_path.to_string_lossy(), branch])
            .current_dir(repo_path)
            .output()?
    } else {
        // Check if HEAD is valid (repository has at least one commit)
        let head_valid = Command::new("git")
            .args(["rev-parse", "--verify", "HEAD"])
            .current_dir(repo_path)
            .output()?
            .status
            .success();

        if !head_valid {
            return Err(Error::WorktreeError(
                "Cannot create a new branch: the repository has no commits yet. Please make an initial commit first.".to_string()
            ));
        }

        // Create new branch from current HEAD
        Command::new("git")
            .args(["worktree", "add", "-b", branch, &worktree_path.to_string_lossy()])
            .current_dir(repo_path)
            .output()?
    };

    if !output.status.success() {
        return Err(Error::WorktreeError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    Ok(())
}

pub fn remove_worktree_internal(repo_path: &Path, worktree_path: &Path) -> Result<()> {
    let output = Command::new("git")
        .args(["worktree", "remove", &worktree_path.to_string_lossy(), "--force"])
        .current_dir(repo_path)
        .output()?;
    
    if !output.status.success() {
        return Err(Error::WorktreeError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }
    
    Ok(())
}

pub fn list_worktrees_internal(repo_path: &Path) -> Result<Vec<WorktreeInfo>> {
    let output = Command::new("git")
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()?;
    
    if !output.status.success() {
        return Err(Error::WorktreeError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_worktree: Option<WorktreeInfo> = None;
    
    for line in stdout.lines() {
        if line.starts_with("worktree ") {
            if let Some(wt) = current_worktree.take() {
                worktrees.push(wt);
            }
            current_worktree = Some(WorktreeInfo {
                path: line.strip_prefix("worktree ").unwrap_or("").to_string(),
                branch: String::new(),
                head: String::new(),
                is_bare: false,
            });
        } else if let Some(ref mut wt) = current_worktree {
            if line.starts_with("HEAD ") {
                wt.head = line.strip_prefix("HEAD ").unwrap_or("").to_string();
            } else if line.starts_with("branch ") {
                wt.branch = line
                    .strip_prefix("branch refs/heads/")
                    .unwrap_or(line.strip_prefix("branch ").unwrap_or(""))
                    .to_string();
            } else if line == "bare" {
                wt.is_bare = true;
            }
        }
    }
    
    if let Some(wt) = current_worktree {
        worktrees.push(wt);
    }
    
    Ok(worktrees)
}

pub fn get_branches_internal(repo_path: &Path) -> Result<Vec<BranchInfo>> {
    let output = Command::new("git")
        .args(["branch", "-a", "--format=%(refname:short)|%(HEAD)|%(upstream:short)"])
        .current_dir(repo_path)
        .output()?;
    
    if !output.status.success() {
        return Err(Error::GitError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }
    
    let stdout = String::from_utf8_lossy(&output.stdout);
    let branches: Vec<BranchInfo> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            let name = parts.first().unwrap_or(&"").to_string();
            let is_current = parts.get(1).map_or(false, |s| *s == "*");
            let upstream = parts.get(2).and_then(|s| {
                if s.is_empty() { None } else { Some(s.to_string()) }
            });
            let is_remote = name.starts_with("origin/") || name.starts_with("remotes/");
            
            BranchInfo {
                name,
                is_current,
                is_remote,
                upstream,
            }
        })
        .collect();
    
    Ok(branches)
}

pub fn get_current_branch_internal(repo_path: &Path) -> Result<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(repo_path)
        .output()?;
    
    if !output.status.success() {
        return Err(Error::GitError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
