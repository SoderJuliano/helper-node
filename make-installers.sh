#!/usr/bin/env bash
# Gera UM instalador gráfico por pacote presente em dist/ (sem rebuildar nada).
#   dist/helper-node-<ed>_<ver>_amd64.deb        -> instalar-<ed>-deb.sh   (apt)
#   dist/helper-node-<ed>-<ver>-1-x86_64.pkg.tar.zst -> instalar-<ed>-arch.sh (pacman)
# Cada instalador REMOVE qualquer edição anterior antes de instalar a nova.
# Mesma lógica embutida em package.sh; este script serve pra (re)gerar os
# instaladores de pacotes já construídos.
set -euo pipefail

GREEN="\033[0;32m"; YELLOW="\033[1;33m"; NC="\033[0m"
DIST_DIR="$(cd "$(dirname "$0")" && pwd)/dist"

[ -d "$DIST_DIR" ] || { echo "dist/ não existe. Rode ./package.sh primeiro."; exit 1; }

# Limpa o instalador genérico antigo (que o build 'all' sobrescrevia).
rm -f "$DIST_DIR/instalar.sh" "$DIST_DIR/Instalar Helper Node.desktop" 2>/dev/null || true

gen_desktop() {
    # $1 = caminho do .sh   $2 = rótulo (ex.: "lite · deb")   $3 = formato (deb/arch)
    local sh="$1" label="$2" fmt="$3"
    local dsk="$DIST_DIR/Instalar Helper Node (${label// · /-}).desktop"
    cat > "$dsk" <<DESKTOP_EOF
[Desktop Entry]
Version=1.0
Name=Instalar Helper Node (${label})
Comment=Instala o Helper Node (${label}) no sistema
Exec=bash -c 'p="%k"; p="\${p#file://}"; d="\$(dirname "\$p")"; [ -d "\$d" ] && cd "\$d"; exec bash ./$(basename "$sh")'
Terminal=true
Type=Application
Icon=system-software-install
Categories=System;
DESKTOP_EOF
    chmod +x "$dsk"
}

gen_deb() {
    local deb_file ed sh
    deb_file="$(basename "$1")"
    ed="$(sed -E 's/^helper-node-([a-z]+)_.*/\1/' <<<"$deb_file")"
    sh="$DIST_DIR/instalar-${ed}-deb.sh"
    cat > "$sh" <<DEB_HEAD
#!/usr/bin/env bash
# Instalador do Helper Node (edição: ${ed}, formato: deb). Remove edição anterior e instala.
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
PKG="\$SCRIPT_DIR/${deb_file}"
DEB_HEAD
    cat >> "$sh" <<'DEB_BODY'
notify() { command -v notify-send >/dev/null 2>&1 && notify-send "Helper Node" "$1" 2>/dev/null || true; }
[ -f "$PKG" ] || { echo "ERRO: pacote não encontrado: $PKG"; notify "✗ .deb não encontrado"; [ -t 0 ] && read -rp "Pressione Enter..."; exit 1; }
if [ -t 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; echo "(será pedida sua senha de sudo)"; else SUDO="pkexec"; fi
notify "Instalando… confirme a senha se aparecer."
echo "Removendo versão anterior (se houver)..."
$SUDO apt-get remove -y helper-node helper-node-full helper-node-lite 2>/dev/null
echo "Instalando $(basename "$PKG")..."
$SUDO apt-get install -y "$PKG"; EXIT=$?
echo ""
if [ "$EXIT" -eq 0 ]; then echo "✓ Instalado! Execute: helper-node"; notify "✓ Instalado! Rode: helper-node";
else echo "✗ Falhou (código $EXIT). Tente: sudo apt install \"$PKG\""; notify "✗ Falhou (código $EXIT)"; fi
[ -t 0 ] && read -rp "Pressione Enter..."
DEB_BODY
    chmod +x "$sh"
    gen_desktop "$sh" "${ed} · deb" deb
    echo -e "${GREEN}✓${NC} $sh"
}

gen_arch() {
    local zst_file ed sh
    zst_file="$(basename "$1")"
    ed="$(sed -E 's/^helper-node-([a-z]+)-.*/\1/' <<<"$zst_file")"
    sh="$DIST_DIR/instalar-${ed}-arch.sh"
    cat > "$sh" <<ARCH_HEAD
#!/usr/bin/env bash
# Instalador do Helper Node (edição: ${ed}, formato: Arch/pacman). Remove edição anterior e instala.
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
PKG="\$SCRIPT_DIR/${zst_file}"
ARCH_HEAD
    cat >> "$sh" <<'ARCH_BODY'
notify() { command -v notify-send >/dev/null 2>&1 && notify-send "Helper Node" "$1" 2>/dev/null || true; }
[ -f "$PKG" ] || { echo "ERRO: pacote não encontrado: $PKG"; notify "✗ .pkg.tar.zst não encontrado"; [ -t 0 ] && read -rp "Pressione Enter..."; exit 1; }
if [ -t 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; echo "(será pedida sua senha de sudo)"; else SUDO="pkexec"; fi
notify "Instalando… confirme a senha se aparecer."
echo "Removendo versão anterior (se houver)..."
$SUDO pacman -Rns --noconfirm helper-node helper-node-full helper-node-lite 2>/dev/null
echo "Instalando $(basename "$PKG")..."
$SUDO pacman -U --noconfirm "$PKG"; EXIT=$?
echo ""
if [ "$EXIT" -eq 0 ]; then echo "✓ Instalado! Execute: helper-node"; notify "✓ Instalado! Rode: helper-node";
else echo "✗ Falhou (código $EXIT). Tente: sudo pacman -U \"$PKG\""; notify "✗ Falhou (código $EXIT)"; fi
[ -t 0 ] && read -rp "Pressione Enter..."
ARCH_BODY
    chmod +x "$sh"
    gen_desktop "$sh" "${ed} · arch" arch
    echo -e "${GREEN}✓${NC} $sh"
}

found=0
for f in "$DIST_DIR"/helper-node-*_*_amd64.deb; do
    [ -e "$f" ] || continue; found=1; gen_deb "$f"
done
for f in "$DIST_DIR"/helper-node-*-*-x86_64.pkg.tar.zst; do
    [ -e "$f" ] || continue; found=1; gen_arch "$f"
done

if [ "$found" -eq 0 ]; then
    echo -e "${YELLOW}Nenhum pacote em dist/.${NC} Rode ./package.sh primeiro."
    exit 1
fi
echo -e "${GREEN}Instaladores gerados em${NC} $DIST_DIR/"
