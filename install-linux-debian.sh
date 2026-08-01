#!/usr/bin/env bash
# Helper Node — instalador Linux (Debian / Ubuntu / Pop!_OS / Mint)
#
# Uso (sem clonar nada antes):
#   curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-debian.sh | bash
#
# Opções (variáveis de ambiente — NÃO há prompt interativo, ver nota do curl|bash abaixo):
#   HELPER_EDITION=lite   # padrão: full. 'lite' esconde na UI os provedores locais.
#   HELPER_WHISPER=1      # compila whisper.cpp + baixa ~1.5 GB de modelos (padrão: não).
#   HELPER_SKIP_DEPS=1    # pula os pacotes de sistema (não pede sudo).
#   HELPER_DIR=/caminho   # padrão: ~/.local/share/helper-node
#
#   curl -fsSL .../install-linux-debian.sh | HELPER_EDITION=lite bash
#
# Mesma estratégia do instalador Windows (install-windows-full.ps1): NÃO gera
# pacote nem .deb. Clona/atualiza o código-fonte e roda `npm install`, que baixa
# o Electron OFICIAL. Instala no HOME do usuário — o único sudo é pros pacotes
# de sistema (libs do Electron, ffmpeg, ferramentas de screenshot).
#
# Por que não usar o .deb do repo: o .deb instala em /opt e é gerado pelo
# package.sh a partir de uma máquina de build. Para instalação direta da fonte,
# clonar + npm install é o caminho que já está validado no Windows e evita ter
# que publicar/hospedar artefato a cada commit.

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

echo -e "${MAGENTA}=== Helper Node — instalador Debian/Ubuntu (edição: $EDITION) ===${NC}"

# --- 0) Sanidade -------------------------------------------------------------
# Rodar como root instalaria no /root e os atalhos/config iriam pro usuário errado.
if [[ "${EUID}" -eq 0 ]]; then
  fatal "Não rode como root/sudo. Rode como seu usuário normal — o script pede sudo só pros pacotes de sistema."
fi
command -v apt-get >/dev/null 2>&1 || fatal "apt-get não encontrado. Esta máquina não parece Debian/Ubuntu — use install-linux-arch.sh."

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|aarch64|arm64) ;;
  *) fatal "Arquitetura '$ARCH' não suportada pelo Electron deste projeto (precisa x86_64 ou arm64)." ;;
esac

# --- 1) Pacotes de sistema ---------------------------------------------------
# Instalado em dois grupos: ESSENCIAL (falha para tudo) e OPCIONAL (best-effort,
# um por um). O motivo do best-effort: vários runtimes do Electron foram
# RENOMEADOS na transição time_t 64-bit (libasound2 -> libasound2t64,
# libatspi2.0-0 -> libatspi2.0-0t64) no Ubuntu 24.04+/Debian trixie. Instalar a
# lista inteira de uma vez faz o apt abortar TUDO por causa de um nome que não
# existe naquela release — por isso os renomeáveis vão um a um e sem -e.
apt_try_one() {
  sudo apt-get install -y "$1" >/dev/null 2>&1 && echo "   + $1" || true
}

if [[ "${HELPER_SKIP_DEPS:-0}" == "1" ]]; then
  warn "HELPER_SKIP_DEPS=1 — pulando pacotes de sistema."
else
  step "Instalando pacotes de sistema (vai pedir sua senha do sudo)..."
  sudo apt-get update -qq

  # Essenciais: sem isso o app não builda nem roda.
  sudo apt-get install -y \
    git curl ca-certificates ffmpeg \
    xdg-utils x11-utils wl-clipboard \
    || fatal "Falha instalando pacotes essenciais via apt."

  # Runtime do Electron + áudio + screenshot. Nomes variam entre releases.
  step "Instalando bibliotecas do Electron e ferramentas auxiliares..."
  for pkg in \
    libgtk-3-0 libgtk-3-0t64 \
    libnotify4 libnss3 libxss1 libxtst6 \
    libatspi2.0-0 libatspi2.0-0t64 \
    libasound2 libasound2t64 \
    libsecret-1-0 \
    pipewire pipewire-pulse pipewire-utils pulseaudio-utils \
    imagemagick gnome-screenshot
  do
    apt_try_one "$pkg"
  done

  # Ferramentas de captura dependem do compositor. COSMIC (Pop!_OS 24.04+) NÃO
  # funciona com grim — precisa do cosmic-screenshot; a lógica é a mesma do
  # install-deps.sh que já existe no repo.
  if [[ "${XDG_CURRENT_DESKTOP:-}" == *"COSMIC"* ]]; then
    step "Desktop COSMIC detectado — instalando cosmic-screenshot..."
    apt_try_one cosmic-screenshot
  elif [[ "${XDG_SESSION_TYPE:-}" == "wayland" ]]; then
    step "Sessão Wayland detectada — instalando grim/slurp..."
    apt_try_one grim
    apt_try_one slurp
  fi
  ok "Pacotes de sistema instalados"
fi

# --- 2) Node.js >= 18 --------------------------------------------------------
# Debian/Ubuntu LTS costumam empacotar Node antigo demais (o 22.04 ainda traz
# o 12). Se o que está no PATH não serve, usamos o repositório oficial da
# NodeSource — que é uma alteração de sistema, então avisamos em voz alta.
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
    fatal "Node.js 18+ é obrigatório e HELPER_SKIP_DEPS=1 impede a instalação. Instale manualmente e rode de novo."
  fi
  warn "Vou adicionar o repositório oficial da NodeSource (nodesource.com) e instalar o Node 22."
  warn "Isso ALTERA as fontes de pacote do sistema. Se preferir instalar por conta própria (nvm, etc),"
  warn "cancele agora com Ctrl+C, instale Node 18+ e rode este script de novo."
  sleep 4
  step "Configurando NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - \
    || fatal "Falha ao configurar o repositório NodeSource."
  sudo apt-get install -y nodejs || fatal "Falha ao instalar Node.js via NodeSource."
  ok "Node.js $(node -v)"
fi

command -v npm >/dev/null 2>&1 || fatal "npm não encontrado mesmo com o Node instalado."

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
  sudo apt-get install -y make g++ cmake || warn "Falha instalando toolchain de build."
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
# ~/.local/bin é padrão XDG e já está no PATH na maioria das distros, mas o
# Debian só o adiciona no ~/.profile SE o diretório já existisse no login.
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  warn "$BIN_DIR não está no seu PATH nesta sessão."
  echo "   Adicione ao ~/.bashrc (ou ~/.zshrc):"
  echo -e "     ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
  echo "   Ou saia e entre de novo na sessão (o ~/.profile do Debian já cobre esse caminho)."
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
