pub mod protocol;
pub mod server;
pub mod session;
pub mod env;
pub mod shell;
pub mod shell_wrapper;
pub mod persistence;
pub mod wrappers;
pub mod notification;
pub mod client;
pub mod logging;
pub mod tray;
pub mod pid;
pub mod tauri_commands;

pub use server::{run_daemon, run_daemon_with_tray};
