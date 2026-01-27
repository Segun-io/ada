//! Application constants
//!
//! Centralized constants that mirror values from tauri.conf.json
//! to avoid hardcoding throughout the codebase.

/// Application name (matches productName in tauri.conf.json)
pub const APP_NAME: &str = "Ada";

/// Application identifier (matches identifier in tauri.conf.json)
pub const APP_IDENTIFIER: &str = "com.ada.agent";

/// Application description
pub const APP_DESCRIPTION: &str = "AI Code Agent Manager";

/// Full application title (matches app.windows[0].title in tauri.conf.json)
pub const APP_TITLE: &str = "Ada - AI Code Agent Manager";

/// Vite development server URL (matches build.devUrl in tauri.conf.json)
pub const DEV_SERVER_URL: &str = "http://localhost:5173";

/// macOS application bundle name
pub const MACOS_APP_BUNDLE: &str = "Ada.app";

/// Windows executable name
pub const WINDOWS_EXE: &str = "Ada.exe";

/// Linux binary name
pub const LINUX_BINARY: &str = "ada";
