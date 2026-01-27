//! System tray icon for the Ada daemon
//!
//! Provides a menu bar icon with quick access to:
//! - Open the main Ada app
//! - View active sessions (grouped by project)
//! - Quit the daemon
//!
//! Features:
//! - Live updates when sessions change
//! - Sessions grouped by project

use std::collections::HashMap;
use std::sync::mpsc;
#[allow(unused_imports)]
use std::thread::{self, JoinHandle};
use std::sync::Arc;

use muda::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use parking_lot::{Mutex, RwLock};
use once_cell::sync::Lazy;
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tray_icon::{menu::MenuId, TrayIconBuilder};
use tracing::{debug, info, warn};

use crate::constants::{APP_DESCRIPTION, APP_NAME};
#[cfg(target_os = "macos")]
use crate::constants::{DEV_SERVER_URL, MACOS_APP_BUNDLE};
#[cfg(target_os = "windows")]
use crate::constants::WINDOWS_EXE;
#[cfg(target_os = "linux")]
use crate::constants::LINUX_BINARY;
use crate::terminal::{TerminalInfo, TerminalStatus};
// AgentStatus is tracked by the daemon but not currently displayed in the tray

/// Commands that can be sent from the tray to the daemon
#[derive(Debug, Clone)]
pub enum TrayCommand {
    /// Open the main Ada application
    OpenApp,
    /// User selected a specific session
    SelectSession(String),
    /// Quit the daemon
    Quit,
}

/// Updates that can be sent to the tray to refresh the menu
#[derive(Debug, Clone)]
pub enum TrayUpdate {
    /// Sessions have changed, rebuild menu
    SessionsChanged(Vec<TerminalInfo>),
}

/// Menu item IDs
const ID_OPEN_APP: &str = "open_app";
const ID_QUIT: &str = "quit";
const ID_NO_SESSIONS: &str = "no_sessions";

/// Shared state for tray updates
pub struct TrayState {
    sessions: Arc<RwLock<Vec<TerminalInfo>>>,
    update_tx: mpsc::Sender<TrayUpdate>,
}

impl TrayState {
    /// Update the sessions and notify the tray to rebuild its menu
    pub fn update_sessions(&self, sessions: Vec<TerminalInfo>) {
        *self.sessions.write() = sessions.clone();
        let _ = self.update_tx.send(TrayUpdate::SessionsChanged(sessions));
    }
}

/// Runs the tray event loop on the current thread.
///
/// On macOS, this MUST be called from the main thread.
/// This function never returns - it runs the event loop forever.
///
/// Returns a TrayState that can be used to send updates to the tray.
pub fn run_tray_on_main_thread(
    cmd_tx: mpsc::Sender<TrayCommand>,
    initial_sessions: Vec<TerminalInfo>,
) -> ! {
    info!("tray starting on main thread");
    run_tray_loop(cmd_tx, initial_sessions)
}

/// Create tray state for sending updates
pub fn create_tray_state(
    initial_sessions: Vec<TerminalInfo>,
) -> (TrayState, mpsc::Receiver<TrayUpdate>) {
    let (update_tx, update_rx) = mpsc::channel();
    let state = TrayState {
        sessions: Arc::new(RwLock::new(initial_sessions)),
        update_tx,
    };
    (state, update_rx)
}

