#!/bin/bash

# Helper Node launcher script

APP_DIR="/opt/helper-node"
CONFIG_FLAG="$HOME/.config/helper-node/.setup-done"

# Change to app directory
cd "$APP_DIR"

# Check if first run
if [ ! -f "$CONFIG_FLAG" ]; then
    echo "🚀 First run detected! Configuring global hotkeys..."
    
    # Create config directory
    mkdir -p "$HOME/.config/helper-node"
    
    # Run setup script
    if [ -f "$APP_DIR/setup-hotkey.sh" ]; then
        bash "$APP_DIR/setup-hotkey.sh"
        
        # Mark as configured
        touch "$CONFIG_FLAG"
        echo "✓ Configuration complete!"
    else
        echo "⚠️ Warning: setup-hotkey.sh not found"
    fi
    
    echo ""
    echo "Starting Helper Node..."
    sleep 2
fi

# Start the application
exec /usr/bin/electron "$APP_DIR/main.js" "$@"
