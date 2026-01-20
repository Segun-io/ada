#!/bin/bash
# Build Ada with ad-hoc code signing for macOS distribution
# Usage: ./scripts/build-signed.sh
#
# This script:
# 1. Builds the Tauri app in release mode
# 2. Ad-hoc signs the .app bundle (removes "corrupted" warnings)
# 3. Recreates the DMG with the signed app
#
# Note: Ad-hoc signing allows local distribution but recipients may still need
# to right-click → Open the first time. For full Gatekeeper clearance, you need
# an Apple Developer certificate and notarization.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BUNDLE_DIR="$PROJECT_ROOT/src-tauri/target/release/bundle"
APP_PATH="$BUNDLE_DIR/macos/Ada.app"
DMG_DIR="$BUNDLE_DIR/dmg"

echo "==> Building Tauri app..."
cd "$PROJECT_ROOT"
bun run tauri:build

echo "==> Signing app bundle (ad-hoc)..."
codesign --force --deep --sign - "$APP_PATH"

echo "==> Verifying signature..."
codesign --verify --verbose "$APP_PATH"

echo "==> Recreating DMG with signed app..."
# Get version from tauri.conf.json
VERSION=$(grep -o '"version": "[^"]*"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | cut -d'"' -f4)
ARCH=$(uname -m)
DMG_NAME="Ada_${VERSION}_${ARCH}.dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"

rm -f "$DMG_PATH"
hdiutil create -volname "Ada" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

echo ""
echo "==> Build complete!"
echo "    App: $APP_PATH"
echo "    DMG: $DMG_PATH"
echo ""
echo "Note: Recipients may need to right-click → Open on first launch,"
echo "or run: xattr -cr /Applications/Ada.app"
