use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::daemon::shell::ShellConfig;

const ALLOWED_ENV_VARS: &[&str] = &[
    "PATH", "HOME", "USER", "SHELL", "TERM", "TMPDIR", "LANG",
    "SSH_AUTH_SOCK", "SSH_AGENT_PID",
    "NVM_DIR", "NVM_BIN", "NVM_INC",
    "PYENV_ROOT", "PYENV_SHELL",
    "RBENV_ROOT", "RBENV_SHELL",
    "CARGO_HOME", "RUSTUP_HOME",
    "GOPATH", "GOROOT", "GOBIN",
    "BUN_INSTALL",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "no_proxy",
    "__CF_USER_TEXT_ENCODING",
    "Apple_PubSub_Socket_Render",
    "LC_ALL", "LC_CTYPE", "LC_MESSAGES",
];

const ALLOWED_PREFIXES: &[&str] = &[
    "ADA_",
    "LC_",
];

pub fn build_terminal_env(
    shell: &ShellConfig,
    wrapper_dir: &Path,
    ada_home: &Path,
    ada_bin_dir: &Path,
    terminal_id: &str,
    project_id: &str,
    notification_port: u16,
) -> HashMap<String, String> {
    let mut env = HashMap::new();
    let allowed: HashSet<&str> = ALLOWED_ENV_VARS.iter().copied().collect();

    for (key, value) in std::env::vars() {
        let included = allowed.contains(key.as_str())
            || ALLOWED_PREFIXES.iter().any(|prefix| key.starts_with(prefix));

        if included {
            env.insert(key, value);
        }
    }

    match shell.name.as_str() {
        "zsh" => {
            let orig_zdotdir = std::env::var("ZDOTDIR")
                .unwrap_or_else(|_| {
                    dirs::home_dir()
                        .map(|h| h.to_string_lossy().to_string())
                        .unwrap_or_default()
                });
            env.insert("ADA_ORIG_ZDOTDIR".into(), orig_zdotdir);
            env.insert(
                "ZDOTDIR".into(),
                wrapper_dir.join("zsh").to_string_lossy().to_string(),
            );
        }
        _ => {}
    }

    env.insert("ADA_HOME".into(), ada_home.to_string_lossy().to_string());
    env.insert("ADA_BIN_DIR".into(), ada_bin_dir.to_string_lossy().to_string());
    env.insert("ADA_TERMINAL_ID".into(), terminal_id.to_string());
    env.insert("ADA_PROJECT_ID".into(), project_id.to_string());
    env.insert("ADA_NOTIFICATION_PORT".into(), notification_port.to_string());
    env.insert("TERM".into(), "xterm-256color".into());
    env.insert("SHELL".into(), shell.path.to_string_lossy().to_string());

    let ada_bin = ada_bin_dir.to_string_lossy().to_string();
    let path_value = env
        .get("PATH")
        .map(|path| format!("{ada_bin}:{path}"))
        .unwrap_or_else(|| ada_bin.clone());
    env.insert("PATH".into(), path_value);

    env
}
