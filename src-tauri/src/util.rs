use std::fs;
use std::path::Path;

/// Atomically write content to a file.
///
/// Writes to a temporary file first, then renames to the target path.
/// This ensures the file is never in a partially-written state.
pub fn atomic_write(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
