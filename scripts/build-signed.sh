#!/bin/bash
# Build Ada with ad-hoc code signing for macOS distribution
# Usage: ./scripts/build-signed.sh
#
# This script:
# 1. Builds sidecar binaries (ada-cli, ada-daemon)
# 2. Builds the Tauri app in release mode
# 3. Signs all components individually (sidecars, main binary, frameworks)
# 4. Signs the .app bundle
# 5. Creates the DMG
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

# Signing identity (use "-" for ad-hoc, or set CODESIGN_IDENTITY env var for real cert)
SIGN_IDENTITY="${CODESIGN_IDENTITY:--}"

echo "==> Build Configuration"
echo "    Sign identity: $SIGN_IDENTITY"
echo ""

# Step 1: Build sidecar binaries first
# Note: tauri build's beforeBuildCommand also calls this, but we do it here first
# to ensure binaries exist for Tauri's build.rs validation
echo "==> Building sidecar binaries (ada-cli, ada-daemon)..."
cd "$PROJECT_ROOT"
./scripts/build-sidecars.sh

# Step 2: Build Tauri app
echo ""
echo "==> Building Tauri app..."
bun run tauri:build

# Step 3: Sign all components inside the bundle
echo ""
echo "==> Signing app components..."

# Sign helper binaries in MacOS folder (sidecars get copied here)
if [[ -d "$APP_PATH/Contents/MacOS" ]]; then
    echo "    Signing sidecars and executables..."

    # Sign ada-cli sidecar
    if [[ -f "$APP_PATH/Contents/MacOS/ada-cli" ]]; then
        codesign --force --options runtime --sign "$SIGN_IDENTITY" "$APP_PATH/Contents/MacOS/ada-cli"
        echo "    ✓ ada-cli"
    fi

    # Sign ada-daemon sidecar
    if [[ -f "$APP_PATH/Contents/MacOS/ada-daemon" ]]; then
        codesign --force --options runtime --sign "$SIGN_IDENTITY" "$APP_PATH/Contents/MacOS/ada-daemon"
        echo "    ✓ ada-daemon"
    fi

    # Sign main binary
    if [[ -f "$APP_PATH/Contents/MacOS/Ada" ]]; then
        codesign --force --options runtime --sign "$SIGN_IDENTITY" "$APP_PATH/Contents/MacOS/Ada"
        echo "    ✓ Ada (main binary)"
    fi
fi

# Sign frameworks if any exist
if [[ -d "$APP_PATH/Contents/Frameworks" ]]; then
    echo "    Signing frameworks..."
    find "$APP_PATH/Contents/Frameworks" -type f -perm +111 -exec \
        codesign --force --options runtime --sign "$SIGN_IDENTITY" {} \; 2>/dev/null || true
fi

# Sign any dylibs
find "$APP_PATH" -name "*.dylib" -exec \
    codesign --force --options runtime --sign "$SIGN_IDENTITY" {} \; 2>/dev/null || true

# Step 4: Sign the entire app bundle
echo ""
echo "==> Signing app bundle..."
codesign --force --options runtime --sign "$SIGN_IDENTITY" "$APP_PATH"

# Step 5: Verify signatures
echo ""
echo "==> Verifying signatures..."
echo "    Checking app signature..."
codesign --verify --verbose "$APP_PATH"

echo "    Checking Gatekeeper assessment..."
spctl --assess --verbose "$APP_PATH" 2>&1 || echo "    (Gatekeeper may reject ad-hoc signed apps - this is expected)"

echo "    Checking sidecar signatures..."
if [[ -f "$APP_PATH/Contents/MacOS/ada-cli" ]]; then
    codesign --verify --verbose "$APP_PATH/Contents/MacOS/ada-cli" && echo "    ✓ ada-cli verified"
fi
if [[ -f "$APP_PATH/Contents/MacOS/ada-daemon" ]]; then
    codesign --verify --verbose "$APP_PATH/Contents/MacOS/ada-daemon" && echo "    ✓ ada-daemon verified"
fi

# Step 6: Create DMG
echo ""
echo "==> Creating DMG..."
VERSION=$(grep -o '"version": "[^"]*"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | cut -d'"' -f4)
ARCH=$(uname -m)
DMG_NAME="Ada_${VERSION}_${ARCH}.dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"

mkdir -p "$DMG_DIR"
rm -f "$DMG_PATH"
hdiutil create -volname "Ada" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

echo ""
echo "==> Build complete!"
echo "    App: $APP_PATH"
echo "    DMG: $DMG_PATH"
echo ""
echo "To distribute:"
echo "  1. Share the DMG file"
echo "  2. Recipients may need to right-click → Open on first launch"
echo "  3. Or run: xattr -cr /Applications/Ada.app"
echo ""
echo "For Gatekeeper clearance without warnings, set CODESIGN_IDENTITY to your"
echo "Apple Developer certificate and notarize with 'xcrun notarytool'"
