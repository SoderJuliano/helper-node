#!/bin/bash

# Package Builder for Helper Node
# Builds both DEB and Arch packages

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="helper-node"
BUILD_DIR="$(pwd)/build"
DIST_DIR="$(pwd)/dist"
PROJECT_ROOT="$(pwd)"
# (Removido APP_CONFIG_CANDIDATES — o build NÃO empacota config do usuário:
#  continha a API key e vazava nos pacotes. Cada user configura a própria chave.)

# Check if we're in the right directory
if [ ! -f "main.js" ] || [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must be run from helper-node project root!${NC}"
    exit 1
fi

# VERSION vem SEMPRE do package.json — antes era hardcoded aqui e ficava
# dessincronizado (o script buildava uma versão "fantasma" enquanto o
# package.json já tinha outra), fazendo o build parecer "novo" mas instalar
# sempre o pacote velho.
VERSION="$(node -p "require('./package.json').version")"

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Helper Node Package Builder v${VERSION}  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Cada build limpa só o SEU próprio artefato (dentro de build_deb/build_arch),
# pra não apagar as outras edições/formatos. Aqui só garante o diretório.
mkdir -p "$DIST_DIR"

# Check dependencies
echo -e "${YELLOW}→${NC} Checking dependencies..."
if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm not found. Please install Node.js${NC}"
    exit 1
fi

# Function to build DEB package
build_deb() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════${NC}"
    echo -e "${GREEN}  Building DEB Package${NC}"
    echo -e "${GREEN}═══════════════════════════════════${NC}"
    
        DEB_ROOT="${BUILD_DIR}/deb-root/${PKG_NAME}_${VERSION}_amd64"
        APP_ROOT="${DEB_ROOT}/opt/helper-node"
        DEB_OUTPUT="${DIST_DIR}/${PKG_NAME}_${VERSION}_amd64.deb"
        # Apaga QUALQUER versão anterior deste mesmo pacote (edição+formato), não só
        # o nome exato da versão atual — senão dist/ acumula .deb de builds antigas
        # e o instalador errado pode sobrar por lá confundindo instalação futura.
        rm -f "${DIST_DIR}/${PKG_NAME}"_*_amd64.deb
    
    # Create directory structure
    echo -e "${YELLOW}→${NC} Creating DEB directory structure..."
        rm -rf "${BUILD_DIR}/deb-root"
        mkdir -p "${APP_ROOT}"
    mkdir -p "${DEB_ROOT}/DEBIAN"
    
    # Copy application files
    echo -e "${YELLOW}→${NC} Copying application files..."
        cp -r main.js main_new_notification.js createOsNotificationWindow_fixed.js index.html config.html config.js preload.js editorController.js preferences.html preferences.js "${APP_ROOT}/" 2>/dev/null || true
        cp -r assets os-integration services "${APP_ROOT}/"

        # Marca a edição pro runtime (services/edition.js lê esse arquivo)
        echo "{\"edition\":\"${EDITION}\"}" > "${APP_ROOT}/edition.json"

        # === Modelos LOCAIS (Whisper + Vosk) — só na edição FULL ===
        # Na Lite (100% online) tudo isso é omitido → pacote ~600MB menor.
        if [ "$EDITION" != "lite" ]; then
        cp -r vosk-model "${APP_ROOT}/"

        # Whisper: copia seletiva (binarios + libs + modelos reais)
        # Evita repo git, fontes C++, examples, tests, bindings e modelos for-tests-
        echo -e "${YELLOW}→${NC} Copying whisper runtime (selective)..."
        mkdir -p "${APP_ROOT}/whisper/build" "${APP_ROOT}/whisper/models"
        cp -r whisper/build/bin "${APP_ROOT}/whisper/build/"
        mkdir -p "${APP_ROOT}/whisper/build/src" "${APP_ROOT}/whisper/build/ggml/src"
        cp -P whisper/build/src/libwhisper.so* "${APP_ROOT}/whisper/build/src/"
        cp -P whisper/build/ggml/src/libggml*.so* "${APP_ROOT}/whisper/build/ggml/src/"
        for m in whisper/models/ggml-*.bin; do
            base="$(basename "$m")"
            [[ "$base" == for-tests-* ]] && continue
            cp "$m" "${APP_ROOT}/whisper/models/"
        done

        cp vosk-stream.py "${APP_ROOT}/"

        # Bundle vosk wheel so postinst installs offline (no download during install)
        echo -e "${YELLOW}→${NC} Downloading vosk wheel for offline bundling..."
        mkdir -p "${APP_ROOT}/python-packages"
        python3 -m pip download vosk --only-binary :all: --dest "${APP_ROOT}/python-packages/" --quiet 2>&1 \
            && echo -e "${GREEN}  vosk wheel bundled OK${NC}" \
            || echo -e "${YELLOW}  WARNING: vosk wheel download failed — will download at install time${NC}"
        cp vosk-vocab.json "${APP_ROOT}/" 2>/dev/null || true
        fi
        cp package.json package-lock.json "${APP_ROOT}/" 2>/dev/null || true
        cp *.traineddata "${APP_ROOT}/" 2>/dev/null || true
        cp helper-node.sh helper-node.desktop setup-hotkey.sh capture-screenshot.sh install-deps.sh "${APP_ROOT}/" 2>/dev/null || true
        cp README.markdown ROADMAP.md "${APP_ROOT}/" 2>/dev/null || true

        # Instala a entrada de menu (.desktop) e o ícone no pacote DEB (/usr/share/applications e /usr/share/pixmaps)
        mkdir -p "${DEB_ROOT}/usr/share/applications"
        cp helper-node.desktop "${DEB_ROOT}/usr/share/applications/helper-node.desktop"
        if [ -f "assets/linux.png" ]; then
            mkdir -p "${DEB_ROOT}/usr/share/pixmaps"
            cp assets/linux.png "${DEB_ROOT}/usr/share/pixmaps/helper-node.png"
        fi

        # ⚠️ NUNCA empacotar config do usuário. O config.json contém a API KEY e
        # estava sendo embutido como config-default.json → vazava a chave em TODO
        # pacote gerado. Removido de propósito. Cada usuário configura a própria
        # key no primeiro uso (o app usa os defaults internos do configService,
        # sem token e com osIntegration:false).

        # Install Node dependencies directly in package root (includes Electron runtime)
        echo -e "${YELLOW}→${NC} Installing packaged Node dependencies..."
        (
            cd "${APP_ROOT}"
            if [ -f package-lock.json ]; then
                npm ci --include=dev --include=optional
            else
                npm install --include=dev --include=optional
            fi
        )

        # O `npm ci` isolado às vezes NÃO baixa o binário real do Electron
        # (sobra só node_modules/electron/dist/libvulkan.so.1, sem o executável
        # dist/electron + path.txt). Sem isso o app instalado morre com
        # "Electron failed to install correctly". Garantimos o binário aqui:
        # se faltar no pacote, copiamos da árvore de dev (mesma versão do lock).
        PKG_ELECTRON_BIN="${APP_ROOT}/node_modules/electron/dist/electron"
        if [ ! -x "${PKG_ELECTRON_BIN}" ]; then
            echo -e "${YELLOW}→${NC} Electron binary ausente no pacote — copiando da árvore de dev..."
            DEV_ELECTRON_DIST="${PROJECT_ROOT}/node_modules/electron/dist"
            DEV_ELECTRON_PATHTXT="${PROJECT_ROOT}/node_modules/electron/path.txt"
            if [ -x "${DEV_ELECTRON_DIST}/electron" ]; then
                rm -rf "${APP_ROOT}/node_modules/electron/dist"
                cp -a "${DEV_ELECTRON_DIST}" "${APP_ROOT}/node_modules/electron/dist"
                [ -f "${DEV_ELECTRON_PATHTXT}" ] && cp -a "${DEV_ELECTRON_PATHTXT}" "${APP_ROOT}/node_modules/electron/path.txt"
            else
                echo -e "${RED}Error: binário do Electron não encontrado nem no pacote nem em ${DEV_ELECTRON_DIST}.${NC}"
                echo -e "${RED}Rode 'npm install' na raiz do projeto (que baixa o binário) e tente de novo.${NC}"
                exit 1
            fi
        fi

        # Valida o binário REAL (não o cli.js do .bin) antes de fechar o pacote.
        if [ ! -x "${APP_ROOT}/node_modules/electron/dist/electron" ]; then
            echo -e "${RED}Error: electron binary not found inside package tree.${NC}"
            exit 1
        fi


    # Copy DEBIAN scripts (postinst/preinst/prerm), depois gera o control por edição
    echo -e "${YELLOW}→${NC} Adding control files..."
    cp build/deb/DEBIAN/* "${DEB_ROOT}/DEBIAN/"
    chmod 755 "${DEB_ROOT}/DEBIAN/postinst"
    chmod 755 "${DEB_ROOT}/DEBIAN/preinst"
    chmod 755 "${DEB_ROOT}/DEBIAN/prerm"

    # Gera o control: nome e Depends variam por edição. Lite não precisa de python/vosk.
    DEB_DEPENDS="libgtk-3-0t64 | libgtk-3-0, libnss3, libxss1, libxtst6, libasound2t64 | libasound2, libgbm1, libdrm2, xdg-utils, libatspi2.0-0t64 | libatspi2.0-0, ffmpeg, pipewire-bin, pulseaudio-utils, libnotify4"
    if [ "$EDITION" != "lite" ]; then
        DEB_DEPENDS="${DEB_DEPENDS}, python3, python3-venv, python3-pip"
    fi
    OTHER_EDITION="lite"; [ "$EDITION" == "lite" ] && OTHER_EDITION="full"
    cat > "${DEB_ROOT}/DEBIAN/control" <<CONTROL_EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: Helper Node Team <support@helper-node.app>
Depends: ${DEB_DEPENDS}
Provides: helper-node
Conflicts: helper-node, ${APP_NAME}-${OTHER_EDITION}
Replaces: helper-node, ${APP_NAME}-${OTHER_EDITION}
Description: Assistente de voz com IA (edição ${EDITION})
 Helper Node — copiloto stealth com IA. Edição ${EDITION}.
 A edição full inclui transcrição offline (Whisper/Vosk + Ollama local);
 a edição lite é 100% online (somente modelos cloud) e bem menor.
CONTROL_EOF
    
    # Set permissions
    echo -e "${YELLOW}→${NC} Setting permissions..."
    chmod +x "${APP_ROOT}/helper-node.sh"
    chmod +x "${APP_ROOT}/setup-hotkey.sh" 2>/dev/null || true
    chmod +x "${APP_ROOT}/capture-screenshot.sh" 2>/dev/null || true
    chmod +x "${APP_ROOT}/whisper/build/bin/whisper-cli" 2>/dev/null || true
    
    # Build package
    echo -e "${YELLOW}→${NC} Building DEB package..."
        if command -v fakeroot &> /dev/null; then
            fakeroot dpkg-deb --build "${DEB_ROOT}" "${DEB_OUTPUT}"
        else
            dpkg-deb --build "${DEB_ROOT}" "${DEB_OUTPUT}"
        fi
    
    # Cleanup
    rm -rf "${BUILD_DIR}/deb-root"

    # Generate graphical installer (bypasses cosmic-store bugs with large local .deb)
    # A edição (full/lite) é CRAVADA aqui: o instalador aponta para o .deb desta
    # build específica, e não mais um glob que escorregava pro pacote errado quando
    # lite e full coexistiam em dist/.
    # IMPORTANTE: um instalador POR PACOTE (instalar-<edição>-deb.sh). Antes era um
    # único instalar.sh que o build `all` sobrescrevia — sobrava só o da última
    # edição e os pacotes Arch ficavam sem instalador nenhum.
    INSTALLER_SH="${DIST_DIR}/instalar-${EDITION}-deb.sh"
    cat > "${INSTALLER_SH}" << INSTALLER_HEAD
#!/usr/bin/env bash
# Instalador do Helper Node (edição: ${EDITION}, formato: deb). Aponta para o .deb
# desta build, REMOVE qualquer edição anterior e instala — funciona mesmo reinstalando a mesma versão.
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
DEB="\$SCRIPT_DIR/$(basename "${DEB_OUTPUT}")"
INSTALLER_HEAD
    cat >> "${INSTALLER_SH}" << 'INSTALLER_EOF'
# Se executado via duplo-clique na GUI (sem TTY), tenta abrir uma janela de terminal
if [ ! -t 0 ] && [ "${HELPER_NODE_GUI_RUN:-0}" != "1" ]; then
    export HELPER_NODE_GUI_RUN=1
    for term in cosmic-terminal gnome-terminal ptyxis x-terminal-emulator konsole xfce4-terminal alacritty kitty xterm; do
        if command -v "$term" >/dev/null 2>&1; then
            case "$term" in
                cosmic-terminal|gnome-terminal|ptyxis)
                    exec "$term" -- bash -c "exec \"$0\" \"$@\"" && exit 0
                    ;;
                konsole|xfce4-terminal|alacritty|kitty|xterm|x-terminal-emulator)
                    exec "$term" -e bash -c "exec \"$0\" \"$@\"" && exit 0
                    ;;
            esac
        fi
    done
fi

notify() { command -v notify-send >/dev/null 2>&1 && notify-send "Helper Node" "$1" 2>/dev/null || true; }

show_gui_dialog() {
    local msg_type="$1" title="$2" msg="$3"
    python3 -c "
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
m = Gtk.MessageType.INFO if '$msg_type' == 'info' else Gtk.MessageType.ERROR
d = Gtk.MessageDialog(flags=0, message_type=m, buttons=Gtk.ButtonsType.OK, text='$title')
d.format_secondary_text('$msg')
d.run(); d.destroy()
" 2>/dev/null || true
}

if [ ! -f "$DEB" ]; then
    msg="ERRO: arquivo .deb não encontrado:\n$DEB"
    echo -e "$msg"
    notify "✗ .deb não encontrado"
    show_gui_dialog "error" "Helper Node — Erro" "$msg"
    [ -t 0 ] && read -rp "Pressione Enter para fechar..."; exit 1
fi

echo "=================================================="
echo "    Instalador do Helper Node (edição deb)"
echo "=================================================="
echo ""
echo "Instalando: $(basename "$DEB")"
echo ""

if [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
    echo "(será pedida sua senha de sudo)"
    sudo bash -c "apt-get remove -y helper-node helper-node-full helper-node-lite 2>/dev/null || true; apt-get install -y \"$DEB\""
    EXIT=$?
else
    notify "Instalando… digite sua senha de permissão."
    pkexec bash -c "apt-get remove -y helper-node helper-node-full helper-node-lite 2>/dev/null || true; apt-get install -y \"$DEB\""
    EXIT=$?
fi

echo ""
if [ "$EXIT" -eq 0 ]; then
    echo "✓ Helper Node instalado com sucesso!"
    echo "  Procure 'Helper Node' no menu de aplicativos ou rode: helper-node"
    notify "✓ Instalado! Procure 'Helper Node' no menu."
    show_gui_dialog "info" "Helper Node" "✓ Instalado com sucesso!\n\nProcure por 'Helper Node' no seu menu de aplicativos ou execute: helper-node"
else
    echo "✗ Falha na instalação (código de erro: $EXIT)"
    echo "  Para ver detalhes, execute no terminal:"
    echo "  sudo apt install \"$DEB\""
    notify "✗ Falha na instalação (código $EXIT)."
    show_gui_dialog "error" "Helper Node — Erro" "✗ Falha ao instalar o pacote (código $EXIT).\n\nTente instalar manualmente abrindo o terminal e digitando:\nsudo apt install \"$DEB\""
fi

if [ -t 0 ]; then
    echo ""
    read -rp "Pressione Enter para fechar..."
fi
INSTALLER_EOF
    chmod +x "${INSTALLER_SH}"

    # Lançador gráfico por edição (cada um chama o seu próprio instalar-*.sh).
    DESKTOP_FILE="${DIST_DIR}/Instalar Helper Node (${EDITION}-deb).desktop"
    cat > "${DESKTOP_FILE}" << DESKTOP_EOF
[Desktop Entry]
Version=1.0
Name=Instalar Helper Node (${EDITION} · deb)
Comment=Instala o Helper Node (edição ${EDITION}, .deb) no sistema
Exec=bash -c 'DIR="\$(dirname "\$(echo "\$1" | sed "s|^file://||")")"; [ -d "\$DIR" ] && cd "\$DIR"; exec bash ./$(basename "${INSTALLER_SH}")' _ %k
Terminal=false
Type=Application
Icon=system-software-install
Categories=System;
DESKTOP_EOF
    chmod +x "${DESKTOP_FILE}"

    echo -e "${GREEN}✓${NC} DEB package created: ${DEB_OUTPUT}"
    echo -e "${GREEN}✓${NC} Instalador gráfico: ${INSTALLER_SH}"
}

gen_arch_installer() {
    local ZST_NAME="${PKG_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
    local INST="${DIST_DIR}/instalar-${EDITION}-arch.sh"
    cat > "${INST}" << ARCH_INST_HEAD
#!/usr/bin/env bash
# Instalador do Helper Node (edição: ${EDITION}, formato: Arch/pacman).
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
ZST="\$SCRIPT_DIR/${ZST_NAME}"
ARCH_INST_HEAD
    cat >> "${INST}" << 'ARCH_INST_EOF'
# Se executado via duplo-clique na GUI (sem TTY), tenta abrir uma janela de terminal
if [ ! -t 0 ] && [ "${HELPER_NODE_GUI_RUN:-0}" != "1" ]; then
    export HELPER_NODE_GUI_RUN=1
    for term in cosmic-terminal gnome-terminal ptyxis x-terminal-emulator konsole xfce4-terminal alacritty kitty xterm; do
        if command -v "$term" >/dev/null 2>&1; then
            case "$term" in
                cosmic-terminal|gnome-terminal|ptyxis)
                    exec "$term" -- bash -c "exec \"$0\" \"$@\"" && exit 0
                    ;;
                konsole|xfce4-terminal|alacritty|kitty|xterm|x-terminal-emulator)
                    exec "$term" -e bash -c "exec \"$0\" \"$@\"" && exit 0
                    ;;
            esac
        fi
    done
fi

notify() { command -v notify-send >/dev/null 2>&1 && notify-send "Helper Node" "$1" 2>/dev/null || true; }

show_gui_dialog() {
    local msg_type="$1" title="$2" msg="$3"
    python3 -c "
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import Gtk
m = Gtk.MessageType.INFO if '$msg_type' == 'info' else Gtk.MessageType.ERROR
d = Gtk.MessageDialog(flags=0, message_type=m, buttons=Gtk.ButtonsType.OK, text='$title')
d.format_secondary_text('$msg')
d.run(); d.destroy()
" 2>/dev/null || true
}

if [ ! -f "$ZST" ]; then
    msg="ERRO: pacote não encontrado:\n$ZST"
    echo -e "$msg"
    notify "✗ Pacote Arch não encontrado"
    show_gui_dialog "error" "Helper Node — Erro" "$msg"
    [ -t 0 ] && read -rp "Pressione Enter para fechar..."; exit 1
fi

echo "=================================================="
echo "    Instalador do Helper Node (edição Arch)"
echo "=================================================="
echo ""
echo "Instalando: $(basename "$ZST")"
echo ""

if [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
    echo "(será pedida sua senha de sudo)"
    sudo bash -c "pacman -Rns --noconfirm helper-node helper-node-full helper-node-lite 2>/dev/null || true; pacman -U --noconfirm \"$ZST\""
    EXIT=$?
else
    notify "Instalando… digite sua senha de permissão."
    pkexec bash -c "pacman -Rns --noconfirm helper-node helper-node-full helper-node-lite 2>/dev/null || true; pacman -U --noconfirm \"$ZST\""
    EXIT=$?
fi

echo ""
if [ "$EXIT" -eq 0 ]; then
    echo "✓ Helper Node instalado com sucesso!"
    echo "  Procure 'Helper Node' no menu de aplicativos ou rode: helper-node"
    notify "✓ Instalado! Procure 'Helper Node' no menu."
    show_gui_dialog "info" "Helper Node" "✓ Instalado com sucesso!\n\nProcure por 'Helper Node' no seu menu de aplicativos ou execute: helper-node"
else
    echo "✗ Falha na instalação (código de erro: $EXIT)"
    echo "  Para ver detalhes, execute no terminal:"
    echo "  sudo pacman -U \"$ZST\""
    notify "✗ Falha na instalação (código $EXIT)."
    show_gui_dialog "error" "Helper Node — Erro" "✗ Falha ao instalar o pacote (código $EXIT).\n\nTente instalar manualmente abrindo o terminal e digitando:\nsudo pacman -U \"$ZST\""
fi

if [ -t 0 ]; then
    echo ""
    read -rp "Pressione Enter para fechar..."
fi
ARCH_INST_EOF
    chmod +x "${INST}"

    local DSK="${DIST_DIR}/Instalar Helper Node (${EDITION}-arch).desktop"
    cat > "${DSK}" << ARCH_DESKTOP_EOF
[Desktop Entry]
Version=1.0
Name=Instalar Helper Node (${EDITION} · arch)
Comment=Instala o Helper Node (edição ${EDITION}, .pkg.tar.zst) no sistema
Exec=bash -c 'DIR="\$(dirname "\$(echo "\$1" | sed "s|^file://||")")"; [ -d "\$DIR" ] && cd "\$DIR"; exec bash ./$(basename "${INST}")' _ %k
Terminal=false
Type=Application
Icon=system-software-install
Categories=System;
ARCH_DESKTOP_EOF
    chmod +x "${DSK}"
    echo -e "${GREEN}✓${NC} Instalador gráfico: ${INST}"
}

# Function to build Arch package
build_arch() {
    echo ""
    echo -e "${GREEN}═══════════════════════════════════${NC}"
    echo -e "${GREEN}  Building Arch Package${NC}"
    echo -e "${GREEN}═══════════════════════════════════${NC}"
    
    ARCH_BUILD="${DIST_DIR}/arch-build"
    
    # Create build directory
    echo -e "${YELLOW}→${NC} Creating Arch build directory..."
    mkdir -p "${ARCH_BUILD}"
    
    # Create tarball
    echo -e "${YELLOW}→${NC} Creating source tarball..."
    TARBALL="${ARCH_BUILD}/helper-node-${VERSION}.tar.gz"
    # Modelos locais (whisper/vosk) só na edição full
    LOCAL_AI_FILES=""
    if [ "$EDITION" != "lite" ]; then
        LOCAL_AI_FILES="whisper/ vosk-model/ vosk-stream.py vosk-vocab.json"
    fi
    tar czf "${TARBALL}" \
        --exclude='node_modules' \
        --exclude='build' \
        --exclude='dist' \
        --exclude='.git' \
        --exclude='.idea' \
        --exclude='*.png' \
        --transform "s,^,helper-node/," \
        main.js index.html config.html config.js preload.js editorController.js preferences.html preferences.js \
        assets/ os-integration/ services/ \
        ${LOCAL_AI_FILES} package.json *.traineddata \
        helper-node.sh helper-node.desktop setup-hotkey.sh \
        README.markdown ROADMAP.md 2>/dev/null || true

    # Gera o PKGBUILD por edição (nome, depends, edition.json). Lite não usa python/vosk.
    if [ "$EDITION" != "lite" ]; then
        ARCH_DEPENDS="'curl' 'ffmpeg' 'nodejs' 'python' 'python-vosk' 'pipewire' 'pipewire-pulse' 'libpulse' 'xorg-xprop' 'wl-clipboard' 'gtk3' 'libnotify' 'nss' 'libxss' 'libxtst' 'xdg-utils' 'at-spi2-core' 'alsa-lib'"
    else
        ARCH_DEPENDS="'ffmpeg' 'nodejs' 'pipewire' 'pipewire-pulse' 'libpulse' 'xorg-xprop' 'wl-clipboard' 'gtk3' 'libnotify' 'nss' 'libxss' 'libxtst' 'xdg-utils' 'at-spi2-core' 'alsa-lib'"
    fi
    cat > "${ARCH_BUILD}/PKGBUILD" <<PKGBUILD_EOF
# Maintainer: Helper Node Team <support@helper-node.app>
pkgname=${PKG_NAME}
pkgver=${VERSION}
pkgrel=1
pkgdesc="Helper Node — copiloto IA stealth (edição ${EDITION})"
arch=('x86_64')
url="https://github.com/SoderJuliano/helper-node"
license=('MIT')
depends=(${ARCH_DEPENDS})
provides=('helper-node')
conflicts=('helper-node' '${APP_NAME}-${OTHER_EDITION}')
replaces=('helper-node' '${APP_NAME}-${OTHER_EDITION}')
source=("helper-node-${VERSION}.tar.gz")
sha256sums=('SKIP')

build() {
    cd "\${srcdir}/helper-node"
    npm install --production
    npm install electron --save-dev
}

package() {
    cd "\${srcdir}/helper-node"
    install -dm755 "\${pkgdir}/opt/helper-node"
    cp -r * "\${pkgdir}/opt/helper-node/"
    echo '{"edition":"${EDITION}"}' > "\${pkgdir}/opt/helper-node/edition.json"
    rm -rf "\${pkgdir}/opt/helper-node/build" "\${pkgdir}/opt/helper-node/dist" "\${pkgdir}/opt/helper-node/.git" 2>/dev/null || true
    chmod +x "\${pkgdir}/opt/helper-node/helper-node.sh"
    chmod +x "\${pkgdir}/opt/helper-node/setup-hotkey.sh" 2>/dev/null || true
    chmod +x "\${pkgdir}/opt/helper-node/whisper/build/bin"/* 2>/dev/null || true
    install -Dm644 helper-node.desktop "\${pkgdir}/usr/share/applications/helper-node.desktop"
    if [ -f "assets/linux.png" ]; then
        install -Dm644 assets/linux.png "\${pkgdir}/usr/share/pixmaps/helper-node.png"
    fi
    install -dm755 "\${pkgdir}/usr/local/bin"
    ln -s /opt/helper-node/helper-node.sh "\${pkgdir}/usr/local/bin/helper-node"
}
PKGBUILD_EOF
    
    # Build package: nativo (makepkg) ou via container Arch (docker/podman).
    # Em distros nao-Arch (Pop/Ubuntu/Debian), cai automaticamente pro container.
    if command -v makepkg &> /dev/null; then
        echo -e "${YELLOW}→${NC} Building Arch package (makepkg nativo)..."
        cd "${ARCH_BUILD}"
        makepkg -f --nodeps
        cd "${PROJECT_ROOT}"
        # Apaga versões anteriores deste mesmo pacote antes de mover a nova (mesmo
        # motivo do DEB acima). Glob restrito a "-<digito>" pra não pegar o pacote
        # -debug do makepkg (helper-node-full-debug-...) junto com o principal.
        rm -f "${DIST_DIR}/${PKG_NAME}"-[0-9]*-x86_64.pkg.tar.zst
        mv "${ARCH_BUILD}/${PKG_NAME}"-[0-9]*-x86_64.pkg.tar.zst "${DIST_DIR}/" 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${PKG_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
        gen_arch_installer
    elif command -v docker &> /dev/null || command -v podman &> /dev/null; then
        CONTAINER_CMD="docker"
        command -v docker &> /dev/null || CONTAINER_CMD="podman"
        echo -e "${YELLOW}→${NC} makepkg ausente; usando container Arch via ${CONTAINER_CMD}..."
        # NOTA: o container instala base-devel + nodejs + npm + fakeroot,
        # cria um user nao-root (makepkg recusa rodar como root) e roda
        # makepkg -f --nodeps --skipchecksums. PKGBUILD ja faz npm install
        # dentro do container, entao gera tudo isolado da maquina host.
        ${CONTAINER_CMD} run --rm -v "${ARCH_BUILD}:/build" -w /build archlinux:latest bash -c '
            set -e
            pacman -Sy --noconfirm --needed base-devel nodejs npm fakeroot >/dev/null 2>&1
            id -u builder &>/dev/null || useradd -m builder
            chown -R builder:builder /build
            su builder -c "makepkg -f --nodeps --skipchecksums"
        '
        # Move pacote final pra dist/ e limpa TUDO desnecessario
        if ls "${ARCH_BUILD}"/${PKG_NAME}-${VERSION}-*-x86_64.pkg.tar.zst &>/dev/null; then
            # Apaga versões anteriores deste mesmo pacote antes de mover a nova.
            rm -f "${DIST_DIR}/${PKG_NAME}"-[0-9]*-x86_64.pkg.tar.zst
            mv "${ARCH_BUILD}"/${PKG_NAME}-${VERSION}-*-x86_64.pkg.tar.zst "${DIST_DIR}/"
            echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${PKG_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
            gen_arch_installer
            # Limpa pasta arch-build completamente (tarball, debug pkg, pkg/, src/, etc)
            rm -rf "${ARCH_BUILD}" 2>/dev/null || true
        else
            echo -e "${RED}✗${NC} container Arch terminou mas .pkg.tar.zst nao foi gerado"
            return 1
        fi
    else
        echo -e "${YELLOW}⚠${NC} makepkg/docker/podman nao encontrados — pacote Arch NAO gerado."
        echo -e "${YELLOW}→${NC} Tarball + PKGBUILD em ${ARCH_BUILD}/ pra build manual numa maquina Arch."
    fi
}

# Main build process
echo -e "${YELLOW}→${NC} Using isolated dependency install for packaging (local dev node_modules will not be modified)..."

# Edição: full (offline, modelos locais) ou lite (100% online, pacote pequeno)
build_one() {
    local fmt="$1"
    EDITION="${2:-full}"
    PKG_NAME="${APP_NAME}-${EDITION}"
    OTHER_EDITION="lite"; [ "$EDITION" == "lite" ] && OTHER_EDITION="full"
    echo -e "${GREEN}»»» Edição: ${EDITION} | Formato: ${fmt} | Pacote: ${PKG_NAME}${NC}"
    if [ "$fmt" == "deb" ]; then build_deb; else build_arch; fi
}

# Uso: package.sh deb [full|lite] | arch [full|lite] | all
case "$1" in
    deb)
        if [ -n "${2:-}" ]; then
            build_one deb "$2"
        else
            build_one deb full
            build_one deb lite
        fi
        ;;
    arch)
        if [ -n "${2:-}" ]; then
            build_one arch "$2"
        else
            build_one arch full
            build_one arch lite
        fi
        ;;
    all)
        build_one deb full
        build_one deb lite
        build_one arch full
        build_one arch lite
        ;;
    *)
        # padrão: gera full e lite para deb e arch
        build_one deb full
        build_one deb lite
        build_one arch full
        build_one arch lite
        ;;
esac

# Summary
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║         Build Complete! ✓              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Packages created in:${NC} ${DIST_DIR}/"
echo ""
ls -lh "${DIST_DIR}"/*.deb "${DIST_DIR}"/*.pkg.tar.zst 2>/dev/null | awk '{print "  • " $9 " (" $5 ")"}'
echo ""
echo -e "${GREEN}Installation:${NC} rode um dos instaladores abaixo (removem a versão antiga sozinhos)"
for f in "${DIST_DIR}"/instalar-*.sh; do
    [ -e "$f" ] && echo -e "  ${YELLOW}${f}${NC}"
done
echo ""
