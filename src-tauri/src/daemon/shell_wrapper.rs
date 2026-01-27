use std::fs;
use std::path::{Path, PathBuf};

const ZSH_ZPROFILE: &str = r#"
# Ada shell wrapper - sources user config then adds Ada modifications

if [[ -f "${ADA_ORIG_ZDOTDIR}/.zprofile" ]]; then
    source "${ADA_ORIG_ZDOTDIR}/.zprofile"
fi

export PATH="${ADA_BIN_DIR}:${PATH}"
"#;

const ZSH_ZSHRC: &str = r#"
export ZDOTDIR="${ADA_ORIG_ZDOTDIR}"

if [[ -f "${ZDOTDIR}/.zshrc" ]]; then
    source "${ZDOTDIR}/.zshrc"
fi
"#;

const BASH_RC: &str = r#"
if [[ -f /etc/profile ]]; then
    source /etc/profile
fi

if [[ -f ~/.bash_profile ]]; then
    source ~/.bash_profile
elif [[ -f ~/.bash_login ]]; then
    source ~/.bash_login
elif [[ -f ~/.profile ]]; then
    source ~/.profile
fi

if [[ -f ~/.bashrc ]]; then
    source ~/.bashrc
fi

export PATH="${ADA_BIN_DIR}:${PATH}"
"#;

pub fn setup_shell_wrappers(ada_home: &Path) -> std::io::Result<PathBuf> {
    let wrapper_dir = ada_home.join("shell-wrapper");

    let zsh_dir = wrapper_dir.join("zsh");
    fs::create_dir_all(&zsh_dir)?;
    fs::write(zsh_dir.join(".zprofile"), ZSH_ZPROFILE.trim_start())?;
    fs::write(zsh_dir.join(".zshrc"), ZSH_ZSHRC.trim_start())?;

    let bash_dir = wrapper_dir.join("bash");
    fs::create_dir_all(&bash_dir)?;
    fs::write(bash_dir.join(".bashrc"), BASH_RC.trim_start())?;

    Ok(wrapper_dir)
}
