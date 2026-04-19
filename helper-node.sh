#!/bin/bash

# Helper Node launcher script

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOCAL_MODE=false

if [ "${1:-}" = "--local" ]; then
    LOCAL_MODE=true
    shift
fi

if [ -d "/opt/helper-node" ] && [ "$LOCAL_MODE" = false ]; then
    APP_DIR="/opt/helper-node"
else
    APP_DIR="$SCRIPT_DIR"
fi

# If running local dev inside Flatpak (VS Code sandbox), re-exec on host.
# Global hotkeys (xbindkeys) run on host and call localhost:3000 there.
if [ "$LOCAL_MODE" = true ] \
   && [ -f /.flatpak-info ] \
   && command -v flatpak-spawn >/dev/null 2>&1 \
   && [ "${HELPER_NODE_HOST_REEXEC:-0}" != "1" ]; then
    echo "🔁 Flatpak detectado: iniciando instância local no host para habilitar atalhos globais..."
    HOST_CMD="cd \"$APP_DIR\" && HELPER_NODE_HOST_REEXEC=1 bash ./helper-node.sh --local"
    for arg in "$@"; do
        HOST_CMD+=" $(printf '%q' "$arg")"
    done
    exec flatpak-spawn --host bash -lc "$HOST_CMD"
fi

CONFIG_FLAG="$HOME/.config/helper-node/.setup-done"
USER_APP_CONFIG_DIR="$HOME/.config/meu-electron-app"
USER_APP_CONFIG_PATH="$USER_APP_CONFIG_DIR/config.json"
DEFAULT_CONFIG_PATH="$APP_DIR/config-default.json"
ELECTRON_BIN="$APP_DIR/node_modules/.bin/electron"
RUN_HOTKEY_SETUP=false

# Change to app directory
cd "$APP_DIR"

# Check if first run
if [ ! -f "$CONFIG_FLAG" ]; then
    RUN_HOTKEY_SETUP=true
    echo "🚀 First run detected! Configuring global hotkeys..."
    
    # Create config directory
    mkdir -p "$HOME/.config/helper-node"

    # Seed user config with packaged defaults (if available)
    if [ -f "$DEFAULT_CONFIG_PATH" ] && [ ! -f "$USER_APP_CONFIG_PATH" ]; then
        mkdir -p "$USER_APP_CONFIG_DIR"
        cp "$DEFAULT_CONFIG_PATH" "$USER_APP_CONFIG_PATH"
        echo "✓ Default AI/Tesseract settings imported"
    fi
    
fi

# Run setup script when needed (best-effort for local dev)
if [ "$RUN_HOTKEY_SETUP" = true ]; then
    if [ -f "$APP_DIR/setup-hotkey.sh" ]; then
        if bash "$APP_DIR/setup-hotkey.sh"; then
            touch "$CONFIG_FLAG"
            echo "✓ Hotkey configuration complete!"
        else
            echo "⚠️ Hotkey setup returned an error. App will continue running."
        fi
    else
        echo "⚠️ Warning: setup-hotkey.sh not found"
    fi

    echo ""
    echo "Starting Helper Node..."
    sleep 1
fi

if [ ! -x "$ELECTRON_BIN" ]; then
    echo "❌ Electron runtime not found at: $ELECTRON_BIN"
    echo "For local dev, run: npm install"
    exit 1
fi

ELECTRON_ARGS=()

# Wayland support (COSMIC/Hyprland/KDE Wayland)
if [ -n "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
    ELECTRON_ARGS+=("--ozone-platform=wayland" "--enable-features=UseOzonePlatform")
fi

# If chrome-sandbox is not configured with SUID, fallback to no-sandbox
if [ ! -u "$APP_DIR/node_modules/electron/dist/chrome-sandbox" ]; then
    ELECTRON_ARGS+=("--no-sandbox")
fi

exec "$ELECTRON_BIN" "$APP_DIR/main.js" "${ELECTRON_ARGS[@]}" "$@"
