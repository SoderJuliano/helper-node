#!/usr/bin/env bash
set -euo pipefail

# Helper Node dependency installer
# - Installs system packages (Git, make/g++, curl, ffmpeg, cmake)
# - Clones and builds whisper.cpp
# - Downloads tiny and small Whisper models
# - Optionally sets up Ollama (if requested)
# - Runs setup-hotkey.sh at the end

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
WHISPER_DIR="$PROJECT_ROOT/whisper"
MODELS_DIR="$WHISPER_DIR/models"

# Colors
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

info() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[..]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
}

# Detect distro (Arch vs Debian/Ubuntu)
detect_distro() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    case "${ID}" in
      arch|garuda)
        echo "arch" ; return 0 ;;
      ubuntu|debian|pop)
        echo "debian" ; return 0 ;;
    esac
    # Fallback based on package manager
    if require_cmd pacman; then echo "arch" ; return 0; fi
    if require_cmd apt-get; then echo "debian" ; return 0; fi
  fi
  # Default to debian style
  echo "debian"
}

install_packages_arch() {
  warn "Installing packages via pacman (sudo required)"
  
  # Base packages including Wayland screenshot tools (work on both X11 and Wayland)
  sudo pacman -S --needed git nodejs npm make gcc curl ffmpeg cmake gnome-screenshot grim slurp imagemagick || {
    err "pacman install failed"; exit 1;
  }
}

install_packages_debian() {
  warn "Installing packages via apt (sudo required)"
  sudo apt-get update
  
  # Detect if Wayland
  local is_wayland=false
  if [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    is_wayland=true
    warn "Detected Wayland session - installing grim and slurp for screenshot support"
  fi
  
  # Base packages
  local packages="git nodejs make g++ curl ffmpeg cmake gnome-screenshot imagemagick"
  
  # Add Wayland screenshot tools
  if [[ "$is_wayland" == "true" ]]; then
    packages="$packages grim slurp"
  fi
  
  sudo apt-get install -y $packages || {
    err "apt install failed"; exit 1;
  }
}

install_system_packages() {
  local distro
  distro="$(detect_distro)"
  warn "Detected distro: $distro"
  case "$distro" in
    arch)   install_packages_arch ;;
    debian) install_packages_debian ;;
    *) warn "Unknown distro; trying Debian-style"; install_packages_debian ;;
  esac
  info "System packages installed"
}

clone_whisper() {
  if [[ -d "$WHISPER_DIR/.git" ]]; then
    info "whisper.cpp already cloned"
  else
    warn "Cloning whisper.cpp into $WHISPER_DIR"
    git clone https://github.com/ggerganov/whisper.cpp.git "$WHISPER_DIR"
    info "whisper.cpp cloned"
  fi
}

build_whisper() {
  warn "Building whisper.cpp (make)"
  (cd "$WHISPER_DIR" && make) || {
    err "Failed to build whisper via make. Trying CMake..."
    (\
      cd "$WHISPER_DIR" && \
      mkdir -p build && cd build && \
      cmake .. && \
      cmake --build .
    ) || { err "Failed to build whisper via CMake"; exit 1; }
  }
  info "whisper.cpp built"
}

download_models() {
  mkdir -p "$MODELS_DIR"
  warn "Downloading Whisper models to $MODELS_DIR"
  local TINY_URL SMALL_URL
  TINY_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
  SMALL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"

  if [[ ! -f "$MODELS_DIR/ggml-tiny.bin" ]]; then
    curl -L -o "$MODELS_DIR/ggml-tiny.bin" "$TINY_URL"
    info "ggml-tiny.bin downloaded"
  else
    info "ggml-tiny.bin already present"
  fi

  if [[ ! -f "$MODELS_DIR/ggml-small.bin" ]]; then
    curl -L -o "$MODELS_DIR/ggml-small.bin" "$SMALL_URL"
    info "ggml-small.bin downloaded"
  else
    info "ggml-small.bin already present"
  fi
}

maybe_setup_ollama() {
  if [[ "${SETUP_OLLAMA:-false}" == "true" ]]; then
    warn "Setting up Ollama (requires sudo)"
    if require_cmd curl; then
      curl https://ollama.ai/install.sh | sh || warn "Ollama install script failed"
      warn "You may need to run: ollama run llama3"
    else
      warn "curl not found, skipping Ollama install"
    fi
  else
    warn "Skipping Ollama setup (SETUP_OLLAMA=true to enable)"
  fi
}

run_hotkey_setup() {
  warn "Running setup-hotkey.sh"
  (cd "$PROJECT_ROOT" && bash ./setup-hotkey.sh) || warn "setup-hotkey.sh failed"
}

main() {
  warn "Starting Helper Node dependency installation"
  install_system_packages
  clone_whisper
  build_whisper
  download_models
  maybe_setup_ollama
  run_hotkey_setup
  info "All done!"
  echo
  echo -e "${YELLOW}Next steps:${NC}"
  echo "- Ensure your Gemini CLI is set up and working"
  echo "- Start the app: npm start"
}

main "$@"
