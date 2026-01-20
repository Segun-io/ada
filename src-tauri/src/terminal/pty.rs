use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter};

use crate::clients::ClientConfig;
use crate::error::{Error, Result};
use super::types::{PtyHandle, TerminalOutput, TerminalOutputBuffer};

pub fn spawn_pty(
    app_handle: &AppHandle,
    terminal_id: &str,
    working_dir: &Path,
    client: &ClientConfig,
    cols: u16,
    rows: u16,
    output_buffer: Arc<TerminalOutputBuffer>,
) -> Result<PtyHandle> {
    let pty_system = NativePtySystem::default();

    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    // Use full path to command (macOS GUI apps don't inherit shell PATH)
    let command_path = client.get_command_path();
    let mut cmd = CommandBuilder::new(&command_path);
    cmd.args(&client.args);
    cmd.cwd(working_dir);

    // Set up proper PATH environment for the PTY
    // This ensures child processes can find common tools
    if let Some(home) = dirs::home_dir() {
        let path_dirs = vec![
            home.join(".local/bin"),
            home.join(".cargo/bin"),
            home.join(".bun/bin"),
            std::path::PathBuf::from("/opt/homebrew/bin"),
            std::path::PathBuf::from("/opt/homebrew/sbin"),
            std::path::PathBuf::from("/usr/local/bin"),
            std::path::PathBuf::from("/usr/bin"),
            std::path::PathBuf::from("/bin"),
            std::path::PathBuf::from("/usr/sbin"),
            std::path::PathBuf::from("/sbin"),
        ];

        let path_value: String = path_dirs
            .iter()
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(":");

        cmd.env("PATH", &path_value);
        cmd.env("HOME", home.to_string_lossy().to_string());
    }

    // Set TERM for proper terminal emulation
    cmd.env("TERM", "xterm-256color");

    // Set environment variables from client config
    for (key, value) in &client.env {
        cmd.env(key, value);
    }
    
    // Spawn the child process
    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    
    // Drop the slave to avoid blocking
    drop(pair.slave);
    
    // Get reader for output
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    
    // Spawn a thread to read output and emit events
    let app_handle_clone = app_handle.clone();
    let terminal_id_clone = terminal_id.to_string();

    // Get the writer before spawning the read thread
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    std::thread::spawn(move || {
        let mut buffer = [0u8; 4096];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buffer[..n]).to_string();

                    // Store in output buffer for persistence
                    output_buffer.append(output.clone());

                    // Emit output event for frontend
                    let _ = app_handle_clone.emit(
                        "terminal-output",
                        TerminalOutput {
                            terminal_id: terminal_id_clone.clone(),
                            data: output,
                        },
                    );
                }
                Err(_) => break,
            }
        }

        // Emit terminal closed event
        let _ = app_handle_clone.emit("terminal-closed", terminal_id_clone);
    });

    Ok(PtyHandle {
        master: Arc::new(Mutex::new(pair.master)),
        writer: Arc::new(Mutex::new(writer)),
    })
}

pub fn write_to_pty(pty_handle: &PtyHandle, data: &[u8]) -> Result<()> {
    use std::io::Write;

    let mut writer = pty_handle.writer.lock();
    writer
        .write_all(data)
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    writer
        .flush()
        .map_err(|e| Error::TerminalError(e.to_string()))?;

    Ok(())
}

pub fn resize_pty(pty_handle: &PtyHandle, cols: u16, rows: u16) -> Result<()> {
    let master = pty_handle.master.lock();
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| Error::TerminalError(e.to_string()))?;
    Ok(())
}
