#!/bin/bash
# Script para captura de screenshot que funciona fora do Electron

OUTPUT_FILE="$1"

if [ -z "$OUTPUT_FILE" ]; then
    echo "Uso: $0 <arquivo-saida.png>"
    exit 1
fi

# Ensure Wayland display is set
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-1}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# Try slurp+grim first (best for Wayland)
if command -v slurp >/dev/null 2>&1 && command -v grim >/dev/null 2>&1; then
    REGION=$(slurp -f '%x %y %w %h' 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$REGION" ]; then
        read -r x y w h <<< "$REGION"
        grim -g "${x},${y} ${w}x${h}" "$OUTPUT_FILE"
        exit $?
    fi
fi

# Fallback to gnome-screenshot
if command -v gnome-screenshot >/dev/null 2>&1; then
    gnome-screenshot -a -f "$OUTPUT_FILE"
    exit $?
fi

echo "Nenhuma ferramenta de captura encontrada"
exit 1
