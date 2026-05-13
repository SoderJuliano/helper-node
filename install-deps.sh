#!/usr/bin/env bash
set -euo pipefail

# Helper Node dependency installer
# - Installs system packages (Git, make/g++, curl, ffmpeg, cmake)
# - Clones and builds whisper.cpp
# - Downloads small and medium Whisper models
# - Installs Vosk speech recognition (Python) and downloads PT-BR model
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
  sudo pacman -S --needed git nodejs npm make gcc curl ffmpeg cmake gnome-screenshot grim slurp imagemagick python python-pip pipewire pipewire-pulse libpulse || {
    err "pacman install failed"; exit 1;
  }

  # COSMIC native screenshot tool (in AUR or extra repo on some distros)
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *"COSMIC"* ]]; then
    warn "Detected COSMIC desktop — trying to install cosmic-screenshot"
    sudo pacman -S --needed cosmic-screenshot 2>/dev/null \
      || warn "cosmic-screenshot not in official repos. Try AUR (yay -S cosmic-screenshot) or rely on Electron Portal."
  fi
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

  # Detect COSMIC desktop (Pop!_OS 24.04+)
  local is_cosmic=false
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *"COSMIC"* ]]; then
    is_cosmic=true
    warn "Detected COSMIC desktop — will install cosmic-screenshot (grim does NOT work in COSMIC)"
  fi
  
  # Base packages
  local packages="git nodejs make g++ curl ffmpeg cmake gnome-screenshot imagemagick python3 python3-venv python3-pip pipewire pulseaudio-utils"
  
  # Add Wayland screenshot tools (Sway/Hyprland/Wayfire — not COSMIC)
  if [[ "$is_wayland" == "true" && "$is_cosmic" == "false" ]]; then
    packages="$packages grim slurp"
  fi

  # Add COSMIC native screenshot tool
  if [[ "$is_cosmic" == "true" ]]; then
    packages="$packages cosmic-screenshot"
  fi
  
  sudo apt-get install -y $packages || {
    # cosmic-screenshot may not be in repos on older Pop!_OS; retry without it
    if [[ "$is_cosmic" == "true" ]]; then
      warn "Initial install failed; retrying without cosmic-screenshot (Electron Portal will be used as fallback)"
      packages="${packages//cosmic-screenshot/}"
      sudo apt-get install -y $packages || { err "apt install failed"; exit 1; }
    else
      err "apt install failed"; exit 1;
    fi
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
  local SMALL_URL MEDIUM_URL
  SMALL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin"
  MEDIUM_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin"

  if [[ ! -f "$MODELS_DIR/ggml-small.bin" ]]; then
    curl -L -o "$MODELS_DIR/ggml-small.bin" "$SMALL_URL"
    info "ggml-small.bin downloaded"
  else
    info "ggml-small.bin already present"
  fi

  if [[ ! -f "$MODELS_DIR/ggml-medium.bin" ]]; then
    curl -L -o "$MODELS_DIR/ggml-medium.bin" "$MEDIUM_URL"
    info "ggml-medium.bin downloaded"
  else
    info "ggml-medium.bin already present"
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

install_vosk() {
  warn "Setting up local Python venv for Vosk"
  local VENV_DIR="$PROJECT_ROOT/venv"
  if [[ ! -d "$VENV_DIR" ]]; then
    python3 -m venv "$VENV_DIR" || { err "Failed to create venv"; return 1; }
    info "venv created at $VENV_DIR"
  else
    info "venv already exists"
  fi
  warn "Installing Vosk into venv (this may take a minute)"
  "$VENV_DIR/bin/pip" install --upgrade pip >/dev/null
  "$VENV_DIR/bin/pip" install vosk || { err "vosk install failed"; return 1; }
  info "Vosk installed in venv"

  local VOSK_MODEL_DIR="$PROJECT_ROOT/vosk-model"
  if [[ -d "$VOSK_MODEL_DIR/conf" ]]; then
    info "Vosk model already present in $VOSK_MODEL_DIR"
    return 0
  fi

  # Choose model size: VOSK_MODEL_SIZE=small (40MB, default) | large (1.6GB, FalaBrasil)
  # NOTE: Em testes reais, o small se saiu MELHOR para áudio comprimido (WhatsApp, calls).
  # O large só é superior para narração limpa (locução, livros).
  local VOSK_SIZE="${VOSK_MODEL_SIZE:-small}"
  local VOSK_URL VOSK_DIRNAME
  case "$VOSK_SIZE" in
    large)
      VOSK_URL="https://alphacephei.com/vosk/models/vosk-model-pt-fb-v0.1.1-20220516_2113.zip"
      VOSK_DIRNAME="vosk-model-pt-fb-v0.1.1-20220516_2113"
      warn "Downloading Vosk PT-BR LARGE model (FalaBrasil, ~1.6GB)"
      ;;
    small|*)
      VOSK_URL="https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip"
      VOSK_DIRNAME="vosk-model-small-pt-0.3"
      warn "Downloading Vosk PT-BR SMALL model (~40MB)"
      ;;
  esac

  mkdir -p "$VOSK_MODEL_DIR"
  local VOSK_ZIP="$PROJECT_ROOT/vosk-model.zip"
  curl -L --progress-bar -o "$VOSK_ZIP" "$VOSK_URL" || { err "Vosk model download failed"; return 1; }
  warn "Extracting Vosk model..."
  unzip -qo "$VOSK_ZIP" -d "$PROJECT_ROOT" || { err "Failed to unzip Vosk model"; return 1; }
  mv "$PROJECT_ROOT/$VOSK_DIRNAME"/* "$VOSK_MODEL_DIR/"
  rm -rf "$PROJECT_ROOT/$VOSK_DIRNAME" "$VOSK_ZIP"
  info "Vosk PT-BR ($VOSK_SIZE) model installed at $VOSK_MODEL_DIR"
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
  install_vosk
  maybe_setup_ollama
  run_hotkey_setup
  info "All done!"
  echo
  echo -e "${YELLOW}Next steps:${NC}"
  echo "- Ensure your Gemini CLI is set up and working"
  echo "- Start the app: npm start"
}

main "$@"
