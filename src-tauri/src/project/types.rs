use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdaProject {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub description: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub terminal_ids: Vec<String>,
    pub settings: ProjectSettings,
    /// The main terminal ID for this project (auto-created on project open)
    #[serde(default)]
    pub main_terminal_id: Option<String>,
    /// Whether this project has a git repository
    #[serde(default)]
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProjectSettings {
    pub default_client: Option<String>,
    pub auto_create_worktree: bool,
    pub worktree_base_path: Option<PathBuf>,
}

impl AdaProject {
    pub fn new(path: PathBuf, is_git_repo: bool) -> Self {
        let now = Utc::now();
        // Extract project name from path
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unnamed Project".into());

        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            path,
            description: None,
            created_at: now,
            updated_at: now,
            terminal_ids: Vec::new(),
            settings: ProjectSettings::default(),
            main_terminal_id: None,
            is_git_repo,
        }
    }
    
    pub fn add_terminal(&mut self, terminal_id: String) {
        if !self.terminal_ids.contains(&terminal_id) {
            self.terminal_ids.push(terminal_id);
            self.updated_at = Utc::now();
        }
    }
    
    pub fn remove_terminal(&mut self, terminal_id: &str) {
        self.terminal_ids.retain(|id| id != terminal_id);
        self.updated_at = Utc::now();
    }
}

/// Request to create a new project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateProjectRequest {
    pub path: String,
    /// Whether to initialize a git repository (default: true)
    #[serde(default = "default_true")]
    pub init_git: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: String,
    pub terminal_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub main_terminal_id: Option<String>,
    pub is_git_repo: bool,
}

impl From<&AdaProject> for ProjectSummary {
    fn from(project: &AdaProject) -> Self {
        Self {
            id: project.id.clone(),
            name: project.name.clone(),
            path: project.path.to_string_lossy().to_string(),
            terminal_count: project.terminal_ids.len(),
            created_at: project.created_at,
            updated_at: project.updated_at,
            main_terminal_id: project.main_terminal_id.clone(),
            is_git_repo: project.is_git_repo,
        }
    }
}
