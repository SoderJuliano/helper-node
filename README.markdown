# Helper Node

Assistente de voz com IA, transcrição offline e integração nativa com o sistema operacional. Aplicativo Electron para Linux.

## ✨ Funcionalidades

- 🎙️ **Transcrição de voz** com dois engines:
  - **Whisper.cpp** (modo Ctrl+D, batch) — modelo `medium` PT-BR/EN, alta qualidade
  - **Vosk** (modo realtime) — modelo grande FalaBrasil PT-BR (1.6GB), streaming ao vivo word-by-word
- 🤖 **Respostas de IA** — OpenAI (GPT-4.1-nano / GPT-4.1 / GPT-5.1), LLaMA local ou backend customizado
- 📸 **OCR de screenshots** com Tesseract (PT/EN)
- ⌨️ **Atalhos globais** integrados
- 🪟 **Modo OS Integration** com janelas flutuantes
- 🎧 **Modo Realtime Assistant** — escuta áudio do sistema (vídeos, lives, reuniões), transcreve ao vivo e gera comentários da IA por trecho
- 💻 **Code blocks** com syntax highlight e botão copiar
- 📚 **Histórico de sessões** persistente

---

## 📥 Instalação

### Ubuntu / Pop!_OS / Debian (.deb)

```bash
wget https://github.com/SoderJuliano/helper-node/releases/download/v0.1.0/helper-node_0.1.0_amd64.deb
sudo apt install ./helper-node_0.1.0_amd64.deb
helper-node
```

O `postinst` cria automaticamente um Python venv em `/opt/helper-node/venv` com Vosk instalado — **zero configuração manual**.

### Arch Linux / Manjaro / EndeavourOS

```bash
wget https://github.com/SoderJuliano/helper-node/releases/download/v0.1.0/helper-node-0.1.0-1-x86_64.pkg.tar.zst
sudo pacman -U helper-node-0.1.0-1-x86_64.pkg.tar.zst
helper-node
```

### O que está incluído nos pacotes

| Componente | Tamanho | Função |
|---|---|---|
| Electron + app | ~250MB | Runtime |
| Whisper.cpp + modelo `medium` | ~1.5GB | Transcrição batch (Ctrl+D) |
| Modelo Vosk PT-BR FalaBrasil | ~1.6GB | Transcrição streaming (realtime) |
| Tesseract data PT/EN | ~30MB | OCR |
| **Total .deb** | **~2GB** | Tudo offline |

---

## ⌨️ Atalhos globais

| Atalho | Ação |
|---|---|
| `Ctrl+D` | Iniciar/parar gravação (Whisper batch) |
| `Ctrl+I` | Janela de entrada manual |
| `Ctrl+A` | Focar janela do Helper Node |
| `Ctrl+Shift+C` | Configurações |
| `Ctrl+Shift+X` | Capturar screenshot e analisar (OCR) |
| `Ctrl+Shift+1/2` | Mover para display 1 / 2 |

---

## 🎧 Modo Realtime Assistant (Copiloto Stealth)

Escuta **microfone + áudio do sistema simultaneamente** (você + interlocutores em
Teams/Meet/Zoom/WhatsApp/YouTube) e age como **copiloto discreto** durante
conversas, reuniões e estudos.

**Pipeline híbrido Vosk-rápido + Whisper-lento:**

1. Captura `parec` em duas fontes (mic `@DEFAULT_SOURCE@` + `<sink>.monitor`)
2. Mixer PCM s16le 16kHz → stream para `vosk-stream.py` (transcrição instantânea)
3. **Bolha única por segmento** com atualização in-place
4. Segmento fecha em **5 s de silêncio** OU **25 s contínuos**
5. IA responde com base no Vosk → `🤖 resposta inicial`
6. Em background, `whisper-cli` (modelo `medium`) re-transcreve o WAV;
   se diferir, **reescreve a mesma bolha** + re-pergunta à IA → `🤖 resposta revisada`
