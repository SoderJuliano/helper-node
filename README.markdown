# Helper Node

Helper Node is an Electron-based application that transcribes audio queries using Whisper and displays AI-generated responses in a user-friendly interface. Features include:

- 🎙️ **Voice Transcription** with Whisper (pre-compiled)
- 🤖 **AI Responses** powered by OpenAI/LLaMA
- 📸 **OCR from Screenshots** with Tesseract
- ⌨️ **Global Hotkeys** for seamless OS integration
- 🪟 **OS Integration Mode** with floating notifications
- 💻 **Syntax-highlighted code blocks** with copy buttons

## 📥 Download e Instalação

### 🐧 Ubuntu / Pop OS / Debian (.deb)

**Pacote DEB** - Para sistemas baseados em Debian:

```bash
# 1. Baixar o pacote
wget https://github.com/SoderJuliano/helper-node/releases/download/v0.0.1/helper-node_0.0.1_amd64.deb

# 2. Instalar
sudo dpkg -i helper-node_0.0.1_amd64.deb

# 3. Resolver dependências (se necessário)
sudo apt-get install -f

# 4. Executar
helper-node
# ou via menu de aplicações
```

### 🏔️ Arch Linux / Garuda / Manjaro (.pkg.tar.zst)

**Pacote Arch** - Totalmente independente (656MB com todas as dependências):

```bash
# 1. Baixar o pacote
wget https://github.com/SoderJuliano/helper-node/releases/download/v0.0.1/helper-node-0.0.1-1-x86_64.pkg.tar.zst

# 2. Instalar
sudo pacman -U helper-node-0.0.1-1-x86_64.pkg.tar.zst

# 3. Executar
helper-node
# ou via menu de aplicações
```

#### Via AUR (em breve)
```bash
# Quando publicado no AUR
yay -S helper-node
# ou
paru -S helper-node
```

### ✅ O que está incluído nos pacotes:
- 🎯 **Aplicação completa** com Electron
- 🤖 **Whisper.cpp** pré-compilado para transcrição
- 📄 **Tesseract** para OCR de imagens  
- ⚡ **Node.js modules** e todas as dependências
- 🔧 **Scripts de configuração** automática
- 🚀 **Hotkeys globais** configurados automaticamente

**✨ Primeira execução:** Os hotkeys globais serão configurados automaticamente!

## ⌨️ Atalhos Globais

Após a instalação, os seguintes atalhos estão disponíveis em todo o sistema:

- **Ctrl+D** - Iniciar/Parar gravação de áudio
- **Ctrl+I** - Abrir janela de entrada manual
- **Ctrl+A** - Focar janela do Helper Node
- **Ctrl+Shift+C** - Abrir configurações
- **Ctrl+Shift+X** - Capturar screenshot e analisar
- **Ctrl+Shift+1** - Mover para display 1
- **Ctrl+Shift+2** - Mover para display 2

## 🛠️ Instalação Manual (Desenvolvimento)

### Pré-requisitos

- **Node.js** (v18 ou superior)
- **FFmpeg** para processamento de áudio
- **curl** para requisições API

Instalação no **Arch/Garuda**:
```bash
sudo pacman -S nodejs npm ffmpeg curl
```

No **Pop OS/Ubuntu/Debian**:
```bash
sudo apt-get update
sudo apt-get install nodejs npm ffmpeg curl
```

### Configuração do Código Fonte

```bash
# Clonar repositório
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node

# Instalar dependências
npm install

# Executar
npm start
```

**Nota:** Os binários do Whisper e modelos já estão incluídos no repositório!

## ⚙️ Configuração

Abra as configurações com **Ctrl+Shift+C** para configurar:

- **Modelo de IA**: Escolha entre OpenAI, LLaMA ou backend customizado
- **Token OpenAI**: Adicione sua chave API para modelos OpenAI
- **Instrução de Prompt**: Personalize o comportamento da IA
- **Idioma**: Defina idioma de resposta (pt-br, en-us)
- **Modo Print**: Ative OCR automático de screenshots
- **Integração OS**: Ative modo de notificações flutuantes

## 🚀 Funcionalidades

### Transcrição de Voz
- Pressione **Ctrl+D** para iniciar/parar gravação
- Transcreve automaticamente com Whisper
- Envia para IA para respostas inteligentes

### OCR de Screenshots
- Pressione **Ctrl+Shift+X** para capturar e analisar tela
- Extração automática de texto com Tesseract
- IA explica código ou responde perguntas sobre a imagem

### Modo de Integração OS
- Notificações flutuantes para respostas
- Funciona sem focar a janela do app
- Perfeito para workflows Hyprland/GNOME/KDE

## 📦 Compilando Pacotes

Para compilar seus próprios pacotes do código fonte:

```bash
# Compilar pacotes DEB e Arch
./package.sh

# Compilar apenas DEB
./package.sh deb

# Compilar apenas Arch
./package.sh arch
```

Os pacotes serão criados no diretório `dist/`.

## 🤝 Contribuindo

Contribuições são bem-vindas! Por favor abra uma issue ou submeta um pull request.

## 🗺️ Roadmap de Desenvolvimento

Para detalhes sobre a arquitetura atual, planos futuros e estratégias de implementação de funcionalidades (como a configuração de hotkeys globais), consulte o arquivo [ROADMAP.md](ROADMAP.md).

## 📄 Licença

MIT License. See [LICENSE](LICENSE) for details.