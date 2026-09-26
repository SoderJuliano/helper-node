# Helper Node

[![Version](https://img.shields.io/badge/version-0.8.0-blue?style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)
[![Latest release](https://img.shields.io/github/v/release/SoderJuliano/helper-node?label=latest%20release&style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-36-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-333333?style=flat-square)](#instalacao-padrao)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#licenca)

<p align="center"><img src="assets/helper-node-img.jpg" width="800"></p>

Copiloto desktop stealth para produtividade, desenvolvimento, entrevistas e estudos: transcrição ao vivo, leitura visual de tela (OCR/Vision) e respostas instantâneas na tela com suporte ao Gemini Multimodal Live, Z.ai (GLM), OpenAI, Ollama local e CLIs nativos de desenvolvimento (Claude Code, Gemini CLI e GitHub Copilot).

> **Aviso de Acesso:** Esta versão do Helper Node é **100% gratuita por enquanto** durante a fase atual de disponibilização e testes. Aproveite todos os recursos liberados.

---

## Instalacao Padrao

Para instalar o Helper Node rapidamente no seu sistema operacional, baixe o pacote ou instalador oficial direto na pagina de **[Releases no GitHub](https://github.com/SoderJuliano/helper-node/releases/latest)** ou utilize os comandos de instalacao rapida via terminal:

### Windows (PowerShell)

Execute no PowerShell (como usuario comum, sem necessidade de privilegios de Administrador):

```powershell
irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows.ps1 | iex
```

*Requisitos:* [Node.js](https://nodejs.org) 18+ instalado. O instalador configura o binario oficial do Electron, registra os atalhos na Area de Trabalho e Menu Iniciar e adiciona o comando `helper-node` ao seu PATH.

### Linux — Debian, Ubuntu, Pop!_OS, Mint

```bash
curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-debian.sh | bash
```

### Linux — Arch, Manjaro, EndeavourOS, CachyOS

```bash
curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-arch.sh | bash
```

*Nota:* Os instaladores Linux solicitam `sudo` apenas uma vez no inicio para instalar bibliotecas basicas de sistema (Electron runtime, áudio PipeWire/ALSA e ferramentas de captura de tela). Para ignorar a instalacao de pacotes de sistema, passe `HELPER_SKIP_DEPS=1`.

---

## Gerar Pacote Linux para Instalacao Local

Caso voce prefira compilar e gerar os pacotes de distribuicao localmente na sua propria maquina (`.deb` ou `.pkg.tar.zst` para Arch):

```bash
# 1. Clone o repositorio
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node

# 2. Gerar pacote Debian / Ubuntu (.deb):
./package.sh deb

# Instalar o .deb gerado em dist/:
sudo dpkg -i dist/helper-node*.deb

# 3. Gerar pacote Arch Linux (.pkg.tar.zst):
./package.sh arch

# Instalar o pacote Arch gerado em dist/:
sudo pacman -U dist/helper-node*.pkg.tar.zst

# 4. Gerar ambos os formatos de pacote:
./package.sh all
```

---

## Atualizacao e Desinstalacao

### Atualizar

Basta rodar novamente o mesmo comando do instalador (PowerShell no Windows ou `curl | bash` no Linux). Ele atualiza o repositorio e as dependencias mantendo intactas todas as suas configuracoes, historicos e chaves de API.

### Desinstalar

O Helper Node nao espalha arquivos no sistema:

```bash
# Linux
rm -rf ~/.local/share/helper-node ~/.local/bin/helper-node ~/.local/share/applications/helper-node.desktop
rm -rf ~/.config/meu-electron-app ~/.config/helper-node
```

```powershell
# Windows
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\helper-node"
Remove-Item -Recurse -Force "$env:APPDATA\meu-electron-app"
Remove-Item "$([Environment]::GetFolderPath('Desktop'))\Helper Node.lnk"
```

---

## Recursos e Capacidades

O Helper Node e um copiloto de produtividade e desenvolvimento desktop que conecta seu ambiente de trabalho as mais avancadas tecnologias de inteligencia artificial:

- **Ditado Inteligente e Transcricao Universal (`Ctrl+D`):** Suporte nativo ao Google Gemini Free Tier (`gemini-2.0-flash`), OpenAI Whisper, Whisper local e preparacao nativa macOS Speech. Ditado por voz rapido com fallback inteligente entre provedores e sem consumo obrigatorio de creditos pagos.
- **IA Multimodal e Voz em Tempo Real:** Conversacao full-duplex de baixa latencia com o Google Gemini Live e visualizacao reativa com o motor 3D Raphael Core.
- **Integracao Direta com CLIs de Desenvolvimento:** Comunica-se diretamente com os CLIs instalados no seu sistema (Gemini CLI / Antigravity, Claude Code, GitHub Copilot CLI e Ollama local), reaproveitando tokens e credenciais existentes sem configuracoes redundantes.
- **Leitura Visual de Tela e Captura Contextual:** Suporte a captura automatica de tela e analise visual com suporte em Wayland (KDE Plasma 6 Spectacle, GNOME, COSMIC, Hyprland), Windows e macOS. Fila de capturas em lote (`Alt+S`) para consolidar multiplos prints em uma unica consulta.
- **Persistencia de Rascunhos:** Protecao contra perda de texto digitado no prompt ao cancelar com Esc, com recuperacao imediata atraves da tecla Up.

---

## Nexa AI e Raphael Core

A assistente virtual **Nexa** e acompanhada pelo motor tridimensional **Raphael Core**. Inspirado no computador supremo *Raphael / Lord of Wisdom (Ciel)* de *Tensura*, o Raphael Core projeta uma esfera de plasma e energia cosmica circundada por tres aureolas orbitais tridimensionais que reagem dinamicamente ao ambiente, as tarefas e a voz da IA.

### Tabela de Cores e Estados da Alma da Nexa

Cada estado ou acao cognitiva da Nexa transforma o comportamento visual, a rotacao das aureolas e o tom do nucleo:

| Estado | Cor Predominante | Significado e Comportamento Visual |
| :--- | :--- | :--- |
| **IDLE** | Ciano Etereo e Indigo (`#00f0ff` / `#4a00e0`) | **Vigilancia e Standby:** Pulsacao cosmica serena com aneis girando em baixa velocidade nos eixos 3D. |
| **LISTENING** | Ambar Solar e Ouro (`#ffb700` / `#ffe600`) | **Captacao de Microfone:** Aneis se alinham como lente receptora acustica focada na voz. |
| **THINKING** | Violeta Quantico e Magenta (`#9d00ff` / `#ff007f`) | **Processamento e Raciocinio:** Rotacao giroscopica acelerada nos eixos X/Y/Z com ondas de choque. |
| **SPEAKING** | Teal Luminescente e Ciano (`#00e5ff` / `#0077fe`) | **Ressonancia Vocal (Voice Sync):** O nucleo vibra e pulsa em sincronia direta com o espectro de frequencias da voz em tempo real (FFT). |
| **WORKING** | Esmeralda Matrix (`#00ff88` / `#05ffa1`) | **Leitura e Edicao de Codigo:** Fluxo de particulas e aneis computacionais em processamento. |
| **SEARCHING** | Azul Safira e Oceanico (`#0051ff` / `#00c8ff`) | **Pesquisa e Internet:** Aureolas expandidas criando malha esferica interconectada. |
| **SLEEPING** | Azul Meia-Noite e Estelar (`#1e293b` / `#3b82f6`) | **Hibernacao:** Brilho atenuado com pulso estelar lento apos periodo de inatividade. |

### Sincronizacao Espectral em Tempo Real (Voice Sync)

O motor **Raphael Core** conecta-se a saida de audio e streaming de voz da **Gemini Multimodal Live API** atraves da Web Audio API:
- **Graves (20Hz a 250Hz):** Modulam o diametro e a pulsacao da esfera central.
- **Medios (250Hz a 2500Hz):** Aceleram os aneis e modulam a velocidade de rotacao giroscopica.
- **Agudos (2500Hz a 8000Hz):** Disparam cintilacoes e faiscas de particulas nos momentos sibilantes da fala.

---

## Atalhos de Teclado Globais

| Atalho | Acao | Detalhes |
|---|---|---|
| `Ctrl+D` | Iniciar / Parar Gravacao ou Ditado | Processamento de fala por IA via Google Gemini Free Tier ou OpenAI |
| `Ctrl+I` | Janela de Entrada Manual | Caixa flutuante discreta para perguntas rapidas por texto |
| `Ctrl+A` | Focar na Janela Principal | Traz a janela do Helper Node para primeiro plano |
| `Ctrl+Shift+S` | Captura Direta de Tela (Auto Print) | Captura a tela atual sem selecao e envia diretamente para analise da IA |
| `Alt+S` | Coletor de Capturas em Lote | Abre ou fecha o coletor de multiplos prints sequenciais para analise conjunta |
| `Ctrl+Shift+C` | Abrir Configuracoes | Painel principal de controles, toggles e APIs & Provedores |
| `Ctrl+Shift+X` | Captura com Selecao de Regiao | Permite selecionar interativamente uma regiao da tela para analise |
| `Ctrl+Shift+1` / `Ctrl+Shift+2` | Mover de Display | Move o overlay para o monitor 1 ou 2 |

---

## Onde os Dados Ficam Salvos

Todas as configuracoes, tokens e historicos sao armazenados exclusivamente no diretorio de dados do usuario (fora da pasta do executavel), garantindo persistencia entre atualizacoes:

- **Linux:** `~/.config/meu-electron-app/` e `~/.config/helper-node/`
- **Windows:** `%APPDATA%\meu-electron-app\` e `~/.config/helper-node\`

Arquivos principais:
- `config.json`: Chaves de API, configuracoes de modelo e parametros do usuario.
- `history/`: Historico de conversas persistidas por sessao.
- `knowledge/answers.json`: Banco de respostas frequentes (Answer Bank com RAG local).

---

## Execucao a Partir do Codigo-Fonte

```bash
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node
npm install
npm start
```

---

## Documentacao Tecnica

| Documento | Descricao |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Arquitetura modular, fluxo de eventos e servicos |
| [`docs/architecture/RAPHAEL_CORE_DESIGN_DECISIONS.md`](docs/architecture/RAPHAEL_CORE_DESIGN_DECISIONS.md) | Motor 3D da alma da Nexa, shaders e Web Audio API |
| [`docs/MACOS_SPEECH_ROADMAP.md`](docs/MACOS_SPEECH_ROADMAP.md) | Arquitetura e roadmap para reconhecimento de voz nativo macOS on-device |
| [`TRANSLATION_ASSISTANT.md`](TRANSLATION_ASSISTANT.md) | Assistente de traducao e resposta em entrevistas |
| [`WINDOWS-PORT.md`](WINDOWS-PORT.md) | Especificidades e detalhes tecnicos da versao Windows |
| [`ROADMAP.md`](ROADMAP.md) | Planejamento e proximos passos |

---

## Contribuicao

Contribuicoes sao bem-vindas. Antes de submeter alteracoes:
1. Nao utilize emojis em nenhuma parte do codigo, documentacao ou interface (regra global obrigatoria do projeto).
2. Execute `npm run check` para validar integridade de arquivos, imports e diretivas.
3. Utilize mensagens de commit no padrao convencional (`feat:`, `fix:`, `refactor:`, `docs:`, `ui:`).

---

## Licenca

Distribuido sob a licenca [MIT](LICENSE).