/// Main tray event loop using tao for proper cross-platform support
fn run_tray_loop(
    cmd_tx: mpsc::Sender<TrayCommand>,
    initial_sessions: Vec<TerminalInfo>,
) -> ! {
    // Create the event loop - this handles platform-specific initialization
    let event_loop = EventLoopBuilder::new().build();

    // Create update channel for live updates
    let (update_tx, update_rx) = mpsc::channel::<TrayUpdate>();

    // Store sessions in shared state
    let sessions = Arc::new(RwLock::new(initial_sessions.clone()));

    // Make update_tx available globally for the daemon to send updates
    info!("setting up global tray update channel");
    *TRAY_UPDATE_TX.lock() = Some(update_tx);
    info!("tray update channel ready for cross-thread notifications");

    // Build initial menu
    let menu = build_menu(&initial_sessions).expect("failed to build tray menu");

    // Load icon - use embedded icon data
    let icon = load_tray_icon().expect("failed to load tray icon");

    // Build tray with dynamic title showing session count
    let title = format_tray_title(&initial_sessions);
    let tooltip = format!("{} - {}", APP_NAME, APP_DESCRIPTION);

    let mut builder = TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip(&tooltip)
        .with_icon(icon)
        .with_menu_on_left_click(true)
        .with_title(&title);

    // On macOS, set icon as template for proper menu bar display
    #[cfg(target_os = "macos")]
    {
        builder = builder.with_icon_as_template(true);
    }

    let tray = builder.build().expect("failed to build tray icon");

    info!("tray icon created");

    // Get menu event receiver
    let menu_channel = MenuEvent::receiver();

    // Run the event loop (never returns)
    event_loop.run(move |_event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        // Check for session updates (non-blocking)
        if let Ok(update) = update_rx.try_recv() {
            match update {
                TrayUpdate::SessionsChanged(new_sessions) => {
                    let running = new_sessions.iter()
                        .filter(|s| s.status == TerminalStatus::Running)
                        .count();
                    let projects: std::collections::HashSet<_> = new_sessions.iter()
                        .map(|s| &s.project_id)
                        .collect();

                    info!(
                        total_sessions = new_sessions.len(),
                        running_sessions = running,
                        unique_projects = projects.len(),
                        "tray received session update, rebuilding menu"
                    );

                    *sessions.write() = new_sessions.clone();

                    // Rebuild and update menu
                    match build_menu(&new_sessions) {
                        Ok(new_menu) => {
                            tray.set_menu(Some(Box::new(new_menu)));
                            debug!("tray menu rebuilt successfully");
                        }
                        Err(e) => {
                            warn!(error = %e, "failed to rebuild tray menu");
                        }
                    }

                    // Update title with session count
                    let new_title = format_tray_title(&new_sessions);
                    tray.set_title(Some(&new_title));
                    debug!(title = %new_title, "tray title updated");
                }
            }
        }

        // Check for menu events (non-blocking)
        if let Ok(event) = menu_channel.try_recv() {
            let id = event.id.0.as_str();
            debug!(menu_id = id, "tray menu event");

            match id {
                ID_OPEN_APP => {
                    if cmd_tx.send(TrayCommand::OpenApp).is_err() {
                        warn!("failed to send OpenApp command");
                        *control_flow = ControlFlow::Exit;
                    }
                }
                ID_QUIT => {
                    info!("quit requested from tray");
                    let _ = cmd_tx.send(TrayCommand::Quit);
                    *control_flow = ControlFlow::Exit;
                }
                ID_NO_SESSIONS => {
                    // Disabled item, do nothing
                }
                id if id.starts_with("session:") => {
                    let terminal_id = id.strip_prefix("session:").unwrap_or(id);
                    if cmd_tx.send(TrayCommand::SelectSession(terminal_id.to_string())).is_err() {
                        warn!("failed to send SelectSession command");
                        *control_flow = ControlFlow::Exit;
                    }
                }
                _ => {
                    debug!(id, "unknown menu item");
                }
            }
        }
    })
}

/// Global sender for tray updates (thread-safe, accessible from any thread)
static TRAY_UPDATE_TX: Lazy<Mutex<Option<mpsc::Sender<TrayUpdate>>>> = Lazy::new(|| {
    debug!("initializing global tray update channel");
    Mutex::new(None)
});

/// Send a session update to the tray (call from daemon when sessions change)
pub fn notify_sessions_changed(sessions: Vec<TerminalInfo>) {
    let session_count = sessions.len();
    let running_count = sessions.iter()
        .filter(|s| s.status == TerminalStatus::Running)
        .count();

    if let Some(sender) = TRAY_UPDATE_TX.lock().as_ref() {
        match sender.send(TrayUpdate::SessionsChanged(sessions)) {
            Ok(()) => {
                info!(
                    session_count,
                    running_count,
                    "tray notification queued"
                );
            }
            Err(e) => {
                warn!(error = %e, "failed to send tray notification");
            }
        }
    } else {
        warn!(
            session_count,
            "tray update channel not initialized yet, skipping notification"
        );
    }
}

