#!/usr/bin/env bash
# Helper Node — instalador Linux (Debian / Ubuntu / Pop!_OS / Mint)
#
# Uso (sem clonar nada antes):
#   curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-debian.sh | bash
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

echo -e "${MAGENTA}=== Helper Node — instalador Debian/Ubuntu ===${NC}"
echo -e "${GRAY}Versão com acesso gratuito — instalação rápida e unificada${NC}"

# --- 0) Sanidade -------------------------------------------------------------
if [[ "${EUID}" -eq 0 ]]; then
  fatal "Não execute como root/sudo. Execute como usuário padrão — o script pede sudo apenas para pacotes de sistema."
fi
command -v apt-get >/dev/null 2>&1 || fatal "apt-get não encontrado. Para distribuições baseadas em Arch, use install-linux-arch.sh."

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64|arm64) ;;
  *) fatal "Arquitetura '$ARCH' não suportada pelo Electron deste projeto (necessário x86_64 ou arm64)." ;;
esac

# --- 1) Pacotes de sistema ---------------------------------------------------
apt_try_one() {
  sudo apt-get install -y "$1" >/dev/null 2>&1 && echo "   + $1" || true
}

if [[ "${HELPER_SKIP_DEPS:-0}" == "1" ]]; then
  warn "HELPER_SKIP_DEPS=1 — pulando pacotes de sistema."
else
  step "Instalando dependências de sistema (solicitará senha sudo)..."
  sudo apt-get update -qq

  # Pacotes essenciais
  sudo apt-get install -y \
    git curl ca-certificates ffmpeg \
    xdg-utils x11-utils wl-clipboard \
    || fatal "Falha instalando pacotes essenciais via apt."

  # Bibliotecas de runtime do Electron e áudio
  step "Instalando bibliotecas do Electron e áudio..."
  for pkg in \
    libgtk-3-0 libgtk-3-0t64 \
    libnotify4 libnss3 libxss1 libxtst6 \
    libatspi2.0-0 libatspi2.0-0t64 \
    libasound2 libasound2t64 \
    libsecret-1-0 \
    pipewire pipewire-pulse pipewire-utils pulseaudio-utils
  do
    apt_try_one "$pkg"
  done

  # Captura de tela conforme ambiente
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *"COSMIC"* ]]; then
    step "Ambiente COSMIC detectado — instalando cosmic-screenshot..."
    apt_try_one cosmic-screenshot
  elif [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    step "Sessão Wayland detectada — instalando grim/slurp..."
    apt_try_one grim
    apt_try_one slurp
  else
    apt_try_one gnome-screenshot
  fi
  ok "Pacotes de sistema instalados"
fi

# --- 2) Node.js >= 18 --------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CUR="$(node_major)"
  if [[ -n "$CUR" && "$CUR" -ge 18 ]]; then
    NEED_NODE=0
    ok "Node.js $(node -v)"
  else
    warn "Node.js $(node -v) é antigo demais (mínimo: 18)."
  fi
else
  warn "Node.js não encontrado."
fi

if [[ "$NEED_NODE" -eq 1 ]]; then
  if [[ "${HELPER_SKIP_DEPS:-0}" == "1" ]]; then
    fatal "Node.js 18+ é obrigatório e HELPER_SKIP_DEPS=1 impede a instalação automática. Instale manualmente e execute novamente."
  fi
  warn "Adicionando repositório oficial NodeSource para Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - \
    || fatal "Falha ao configurar repositório NodeSource."
  sudo apt-get install -y nodejs || fatal "Falha ao instalar Node.js."
  ok "Node.js $(node -v) instalado"
fi

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
