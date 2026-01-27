#!/bin/bash
# Build sidecar binaries (ada-cli and ada-daemon) for Tauri bundling
#
# Tauri expects sidecar binaries in src-tauri/binaries/ with target triple suffix:
#   ada-cli-x86_64-apple-darwin
#   ada-cli-aarch64-apple-darwin
#   ada-daemon-x86_64-apple-darwin
#   ada-daemon-aarch64-apple-darwin
#   etc.
#
# Options:
#   --force    Force rebuild even if binaries are up-to-date

set -e

FORCE_BUILD=false
if [[ "$1" == "--force" ]]; then
    FORCE_BUILD=true
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
BINARIES_DIR="$TAURI_DIR/binaries"
TARGET_RELEASE="$TAURI_DIR/target/release"

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

# Determine binary names based on platform
if [[ "$TARGET" == *"windows"* ]]; then
    CLI_BIN="ada-cli-${TARGET}.exe"
    DAEMON_BIN="ada-daemon-${TARGET}.exe"
    CLI_RELEASE="ada-cli.exe"
    DAEMON_RELEASE="ada-daemon.exe"
else
    CLI_BIN="ada-cli-${TARGET}"
    DAEMON_BIN="ada-daemon-${TARGET}"
    CLI_RELEASE="ada-cli"
    DAEMON_RELEASE="ada-daemon"
fi

CLI_PATH="$BINARIES_DIR/$CLI_BIN"
DAEMON_PATH="$BINARIES_DIR/$DAEMON_BIN"
CLI_RELEASE_PATH="$TARGET_RELEASE/$CLI_RELEASE"
DAEMON_RELEASE_PATH="$TARGET_RELEASE/$DAEMON_RELEASE"

# Create binaries directory
mkdir -p "$BINARIES_DIR"

# Check if we can skip the build
if [[ "$FORCE_BUILD" == "false" ]]; then
    # Check if existing binaries are up-to-date
    if [[ -f "$CLI_PATH" && -f "$DAEMON_PATH" && -f "$CLI_RELEASE_PATH" && -f "$DAEMON_RELEASE_PATH" ]]; then
        # Check if binaries dir files are at least as new as release binaries
        if [[ ! "$CLI_RELEASE_PATH" -nt "$CLI_PATH" && ! "$DAEMON_RELEASE_PATH" -nt "$DAEMON_PATH" ]]; then
            # Also check file sizes to ensure they're not placeholders
            CLI_SIZE=$(stat -f%z "$CLI_PATH" 2>/dev/null || stat -c%s "$CLI_PATH" 2>/dev/null || echo "0")
            DAEMON_SIZE=$(stat -f%z "$DAEMON_PATH" 2>/dev/null || stat -c%s "$DAEMON_PATH" 2>/dev/null || echo "0")

            # Real binaries should be > 1MB
            if [[ "$CLI_SIZE" -gt 1000000 && "$DAEMON_SIZE" -gt 1000000 ]]; then
                echo "Sidecars already built and up-to-date for $TARGET, skipping..."
                ls -la "$BINARIES_DIR"
                exit 0
            fi
        fi
    fi
fi

echo "Building sidecars for target: $TARGET"

# Create placeholder files so Tauri build validation passes
# (Tauri checks for these files during its build.rs before we can build them)
echo "Creating placeholders for Tauri validation..."
if [[ ! -f "$CLI_PATH" || ! -s "$CLI_PATH" ]]; then
    touch "$CLI_PATH"
fi
if [[ ! -f "$DAEMON_PATH" || ! -s "$DAEMON_PATH" ]]; then
    touch "$DAEMON_PATH"
fi

# Build the binaries in release mode
echo "Building ada-cli and ada-daemon (release)..."
cd "$TAURI_DIR"

RUSTFLAGS="" cargo build --release --bin ada-cli --bin ada-daemon 2>&1 || {
    echo "Direct build failed, trying alternative approach..."
    cargo rustc --release --bin ada-cli -- && \
    cargo rustc --release --bin ada-daemon --
}

# Copy binaries with target suffix
echo "Copying binaries to $BINARIES_DIR..."
cp "$CLI_RELEASE_PATH" "$CLI_PATH"
cp "$DAEMON_RELEASE_PATH" "$DAEMON_PATH"
chmod +x "$CLI_PATH" "$DAEMON_PATH"

echo "Done! Sidecar binaries ready for bundling:"
ls -la "$BINARIES_DIR"
