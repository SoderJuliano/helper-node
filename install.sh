#!/usr/bin/env bash
# Helper Node — installer/reinstaller do .deb
# Detecta versao instalada e remove antes de instalar a nova.
# Uso:
#   sudo ./install.sh                 # usa o .deb mais novo em dist/
#   sudo ./install.sh /path/foo.deb   # usa um .deb especifico

set -e

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
NC="\033[0m"

if [[ $EUID -ne 0 ]]; then
    echo -e "${RED}Precisa de sudo.${NC} Rode: sudo ./install.sh"
    exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
DEB_PATH="${1:-}"

# Sem argumento: pega o .deb mais recente em dist/.
# Glob cobre os nomes reais: helper-node-lite_*, helper-node-full_* e o legado
# helper-node_* (sem sufixo). O antigo 'helper-node_*' NAO casava com -lite/-full
# e o script achava "nenhum .deb" mesmo com pacotes presentes.
if [[ -z "$DEB_PATH" ]]; then
    DEB_PATH=$(ls -t "$PROJECT_ROOT/dist"/helper-node*_amd64.deb 2>/dev/null | head -n1 || true)
    if [[ -z "$DEB_PATH" ]]; then
        echo -e "${RED}Nenhum .deb encontrado em dist/.${NC} Rode ./package.sh deb primeiro."
        exit 1
    fi
    echo -e "${YELLOW}i${NC} Varios .deb podem coexistir (lite/full). Passe um caminho pra escolher: sudo ./install.sh dist/helper-node-lite_${VERSION:-0.4.2}_amd64.deb"
fi

if [[ ! -f "$DEB_PATH" ]]; then
    echo -e "${RED}Arquivo nao encontrado:${NC} $DEB_PATH"
    exit 1
fi

echo -e "${GREEN}->${NC} Pacote alvo: $DEB_PATH"

# Se ja estiver instalado, remove primeiro (mantem configs do usuario em ~/.config)
if dpkg -l helper-node 2>/dev/null | grep -q "^ii"; then
    INSTALLED_VER=$(dpkg-query -W -f='${Version}' helper-node 2>/dev/null || echo "?")
    echo -e "${YELLOW}->${NC} helper-node ${INSTALLED_VER} ja instalado — removendo..."
    apt-get remove -y helper-node || dpkg --remove helper-node
fi

echo -e "${GREEN}->${NC} Instalando ${DEB_PATH}..."
apt-get install -y "$DEB_PATH"

echo -e "${GREEN}OK.${NC} Rode: helper-node"
