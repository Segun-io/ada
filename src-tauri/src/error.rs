use serde::Deserialize;
use thiserror::Error;

#[derive(Error, Debug, Deserialize)]
pub enum Error {
    #[error("Project not found: {0}")]
    ProjectNotFound(String),
    
    #[error("Terminal not found: {0}")]
    TerminalNotFound(String),
    
    #[error("Git error: {0}")]
    GitError(String),
    
    #[error("IO error: {0}")]
    IoError(String),
    
    #[error("Configuration error: {0}")]
    ConfigError(String),
    
    #[error("Terminal error: {0}")]
    TerminalError(String),
    
    #[error("Client not found: {0}")]
    ClientNotFound(String),
    
    #[error("Worktree error: {0}")]
    WorktreeError(String),
    
    #[error("Serialization error: {0}")]
    SerializationError(String),
}

impl From<std::io::Error> for Error {
    fn from(err: std::io::Error) -> Self {
        Error::IoError(err.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::SerializationError(err.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

// Custom Serialize implementation for Tauri's command system
impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
