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

    # Base path for custom keybindings
    BASE_KEY_PATH="/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/"
    NEW_KEY_PATHS=()

    # Function to create and register a new hotkey
    configure_gnome_hotkey() {
        local name_suffix=$1
        local command=$2
        local binding=$3
        local path_suffix=$4 # e.g., 'helper-node-record'

        local KEY_PATH="${BASE_KEY_PATH}${path_suffix}/"

        echo "Configuring hotkey: $name_suffix with binding $binding"
        gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"$KEY_PATH" name "Helper-Node $name_suffix"
        gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"$KEY_PATH" command "$command"
        gsettings set org.gnome.settings-daemon.plugins.media-keys.custom-keybinding:"$KEY_PATH" binding "$binding"
        NEW_KEY_PATHS+=("'$KEY_PATH'")
    }

    # Hotkey for toggle-recording (Ctrl+D)
    configure_gnome_hotkey "Record" "curl -X POST http://localhost:3000/toggle-recording" "<Control>d" "helper-node-record"

    # Hotkey for move-to-display/0 (Ctrl+Shift+1)
    configure_gnome_hotkey "Move to Display 1" "curl -X POST http://localhost:3000/move-to-display/0" "<Control><Shift>1" "helper-node-move-display-0"

    # Hotkey for move-to-display/1 (Ctrl+Shift+2)
    configure_gnome_hotkey "Move to Display 2" "curl -X POST http://localhost:3000/move-to-display/1" "<Control><Shift>2" "helper-node-move-display-1"

    # Hotkey for bring-to-focus-and-input (Ctrl+I)
    configure_gnome_hotkey "Focus App and Input (Ctrl+I)" "curl -X POST http://localhost:3000/bring-to-focus-and-input" "<Control>i" "helper-node-focus-input-ctrl"

    # Hotkey for bring-to-focus-and-input (Ctrl+Shift+I)
    configure_gnome_hotkey "Focus App and Input (Ctrl+Shift+I)" "curl -X POST http://localhost:3000/bring-to-focus-and-input" "<Control><Shift>i" "helper-node-focus-input-ctrl-shift"

    # Get current custom keybindings
    EXISTING_BINDINGS=$(gsettings get org.gnome.settings-daemon.plugins.media-keys custom-keybindings | sed "s/^@as //")

    # Construct the final list of keybindings, avoiding duplicates
    FINAL_KEY_LIST="["
    FIRST=true

    # Add existing bindings
    if [[ "$EXISTING_BINDINGS" != "[]" ]]; then
        # Remove trailing ']' and leading '['
        EXISTING_BINDINGS_CLEANED=$(echo "$EXISTING_BINDINGS" | sed 's/^\[//;s/\]$//')
        for item in $(echo "$EXISTING_BINDINGS_CLEANED" | tr ',' '\n'); do
            # Remove quotes and trim whitespace
            item=$(echo "$item" | sed "s/'//g" | xargs)
            if [[ "$item" != *"${BASE_KEY_PATH}helper-node"* ]]; then # Avoid adding old helper-node binds if they're not explicitly helper-node-*
                if [ "$FIRST" = false ]; then FINAL_KEY_LIST+=" , "; fi
                FINAL_KEY_LIST+="'${item}'"
                FIRST=false
            fi
        done
    fi

    # Add new helper-node bindings
    for item_path in "${NEW_KEY_PATHS[@]}"; do
        if [ "$FIRST" = false ]; then FINAL_KEY_LIST+=" , "; fi
        FINAL_KEY_LIST+="$item_path"
        FIRST=false
    done
    FINAL_KEY_LIST+="]"

    gsettings set org.gnome.settings-daemon.plugins.media-keys custom-keybindings "$FINAL_KEY_LIST"

    echo "------------------------------------------------------------------"
    echo "SUCCESS: GNOME hotkeys configured!"
    echo "Global hotkeys should now be active: Ctrl+D, Ctrl+Shift+1, Ctrl+Shift+2, Ctrl+I, Ctrl+Shift+I."
    echo "If they don't work immediately, you may need to log out and log back in."
    echo "------------------------------------------------------------------"

elif [[ "$XDG_CURRENT_DESKTOP" == "Hyprland" ]]; then
    # --- Hyprland Configuration ---
    echo "Attempting to configure for Hyprland..."
    HYPR_CONFIG="$HOME/.config/hypr/hyprland.conf"

    if [ ! -f "$HYPR_CONFIG" ]; then
        echo "ERROR: Hyprland config file not found at $HYPR_CONFIG"
        exit 1
    fi

    configure_hyprland_hotkey() {
        local keys=$1
        local command=$2
        local description=$3
        local ipc_command_part=$(echo "$command" | sed 's/curl -X POST //') # Extract part for grep

        if grep -qF "exec, $ipc_command_part" "$HYPR_CONFIG"; then
            echo "Hotkey for $description already seems to exist in $HYPR_CONFIG. Skipping."
        else
            echo "Adding hotkey for $description to $HYPR_CONFIG..."
            echo -e "\n# Helper-Node Hotkey: $description (added by setup script)" >> "$HYPR_CONFIG"
            echo "bind = $keys, exec, $command" >> "$HYPR_CONFIG"
        fi
    }

    # Hotkey for toggle-recording (Super+D)
    configure_hyprland_hotkey "SUPER, D" "curl -X POST http://localhost:3000/toggle-recording" "Toggle Recording"

    # Hotkey for move-to-display/0 (Super+Shift+1)
    configure_hyprland_hotkey "SUPER_SHIFT, 1" "curl -X POST http://localhost:3000/move-to-display/0" "Move to Workspace 1"

    # Hotkey for move-to-display/1 (Super+Shift+2)
    configure_hyprland_hotkey "SUPER_SHIFT, 2" "curl -X POST http://localhost:3000/move-to-display/1" "Move to Workspace 2"

    # Hotkey for bring-to-focus-and-input (Super+I)
    configure_hyprland_hotkey "SUPER, I" "curl -X POST http://localhost:3000/bring-to-focus-and-input" "Focus App and Input (Super+I)"

    # Hotkey for bring-to-focus-and-input (Super+Shift+I)
    configure_hyprland_hotkey "SUPER_SHIFT, I" "curl -X POST http://localhost:3000/bring-to-focus-and-input" "Focus App and Input (Super+Shift+I)"

    # Hotkey for bring-to-focus-and-input (Ctrl+I)
    configure_hyprland_hotkey "CONTROL, I" "curl -X POST http://localhost:3000/bring-to-focus-and-input" "Focus App and Input (Ctrl+I)"

    echo "------------------------------------------------------------------"
    echo "SUCCESS: Hyprland hotkeys configured!"
    echo "Please reload your Hyprland configuration for the change to take effect."
    echo "(You can usually do this with 'hyprctl reload' or by restarting Hyprland)."
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
