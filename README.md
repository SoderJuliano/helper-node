# Helper Node

[![Language](https://img.shields.io/badge/JavaScript-Node.js-f7df1e?style=flat-square&logo=javascript&logoColor=black)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-36-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![Version](https://img.shields.io/badge/version-0.5.1-blue?style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)
[![Latest release](https://img.shields.io/github/v/release/SoderJuliano/helper-node?label=latest%20release&style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#license)
[![Platform](https://img.shields.io/badge/platform-Linux-333333?style=flat-square&logo=linux&logoColor=white)](#prerequisites)

<p align="center"><img src="assets/helper-node-img.jpg" width="800"></p>

A stealth AI copilot for Linux: live transcription, screen OCR, and on-screen answers during meetings, interviews, and study sessions, powered by your own API key.

## Overview

Helper Node is an Electron desktop assistant for Linux that listens to your microphone and your system audio at the same time, transcribes speech in real time, reads what is on your screen through OCR or vision models, and surfaces concise AI answers in discreet overlay windows. It is built for people who need a second brain during live conversations: interviews in another language, technical meetings, calls, and lectures. Every native operating-system notification is suppressed by design, so nobody watching a screen-share sees that an assistant is running. Transcription and answers run either fully online through OpenAI or fully offline through local Whisper.cpp and Vosk models plus a local Ollama or custom backend. You bring your own OpenAI key or your own local model; no credentials are bundled with the app.

## Features

<table>
  <thead>
    <tr><th>Category</th><th>Feature</th><th>Description</th></tr>
  </thead>
  <tbody>
    <tr>
      <td rowspan="3"><b>Transcription</b></td>
      <td>Whisper.cpp (batch)</td>
      <td>High-quality offline transcription on the <code>Ctrl+D</code> push-to-talk flow, using the <code>medium</code> PT-BR/EN model.</td>
    </tr>
    <tr>
      <td>Vosk (streaming)</td>
      <td>Live word-by-word transcription via <code>vosk-stream.py</code> with the large FalaBrasil PT-BR model.</td>
    </tr>
    <tr>
      <td>OpenAI transcription</td>
      <td>Cloud transcription with <code>gpt-4o-transcribe</code> for the online realtime path and the Lite edition.</td>
    </tr>
    <tr>
      <td rowspan="4"><b>AI providers</b></td>
      <td>OpenAI</td>
      <td>Chat, vision, and tool calling with <code>gpt-4.1-nano</code> (default), <code>gpt-4.1</code>, or <code>gpt-5.1</code>.</td>
    </tr>
    <tr>
      <td>Ollama / custom backend</td>
      <td>Local Ollama models or a remote backend over HTTP. No automatic fallback between providers: you choose, the agent honors it.</td>
    </tr>
    <tr>
      <td>Gemini CLI</td>
      <td>Google's <code>gemini</code> CLI as a persistent REPL session. Auth via <code>~/.gemini/</code> — no API key in the app. Streaming, tool activity, and thinking visible live.</td>
    </tr>
    <tr>
      <td>Claude Code CLI</td>
      <td>Anthropic's <code>claude</code> CLI in <code>--print --output-format stream-json</code> mode. Auth via <code>~/.claude/</code>. Thinking streamed in real time, file edits show diffs on click, session continuity via <code>--resume</code>.</td>
    </tr>
    <tr>
      <td rowspan="2"><b>Realtime copilot</b></td>
      <td>Realtime Assistant</td>
      <td>Listens to mic plus system audio, segments speech live, and answers per segment. Offline path corrects each Vosk bubble in place with a background Whisper pass.</td>
    </tr>
    <tr>
      <td>Jargon explainer</td>
      <td>Defines business and technical acronyms (IPO, M&amp;A, EBITDA) discreetly, without interrupting the answer flow.</td>
    </tr>
    <tr>
      <td><b>Translation</b></td>
      <td>Translation Assistant</td>
      <td>Translates the interviewer (system audio) and suggests a reply, while transcribing your own speech on screen without translating it. Includes a microphone selector; system audio follows the active sink automatically.</td>
    </tr>
    <tr>
      <td rowspan="2"><b>Vision &amp; OCR</b></td>
      <td>Tesseract OCR</td>
      <td>Local screenshot OCR (PT/EN) with bundled <code>eng</code> and <code>por</code> traineddata.</td>
    </tr>
    <tr>
      <td>GPT-4o vision</td>
      <td>Online image understanding for pasted or captured images via the integrated input.</td>
    </tr>
    <tr>
      <td rowspan="3"><b>Helper Tools (function calling)</b></td>
      <td>Read tools</td>
      <td><code>listDir</code>, <code>readFile</code>, <code>readFileChunk</code>, <code>searchInFiles</code>, <code>findFiles</code>, <code>fileInfo</code>, <code>listPackages</code>, <code>listDesktopApps</code>, <code>detectShellConfig</code>.</td>
    </tr>
    <tr>
      <td>Write tools</td>
      <td><code>writeFile</code>, <code>patchFile</code>, <code>appendToFile</code>, <code>deleteFile</code>, each with automatic backups and click confirmation.</td>
    </tr>
    <tr>
      <td>Execution tools</td>
      <td><code>runCommand</code> (whitelist), <code>runShellAdvanced</code> (confirmed shell with hard-deny patterns), <code>systemPowerAction</code>. Sandboxed to <code>$HOME</code> with a secret redactor and append-only audit log.</td>
    </tr>
    <tr>
      <td><b>Memory</b></td>
      <td>Answer Bank &amp; knowledge base</td>
      <td>RAG over your own conversations: stores well-scored answers and re-injects them as hints when a near-identical question reappears (cosine &ge; 0.85).</td>
    </tr>
    <tr>
      <td rowspan="3"><b>System integration</b></td>
      <td>Global hotkeys</td>
      <td>Hotkeys routed through an internal IPC server (port 3000), so they work outside app focus on Wayland and X11.</td>
    </tr>
    <tr>
      <td>Overlay windows</td>
      <td>Floating, positionable windows for recording, loading, responses, capture, and manual input in OS Integration mode.</td>
    </tr>
    <tr>
      <td>Stealth mode</td>
      <td>The Electron <code>Notification</code> class is replaced by a no-op stub: no native OS notification is ever shown.</td>
    </tr>
    <tr>
      <td><b>UX</b></td>
      <td>Streaming &amp; code blocks</td>
      <td>Token-by-token answer rendering, syntax-highlighted code blocks with copy buttons, and a persistent session history.</td>
    </tr>
  </tbody>
</table>

### Editions: Lite (online) vs Full (offline)

Helper Node ships in two mutually exclusive editions. They both run as `helper-node`; the active edition is recorded in `/opt/helper-node/edition.json` and read by `services/edition.js`.

<table>
  <thead>
    <tr><th></th><th>Lite (<code>helper-node-lite</code>)</th><th>Full (<code>helper-node-full</code>)</th></tr>
  </thead>
  <tbody>
    <tr><td><b>.deb size</b></td><td>~127 MB</td><td>~654 MB</td></tr>
    <tr><td><b>Transcription (Ctrl+D)</b></td><td>OpenAI cloud (<code>gpt-4o-mini-transcribe</code>)</td><td>Local Whisper.cpp</td></tr>
    <tr><td><b>Screen OCR</b></td><td><code>gpt-4o</code> vision (online)</td><td>Local Tesseract</td></tr>
    <tr><td><b>AI providers</b></td><td>OpenAI only</td><td>OpenAI + local Ollama + custom backend</td></tr>
    <tr><td><b>Works offline</b></td><td>No</td><td>Yes (local models)</td></tr>
    <tr><td><b>Requires OpenAI key</b></td><td>Yes</td><td>Optional</td></tr>
  </tbody>
</table>

## Installation

### Prerequisites

- **Operating system:** Linux. Tested on Pop!_OS / Ubuntu / Debian and Arch / Manjaro, on both Wayland and X11.
- **Node.js:** 18 or newer (Electron 36). The maintainer's environment uses Node 24.
- **Native dependencies:** `git`, `ffmpeg`, `cmake`, `make`, a C++ compiler, `python3` with `venv` and `pip`, PipeWire / PulseAudio utilities (`parec`, `pactl`), `x11-utils`, `gnome-screenshot`, and `imagemagick`. The Full edition additionally builds Whisper.cpp and downloads the Whisper and Vosk models.

```bash
# Pop!_OS / Ubuntu / Debian
sudo apt install git nodejs npm make g++ curl ffmpeg cmake \
                 python3 python3-venv python3-pip \
                 pipewire pipewire-utils pulseaudio-utils x11-utils \
                 gnome-screenshot imagemagick

# Arch / Manjaro
sudo pacman -S git nodejs npm make gcc curl ffmpeg cmake \
               python python-pip pipewire pipewire-pulse libpulse xorg-xprop \
               gnome-screenshot grim slurp imagemagick
```

### Quick Start

```bash
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node
```

```bash
# Installs everything: Whisper.cpp, models, Python venv, Vosk, and the PT-BR model.
# Use a smaller Vosk model (40 MB, lower quality) with VOSK_MODEL_SIZE=small.
./install-deps.sh
```

```bash
npm start
```

### Install from a release

Download the assets from the [latest release](https://github.com/SoderJuliano/helper-node/releases/latest). Each edition provides a `.deb` (Debian family) and a `.pkg.tar.zst` (Arch family), plus a graphical installer script.

```bash
# Debian / Ubuntu / Pop!_OS — Lite (recommended, ~127 MB, online):
sudo apt install ./helper-node-lite_0.4.2_amd64.deb

# OR Full (offline, ~654 MB, local Whisper/Vosk/Ollama):
sudo apt install ./helper-node-full_0.4.2_amd64.deb

helper-node
```

```bash
# Arch / Manjaro / EndeavourOS — Lite or Full:
sudo pacman -U helper-node-lite-0.4.2-1-x86_64.pkg.tar.zst
helper-node
```

The Debian `postinst` step builds a Python venv at `/opt/helper-node/venv` with Vosk installed from a wheel bundled inside the package, so installation stays offline and needs no manual setup.

> Do not install the `.deb` through the Pop!_OS cosmic-store. It has a known bug with large local `.deb` packages and hangs at "Installing (0%)". Install from a terminal or with the bundled installer script instead. The installer copies the package to `/tmp` first to work around an `_apt` read-permission limitation on home directories.

### Build & Package

```bash
./package.sh         # builds both .deb and .pkg.tar.zst
./package.sh deb     # Debian only
./package.sh arch    # Arch only
./make-installers.sh # generates the per-edition graphical installers
```

Artifacts are written to `dist/`.

## Usage

- **Push-to-talk (Whisper batch):** press `Ctrl+D` to start recording, press again to transcribe and answer. In OS Integration mode the answer appears in a transparent overlay in the top-right corner and closes itself after a few seconds.
- **Realtime Assistant:** when enabled in settings, `Ctrl+D` toggles continuous listening instead. With OpenAI selected (and always in Lite) the whole pipeline runs online. With a local backend or Ollama selected, transcription runs offline through Vosk with a Whisper correction pass, and the answer goes to the selected provider.
- **Translation Assistant:** translates the interviewer (system audio), suggests a reply, and shows your own speech transcribed but untranslated. Pick your microphone in Settings; system audio is captured automatically.
- **Helper Tools:** enable under Settings, "Advanced Tools". The AI then receives read, write, and execution tools through function calling and decides which to call.

### Keyboard shortcuts

| Shortcut | Action | Notes |
|---|---|---|
| `Ctrl+D` | Start / stop recording | Becomes start/stop for the Realtime Assistant when that mode is on |
| `Ctrl+I` | Manual input window | |
| `Ctrl+A` | Focus the Helper Node window | |
| `Ctrl+Shift+C` | Open Settings | |
| `Ctrl+Shift+X` | Capture a screenshot and analyze it | OCR (Full) or vision (Lite) |
| `Ctrl+Shift+1` / `Ctrl+Shift+2` | Move to display 1 / 2 | Moves to workspace 1 / 2 on Hyprland |

Global shortcuts are configured with `./setup-hotkey.sh`, which detects GNOME or Hyprland and registers the bindings (Wayland blocks Electron's own global shortcuts, so an IPC server handles them).

## Latest release

[![Latest release](https://img.shields.io/github/v/release/SoderJuliano/helper-node?label=latest%20release&style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)

**v0.4.2 — Issues fixes and local database to upgrade models.** See all releases at [github.com/SoderJuliano/helper-node/releases](https://github.com/SoderJuliano/helper-node/releases).

- **Streaming (OpenAI):** the translator and realtime assistant render answers token by token, lowering perceived latency.
- **Answer Bank (RAG over conversations):** stores well-scored answers in the background and re-injects them as hints when a near-identical question reappears, with a single shared embedding per query.
- **Realtime copilot:** discreet acronym and jargon explanations, multi-purpose recognition (interviews, meetings, videos), and no longer answers the user's own microphone in `both` mode.
- **Vision and packaging fixes:** image analysis routed to `gpt-4o`, overlay restricted to OS Integration mode, and per-edition installers.

## Configuration

Settings are reachable with `Ctrl+Shift+C` and persisted to `~/.config/meu-electron-app/config.json`.

| Setting | Description |
|---|---|
| AI provider | OpenAI, local Ollama, or custom backend |
| OpenAI model | `gpt-4.1-nano` (default), `gpt-4.1`, or `gpt-5.1` |
| OpenAI token | Your API key (never bundled; supplied per user) |
| Language | `pt-br` or `en-us` |
| OS Integration | Enables global hotkeys and floating overlay windows (stealth, no native notifications) |
| Translation Assistant | Name and background, target language, and microphone selector |
| Advanced Tools | Enables the Helper Tools function-calling module |

Additional state:

- **Edition flag:** `/opt/helper-node/edition.json`, read by `services/edition.js`.
- **Session history:** `~/.config/helper-node/history.json`.
- **Audit log:** `~/.config/helper-node/audit.log` records every Helper Tools invocation.
- **Answer Bank:** persisted to `<userData>/knowledge/answers.json`; configurable via `answerBank { enabled, minScore }`.

## Project structure

```text
helper-node/
├── main.js                     Electron main process: IPC handlers and windows
├── preload.js                  contextBridge bridge to the renderer
├── index.html / config.html    Main chat UI and Settings window
├── config.js                   Settings window logic
├── vosk-stream.py              Streams PCM audio to Vosk, emits JSON
├── package.sh                  Builds the .deb and .pkg.tar.zst
├── install-deps.sh             Installs Whisper.cpp, models, venv, and Vosk
├── setup-hotkey.sh             Registers global hotkeys (GNOME / Hyprland)
├── services/
│   ├── openAIService.js        OpenAI chat, vision, and tool-calling loop
│   ├── llamaService.js         Local Ollama provider
│   ├── backendService.js       HTTP server for global hotkeys (port 3000)
│   ├── realtimeOpenAiService.js   Online realtime path (OpenAI)
│   ├── realtimeAssistantService.js Offline realtime path (Vosk + Whisper)
│   ├── realtimeAudioCapture.js Audio engine for the online realtime path
│   ├── translationAssistant/   Interview translation assistant
│   ├── voskStreamService.js    Microphone to PCM to vosk-stream.py
│   ├── tesseractService.js     Screenshot OCR
│   ├── knowledgeBase.js        Embeddings and hybrid retrieval
│   ├── answerBank.js           RAG over past conversations
│   ├── workspace/              Attached-project context and summarization
│   ├── historyService.js       Persistent session history
│   ├── configService.js        Configuration read/write
│   └── helperTools/            Tool-calling module (read/write/exec tools)
├── os-integration/notifications/  Overlay window HTML
├── assets/                     Images and Lottie animations
└── resources/                  Compositor rules (Hyprland, KWin)
```

The `whisper/` directory is a cloned Whisper.cpp checkout and is not part of this project's source.

## Contributing

Contributions are welcome. The codebase and commit messages are written in Brazilian Portuguese; module logs are prefixed with tags such as `[realtime]` or `[helperTools]`. Use single-line commit messages with one of these prefixes: `fix:`, `feat:`, `release:`, `chore:`, `ui:`, `build:`. Do not modify the `whisper/` submodule, and do not bundle API keys or per-user configuration into packages or commits. Audio capture is sensitive: system audio must be captured with `parec --device=<sink>.monitor`, never `pw-record --target`.

## License

MIT.
