use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Registry};

pub fn init_daemon_logging(ada_home: &Path) -> Option<WorkerGuard> {
    if env_flag("ADA_LOG_DISABLE") {
        return None;
    }

    let log_dir = env::var_os("ADA_LOG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| ada_home.join("logs"));

    if let Err(err) = fs::create_dir_all(&log_dir) {
        eprintln!(
            "Warning: failed to create daemon log directory {}: {}",
            log_dir.display(),
            err
        );
        return None;
    }

    let filter = match env::var("ADA_LOG_LEVEL") {
        Ok(level) if !level.trim().is_empty() => EnvFilter::new(level),
        _ => EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
    };

    let file_appender = tracing_appender::rolling::daily(log_dir, "ada-daemon.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);
    let file_layer = tracing_subscriber::fmt::layer()
        .with_writer(non_blocking)
        .with_ansi(false)
        .with_target(true);

    if env_flag("ADA_LOG_STDERR") {
        let stderr_layer = tracing_subscriber::fmt::layer()
            .with_writer(std::io::stderr)
            .with_ansi(true)
            .with_target(true);
        Registry::default()
            .with(filter)
            .with(file_layer)
            .with(stderr_layer)
            .init();
    } else {
        Registry::default().with(filter).with(file_layer).init();
    }
    Some(guard)
}

fn env_flag(name: &str) -> bool {
    match env::var(name) {
        Ok(value) => matches!(
            value.as_str(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        ),
        Err(_) => false,
    }
}