/// Format the tray title with session count
/// Note: Agent status tracking is preserved for future use but not displayed
fn format_tray_title(sessions: &[TerminalInfo]) -> String {
    let running_count = sessions.iter()
        .filter(|s| s.status == TerminalStatus::Running)
        .count();

    // Agent attention tracking preserved for future use:
    // let _needs_attention = sessions.iter()
    //     .any(|s| s.agent_status == AgentStatus::Permission);

    if running_count == 0 {
        APP_NAME.to_string()
    } else {
        format!("{} ({})", APP_NAME, running_count)
    }
}

/// Builds the tray menu with sessions grouped by project
fn build_menu(sessions: &[TerminalInfo]) -> Result<Menu, Box<dyn std::error::Error>> {
    let menu = Menu::new();

    // Open App
    let open_label = format!("Open {}", APP_NAME);
    let open_item = MenuItem::with_id(ID_OPEN_APP, &open_label, true, None);
    menu.append(&open_item)?;

    // Separator
    menu.append(&PredefinedMenuItem::separator())?;

    // Group sessions by project
    let mut projects: HashMap<String, Vec<&TerminalInfo>> = HashMap::new();
    for session in sessions {
        projects
            .entry(session.project_id.clone())
            .or_default()
            .push(session);
    }

    if projects.is_empty() {
        // No sessions - show placeholder
        let no_sessions = MenuItem::with_id(ID_NO_SESSIONS, "No active sessions", false, None);
        menu.append(&no_sessions)?;
    } else {
        // Always group by project in submenus
        let mut project_list: Vec<_> = projects.into_iter().collect();
        project_list.sort_by(|a, b| a.0.cmp(&b.0));

        for (project_id, project_sessions) in project_list {
            // Use a non-worktree session's working dir to get the project name
            // Worktree sessions have different working_dir (the worktree path, not project root)
            let project_name = project_sessions.iter()
                .find(|s| s.worktree_path.is_none())
                .or_else(|| project_sessions.first())
                .and_then(|s| {
                    std::path::Path::new(&s.working_dir)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| short_id(&project_id));

            // Count sessions
            // Note: Agent attention tracking preserved for future use:
            // let _attention = project_sessions.iter()
            //     .any(|s| s.agent_status == AgentStatus::Permission);
            let session_count = project_sessions.len();
            let label = format!("{} ({})", project_name, session_count);

            let project_menu = Submenu::new(&label, true);

            for session in project_sessions {
                append_session_item_to_submenu(&project_menu, session)?;
            }

            menu.append(&project_menu)?;
        }
    }

    // Separator
    menu.append(&PredefinedMenuItem::separator())?;

    // Quit
    let quit_item = MenuItem::with_id(ID_QUIT, "Quit Daemon", true, None);
    menu.append(&quit_item)?;

    Ok(menu)
}

/// Append a session item to a submenu
fn append_session_item_to_submenu(submenu: &Submenu, session: &TerminalInfo) -> Result<(), Box<dyn std::error::Error>> {
    let status_indicator = format_session_status(session);
    let label = format!("{} {}", session.name, status_indicator);
    let id = format!("session:{}", session.id);
    let item = MenuItem::with_id(MenuId::new(&id), &label, true, None);
    submenu.append(&item)?;
    Ok(())
}

/// Get a short version of an ID for display
fn short_id(id: &str) -> String {
    if id.len() > 8 {
        format!("{}...", &id[..8])
    } else {
        id.to_string()
    }
}

/// Format session status as an indicator string (terminal status only)
/// Note: Agent status is tracked but not displayed here. For future use:
/// - AgentStatus::Working => "⏳"
/// - AgentStatus::Permission => "⚠️"
/// - AgentStatus::Review => "👀"
/// - AgentStatus::Idle => "✓"
fn format_session_status(session: &TerminalInfo) -> &'static str {
    match session.status {
        TerminalStatus::Running => "●",
        TerminalStatus::Starting => "...",
        TerminalStatus::Stopped => "■",
        TerminalStatus::Error => "✗",
    }
}

