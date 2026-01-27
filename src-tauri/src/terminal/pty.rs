use portable_pty::PtySize;

use crate::error::{Error, Result};
use super::types::PtyHandle;

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
