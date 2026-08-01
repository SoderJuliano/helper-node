# Helper Node

[![Version](https://img.shields.io/badge/version-0.6.0-blue?style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)
[![Latest release](https://img.shields.io/github/v/release/SoderJuliano/helper-node?label=latest%20release&style=flat-square)](https://github.com/SoderJuliano/helper-node/releases/latest)
[![Electron](https://img.shields.io/badge/Electron-36-47848f?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-333333?style=flat-square)](#install)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#license)

<p align="center"><img src="assets/helper-node-img.jpg" width="800"></p>

A stealth AI copilot: live transcription, screen OCR, and on-screen answers during
meetings, interviews, and study sessions — powered by your own API key or your own
local models. Native OS notifications are suppressed by design, so nothing shows up
in a screen share.

---

## Install

Every installer follows the same strategy: **nothing is compiled or repackaged**.
It clones the source, runs `npm install` (which pulls the *official* Electron
binary), and registers a `helper-node` command plus a desktop shortcut. Everything
lands in your user profile — no admin/root required for the app itself.

### Linux — Debian, Ubuntu, Pop!_OS, Mint

```bash
curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-debian.sh | bash
```

### Linux — Arch, Manjaro, EndeavourOS, Garuda, CachyOS

```bash
curl -fsSL https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-linux-arch.sh | bash
```

Both ask for `sudo` **once**, only to install system packages (Electron runtime
libs, `ffmpeg`, screenshot tools). Skip that with `HELPER_SKIP_DEPS=1`.

### Windows

```powershell
# Full — enables the Ollama / Claude CLI / Gemini CLI / Copilot CLI options:
irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows-full.ps1 | iex

# Lite — 100% online through OpenAI:
irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows-lite.ps1 | iex
```

Requires [Node.js](https://nodejs.org) 18+ and, ideally, `git` in `PATH` (falls back
to a `.zip` download). No admin rights needed.

> There is intentionally **no packaged `.exe`**. A compiled Electron Forge/Squirrel
> binary was flagged by Windows Defender as `Trojan:Win32/Cinjo.O!cl` — a behavioral
> false positive (global hotkeys + screen-capture evasion in a freshly built,
> unsigned, zero-reputation binary). The full story is in
> [`WINDOWS-PORT.md`](WINDOWS-PORT.md).

### Install options

The Linux scripts never prompt (`curl | bash` already occupies stdin), so options
are passed as environment variables:

| Variable | Default | Effect |
|---|---|---|
| `HELPER_EDITION` | `full` | `lite` hides the local-provider options in the UI |
| `HELPER_WHISPER` | *(off)* | `1` builds Whisper.cpp and downloads the models (~1.5 GB, Linux only) |
| `HELPER_SKIP_DEPS` | *(off)* | `1` skips system packages, so `sudo` is never asked |
| `HELPER_DIR` | `~/.local/share/helper-node` | Install location |

```bash
curl -fsSL .../install-linux-debian.sh | HELPER_EDITION=lite bash
```

On Windows the edition is chosen by picking the `-full` or `-lite` script.

### Updating

Re-run the exact same install command. It does a `git pull` and re-runs
`npm install` in place — your settings and history are untouched.

### Uninstalling

There is no uninstaller; removal is three paths (see
[Where things live](#where-things-live) for what each one holds):

```bash
# Linux
rm -rf ~/.local/share/helper-node ~/.local/bin/helper-node \
       ~/.local/share/applications/helper-node.desktop
rm -rf ~/.config/meu-electron-app ~/.config/helper-node   # also wipes your data
```

```powershell
# Windows
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\helper-node"
Remove-Item -Recurse -Force "$env:APPDATA\meu-electron-app"   # also wipes your data
Remove-Item "$([Environment]::GetFolderPath('Desktop'))\Helper Node.lnk"
```

On Windows the `bin` entry stays in your user `PATH` after the install dir is
deleted; remove it by hand from *Edit environment variables for your account* if it
bothers you.

---

## Getting started

1. **Launch it** — run `helper-node` in a terminal, or open it from your
   applications menu / Start Menu.
2. **Add your key** — press `Ctrl+Shift+C` to open Settings and paste your OpenAI
   API key. No credentials ship with the app; it is always your own key or your own
   local model.
3. **Pick a provider** — OpenAI, a local Ollama, a custom HTTP backend, or one of
   the CLI providers (Claude Code, Gemini, GitHub Copilot). There is no automatic
   fallback between providers: you choose, the agent honors it.
4. **Global hotkeys on Linux** — the installer runs `setup-hotkey.sh` on first
   launch, which detects GNOME or Hyprland and registers the bindings. Wayland
   blocks Electron's own global shortcuts, so an internal IPC server (port 3000)
   handles them. Re-run with `npm run fix-hotkeys` if they stop working.

### Modes

- **Push-to-talk / Dictation** — `Ctrl+D` starts recording, `Ctrl+D` again
  transcribes and answers. In OS Integration mode the answer appears in a
  transparent overlay; in Window/IDE mode the text lands in the input box.
- **Realtime Assistant** — when enabled in Settings, `Ctrl+D` toggles continuous
  listening instead. It listens to your microphone and system audio at once,
  segments speech live, and answers per segment.
- **Translation Assistant** — translates the other party (system audio) and
  suggests a reply, while showing your own speech transcribed but untranslated.
  See [`TRANSLATION_ASSISTANT.md`](TRANSLATION_ASSISTANT.md).
- **IDE mode** — attach a folder plus extra files and let a CLI provider read,
  write, and run commands in it.
- **Helper Tools** — enable under Settings → "Advanced Tools" to give the AI read,
  write, and execution tools through function calling.

### Keyboard shortcuts

| Shortcut | Action | Notes |
|---|---|---|
| `Ctrl+D` | Start / stop recording | Becomes start/stop for the Realtime Assistant when that mode is on |
| `Ctrl+I` | Manual input window | |
| `Ctrl+A` | Focus the Helper Node window | |
| `Ctrl+Shift+C` | Open Settings | |
| `Ctrl+Shift+X` | Capture a screenshot and analyze it | OCR (Full) or vision (Lite) |
| `Ctrl+Shift+1` / `Ctrl+Shift+2` | Move to display 1 / 2 | Moves to workspace 1 / 2 on Hyprland |

---

## Where things live

### The application

| | Linux | Windows |
|---|---|---|
| Source / install dir | `~/.local/share/helper-node` | `%LOCALAPPDATA%\helper-node` |
| Launcher command | `~/.local/bin/helper-node` | `<install dir>\bin\helper-node.cmd`, with that `bin` added to your user `PATH` |
| Menu shortcut | `~/.local/share/applications/helper-node.desktop` | Desktop + Start Menu shortcuts |
| Edition flag | `<install dir>/edition.json` | `<install dir>\edition.json` |

Deleting the install dir is safe — it holds no personal data, only the checkout and
`node_modules`.

### Your data

Everything personal lives in two directories, **outside** the install dir, so
updating or reinstalling never touches it.

**`<userData>`** — `~/.config/meu-electron-app/` on Linux,
`%APPDATA%\meu-electron-app\` on Windows,
`~/Library/Application Support/meu-electron-app/` on macOS:

| Path | Contents |
|---|---|
| `config.json` | All settings, **including your OpenAI API key** |
| `history/` | Persistent session history, one JSON file per session |
| `knowledge/index.json` | Knowledge-base embeddings |
| `knowledge/answers.json` | Answer Bank — RAG over your own past conversations |
| `claude-cli-models.json`, `copilot-cli-models.json` | Cached model lists probed from each CLI |
| `gemini-cli-sessions.json`, `*-cli-backups/` | CLI session state and pre-edit file backups |
| `temp_images/` | Scratch space for captured/pasted images |

**`~/.config/helper-node/`** (same path on every OS):

| Path | Contents |
|---|---|
| `audit.log` | Append-only record of every Helper Tools invocation |
| `workspace.json` | Attached project/folder context |
| `.setup-done` | Marker so hotkey setup only runs on first launch |

> `config.json` holds your API key in plain text. Back up that directory if you
> care about your history, and be careful about where you copy it.

---

## Features

| Area | What you get |
|---|---|
| **Transcription** | OpenAI streaming STT (`gpt-4o-transcribe`) with semantic turn detection for the realtime path; offline Whisper.cpp for push-to-talk in the Full edition on Linux |
| **AI providers** | OpenAI (`gpt-4.1-nano` → `gpt-5.6`), OpenAI Codex mode, local Ollama, custom HTTP backend, Claude Code CLI, Gemini CLI, GitHub Copilot CLI |
| **CLI providers** | Each runs the real binary and reuses its own auth (`~/.claude/`, `~/.gemini/`, Copilot's credential store) — no extra API key in the app. Model lists are probed from the binary at runtime, never hardcoded |
| **Realtime copilot** | Listens to mic + system audio, segments speech live, answers per segment, and explains business/technical jargon (IPO, M&A, EBITDA) without breaking the answer flow |
| **Translation** | Translates the other party and drafts a reply, with a microphone selector; system audio follows the active sink automatically |
| **Vision & OCR** | Local Tesseract screenshot OCR (PT/EN) in Full; `gpt-4o` vision in Lite and for pasted images |
| **Helper Tools** | Read (`listDir`, `readFile`, `searchInFiles`, …), write (`writeFile`, `patchFile`, … with automatic backups + click confirmation), and execution (`runCommand` whitelist, confirmed shell with hard-deny patterns). Sandboxed to `$HOME`, with a secret redactor and an append-only audit log |
| **Memory** | Answer Bank stores well-scored answers and re-injects them as hints when a near-identical question reappears (cosine ≥ 0.85) |
| **System integration** | Global hotkeys via an internal IPC server so they work unfocused on Wayland and X11; floating overlay windows; stealth mode replaces Electron's `Notification` with a no-op stub |

### Editions: Lite (online) vs Full (offline)

Both run as `helper-node`. The active edition is recorded in `edition.json` inside
the install dir and read by `services/edition.js`.

| | Lite | Full |
|---|---|---|
| Transcription (`Ctrl+D`) | OpenAI cloud | Local Whisper.cpp (Linux) |
| Screen OCR | `gpt-4o` vision (online) | Local Tesseract |
| AI providers | OpenAI only | OpenAI + Ollama + custom backend + CLI providers |
| Works offline | No | Yes, with local models |
| Requires an OpenAI key | Yes | Optional |

Local offline transcription is **not ported to Windows yet** — use an OpenAI model
there. See "Gaps conhecidos" in [`WINDOWS-PORT.md`](WINDOWS-PORT.md).

---

## Running from source

```bash
git clone https://github.com/SoderJuliano/helper-node.git
cd helper-node
npm install
npm start
```

`./install-deps.sh` additionally builds Whisper.cpp and downloads the Whisper
models (Linux, Full edition only).

## Building & packaging

Only needed if you want to produce distributable artifacts — the installers above
do not use them.

```bash
./package.sh         # builds both .deb and .pkg.tar.zst into dist/
./package.sh deb     # Debian only
./package.sh arch    # Arch only
./make-installers.sh # generates the per-edition graphical installers
./install.sh         # installs/reinstalls the newest .deb from dist/
```

The Arch `PKGBUILD` lives in [`build/arch/`](build/arch/); publishing to the AUR is
documented in [`AUR_PUBLISH_GUIDE.md`](AUR_PUBLISH_GUIDE.md).

## Project structure

```text
helper-node/
├── main.js / main/             Electron main process: IPC handlers and windows
├── preload.js                  contextBridge bridge to the renderer
├── index.html / renderer/      Main chat UI
├── config.html / config.js     Settings window
├── install-linux-debian.sh     One-line installer (apt)
├── install-linux-arch.sh       One-line installer (pacman)
├── install-windows-*.ps1       One-line installers (PowerShell)
├── helper-node.sh              Linux launcher (Flatpak, nvm and Electron resolution)
├── setup-hotkey.sh             Registers global hotkeys (GNOME / Hyprland)
├── install-deps.sh             Builds Whisper.cpp and downloads the models
├── package.sh                  Builds the .deb and .pkg.tar.zst
├── services/
│   ├── openAIService.js        OpenAI chat, vision, and tool-calling loop
│   ├── realtimeOpenAiService.js   Online realtime path (streaming STT)
│   ├── realtimeAssistantService.js Offline realtime path (local Whisper)
│   ├── realtimeAudioCapture.js Cross-platform audio engine
│   ├── techGlossary.js         Technical vocabulary injected into STT prompts
│   ├── providers/              Claude CLI, Gemini CLI, Copilot CLI
│   ├── translationAssistant/   Interview translation assistant
│   ├── workspace/              Attached-project context and summarization
│   ├── helperTools/            Tool-calling module (read/write/exec tools)
│   ├── knowledgeBase.js        Embeddings and hybrid retrieval
│   ├── answerBank.js           RAG over past conversations
│   └── configService.js        Configuration read/write
├── os-integration/notifications/  Overlay window HTML
├── build/arch/                 PKGBUILD and Arch packaging files
└── assets/ · resources/        Images, animations, compositor rules
```

`whisper/` is a cloned Whisper.cpp checkout and is not part of this project's source.

## Documentation

| File | Topic |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Module layout and data flow |
| [`ROADMAP.md`](ROADMAP.md) | Planned work |
| [`WINDOWS-PORT.md`](WINDOWS-PORT.md) | Windows port status and known gaps |
| [`TRANSLATION_ASSISTANT.md`](TRANSLATION_ASSISTANT.md) | Translation mode internals |
| [`COSMIC_SETUP.md`](COSMIC_SETUP.md) | Extra setup for the COSMIC desktop |
| [`AUR_PUBLISH_GUIDE.md`](AUR_PUBLISH_GUIDE.md) | Publishing to the AUR |

## Contributing

Contributions are welcome. The codebase and commit messages are written in
Brazilian Portuguese; module logs are prefixed with tags such as `[realtime]` or
`[helperTools]`. Use single-line commit messages prefixed with `fix:`, `feat:`,
`release:`, `chore:`, `ui:`, or `build:`.

Run `npm run check` before committing (file-size and structure lint), and
`npm run hooks:install` once to enable it as a pre-commit hook.

Do not modify the `whisper/` checkout, and never bundle API keys or per-user
configuration into packages or commits. Audio capture is sensitive: on Linux,
system audio must be captured with `parec --device=<sink>.monitor`, never
`pw-record --target`.

## License

MIT.
