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
    local sh_name="$(basename "$sh")"
    cat > "$dsk" <<DESKTOP_EOF
[Desktop Entry]
Version=1.0
Name=Instalar Helper Node (${label})
Comment=Instala o Helper Node (${label}) no sistema
Exec=bash -c 'DIR="\$(dirname "\$(echo "\$1" | sed "s|^file://||")")"; [ -d "\$DIR" ] && cd "\$DIR"; exec bash ./${sh_name}' _ %k
Terminal=false
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
# Instalador do Helper Node (edição: ${ed}, formato: deb).
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
DEB="\$SCRIPT_DIR/${deb_file}"
DEB_HEAD
    cat >> "$sh" <<'DEB_BODY'
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
# Instalador do Helper Node (edição: ${ed}, formato: Arch/pacman).
SCRIPT_DIR="\$(cd "\$(dirname "\$(readlink -f "\$0")")" && pwd)"
ZST="\$SCRIPT_DIR/${zst_file}"
ARCH_HEAD
    cat >> "$sh" <<'ARCH_BODY'
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
