use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use crate::terminal::{CommandSpec, TerminalMode};

const MAX_SCROLLBACK_BYTES: usize = 5 * 1024 * 1024; // 5MB

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionMeta {
    pub terminal_id: String,
    pub project_id: String,
    pub name: String,
    pub client_id: String,
    pub working_dir: PathBuf,
    pub branch: Option<String>,
    pub worktree_path: Option<PathBuf>,
    pub folder_path: Option<PathBuf>,
    pub is_main: bool,
    pub mode: TerminalMode,
    pub command: CommandSpec,
    pub shell: Option<String>,
    pub cols: u16,
    pub rows: u16,
    pub created_at: DateTime<Utc>,
    pub last_activity: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub scrollback_bytes: usize,
}

pub struct SessionPersistence {
    session_dir: PathBuf,
    scrollback_writer: BufWriter<File>,
    bytes_written: usize,
    bytes_since_flush: usize,
    pub meta: SessionMeta,
}

impl SessionPersistence {
    pub fn new(base_dir: &Path, meta: SessionMeta) -> std::io::Result<Self> {
        let session_dir = base_dir.join(&meta.terminal_id);
        fs::create_dir_all(&session_dir)?;

        let scrollback_file = open_scrollback(&session_dir, true)?;

        let persistence = Self {
            session_dir,
            scrollback_writer: BufWriter::new(scrollback_file),
            bytes_written: 0,
            bytes_since_flush: 0,
            meta,
        };

        persistence.save_meta()?;
        Ok(persistence)
    }

    pub fn open_existing(base_dir: &Path, meta: SessionMeta) -> std::io::Result<Self> {
        let session_dir = base_dir.join(&meta.terminal_id);
        fs::create_dir_all(&session_dir)?;

        let scrollback_file = open_scrollback(&session_dir, false)?;

        let persistence = Self {
            session_dir,
            scrollback_writer: BufWriter::new(scrollback_file),
            bytes_written: meta.scrollback_bytes,
            bytes_since_flush: 0,
            meta,
        };

        persistence.save_meta()?;
        Ok(persistence)
    }

    pub fn load_meta(session_dir: &Path) -> Option<SessionMeta> {
        let meta_path = session_dir.join("meta.json");
        let content = fs::read_to_string(&meta_path).ok()?;
        match serde_json::from_str(&content) {
            Ok(meta) => Some(meta),
            Err(e) => {
                tracing::warn!("Corrupt session metadata {}: {}", meta_path.display(), e);
                None
            }
        }
    }

    pub fn read_scrollback(session_dir: &Path) -> std::io::Result<String> {
        let scrollback_path = session_dir.join("scrollback.bin");
        let bytes = fs::read(scrollback_path).unwrap_or_default();
        Ok(String::from_utf8_lossy(&bytes).to_string())
    }

    pub fn session_dir(&self) -> &Path {
        &self.session_dir
    }

    pub fn write_output(&mut self, data: &[u8]) -> std::io::Result<()> {
        if self.bytes_written + data.len() > MAX_SCROLLBACK_BYTES {
            self.rotate_scrollback()?;
        }

        self.scrollback_writer.write_all(data)?;
        self.bytes_written += data.len();
        self.bytes_since_flush += data.len();
        self.meta.scrollback_bytes = self.bytes_written;
        self.meta.last_activity = Utc::now();

        if self.bytes_since_flush >= 4096 {
            self.scrollback_writer.flush()?;
            self.save_meta()?;
            self.bytes_since_flush = 0;
        }

        Ok(())
    }

    pub fn mark_ended(&mut self) -> std::io::Result<()> {
        self.meta.ended_at = Some(Utc::now());
        self.scrollback_writer.flush()?;
        self.save_meta()
    }

    pub fn reset(&mut self, meta: SessionMeta) -> std::io::Result<()> {
        let scrollback_file = open_scrollback(&self.session_dir, true)?;

        self.scrollback_writer = BufWriter::new(scrollback_file);
        self.bytes_written = 0;
        self.bytes_since_flush = 0;
        self.meta = meta;
        self.save_meta()
    }

    fn rotate_scrollback(&mut self) -> std::io::Result<()> {
        self.scrollback_writer.flush()?;
        let scrollback_path = self.session_dir.join("scrollback.bin");
        let content = fs::read(&scrollback_path)?;

        let keep_from = content.len().saturating_sub(4 * 1024 * 1024);
        let truncated = truncate_utf8_safe(&content[keep_from..]);

        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&scrollback_path)?;

        self.scrollback_writer = BufWriter::new(file);
        self.scrollback_writer.write_all(truncated)?;
        self.bytes_written = truncated.len();

        Ok(())
    }

    fn save_meta(&self) -> std::io::Result<()> {
        let meta_path = self.session_dir.join("meta.json");
        let json = serde_json::to_string_pretty(&self.meta)?;
        crate::util::atomic_write(&meta_path, json.as_bytes())?;
        Ok(())
    }
}

fn open_scrollback(session_dir: &Path, truncate: bool) -> std::io::Result<File> {
    let scrollback_path = session_dir.join("scrollback.bin");
    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if truncate {
        options.truncate(true);
    } else {
        options.append(true);
    }
    options.open(scrollback_path)
}

fn truncate_utf8_safe(bytes: &[u8]) -> &[u8] {
    for i in 0..4.min(bytes.len()) {
        if std::str::from_utf8(&bytes[i..]).is_ok() {
            return &bytes[i..];
        }
    }
    bytes
}
