# Como Publicar no AUR (Arch User Repository)

## Pré-requisitos
- Conta no AUR: https://aur.archlinux.org/register/
- Chaves SSH configuradas

## Passo a Passo

### 1. Primeiro Release no GitHub
```bash
# Fazer release no GitHub primeiro (v0.0.1)
# Upload do arquivo: helper-node_0.0.1_amd64.deb
```

### 2. Calcular SHA256
```bash
# Baixar o tarball do GitHub
wget https://github.com/SEU-USUARIO/helper-node/archive/refs/tags/v0.0.1.tar.gz

# Calcular hash
sha256sum v0.0.1.tar.gz

# Copiar o hash e colocar no PKGBUILD (substituir 'SKIP')
```

### 3. Testar o PKGBUILD localmente
```bash
cd build/arch/
makepkg -si  # Testa e instala
```

### 4. Criar repositório AUR
```bash
# Clone o repo AUR (vazio inicialmente)
git clone ssh://aur@aur.archlinux.org/helper-node.git aur-helper-node
cd aur-helper-node

# Copiar arquivos necessários
cp ../../build/arch/PKGBUILD .
cp ../../README.markdown .  # Opcional

# Gerar .SRCINFO
makepkg --printsrcinfo > .SRCINFO

# Commit e push
git add PKGBUILD .SRCINFO README.markdown
git commit -m "Initial upload: helper-node v0.0.1 (pre-release)"
git push
```

### 5. Atualizar URL no PKGBUILD
No arquivo `build/arch/PKGBUILD`, linha 7:
```bash
url="https://github.com/SEU-USUARIO/helper-node"  # Substituir SEU-USUARIO
```

## Instalação pelos Usuários

Depois de publicado no AUR, usuários podem instalar com:

```bash
# Usando yay
yay -S helper-node

# Usando paru
paru -S helper-node

# Manualmente
git clone https://aur.archlinux.org/helper-node.git
cd helper-node
makepkg -si
```

## Atualizações Futuras

```bash
# 1. Fazer novo release no GitHub (v0.0.2)
# 2. Atualizar PKGBUILD:
#    - pkgver=0.0.2
#    - Atualizar sha256sums
# 3. Gerar novo .SRCINFO
# 4. Commit e push no repo AUR
```

## Links Úteis
- AUR Guidelines: https://wiki.archlinux.org/title/AUR_submission_guidelines
- AUR Helper: https://wiki.archlinux.org/title/AUR_helpers