/// Load the tray icon
fn load_tray_icon() -> Result<tray_icon::Icon, Box<dyn std::error::Error>> {
    // Use embedded icon bytes for portability
    let icon_data = include_bytes!("../../icons/tray-icon.png");

    let img = image::load_from_memory(icon_data)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let icon = tray_icon::Icon::from_rgba(rgba.into_raw(), width, height)?;
    Ok(icon)
}

/// Opens the main application
#[cfg(target_os = "macos")]
pub fn open_main_app() {
    use std::process::Command;

    // In dev mode, try to activate existing dev window via AppleScript
    // since the dev app runs differently than the production build
    let dev_mode = std::env::var("ADA_DEV_MODE").map(|v| v == "1").unwrap_or(false)
        || cfg!(debug_assertions);
    if dev_mode {
        info!("debug mode: trying to activate existing {} dev window", APP_NAME);

        // Try to activate any window with the app name (dev build)
        let app_name_lower = APP_NAME.to_lowercase();
        let script = format!(
            r#"tell application "System Events"
                set frontmost of first process whose name contains "{}" to true
            end tell"#,
            app_name_lower
        );

        let result = Command::new("osascript")
            .args(["-e", &script])
            .output();

        match result {
            Ok(output) if output.status.success() => {
                info!("activated {} dev window", APP_NAME);
                return;
            }
            _ => {
                // Fall back to opening dev server URL in browser
                info!("no dev window found, opening dev server URL");
                let _ = Command::new("open")
                    .arg(DEV_SERVER_URL)
                    .spawn();
                return;
            }
        }
    }

    info!("opening {} app", APP_NAME);

    // Production: Try to open by app name first
    let result = Command::new("open")
        .args(["-a", APP_NAME])
        .spawn();

    if result.is_err() {
        // Fallback: try to find the app in common locations
        let mut paths: Vec<std::path::PathBuf> = vec![
            std::path::PathBuf::from("/Applications").join(MACOS_APP_BUNDLE),
        ];

        // Add user Applications folder
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join("Applications").join(MACOS_APP_BUNDLE));
        }

        for path in paths {
            if path.exists() {
                let _ = Command::new("open").arg(&path).spawn();
                return;
            }
        }

        warn!("could not find {} to open", MACOS_APP_BUNDLE);
    }
}

#[cfg(target_os = "windows")]
pub fn open_main_app() {
    use std::process::Command;

    info!("opening {} app", APP_NAME);

    // Windows: try to start the executable
    let mut paths: Vec<std::path::PathBuf> = vec![
        std::path::PathBuf::from("C:\\Program Files")
            .join(APP_NAME)
            .join(WINDOWS_EXE),
    ];

    // Try relative to current exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths.insert(0, parent.join(WINDOWS_EXE));
        }
    }

    for path in paths {
        if path.exists() {
            let _ = Command::new(&path).spawn();
            return;
        }
    }

    warn!("could not find {} to open", WINDOWS_EXE);
}

#[cfg(target_os = "linux")]
pub fn open_main_app() {
    use std::process::Command;

    info!("opening {} app", APP_NAME);

    // Linux: try common approaches
    // 1. Try desktop entry
    let result = Command::new("gtk-launch")
        .arg(LINUX_BINARY)
        .spawn();

    if result.is_err() {
        // 2. Try direct execution
        let mut paths: Vec<std::path::PathBuf> = vec![
            std::path::PathBuf::from("/usr/bin").join(LINUX_BINARY),
            std::path::PathBuf::from("/usr/local/bin").join(LINUX_BINARY),
        ];

        // Add ~/.local/bin
        if let Some(home) = dirs::home_dir() {
            paths.push(home.join(".local/bin").join(LINUX_BINARY));
        }

        for path in paths {
            if path.exists() {
                let _ = Command::new(&path).spawn();
                return;
            }
        }
    }

    warn!("could not find {} to open", LINUX_BINARY);
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub fn open_main_app() {
    warn!("open_main_app not implemented for this platform");
}
