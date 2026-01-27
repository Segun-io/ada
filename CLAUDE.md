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
# Start development (frontend + Tauri + daemon)
bun run tauri:dev

# Build for production
bun run tauri:build

# Build signed for distribution (macOS)
bun run tauri:build:signed

# Frontend only
bun run dev          # Vite dev server on :5173
bun run build        # TypeScript check + Vite build

# Linting
bun run lint

# Sidecar binaries (ada-cli, ada-daemon)
bun run build:sidecars        # Build with smart caching
bun run build:sidecars:force  # Force rebuild

# Rust checks (from src-tauri/)
cargo check
cargo build
cargo test
```

## Architecture

Ada uses a **daemon-based architecture** for terminal management:

```
┌─────────────────┐     IPC      ┌─────────────────┐
│   Ada Desktop   │◄────────────►│   Ada Daemon    │
│   (Tauri App)   │              │  (Background)   │
└─────────────────┘              └────────┬────────┘
                                          │ PTY
                                          ▼
                                 ┌─────────────────┐
                                 │  AI Agents      │
                                 └─────────────────┘
```

### Sidecar Binaries

- **ada-daemon** - Background process managing PTY sessions, persists across app restarts
- **ada-cli** - Command-line tool for daemon management (`ada-cli daemon start/stop/status/logs`)

Sidecars are built via `scripts/build-sidecars.sh` and bundled in `src-tauri/binaries/`.

### Backend (src-tauri/src/)

- **daemon/** - Daemon server, IPC protocol, PTY session management, tray icon
  - `server.rs` - TCP server for IPC, session lifecycle
  - `protocol.rs` - Request/response/event types for daemon communication
  - `session.rs` - Individual PTY session management
  - `shell.rs` - Shell/PTY spawning and I/O
  - `tray.rs` - System tray icon and menu
- **cli/** - CLI implementation for daemon management
  - `daemon.rs` - start/stop/status/restart/logs commands
  - `paths.rs` - Data directory and file path resolution
- **state.rs** - Central `AppState` with thread-safe storage for projects, terminals, clients
- **project/** - Project CRUD operations, settings, git initialization
- **terminal/** - Terminal types, status enums, command specs
- **git/** - Branch management and worktree support
- **clients/** - AI client configurations with installation detection via `which`

### Frontend (src/)

- **routes/** - TanStack Router file-based routing
- **components/** - UI components including terminal-view (xterm.js), terminal-strip, project-sidebar
- **stores/** - Zustand stores for projects, terminals, clients
- **lib/api.ts** - Tauri invoke wrappers for all backend commands

### Data Flow

1. Frontend calls `invoke("command_name", { params })` via Tauri IPC
2. Tauri backend forwards terminal operations to daemon via TCP IPC
3. Daemon manages PTY sessions and streams output back
4. Events flow: Daemon → Tauri → Frontend via event system
5. State persisted to `~/.local/share/ada/` (or `ada-dev/` in dev mode)

### Key Patterns

- Daemon runs independently from the Tauri app (survives app restarts)
- All terminal operations go through the daemon
- IPC uses JSON-over-TCP with newline-delimited messages
- Daemon writes PID and port files for discovery
- Terminal history preserved in daemon even when app is closed

## Path Aliases

TypeScript uses `@/*` → `./src/*` path alias.

## Building for Distribution (macOS)

Use the signed build script to create a distributable DMG:

```bash
bun run tauri:build:signed
```

This runs `scripts/build-signed.sh` which:
1. Builds sidecar binaries (ada-cli, ada-daemon)
2. Builds the Tauri app in release mode
3. Signs all components individually (sidecars, main binary, frameworks)
4. Signs the .app bundle with hardened runtime
5. Creates a DMG installer

**Output locations:**
- App: `src-tauri/target/release/bundle/macos/Ada.app`
- DMG: `src-tauri/target/release/bundle/dmg/Ada_<version>_<arch>.dmg`

**Using a real certificate:**
```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" bun run tauri:build:signed
```

**Note:** Ad-hoc signing (default) removes "app is damaged" errors but recipients may still need to right-click → Open on first launch, or run `xattr -cr /Applications/Ada.app`. For full Gatekeeper clearance without warnings, you need an Apple Developer certificate ($99/year) and notarization.
