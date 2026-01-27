#!/bin/bash
# Build sidecar binaries (ada-cli and ada-daemon) for Tauri bundling
#
# Tauri expects sidecar binaries in src-tauri/binaries/ with target triple suffix:
#   ada-cli-x86_64-apple-darwin
#   ada-cli-aarch64-apple-darwin
#   ada-daemon-x86_64-apple-darwin
#   ada-daemon-aarch64-apple-darwin
#   etc.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
BINARIES_DIR="$TAURI_DIR/binaries"

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
echo "Building for target: $TARGET"

# Create binaries directory
mkdir -p "$BINARIES_DIR"

# Create placeholder files first so Tauri build validation passes
# (Tauri checks for these files during its build.rs)
if [[ "$TARGET" == *"windows"* ]]; then
    touch "$BINARIES_DIR/ada-cli-${TARGET}.exe" 2>/dev/null || true
    touch "$BINARIES_DIR/ada-daemon-${TARGET}.exe" 2>/dev/null || true
else
    touch "$BINARIES_DIR/ada-cli-${TARGET}" 2>/dev/null || true
    touch "$BINARIES_DIR/ada-daemon-${TARGET}" 2>/dev/null || true
fi

# Build the binaries in release mode
# Use --package to avoid building the main tauri app which has the circular dependency
echo "Building ada-cli and ada-daemon..."
cd "$TAURI_DIR"

# Build each binary individually to avoid the Tauri build.rs validation
RUSTFLAGS="" cargo build --release --bin ada-cli --bin ada-daemon 2>&1 || {
    echo "Direct build failed, trying without library..."
    # If that fails, try building with specific features disabled
    cargo rustc --release --bin ada-cli -- && \
    cargo rustc --release --bin ada-daemon --
}

# Copy binaries with target suffix
echo "Copying binaries to $BINARIES_DIR..."

if [[ "$TARGET" == *"windows"* ]]; then
    cp "target/release/ada-cli.exe" "$BINARIES_DIR/ada-cli-${TARGET}.exe"
    cp "target/release/ada-daemon.exe" "$BINARIES_DIR/ada-daemon-${TARGET}.exe"
else
    cp "target/release/ada-cli" "$BINARIES_DIR/ada-cli-${TARGET}"
    cp "target/release/ada-daemon" "$BINARIES_DIR/ada-daemon-${TARGET}"
fi

echo "Done! Sidecar binaries ready for bundling:"
ls -la "$BINARIES_DIR"
