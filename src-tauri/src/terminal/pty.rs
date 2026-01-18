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
    
    let mut cmd = CommandBuilder::new(&client.command);
    cmd.args(&client.args);
    cmd.cwd(working_dir);
    
    // Set environment variables
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
