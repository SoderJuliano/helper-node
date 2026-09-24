#!/usr/bin/env bash
# Helper Node — instalador Linux (Arch / Manjaro / EndeavourOS / Garuda / CachyOS)
#
# Uso (sem clonar nada antes):
#   curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-arch.sh | bash
#
# Opções (variáveis de ambiente):
#   HELPER_SKIP_DEPS=1    # pula os pacotes de sistema (não pede sudo).
#   HELPER_DIR=/caminho   # padrão: ~/.local/share/helper-node
#
# Clona/atualiza o código-fonte e executa `npm install` (baixa o Electron oficial).
# Instala no espaço do usuário sem necessidade de root para o app.

set -euo pipefail

GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; CYAN="\033[0;36m"; MAGENTA="\033[0;35m"; GRAY="\033[0;90m"; NC="\033[0m"
step() { echo -e "${CYAN}->${NC} $1"; }
ok()   { echo -e "${GREEN}OK:${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fatal() { echo -e "${RED}ERRO:${NC} $1" >&2; exit 1; }

INSTALL_DIR="${HELPER_DIR:-$HOME/.local/share/helper-node}"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
REPO_URL="https://github.com/SoderJuliano/helper-node.git"
TARBALL_URL="https://github.com/SoderJuliano/helper-node/archive/refs/heads/master.tar.gz"

echo -e "${MAGENTA}=== Helper Node — instalador Arch Linux ===${NC}"
echo -e "${GRAY}Versão com acesso gratuito — instalação rápida e unificada${NC}"

# --- 0) Sanidade -------------------------------------------------------------
if [[ "${EUID}" -eq 0 ]]; then
  fatal "Não execute como root/sudo. Execute como usuário padrão — o script pede sudo apenas para pacotes de sistema."
fi
command -v pacman >/dev/null 2>&1 || fatal "pacman não encontrado. Para distribuições Debian/Ubuntu, use install-linux-debian.sh."

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64|arm64) ;;
  *) fatal "Arquitetura '$ARCH' não suportada pelo Electron deste projeto (necessário x86_64 ou arm64)." ;;
esac

# --- 1) Pacotes de sistema ---------------------------------------------------
if [[ "${HELPER_SKIP_DEPS:-0}" == "1" ]]; then
  warn "HELPER_SKIP_DEPS=1 — pulando pacotes de sistema."
else
  step "Verificando dependências de sistema..."
  PKGS=(
    git curl nodejs npm ffmpeg
    gtk3 libnotify nss libxss libxtst at-spi2-core alsa-lib
    xdg-utils xorg-xprop wl-clipboard
    pipewire pipewire-pulse libpulse
  )

  # Ferramentas de captura dependem do compositor
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *"COSMIC"* ]]; then
    if ! pacman -Q cosmic-screenshot >/dev/null 2>&1; then
      warn "Desktop COSMIC detectado — cosmic-screenshot recomendado (yay -S cosmic-screenshot)."
    fi
  elif [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    PKGS+=(grim slurp)
  else
    PKGS+=(gnome-screenshot)
  fi

  MISSING_PKGS=()
  for pkg in "${PKGS[@]}"; do
    if ! pacman -Q "$pkg" >/dev/null 2>&1; then
      MISSING_PKGS+=("$pkg")
    fi
  done

  if [[ ${#MISSING_PKGS[@]} -gt 0 ]]; then
    step "Instalando pacotes ausentes via pacman: ${MISSING_PKGS[*]} (solicitará senha sudo)..."
    sudo pacman -S --needed --noconfirm "${MISSING_PKGS[@]}" || fatal "Falha instalando pacotes via pacman."
  fi
  ok "Pacotes de sistema verificados"
fi

# --- 2) Node.js >= 18 --------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

command -v node >/dev/null 2>&1 || fatal "Node.js não encontrado após instalação do sistema."
CUR="$(node_major)"
if [[ -z "$CUR" || "$CUR" -lt 18 ]]; then
  fatal "Node.js v$(node -v) é antigo demais (mínimo: 18)."
fi
ok "Node.js $(node -v)"
command -v npm >/dev/null 2>&1 || fatal "npm não encontrado."

# --- 3) Código-fonte ---------------------------------------------------------
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  step "Instalação existente em $INSTALL_DIR — atualizando..."
  git -C "$INSTALL_DIR" pull --quiet --ff-only || {
    warn "git pull divergiu — sincronizando com origin/master..."
    git -C "$INSTALL_DIR" fetch --quiet origin
    git -C "$INSTALL_DIR" reset --hard --quiet origin/master
  }
elif [[ -d "$INSTALL_DIR" ]]; then
  warn "Diretório existente sem .git — reinstalando..."
  rm -rf "$INSTALL_DIR"
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  step "Clonando o repositório em $INSTALL_DIR..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR" || {
    warn "git clone falhou — tentando via pacote tarball..."
    TMP="$(mktemp -d)"
    curl -fsSL "$TARBALL_URL" -o "$TMP/src.tar.gz" || fatal "Download do tarball falhou."
    tar -xzf "$TMP/src.tar.gz" -C "$TMP"
    mv "$TMP"/helper-node-* "$INSTALL_DIR"
    rm -rf "$TMP"
  }
fi
ok "Código-fonte pronto em $INSTALL_DIR"

# --- 4) Configuração unificada ----------------------------------------------
printf '{"edition":"unified"}\n' > "$INSTALL_DIR/edition.json"

# --- 5) npm install ----------------------------------------------------------
step "Instalando dependências (npm install) — baixando Electron oficial..."
( cd "$INSTALL_DIR" && npm install --no-fund --no-audit ) || fatal "npm install falhou."

ELECTRON_BIN="$INSTALL_DIR/node_modules/electron/dist/electron"
[[ -x "$ELECTRON_BIN" ]] || ELECTRON_BIN="$INSTALL_DIR/node_modules/.bin/electron"
[[ -x "$ELECTRON_BIN" ]] || fatal "Electron não executável após npm install. Execute 'npm install' manualmente em $INSTALL_DIR."
ok "Electron pronto"

chmod +x "$INSTALL_DIR/helper-node.sh" "$INSTALL_DIR/setup-hotkey.sh" 2>/dev/null || true

# --- 6) Comando `helper-node` ------------------------------------------------
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/helper-node" <<EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/helper-node.sh" --local "\$@"
EOF
chmod +x "$BIN_DIR/helper-node"
ok "Comando 'helper-node' criado em $BIN_DIR"

# --- 7) Atalho no menu de aplicativos ---------------------------------------
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/helper-node.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Helper Node
Comment=Copiloto de IA com transcrição em tempo real
Exec=$BIN_DIR/helper-node
Icon=$INSTALL_DIR/assets/linux.png
Terminal=false
Categories=Utility;AudioVideo;Office;
Keywords=ai;assistant;voice;transcription;
StartupNotify=true
StartupWMClass=helper-node
EOF
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
ok "Atalho criado no menu de aplicativos"

# --- 8) PATH -----------------------------------------------------------------
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR não está no seu PATH nesta sessão."
  echo "   Adicione ao ~/.bashrc (ou ~/.zshrc):"
  echo -e "     ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

echo ""
echo -e "${MAGENTA}=== Instalação concluída com sucesso! ===${NC}"
echo "Instalado em:   $INSTALL_DIR"
echo "Como abrir:     helper-node (ou pelo menu de aplicativos)"
echo "Como atualizar: execute este comando novamente a qualquer momento"
echo "Acesso:         Versão com acesso 100% gratuito por enquanto"
echo ""
