#!/usr/bin/env bash
# Helper Node — instalador Linux (Arch / Manjaro / EndeavourOS / Garuda / CachyOS)
#
# Uso (sem clonar nada antes):
#   curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-arch.sh | bash
#
# Opções (variáveis de ambiente — NÃO há prompt interativo, ver nota do curl|bash abaixo):
#   HELPER_EDITION=lite   # padrão: full. 'lite' esconde na UI os provedores locais.
#   HELPER_WHISPER=1      # compila whisper.cpp + baixa ~1.5 GB de modelos (padrão: não).
#   HELPER_SKIP_DEPS=1    # pula os pacotes de sistema (não pede sudo).
#   HELPER_DIR=/caminho   # padrão: ~/.local/share/helper-node
#
#   curl -fsSL .../install-linux-arch.sh | HELPER_EDITION=lite bash
#
# Mesma estratégia do instalador Windows (install-windows-full.ps1): NÃO gera
# pacote nem usa o PKGBUILD. Clona/atualiza o código-fonte e roda `npm install`,
# que baixa o Electron OFICIAL. Instala no HOME do usuário — o único sudo é pros
# pacotes de sistema (libs do Electron, ffmpeg, ferramentas de screenshot).
#
# Por que não usar o PKGBUILD do repo (build/arch/PKGBUILD): ele instala em /opt
# a partir de um tarball de release e espera o whisper já compilado. Para
# instalação direta da fonte, clonar + npm install é o caminho já validado no
# Windows e não exige publicar artefato a cada commit.

set -euo pipefail

GREEN="\033[0;32m"; YELLOW="\033[1;33m"; RED="\033[0;31m"; CYAN="\033[0;36m"; MAGENTA="\033[0;35m"; GRAY="\033[0;90m"; NC="\033[0m"
step() { echo -e "${CYAN}->${NC} $1"; }
ok()   { echo -e "${GREEN}OK:${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
fatal() { echo -e "${RED}ERRO:${NC} $1" >&2; exit 1; }

EDITION="${HELPER_EDITION:-full}"
INSTALL_DIR="${HELPER_DIR:-$HOME/.local/share/helper-node}"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
REPO_URL="https://github.com/SoderJuliano/helper-node.git"
TARBALL_URL="https://github.com/SoderJuliano/helper-node/archive/refs/heads/master.tar.gz"

echo -e "${MAGENTA}=== Helper Node — instalador Arch (edição: $EDITION) ===${NC}"

# --- 0) Sanidade -------------------------------------------------------------
# Rodar como root instalaria no /root e os atalhos/config iriam pro usuário errado.
if [[ "${EUID}" -eq 0 ]]; then
  fatal "Não rode como root/sudo. Rode como seu usuário normal — o script pede sudo só pros pacotes de sistema."
fi
command -v pacman >/dev/null 2>&1 || fatal "pacman não encontrado. Esta máquina não parece Arch — use install-linux-debian.sh."

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64|arm64) ;;
  *) fatal "Arquitetura '$ARCH' não suportada pelo Electron deste projeto (precisa x86_64 ou arm64)." ;;
esac

# --- 1) Pacotes de sistema ---------------------------------------------------
# Lista derivada do build/arch/PKGBUILD que já existe no repo (depends), que é a
# referência de runtime do Electron nesta distro. `--needed` deixa idempotente.
if [[ "${HELPER_SKIP_DEPS:-0}" == "1" ]]; then
  warn "HELPER_SKIP_DEPS=1 — pulando pacotes de sistema."