7. Histórico é **editado in-place** (não duplica) via `historyService.replaceMessage`

**Comportamento da IA — modos automáticos:**

| Tipo de fala detectada | Resposta |
|------------------------|----------|
| Pergunta técnica (`como resolvo X?`, `qual a diferença...`) | Resposta direta com cálculo/código |
| Pergunta feita ao usuário (entrevista, reunião) | `💬 Sugestão:` resposta pronta para falar |
| Discussão técnica / decisão | Insight, trade-off, alternativa |
| Termo obscuro mencionado | Definição em 1 linha + relevância |
| Números/valores | Conversão/contexto |
| Conversa casual / ruído | `(trecho sem conteúdo relevante)` |

### 🥷 Modo Stealth (sem notificações do SO)

**Nenhuma notificação nativa do sistema é exibida** em momento algum — nem
"Gravando…", nem "Processando…", nem erros. Toda comunicação acontece somente
nas janelas próprias do app (que você posiciona/oculta como quiser).

Motivo: durante uma reunião ou ligação, ninguém olhando para sua tela deve
perceber que há uma IA ajudando.

> Implementação: a classe `Notification` do Electron é substituída por um stub
> no-op no topo de `main.js`. Veja o comentário "STEALTH MODE".

---

## 🛠️ Desenvolvimento

### Pré-requisitos

```bash
# Pop!_OS / Ubuntu / Debian
sudo apt install git nodejs npm make g++ curl ffmpeg cmake \
                 python3 python3-venv python3-pip \
                 pipewire pulseaudio-utils \
                 gnome-screenshot imagemagick

# Arch
sudo pacman -S git nodejs npm make gcc curl ffmpeg cmake \
               python python-pip pipewire pipewire-pulse libpulse \
               gnome-screenshot grim slurp imagemagick
```

### Setup

```bash
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node

# Instala TUDO (whisper.cpp, modelos, venv Python, Vosk, modelo PT-BR grande)
./install-deps.sh

# Para usar modelo Vosk pequeno (40MB, qualidade limitada):
VOSK_MODEL_SIZE=small ./install-deps.sh

# Roda
npm start
```

### Build dos pacotes

```bash
./package.sh         # gera .deb e .pkg.tar.zst
./package.sh deb     # só Debian
./package.sh arch    # só Arch
```

Output em `dist/`.

---

## ⚙️ Configuração

Acesse com `Ctrl+Shift+C`:

- **Modelo IA**: OpenAI / LLaMA / backend customizado
- **Modelo ChatGPT**: `gpt-4.1-nano` (padrão), `gpt-4.1`, `gpt-5.1`
- **Token OpenAI**: chave da API
- **Idioma**: pt-br / en-us
- **Modo Print**: OCR automático
- **Integração OS**: ativa atalhos globais e janelas flutuantes (sem notificações nativas — modo stealth sempre)

Config salvo em `~/.config/meu-electron-app/config.json`.

---

## 🏗️ Arquitetura

```
Electron (main.js)
├── Whisper batch (Ctrl+D)
│   └── ffmpeg → whisper-cli → texto
└── Realtime Assistant
    └── realtimeAssistantService
        └── voskStreamService
            ├── parec (PipeWire monitor)
            └── python3 vosk-stream.py
                └── Vosk + modelo PT-BR FB
```

---

## 🐛 Troubleshooting

**`ModuleNotFoundError: No module named 'vosk'`**
→ Venv não criado. Rode: `python3 -m venv venv && ./venv/bin/pip install vosk`

**`pw-record: failed to open /dev/stdout`**
→ Build antigo. Atualize para v0.1.0+ (agora usa `parec`).

**Sem transcrição quando toca áudio**
→ Verifique o monitor do sink: `pactl get-default-sink` e teste `parec --device=<sink>.monitor`.

**Atalhos não registram (Wayland/GNOME)**
→ Rode `./setup-hotkey.sh` ou configure manual em Settings → Keyboard.

---

## 📄 Licença

MIT — ver [LICENSE](LICENSE).
