# Porte Windows 11 (mantendo Linux KDE/COSMIC + macOS)

Branch: `feat/windows-port-stealth`

Objetivo: rodar no Windows 11 com `npm i && npm start`, com **stealth real**
(janela do helper nunca capturada em OBS/Zoom/Meet/PrintScreen), print via
Ctrl+Shift+S → OpenAI, Tradutor em tempo real e Assistente em tempo real —
sem quebrar Linux (KDE/COSMIC) nem macOS.

## Por que o stealth agora funciona no Windows (e nunca funcionou no Linux)

- **Windows/macOS**: `win.setContentProtection(true)` chama
  `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` (Win) / `NSWindowSharingNone`
  (Mac) → a janela é **excluída de toda captura de tela**. Stealth real.
- **Linux (Wayland/COSMIC)**: `setContentProtection` é **no-op**. Quem captura é
  o compositor (`cosmic-comp`) e não existe API de cliente para excluir janela.
  Por isso, apesar do código já chamar a API há várias sessões, a janela sempre
  apareceu nas gravações. Não é bug do app — é limitação do compositor.

## Arquitetura do porte

Só 2 pontos são OS-específicos; o resto (OpenAI, tradução, assistente, UI) é
agnóstico:

1. **Captura de tela** — `services/platform/screenCapture.js` (novo)
2. **Captura de áudio** (mic + loopback do sistema) — pendente (Etapa 2)

---

## Etapa 1 — Print Ctrl+Shift+S → OpenAI + stealth  ✅ CONCLUÍDA

**O que foi feito:**

- **`npm start` cross-platform** (`launch.js` novo + `package.json`):
  - Linux → delega ao `helper-node.sh` (hotkeys COSMIC/xbindkeys, flatpak, nvm).
    Comportamento Linux **inalterado** (`start:linux` preserva o script direto).
  - Windows/macOS → sobe o Electron direto (`require('electron')` → caminho do
    binário). Atalhos globais via `globalShortcut` do Electron (nativo no Win).
- **Captura de tela cross-platform** (`services/platform/screenCapture.js`):
  - Usa `desktopCapturer` do Electron, que no **Windows/macOS captura
    SILENCIOSAMENTE** (sem o diálogo de portal que existe só no Wayland).
  - Escolhe o monitor **sob o cursor** (multi-monitor correto).
- **Branch Win/Mac em `captureFullScreenAuto()`** (main.js): entra ANTES das
  ferramentas Linux (cosmic-screenshot/grim/gnome-screenshot). Alimenta a MESMA
  pipeline (compressão → OCR/visão → `processOsQuestion`). Linux intocado.
- **Fix crítico de stealth Windows em `applyStealthProtection()`**: a função
  tratava só `darwin` e `linux` — no Windows **não fazia nada**, deixando várias
  overlays sem proteção. Adicionado branch `win32` com `setContentProtection`.

**Como o fluxo fica no Windows:**
Ctrl+Shift+S → `globalShortcut` → `captureFullScreenAuto()` → `desktopCapturer`
(silencioso) → comprime (`sharp`) → OCR (`tesseract.js`) / visão gpt-4o →
resposta na overlay (que está **fora** da gravação via `setContentProtection`).

**Requisito de uso:** precisa estar com OS Integration ou Print mode ativo
(comportamento já existente).

**Não testável nesta máquina (Linux/COSMIC):** o teste final de stealth no
Windows (janela sumir do OBS) tem que ser feito por você no Windows 11.

---

## Etapa 2 — Áudio cross-platform (Tradutor + Assistente)  ⏳ PENDENTE

Hoje `services/realtimeAudioCapture.js` usa `parec` + `pactl` (PulseAudio). No
Windows precisa de loopback WASAPI. Plano: abstrair a captura atrás de
`services/platform/audioCapture.js` com backend por plataforma.

## Etapa 3 — Tradutor em tempo real  ⏳ PENDENTE (depende da Etapa 2)
## Etapa 4 — Assistente em tempo real  ⏳ PENDENTE (depende da Etapa 2)
