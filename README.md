# Ada

![Ada](screenshots/ada.png)

Ada is an AI Code Agent Manager - a desktop application for managing multiple AI coding agents (Claude Code, OpenCode, Codex) with integrated terminal support and git worktree workflows.

## Features

- **Multi-Agent Support**: Manage Claude Code, OpenCode, Codex, and other AI coding agents from a single interface
- **Integrated Terminals**: Built-in terminal emulator with xterm.js for each agent session
- **Git Worktree Integration**: Automatic worktree creation for branch-isolated development
- **Persistent Sessions**: Terminal sessions survive app restarts via daemon architecture
- **System Tray**: Daemon runs in background with system tray icon for quick access
- **Project Management**: Organize and switch between multiple projects with persistent settings

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 7 + Tailwind CSS v4
- **Backend**: Rust with Tauri 2
- **UI**: Radix UI components + shadcn/ui patterns
- **State**: Zustand
- **Routing**: TanStack Router
- **Terminal**: xterm.js

## Architecture

Ada uses a daemon-based architecture for terminal management:

```
┌─────────────────┐     IPC      ┌─────────────────┐
│   Ada Desktop   │◄────────────►│   Ada Daemon    │
│   (Tauri App)   │              │  (Background)   │
└─────────────────┘              └────────┬────────┘
                                          │
                                          │ PTY
                                          ▼
                                 ┌─────────────────┐
                                 │  AI Agents      │
                                 │ (Claude, etc.)  │
                                 └─────────────────┘
```

### Components

| Component | Description |
|-----------|-------------|
| **Ada Desktop** | Main Tauri application with React frontend |
| **Ada Daemon** | Background process managing PTY sessions, persists across app restarts |
| **Ada CLI** | Command-line tool for daemon management |

### Why a Daemon?

The daemon architecture provides:
- **Session Persistence**: Terminal sessions survive app restarts
- **Background Processing**: Agent sessions continue running when the app is closed
- **System Integration**: Tray icon for quick access and status monitoring
- **Resource Isolation**: PTY processes are managed independently from the UI

## Development

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) (or npm/yarn/pnpm)
- One or more AI coding agents installed (Claude Code, OpenCode, or Codex)

### Setup

```bash
# Install dependencies
bun install

# Start development (builds sidecars, starts frontend + Tauri)
bun run tauri:dev
```

### Development Commands

```bash
# Start development (frontend + Tauri + daemon)
bun run tauri:dev

# Frontend only (Vite dev server on :5173)
bun run dev

# Build frontend
bun run build

# Lint
bun run lint

# Build sidecar binaries only
bun run build:sidecars
bun run build:sidecars:force  # Force rebuild
```

### Rust Commands

Run from `src-tauri/` directory:

```bash
cargo check          # Type check
cargo build          # Debug build
cargo build --release # Release build
cargo test           # Run tests
```

## Building for Distribution

### Standard Build

```bash
bun run tauri:build
```

### Signed Build (macOS)

For distribution, use the signed build which properly signs all components:

```bash
bun run tauri:build:signed
```

This script:
1. Builds sidecar binaries (ada-cli, ada-daemon)
2. Builds the Tauri app in release mode
3. Signs all components individually (sidecars, main binary, frameworks)
4. Signs the .app bundle
5. Creates a DMG installer

**Output locations:**
- App: `src-tauri/target/release/bundle/macos/Ada.app`
- DMG: `src-tauri/target/release/bundle/dmg/Ada_<version>_<arch>.dmg`

### Using a Real Certificate

For full Gatekeeper clearance (no warnings for users), set your Apple Developer certificate:

```bash
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" bun run tauri:build:signed
```

**Note:** Ad-hoc signing (default) removes "app is damaged" errors but recipients may still need to right-click → Open on first launch, or run:
```bash
xattr -cr /Applications/Ada.app
```

## CLI Usage

The `ada-cli` tool manages the daemon. After building, the CLI is available at `src-tauri/target/release/ada-cli` (or `debug` for dev builds).

### Daemon Management

```bash
# Start daemon (runs in background)
ada-cli daemon start

# Start in foreground (for debugging)
ada-cli daemon start --foreground

# Check daemon status
ada-cli daemon status

# Stop daemon
ada-cli daemon stop

# Restart daemon
ada-cli daemon restart

# View logs
ada-cli daemon logs
ada-cli daemon logs -f        # Follow mode (like tail -f)
ada-cli daemon logs -n 100    # Show last 100 lines
```

### Development Mode

Use `--dev` flag for separate data directory (useful when developing):

```bash
ada-cli --dev daemon start
ada-cli --dev daemon status
```

## Data Locations

| Mode | Data Directory |
|------|----------------|
| Production | `~/.local/share/ada/` |
| Development | `~/.local/share/ada-dev/` |

Contents:
- `projects.json` - Project configurations
- `clients.json` - AI client configurations
- `daemon.pid` - Daemon process ID
- `daemon.port` - Daemon IPC port
- `logs/` - Log files

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADA_DEV_MODE` | Enable development mode (`1` = enabled) |
| `ADA_LOG_LEVEL` | Log level (trace, debug, info, warn, error) |
| `ADA_LOG_STDERR` | Log to stderr instead of file (`1` = enabled) |
| `ADA_LOG_DIR` | Custom log directory |
| `ADA_LOG_DISABLE` | Disable logging (`1` = disabled) |
| `CODESIGN_IDENTITY` | macOS code signing identity |

## Screenshots

![Add Project](screenshots/add-project.png)
*Create new projects or open existing folders with git initialization*

![Create Terminal](screenshots/create-terminal.png)
*Spawn AI agent terminals with worktree support for branch isolation*

## License

MIT