else
  step "Instalando pacotes de sistema (vai pedir sua senha do sudo)..."
  sudo pacman -S --needed --noconfirm \
    git curl nodejs npm ffmpeg \
    gtk3 libnotify nss libxss libxtst at-spi2-core alsa-lib \
    xdg-utils xorg-xprop wl-clipboard \
    pipewire pipewire-pulse libpulse \
    imagemagick \
    || fatal "Falha instalando pacotes via pacman. Dica: se houver conflito de versões de bibliotecas (ex: ffmpeg), atualize seu sistema com: sudo pacman -Syu"

  # Ferramentas de captura dependem do compositor. COSMIC NÃO funciona com grim
  # — precisa do cosmic-screenshot (que costuma estar só no AUR); a lógica é a
  # mesma do install-deps.sh que já existe no repo.
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *"COSMIC"* ]]; then
    step "Desktop COSMIC detectado — tentando cosmic-screenshot..."
    sudo pacman -S --needed --noconfirm cosmic-screenshot 2>/dev/null \
      || warn "cosmic-screenshot não está nos repos oficiais. Instale do AUR (yay -S cosmic-screenshot) ou o app cai no portal do Electron."
  elif [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    step "Sessão Wayland detectada — instalando grim/slurp..."
    sudo pacman -S --needed --noconfirm grim slurp || warn "Falha instalando grim/slurp."
  else
    sudo pacman -S --needed --noconfirm gnome-screenshot 2>/dev/null || true
  fi
  ok "Pacotes de sistema instalados"
fi

# --- 2) Node.js >= 18 --------------------------------------------------------
# No Arch o pacote `nodejs` é rolling e sempre atual, então isto aqui é só uma
# rede de segurança pra quem usa nvm/asdf com uma versão velha fixada no PATH.
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

command -v node >/dev/null 2>&1 || fatal "Node.js não encontrado mesmo após o pacman. Instale com: sudo pacman -S nodejs npm"
CUR="$(node_major)"
[[ -n "$CUR" && "$CUR" -ge 18 ]] \
  || fatal "Node.js $(node -v) é antigo demais (mínimo: 18). Se você usa nvm/asdf, troque pra 18+ e rode de novo."
ok "Node.js $(node -v)"
command -v npm >/dev/null 2>&1 || fatal "npm não encontrado."

# --- 3) Código-fonte ---------------------------------------------------------
mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  step "Instalação existente em $INSTALL_DIR — atualizando..."
  git -C "$INSTALL_DIR" pull --quiet --ff-only || {
    warn "git pull falhou (histórico divergiu) — resetando para o remoto..."
    git -C "$INSTALL_DIR" fetch --quiet origin
    git -C "$INSTALL_DIR" reset --hard --quiet origin/master
  }
elif [[ -d "$INSTALL_DIR" ]]; then
  warn "Diretório existente sem .git — reinstalando do zero."
  rm -rf "$INSTALL_DIR"
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
  step "Clonando o repositório em $INSTALL_DIR..."
  git clone --quiet "$REPO_URL" "$INSTALL_DIR" || {
    warn "git clone falhou — tentando via tarball..."
    TMP="$(mktemp -d)"
    curl -fsSL "$TARBALL_URL" -o "$TMP/src.tar.gz" || fatal "Download do tarball falhou."
    tar -xzf "$TMP/src.tar.gz" -C "$TMP"
    mv "$TMP"/helper-node-* "$INSTALL_DIR"
    rm -rf "$TMP"
  }
fi
ok "Código-fonte em $INSTALL_DIR"

# --- 4) edition.json ---------------------------------------------------------
# Mesmo contrato que services/edition.js lê: ausência do arquivo = 'full'.
printf '{"edition":"%s"}\n' "$EDITION" > "$INSTALL_DIR/edition.json"

# --- 5) npm install ----------------------------------------------------------
step "Instalando dependências (npm install) — baixa o Electron oficial, pode demorar..."
( cd "$INSTALL_DIR" && npm install --no-fund --no-audit ) || fatal "npm install falhou."

ELECTRON_BIN="$INSTALL_DIR/node_modules/electron/dist/electron"
[[ -x "$ELECTRON_BIN" ]] || ELECTRON_BIN="$INSTALL_DIR/node_modules/.bin/electron"
[[ -x "$ELECTRON_BIN" ]] || fatal "Electron não ficou executável após o npm install. Rode 'npm install' à mão em $INSTALL_DIR para ver o erro."
ok "Electron pronto"

chmod +x "$INSTALL_DIR/helper-node.sh" "$INSTALL_DIR/setup-hotkey.sh" 2>/dev/null || true

# --- 6) Whisper local (opcional, pesado) -------------------------------------
if [[ "${HELPER_WHISPER:-0}" == "1" ]]; then
  step "HELPER_WHISPER=1 — compilando whisper.cpp e baixando modelos (~1.5 GB)..."
  sudo pacman -S --needed --noconfirm base-devel cmake || warn "Falha instalando toolchain de build."
  ( cd "$INSTALL_DIR" && bash ./install-deps.sh ) || warn "install-deps.sh falhou — o app continua funcionando com transcrição via OpenAI."
else
  echo -e "${GRAY}   (transcrição local Whisper não instalada — use HELPER_WHISPER=1 se quiser. O padrão usa a OpenAI.)${NC}"
fi

# --- 7) Comando `helper-node` ------------------------------------------------
# Usa o launcher do próprio repo com --local: ele já trata Flatpak, PATH do nvm,
# resolução do binário do Electron e o setup de hotkeys no primeiro boot.
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/helper-node" <<EOF
#!/usr/bin/env bash
exec "$INSTALL_DIR/helper-node.sh" --local "\$@"
EOF
chmod +x "$BIN_DIR/helper-node"
ok "Comando 'helper-node' criado em $BIN_DIR"

# --- 8) Atalho no menu de aplicativos ---------------------------------------
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

# --- 9) PATH -----------------------------------------------------------------
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR não está no seu PATH nesta sessão."
  echo "   Adicione ao ~/.bashrc (ou ~/.zshrc):"
  echo -e "     ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

echo ""
echo -e "${MAGENTA}=== Instalação concluída (edição: $EDITION) ===${NC}"
echo "Instalado em: $INSTALL_DIR"
echo "Pra abrir:    helper-node   (ou pelo menu de aplicativos)"
echo "Pra atualizar: rode este mesmo comando de novo (git pull + npm install)."
echo "Configure sua OpenAI API key na primeira execução (Configurações)."
if [[ "$EDITION" == "full" ]]; then
  echo -e "${GRAY}Edição FULL: Ollama/Claude CLI/Gemini CLI/Copilot CLI habilitados na UI (instale-os separadamente).${NC}"
fi
echo ""
