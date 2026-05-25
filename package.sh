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
VERSION="0.3.2"
BUILD_DIR="$(pwd)/build"
DIST_DIR="$(pwd)/dist"
PROJECT_ROOT="$(pwd)"
APP_CONFIG_CANDIDATES=(
    "$HOME/.config/meu-electron-app/config.json"
    "$HOME/.config/helper-node/config.json"
)

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Helper Node Package Builder v0.3.2    ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in the right directory
if [ ! -f "main.js" ] || [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must be run from helper-node project root!${NC}"
    exit 1
fi

# Clean previous builds
echo -e "${YELLOW}→${NC} Cleaning previous builds..."
rm -rf "$DIST_DIR"
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
    
        DEB_ROOT="${BUILD_DIR}/deb-root/${APP_NAME}_${VERSION}_amd64"
        APP_ROOT="${DEB_ROOT}/opt/helper-node"
        DEB_OUTPUT="${DIST_DIR}/${APP_NAME}_${VERSION}_amd64.deb"
    
    # Create directory structure
    echo -e "${YELLOW}→${NC} Creating DEB directory structure..."
        rm -rf "${BUILD_DIR}/deb-root"
        mkdir -p "${APP_ROOT}"
    mkdir -p "${DEB_ROOT}/DEBIAN"
    
    # Copy application files
    echo -e "${YELLOW}→${NC} Copying application files..."
        cp -r main.js main_new_notification.js createOsNotificationWindow_fixed.js index.html config.html config.js preload.js "${APP_ROOT}/" 2>/dev/null || true
        cp -r assets os-integration services vosk-model "${APP_ROOT}/"

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
        cp vosk-vocab.json "${APP_ROOT}/" 2>/dev/null || true
        cp package.json package-lock.json "${APP_ROOT}/" 2>/dev/null || true
        cp *.traineddata "${APP_ROOT}/" 2>/dev/null || true
        cp helper-node.sh helper-node.desktop setup-hotkey.sh capture-screenshot.sh install-deps.sh "${APP_ROOT}/" 2>/dev/null || true
        cp README.markdown ROADMAP.md "${APP_ROOT}/" 2>/dev/null || true

        # Bundle user's local app config (optional) as default config for first run
        for cfg in "${APP_CONFIG_CANDIDATES[@]}"; do
            if [ -f "$cfg" ]; then
                echo -e "${YELLOW}→${NC} Packing local config from: $cfg"
                cp "$cfg" "${APP_ROOT}/config-default.json"
                break
            fi
        done

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
    
    # Copy DEBIAN control files
    echo -e "${YELLOW}→${NC} Adding control files..."
    cp build/deb/DEBIAN/* "${DEB_ROOT}/DEBIAN/"
    chmod 755 "${DEB_ROOT}/DEBIAN/postinst"
    chmod 755 "${DEB_ROOT}/DEBIAN/preinst"
    chmod 755 "${DEB_ROOT}/DEBIAN/prerm"
    
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
    
    echo -e "${GREEN}✓${NC} DEB package created: ${DIST_DIR}/${APP_NAME}_${VERSION}_amd64.deb"
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
        whisper/ vosk-model/ vosk-stream.py vosk-vocab.json package.json *.traineddata \
        helper-node.sh helper-node.desktop setup-hotkey.sh \
        README.markdown ROADMAP.md 2>/dev/null || true
    
    # Copy PKGBUILD
    cp build/arch/PKGBUILD "${ARCH_BUILD}/"
    
    # Build package: nativo (makepkg) ou via container Arch (docker/podman).
    # Em distros nao-Arch (Pop/Ubuntu/Debian), cai automaticamente pro container.
    if command -v makepkg &> /dev/null; then
        echo -e "${YELLOW}→${NC} Building Arch package (makepkg nativo)..."
        cd "${ARCH_BUILD}"
        makepkg -f --nodeps
        cd "${PROJECT_ROOT}"
        mv "${ARCH_BUILD}"/*.pkg.tar.zst "${DIST_DIR}/" 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${APP_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
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
        # Move pacote final pra dist/ e limpa lixo (pkg/, src/, debug pkg)
        if ls "${ARCH_BUILD}"/helper-node-${VERSION}-*-x86_64.pkg.tar.zst &>/dev/null; then
            mv "${ARCH_BUILD}"/helper-node-${VERSION}-*-x86_64.pkg.tar.zst "${DIST_DIR}/"
            # debug package nao serve pra distribuicao
            rm -f "${ARCH_BUILD}"/helper-node-debug-*.pkg.tar.zst 2>/dev/null || true
            # pkg/ e src/ sao do makepkg; podem ter ownership de root via container
            rm -rf "${ARCH_BUILD}/pkg" "${ARCH_BUILD}/src" 2>/dev/null \
                || sudo rm -rf "${ARCH_BUILD}/pkg" "${ARCH_BUILD}/src" 2>/dev/null \
                || true
            echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${APP_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
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

# Build packages based on arguments
if [ "$1" == "deb" ]; then
    build_deb
elif [ "$1" == "arch" ]; then
    build_arch
else
    # Build both
    build_deb
    build_arch
fi

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
