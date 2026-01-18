mod project;
mod terminal;
mod git;
mod clients;
mod state;
mod error;

use state::AppState;
use tauri::Manager;

pub use error::{Error, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_state = AppState::new(app.handle().clone())?;
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Project commands
            project::commands::create_project,
            project::commands::open_project,
            project::commands::list_projects,
            project::commands::delete_project,
            project::commands::get_project,
            project::commands::update_project_settings,
            // Terminal commands
            terminal::commands::create_terminal,
            terminal::commands::list_terminals,
            terminal::commands::close_terminal,
            terminal::commands::write_terminal,
            terminal::commands::resize_terminal,
            terminal::commands::get_terminal,
            terminal::commands::get_terminal_history,
            terminal::commands::restart_terminal,
            terminal::commands::mark_terminal_stopped,
            terminal::commands::switch_terminal_agent,
            // Git commands
            git::commands::get_branches,
            git::commands::create_worktree,
            git::commands::remove_worktree,
            git::commands::list_worktrees,
            git::commands::get_current_branch,
            // Client commands
            clients::commands::list_clients,
            clients::commands::get_client,
            clients::commands::detect_installed_clients,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
