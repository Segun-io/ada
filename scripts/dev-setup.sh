#!/bin/bash
# Dev setup script - builds and copies sidecar binaries for development
# This allows `bun run tauri:dev` to work without manual sidecar builds

set -e

# Source cargo environment if not already in PATH
if ! command -v cargo &> /dev/null; then
    if [[ -f "$HOME/.cargo/env" ]]; then
        source "$HOME/.cargo/env"
    elif [[ -d "$HOME/.cargo/bin" ]]; then
        export PATH="$HOME/.cargo/bin:$PATH"
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
BINARIES_DIR="$TAURI_DIR/binaries"
TARGET_DEBUG="$TAURI_DIR/target/debug"

# Detect target triple
get_target_triple() {
    local arch=$(uname -m)
    local os=$(uname -s)

    case "$os" in
        Darwin)
            case "$arch" in
                x86_64) echo "x86_64-apple-darwin" ;;
                arm64)  echo "aarch64-apple-darwin" ;;
                *)      echo "unknown-apple-darwin" ;;
            esac
            ;;
        Linux)
            case "$arch" in
                x86_64) echo "x86_64-unknown-linux-gnu" ;;
                aarch64) echo "aarch64-unknown-linux-gnu" ;;
                *)      echo "unknown-unknown-linux-gnu" ;;
            esac
            ;;
        MINGW*|MSYS*|CYGWIN*)
            echo "x86_64-pc-windows-msvc"
            ;;
        *)
            echo "unknown-unknown-unknown"
            ;;
    esac
}

TARGET=$(get_target_triple)

# Create binaries directory
mkdir -p "$BINARIES_DIR"

# Determine binary names
if [[ "$TARGET" == *"windows"* ]]; then
    CLI_BIN="ada-cli-${TARGET}.exe"
    DAEMON_BIN="ada-daemon-${TARGET}.exe"
    CLI_DEBUG="ada-cli.exe"
    DAEMON_DEBUG="ada-daemon.exe"
else
    CLI_BIN="ada-cli-${TARGET}"
    DAEMON_BIN="ada-daemon-${TARGET}"
    CLI_DEBUG="ada-cli"
    DAEMON_DEBUG="ada-daemon"
fi

CLI_PATH="$BINARIES_DIR/$CLI_BIN"
DAEMON_PATH="$BINARIES_DIR/$DAEMON_BIN"
CLI_DEBUG_PATH="$TARGET_DEBUG/$CLI_DEBUG"
DAEMON_DEBUG_PATH="$TARGET_DEBUG/$DAEMON_DEBUG"

# Check if we already have valid binaries that are up-to-date with source
# We check if the binaries in binaries/ are newer than or same age as target/debug binaries
if [[ -f "$CLI_PATH" && -f "$DAEMON_PATH" && -f "$CLI_DEBUG_PATH" && -f "$DAEMON_DEBUG_PATH" ]]; then
    # Check if binaries dir files are at least as new as debug binaries
    if [[ ! "$CLI_DEBUG_PATH" -nt "$CLI_PATH" && ! "$DAEMON_DEBUG_PATH" -nt "$DAEMON_PATH" ]]; then
        echo "Dev sidecars already set up and up-to-date, skipping build..."
        ls -la "$BINARIES_DIR"
        exit 0
    else
        echo "Debug binaries are newer, will update sidecar copies..."
    fi
fi

echo "Building ada-cli and ada-daemon (debug)..."

# Remove any existing files/symlinks (including broken ones)
rm -f "$CLI_PATH"
rm -f "$DAEMON_PATH"

# Create real executable placeholders that will pass Tauri's validation
# Using clang to compile minimal C programs as placeholders
PLACEHOLDER_SRC=$(mktemp).c
echo 'int main() { return 0; }' > "$PLACEHOLDER_SRC"

echo "Creating executable placeholders..."
clang -o "$CLI_PATH" "$PLACEHOLDER_SRC" 2>/dev/null || {
    # Fallback: copy a system binary as placeholder
    cp /usr/bin/true "$CLI_PATH"
}
clang -o "$DAEMON_PATH" "$PLACEHOLDER_SRC" 2>/dev/null || {
    cp /usr/bin/true "$DAEMON_PATH"
}
rm -f "$PLACEHOLDER_SRC"

chmod +x "$CLI_PATH" "$DAEMON_PATH"

# Verify placeholders were created and are executable
if [[ ! -x "$CLI_PATH" || ! -x "$DAEMON_PATH" ]]; then
    echo "ERROR: Failed to create executable placeholder files"
    exit 1
fi

echo "Executable placeholders created:"
ls -la "$BINARIES_DIR"

# Build debug binaries
# Use --no-default-features to match Tauri dev mode (see tauri.conf.json devCommand)
cd "$TAURI_DIR"
cargo build --bin ada-cli --bin ada-daemon --no-default-features

# Copy debug binaries to binaries directory (Tauri build script doesn't follow symlinks)
echo "Copying debug binaries to binaries directory..."
rm -f "$CLI_PATH"
rm -f "$DAEMON_PATH"
cp "$CLI_DEBUG_PATH" "$CLI_PATH"
cp "$DAEMON_DEBUG_PATH" "$DAEMON_PATH"
chmod +x "$CLI_PATH" "$DAEMON_PATH"

echo "Dev setup complete!"
ls -la "$BINARIES_DIR"
