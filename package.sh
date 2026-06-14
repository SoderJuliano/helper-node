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
VERSION="0.4.0"
BUILD_DIR="$(pwd)/build"
DIST_DIR="$(pwd)/dist"
PROJECT_ROOT="$(pwd)"
# (Removido APP_CONFIG_CANDIDATES — o build NÃO empacota config do usuário:
#  continha a API key e vazava nos pacotes. Cada user configura a própria chave.)

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Helper Node Package Builder v${VERSION}  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "main.js" ] || [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must be run from helper-node project root!${NC}"
    exit 1
fi

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
        rm -f "${DEB_OUTPUT}"
    
    # Create directory structure
    echo -e "${YELLOW}→${NC} Creating DEB directory structure..."
        rm -rf "${BUILD_DIR}/deb-root"
        mkdir -p "${APP_ROOT}"
    mkdir -p "${DEB_ROOT}/DEBIAN"
    
    # Copy application files
    echo -e "${YELLOW}→${NC} Copying application files..."
        cp -r main.js main_new_notification.js createOsNotificationWindow_fixed.js index.html config.html config.js preload.js "${APP_ROOT}/" 2>/dev/null || true
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

        if [ ! -x "${APP_ROOT}/node_modules/.bin/electron" ]; then
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
    cat > "${DIST_DIR}/instalar.sh" << INSTALLER_HEAD
#!/usr/bin/env bash
# Instalador do Helper Node (edição: ${EDITION}). Aponta para o .deb desta build,
# REMOVE qualquer edição anterior e instala — funciona mesmo reinstalando a mesma versão.
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
DEB="\$SCRIPT_DIR/$(basename "${DEB_OUTPUT}")"
INSTALLER_HEAD
    cat >> "${DIST_DIR}/instalar.sh" << 'INSTALLER_EOF'
# Em terminal usa sudo (PAM/tty, senha de login normal); sem terminal cai pro pkexec.
if [ ! -f "$DEB" ]; then
    echo "ERRO: arquivo .deb não encontrado: $DEB"
    read -rp "Pressione Enter..."; exit 1
fi

if [ -t 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"; echo "(será pedida sua senha de sudo)"
else
    SUDO="pkexec"
fi

echo "Removendo versão anterior (se houver)..."
# Remove qualquer edição (legado sem sufixo + full + lite) pra não coexistirem.
$SUDO apt-get remove -y helper-node helper-node-full helper-node-lite 2>/dev/null

echo "Instalando $(basename "$DEB")..."
$SUDO apt-get install -y "$DEB"; EXIT=$?

echo ""
if [ "$EXIT" -eq 0 ]; then
    echo "✓ Instalado! Execute: helper-node"
else
    echo "✗ Falhou (código $EXIT)"
    echo "  Tente manualmente:  sudo apt install \"$DEB\""
fi
[ -t 0 ] && read -rp "Pressione Enter..."
INSTALLER_EOF
    chmod +x "${DIST_DIR}/instalar.sh"

    cat > "${DIST_DIR}/Instalar Helper Node.desktop" << 'DESKTOP_EOF'
[Desktop Entry]
Version=1.0
Name=Instalar Helper Node
Comment=Instala o Helper Node no sistema
Exec=bash -c 'p="%k"; p="${p#file://}"; d="$(dirname "$p")"; [ -d "$d" ] && cd "$d"; exec bash ./instalar.sh'
Terminal=true
Type=Application
Icon=system-software-install
Categories=System;
DESKTOP_EOF
    chmod +x "${DIST_DIR}/Instalar Helper Node.desktop"

    echo -e "${GREEN}✓${NC} DEB package created: ${DEB_OUTPUT}"
    echo -e "${GREEN}✓${NC} Instalador gráfico: ${DIST_DIR}/instalar.sh"
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
        main.js index.html config.html config.js preload.js \
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
        mv "${ARCH_BUILD}"/*.pkg.tar.zst "${DIST_DIR}/" 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${PKG_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
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
            mv "${ARCH_BUILD}"/${PKG_NAME}-${VERSION}-*-x86_64.pkg.tar.zst "${DIST_DIR}/"
            echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${PKG_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
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
    deb)  build_one deb  "${2:-full}" ;;
    arch) build_one arch "${2:-full}" ;;
    all)
        build_one deb  full
        build_one deb  lite
        build_one arch full
        build_one arch lite ;;
    *)
        # padrão: full deb + full arch (compatível com o comportamento antigo)
        build_one deb  full
        build_one arch full ;;
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
echo -e "${GREEN}Installation:${NC}"
echo -e "  DEB:  ${YELLOW}sudo dpkg -i ${DIST_DIR}/${APP_NAME}_0.0.1_amd64.deb${NC}"
echo -e "  Arch: ${YELLOW}sudo pacman -U ${DIST_DIR}/${APP_NAME}-0.0.1-1-x86_64.pkg.tar.zst${NC}"
echo ""
