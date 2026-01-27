//! Ada CLI - Command line interface for Ada daemon management
//!
//! Usage:
//!   ada-cli daemon start [--foreground] [--dev]
//!   ada-cli daemon stop [--dev]
//!   ada-cli daemon status [--dev]
//!   ada-cli daemon restart [--dev]
//!   ada-cli daemon logs [-f] [-n 50] [--dev]

fn main() {
    ada_lib::cli::run();
}
