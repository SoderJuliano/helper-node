#!/bin/bash

# setup-hotkey.sh
# This script automatically configures the global hotkey (Ctrl+D) for the Helper-Node application.
# It detects the desktop environment (GNOME or Hyprland) and applies the necessary settings.

echo "Starting Auto-Configuration for Helper-Node Global Hotkey..."

# --- Step 1: Check for curl dependency ---
if ! command -v curl &> /dev/null; then
    echo "------------------------------------------------------------------"
    echo "WARNING: 'curl' is not installed, but it is required for the hotkey to work."
    
    # Detect package manager and suggest installation
    if command -v pacman &> /dev/null; then
        echo "This looks like an Arch-based system. Please install curl by running:"
        echo "sudo pacman -S curl"
    elif command -v apt-get &> /dev/null; then
        echo "This looks like a Debian/Ubuntu-based system. Please install curl by running:"
        echo "sudo apt-get update && sudo apt-get install curl"
    else
        echo "Could not detect your package manager. Please install 'curl' manually."
    fi
    echo "------------------------------------------------------------------"
    # We don't exit here, as the user might install it in another terminal.
fi

# --- Step 2: Detect Desktop Environment ---
if [ -z "$XDG_CURRENT_DESKTOP" ]; then
  echo "ERROR: XDG_CURRENT_DESKTOP variable is not set. Cannot determine Desktop Environment."
  exit 1
fi

echo "Detected Desktop Environment: $XDG_CURRENT_DESKTOP"
HOTKEY_COMMAND="curl -X POST http://localhost:3000/toggle-recording"

# --- Step 3: Apply configuration based on DE ---
if [[ "$XDG_CURRENT_DESKTOP" == *"GNOME"* ]]; then
    # --- GNOME Configuration ---
    echo "Attempting to configure for GNOME..."

    # Check if a keybinding with the same command already exists
    EXISTING_BINDINGS=$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings)
    if [[ "$EXISTING_BINDINGS" == *"/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/helper-node/"* ]]; then
        echo "GNOME hotkey for Helper-Node already seems to exist. No changes made."
        exit 0
    fi

    KEY_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/helper-node/"
    
    echo "Creating new custom keybinding..."
    gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"$KEY_PATH" name "Helper-Node Record"
    gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"$KEY_PATH" command "$HOTKEY_COMMAND"
    gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"$KEY_PATH" binding "<Control>d"

    # Add the new keybinding path to the list of custom-keybindings
    if [[ "$EXISTING_BINDINGS" == "@as []" ]] || [[ "$EXISTING_BINDINGS" == "[]" ]]; then
        NEW_KEY_LIST="['$KEY_PATH']"
    else
        # Append the new path to the existing list
        NEW_KEY_LIST=${EXISTING_BINDINGS/]/", '$KEY_PATH']"}
    fi
    
    gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "$NEW_KEY_LIST"

    echo "------------------------------------------------------------------"
    echo "SUCCESS: GNOME hotkey configured!"
    echo "The global hotkey 'Ctrl+D' should now be active."
    echo "If it doesn't work immediately, you may need to log out and log back in."
    echo "------------------------------------------------------------------"

elif [[ "$XDG_CURRENT_DESKTOP" == "Hyprland" ]]; then
    # --- Hyprland Configuration ---
    echo "Attempting to configure for Hyprland..."
    HYPR_CONFIG="$HOME/.config/hypr/hyprland.conf"
    BIND_LINE="bind = CTRL, D, exec, $HOTKEY_COMMAND"

    if [ ! -f "$HYPR_CONFIG" ]; then
        echo "ERROR: Hyprland config file not found at $HYPR_CONFIG"
        exit 1
    fi

    # Check if a similar bind line already exists to avoid duplicates
    if grep -qF -- "exec, $HOTKEY_COMMAND" "$HYPR_CONFIG"; then
        echo "A hotkey for Helper-Node already seems to exist in $HYPR_CONFIG. No changes made."
        exit 0
    fi

    echo "Adding hotkey to $HYPR_CONFIG..."
    # Add a newline and a comment for clarity, then the bind line
    echo -e "\n# Global hotkey for Helper-Node (added by setup script)\n$BIND_LINE" >> "$HYPR_CONFIG"
    
    echo "------------------------------------------------------------------"
    echo "SUCCESS: Hyprland hotkey configured!"
    echo "Please reload your Hyprland configuration for the change to take effect."
    echo "(You can usually do this with Super+M or by restarting Hyprland)."
    echo "------------------------------------------------------------------"

else
    echo "------------------------------------------------------------------"
    echo "WARNING: Unsupported Desktop Environment: $XDG_CURRENT_DESKTOP"
    echo "This script only supports GNOME and Hyprland automatically."
    echo "Please configure the global hotkey manually as described in ROADMAP.md"
    echo "Command: $HOTKEY_COMMAND"
    echo "Shortcut: Ctrl+D"
    echo "------------------------------------------------------------------"
    exit 1
fi

echo "Auto-configuration finished successfully."
exit 0
