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
    eprintln!("[Ada:Worktree] create_worktree_internal called");
    eprintln!("[Ada:Worktree]   repo_path: {:?}", repo_path);
    eprintln!("[Ada:Worktree]   branch: {}", branch);
    eprintln!("[Ada:Worktree]   worktree_path: {:?}", worktree_path);

    // Ensure parent directory exists
    if let Some(parent) = worktree_path.parent() {
        eprintln!("[Ada:Worktree] Creating parent directory: {:?}", parent);
        std::fs::create_dir_all(parent)?;
    }

    // Check for special format: wt-baseBranch/newBranchName
    // This means: create a new branch named newBranchName based on baseBranch
    if branch.starts_with("wt-") {
        let rest = branch.strip_prefix("wt-").unwrap();
        eprintln!("[Ada:Worktree] Detected wt- prefix, rest: {}", rest);

        // Split on first "/" to get baseBranch and newBranchName
        if let Some(slash_pos) = rest.find('/') {
            let base_branch = &rest[..slash_pos];
            let new_branch = &rest[slash_pos + 1..];

            eprintln!("[Ada:Worktree] Parsed special format:");
            eprintln!("[Ada:Worktree]   base_branch: {}", base_branch);
            eprintln!("[Ada:Worktree]   new_branch: {}", new_branch);

            // Verify base branch exists
            let verify_cmd = format!("git rev-parse --verify {}", base_branch);
            eprintln!("[Ada:Worktree] Running: {}", verify_cmd);

            let base_exists = Command::new("git")
                .args(["rev-parse", "--verify", base_branch])
                .current_dir(repo_path)
                .output()?
                .status
                .success();

            eprintln!("[Ada:Worktree] Base branch '{}' exists: {}", base_branch, base_exists);

            if !base_exists {
                return Err(Error::WorktreeError(
                    format!("Base branch '{}' does not exist", base_branch)
                ));
            }

            // Create worktree with new branch from base branch
            let cmd = format!(
                "git worktree add -b {} {} {}",
                new_branch,
                worktree_path.to_string_lossy(),
                base_branch
            );
            eprintln!("[Ada:Worktree] Running: {}", cmd);

            let output = Command::new("git")
                .args(["worktree", "add", "-b", new_branch, &worktree_path.to_string_lossy(), base_branch])
                .current_dir(repo_path)
                .output()?;

            eprintln!("[Ada:Worktree] Command exit status: {}", output.status);
            if !output.stdout.is_empty() {
                eprintln!("[Ada:Worktree] stdout: {}", String::from_utf8_lossy(&output.stdout));
            }
            if !output.stderr.is_empty() {
                eprintln!("[Ada:Worktree] stderr: {}", String::from_utf8_lossy(&output.stderr));
            }

            if !output.status.success() {
                return Err(Error::WorktreeError(
                    String::from_utf8_lossy(&output.stderr).to_string()
                ));
            }

            eprintln!("[Ada:Worktree] Worktree created successfully");
            return Ok(());
        } else {
            eprintln!("[Ada:Worktree] No slash found in wt- format, treating as regular branch");
        }
    }

    // Standard worktree creation (existing branch or new branch from HEAD)
    eprintln!("[Ada:Worktree] Standard worktree creation for branch: {}", branch);

    let verify_cmd = format!("git rev-parse --verify {}", branch);
    eprintln!("[Ada:Worktree] Running: {}", verify_cmd);

    let branch_exists = Command::new("git")
        .args(["rev-parse", "--verify", branch])
        .current_dir(repo_path)
        .output()?
        .status
        .success();

    eprintln!("[Ada:Worktree] Branch '{}' exists: {}", branch, branch_exists);

    let output = if branch_exists {
        // Use existing branch
        let cmd = format!("git worktree add {} {}", worktree_path.to_string_lossy(), branch);
        eprintln!("[Ada:Worktree] Running: {}", cmd);

        Command::new("git")
            .args(["worktree", "add", &worktree_path.to_string_lossy(), branch])
            .current_dir(repo_path)
            .output()?
    } else {
        // Check if HEAD is valid (repository has at least one commit)
        eprintln!("[Ada:Worktree] Running: git rev-parse --verify HEAD");
        let head_valid = Command::new("git")
            .args(["rev-parse", "--verify", "HEAD"])
            .current_dir(repo_path)
            .output()?
            .status
            .success();

        eprintln!("[Ada:Worktree] HEAD is valid: {}", head_valid);

        if !head_valid {
            return Err(Error::WorktreeError(
                "Cannot create a new branch: the repository has no commits yet. Please make an initial commit first.".to_string()
            ));
        }

        // Create new branch from current HEAD
        let cmd = format!("git worktree add -b {} {}", branch, worktree_path.to_string_lossy());
        eprintln!("[Ada:Worktree] Running: {}", cmd);

        Command::new("git")
            .args(["worktree", "add", "-b", branch, &worktree_path.to_string_lossy()])
            .current_dir(repo_path)
            .output()?
    };

    eprintln!("[Ada:Worktree] Command exit status: {}", output.status);
    if !output.stdout.is_empty() {
        eprintln!("[Ada:Worktree] stdout: {}", String::from_utf8_lossy(&output.stdout));
    }
    if !output.stderr.is_empty() {
        eprintln!("[Ada:Worktree] stderr: {}", String::from_utf8_lossy(&output.stderr));
    }

    if !output.status.success() {
        return Err(Error::WorktreeError(
            String::from_utf8_lossy(&output.stderr).to_string()
        ));
    }

    eprintln!("[Ada:Worktree] Worktree created successfully");
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
