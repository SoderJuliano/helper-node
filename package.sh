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
VERSION="0.0.1"
BUILD_DIR="$(pwd)/build"
DIST_DIR="$(pwd)/dist"
PROJECT_ROOT="$(pwd)"
APP_CONFIG_CANDIDATES=(
    "$HOME/.config/meu-electron-app/config.json"
    "$HOME/.config/helper-node/config.json"
)

echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Helper Node Package Builder v0.0.1    ║${NC}"
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
        cp -r assets os-integration services whisper "${APP_ROOT}/"
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
                npm ci --include=dev --omit=optional
            else
                npm install --include=dev --omit=optional
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
        whisper/ package.json *.traineddata \
        helper-node.sh helper-node.desktop setup-hotkey.sh \
        README.markdown ROADMAP.md 2>/dev/null || true
    
    # Copy PKGBUILD
    cp build/arch/PKGBUILD "${ARCH_BUILD}/"
    
    # Build package (if on Arch-based system)
    if command -v makepkg &> /dev/null; then
        echo -e "${YELLOW}→${NC} Building Arch package..."
        cd "${ARCH_BUILD}"
        makepkg -f --nodeps
        cd "${PROJECT_ROOT}"
        
        # Move package to dist
        mv "${ARCH_BUILD}"/*.pkg.tar.zst "${DIST_DIR}/" 2>/dev/null || true
        
        echo -e "${GREEN}✓${NC} Arch package created: ${DIST_DIR}/${APP_NAME}-${VERSION}-1-x86_64.pkg.tar.zst"
    else
        echo -e "${YELLOW}⚠${NC} makepkg not found. PKGBUILD and tarball created for manual build."
        echo -e "${YELLOW}→${NC} Files in: ${ARCH_BUILD}/"
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
