use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone)]
pub struct ShellConfig {
    pub path: PathBuf,
    pub name: String,
    pub login_args: Vec<String>,
}

impl ShellConfig {
    pub fn detect(shell_override: Option<String>) -> Self {
        let shell_path = shell_override
            .map(PathBuf::from)
            .or_else(Self::get_user_shell)
            .unwrap_or_else(|| PathBuf::from("/bin/bash"));

        let name = shell_path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("bash")
            .to_string();

        let login_args = match name.as_str() {
            "fish" => vec!["--login".to_string()],
            _ => vec!["-l".to_string()],
        };

        Self {
            path: shell_path,
            name,
            login_args,
        }
    }

    #[cfg(target_os = "macos")]
    fn get_user_shell() -> Option<PathBuf> {
        let username = whoami::username();
        let output = Command::new("dscl")
            .args([".", "-read", &format!("/Users/{username}"), "UserShell"])
            .output()
            .ok()?;

        String::from_utf8_lossy(&output.stdout)
            .lines()
            .find(|line| line.starts_with("UserShell:"))
            .map(|line| PathBuf::from(line.trim_start_matches("UserShell:").trim()))
    }

    #[cfg(target_os = "linux")]
    fn get_user_shell() -> Option<PathBuf> {
        let username = whoami::username();
        std::fs::read_to_string("/etc/passwd")
            .ok()?
            .lines()
            .find(|line| line.starts_with(&format!("{username}:")))
            .and_then(|line| line.split(':').last())
            .map(PathBuf::from)
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    fn get_user_shell() -> Option<PathBuf> {
        None
    }
}
