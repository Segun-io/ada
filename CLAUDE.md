# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ada is an AI Code Agent Manager - a Tauri 2 desktop application for managing multiple AI coding agents (Claude Code, OpenCode, Codex) with integrated terminal support and git worktree workflows.

**Tech Stack:**
- Frontend: React 19 + TypeScript + Vite 7 + Tailwind CSS v4
- Backend: Rust with Tauri 2
- UI: Radix UI components + shadcn/ui patterns
- State: Zustand
- Routing: TanStack Router
- Terminal: xterm.js

## Development Commands

```bash
# Start development (frontend + Tauri)
bun run tauri:dev

# Build for production
bun run tauri:build

# Frontend only
bun run dev          # Vite dev server on :5173
bun run build        # TypeScript check + Vite build

# Linting
bun run lint

# Rust checks (from src-tauri/)
cargo check
cargo build
cargo test
```

## Architecture

### Backend (src-tauri/src/)

- **state.rs** - Central `AppState` with thread-safe `RwLock<HashMap>` storage for projects, terminals, PTY handles, and clients
- **project/** - Project CRUD operations, settings, git initialization on creation
- **terminal/** - PTY spawning via `portable-pty`, terminal lifecycle, output buffering (max 1000 chunks)
- **git/** - Branch management and worktree support for branch isolation
- **clients/** - AI client configurations (Claude Code, OpenCode, Codex) with installation detection via `which`

### Frontend (src/)

- **routes/** - TanStack Router file-based routing
- **components/** - UI components including terminal-view (xterm.js), terminal-strip, project-sidebar
- **stores/** - Zustand stores for projects, terminals, clients
- **lib/api.ts** - Tauri invoke wrappers for all backend commands

### Data Flow

1. Frontend calls `invoke("command_name", { params })` via Tauri IPC
2. Rust command handlers in `*/commands.rs` process requests
3. State changes persisted to `~/.local/share/ada/` as JSON files
4. Events emitted via `app_handle.emit()` for terminal output, status changes

### Key Patterns

- All backend operations are Tauri commands (async, return `Result<T, Error>`)
- Terminal output streams via Tauri events (`terminal-output`, `terminal-closed`)
- Worktrees created automatically when spawning terminals on specific branches
- Projects must be git repos with at least one commit
- Terminal history preserved across app restarts (PTY handles are not)

## Path Aliases

TypeScript uses `@/*` → `./src/*` path alias.
