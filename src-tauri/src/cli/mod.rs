//! CLI module for Ada
//!
//! Provides command-line interface for daemon management.

pub mod daemon;
pub mod paths;
pub mod install;

use clap::{Parser, Subcommand};

/// Ada - AI Code Agent Manager
#[derive(Parser)]
#[command(name = "ada", version, about = "Ada AI Code Agent Manager CLI")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,

    /// Use development mode (separate data directory from production)
    #[arg(long, global = true)]
    pub dev: bool,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Manage the Ada daemon
    Daemon {
        #[command(subcommand)]
        action: DaemonAction,
    },
}

#[derive(Subcommand)]
pub enum DaemonAction {
    /// Start the daemon
    Start {
        /// Run in foreground (don't daemonize)
        #[arg(long)]
        foreground: bool,
    },
    /// Stop the daemon
    Stop,
    /// Show daemon status
    Status,
    /// Restart the daemon
    Restart,
    /// View daemon logs
    Logs {
        /// Follow log output (like tail -f)
        #[arg(short, long)]
        follow: bool,
        /// Number of lines to show
        #[arg(short = 'n', long, default_value = "50")]
        lines: usize,
    },
}

/// Run the CLI
pub fn run() {
    let cli = Cli::parse();

    let result = match cli.command {
        Commands::Daemon { action } => match action {
            DaemonAction::Start { foreground } => daemon::start(cli.dev, foreground),
            DaemonAction::Stop => daemon::stop(cli.dev),
            DaemonAction::Status => daemon::status(cli.dev),
            DaemonAction::Restart => daemon::restart(cli.dev),
            DaemonAction::Logs { follow, lines } => daemon::logs(cli.dev, follow, lines),
        },
    };

    if let Err(e) = result {
        eprintln!("Error: {}", e);
        std::process::exit(1);
    }
}
