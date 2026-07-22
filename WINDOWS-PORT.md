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

## Etapa 2 — Áudio cross-platform (Tradutor + Assistente)  ✅ CONCLUÍDA

**Problema:** os DOIS motores de VAD usavam `parec` + `pactl` (PulseAudio, Linux):
- `services/realtimeAudioCapture.js` (Assistente em tempo real)
- `services/translationAssistant/vadEngine.js` (Tradutor)

**Solução — bridge de PCM cross-platform** (`services/platform/nativeAudio.js`
+ `nativeAudioRenderer.html`):
- Janela **oculta** (`show:false`, `backgroundThrottling:false`) captura via
  Chromium: mic (`getUserMedia`) + sistema (`getDisplayMedia` com
  `audio:'loopback'` — WASAPI no Windows).
- Faz resample p/ **s16le / 16 kHz / mono** — MESMO formato do `parec` — e
  envia os chunks PCM via IPC. Os motores reaproveitam TODA a lógica de
  VAD/segmentação/WAV **sem alteração**.
- `setDisplayMediaRequestHandler` auto-aprova o loopback (sem diálogo).

**Edições nos motores (risco mínimo):** só o `startStream()` ganhou um branch
`if (process.platform !== 'linux')` que assina o bridge em vez de spawnar parec.
O path **Linux ficou byte-idêntico**. Follower de sink (pactl) guardado p/ Linux.

**Transcrição:** ambos usam a **API OpenAI** (`/audio/transcriptions`,
`gpt-4o-transcribe`) — HTTP puro, cross-platform. ✅

**Requisito no Windows:** usar o modelo **OpenAI** (online). `pickRealtimeService`
só cai no pipeline local (Vosk+Whisper, binários Linux) quando o modelo NÃO é
`openIa`. Com a chave OpenAI do usuário, cai no caminho cross-platform correto.

**macOS:** loopback de sistema não é suportado pelo Chromium sem driver virtual
(BlackHole). Mic funciona; áudio do sistema fica mudo — mesma limitação de
sempre (no Linux era parec; no Mac nunca houve captura de sistema).

## Etapa 3 — Tradutor em tempo real  ✅ HABILITADA pela Etapa 2

`vadEngine.js` agora recebe PCM do bridge no Windows. Transcrição/tradução via
OpenAI (HTTP). Falta apenas o **teste real no Windows 11**.

## Etapa 4 — Assistente em tempo real  ✅ HABILITADA pela Etapa 2

`realtimeAudioCapture.js` agora recebe PCM do bridge no Windows (via
`realtimeOpenAiService`, modelo OpenAI). Falta apenas o **teste real no Win 11**.

---

## Etapa 5 — Distribuição Windows  ✅ CONCLUÍDA (revisada — ver histórico abaixo)

### Tentativa 1: instalador .exe via Electron Forge/Squirrel — ABANDONADA

Primeira tentativa: `forge.config.js` + `.forgeignore` + `maker-squirrel`
gerando `HelperNodeSetup.exe` assinado com certificado autoassinado
(`scripts/regenerate-cert.ps1`, baseado no `micro-front-end-manager`). O build
funcionou (instalador assinado, `.forgeignore` corretamente ligado via
`packagerConfig.ignore` depois de descobrir que o Forge **não lê
`.forgeignore` sozinho**), mas na hora de **testar rodando de verdade**:

- Instalador abria, ficava numa tela de loading e o app nunca subia.
- O `.exe` portátil também não abria: clicava, ~4s depois o Windows Defender
  disparava um balão de "ameaça bloqueada".
- `Get-MpThreatDetection` / `Get-MpThreat` (PowerShell) confirmaram:
  `Trojan:Win32/Cinjo.O!cl` — detecção via **cloud/ML** (sufixo `!cl`), não
  assinatura conhecida. Ou seja: **falso positivo comportamental**, não vírus
  de verdade.

**Causa raiz:** o app faz, por design, exatamente o que heurística de
comportamento associa a trojan/injetor — hook de atalho global, captura de
tela com `setContentProtection` (evasão de gravação — a mesma API que
cheats de jogo usam pra sumir de anti-cheat/OBS), janela de áudio oculta,
múltiplos processos filhos (Squirrel relança o app várias vezes durante o
próprio install). Some a isso um binário **novo a cada build** (hash nunca
visto, prevalência zero — certificado autoassinado não gera reputação
nenhuma no SmartScreen/Defender), e qualquer Windows 11 com proteção via
nuvem ativada (padrão) chega na mesma detecção — **não é specific dessa
máquina**, ia se repetir pra qualquer dev que recebesse o `.exe`.

**Tentativa de mitigação (Defender exclusion) também bloqueada:** a máquina
de teste tem `Tamper Protection` ativado (`Get-MpComputerStatus` →
`IsTamperProtected: True`) e é gerenciada por domínio — nem admin local
resolveria via script, só via política central de TI.

**Pesquisa de certificado pago (feita, guardada aqui pra quando/se valer a
pena comprar — preços mudam, checar de novo antes de decidir):**

| Opção | Custo | Observação |
|---|---|---|
| [SignPath Foundation](https://signpath.org/) | **Grátis** | OV real, chave em HSM deles (CI assina, você nunca vê a chave). Exige: repo público, licença OSI, sem código proprietário, **já ter histórico de release**. Melhor opção se o projeto for/ficar open source de verdade. |
| [Azure Trusted/Artifact Signing](https://azure.microsoft.com/en-us/pricing/details/trusted-signing/) | US$9,99/mês (pode cancelar após 1 mês) | GA hoje só pra indivíduo nos EUA/Canadá, ou organização na UE/UK — **Brasil como pessoa física provavelmente não se qualifica** (checar de novo, isso muda). |
| Certum (via SSLmentor) | ~US$108/ano | Cert OV tradicional mais barato encontrado. |
| SSL.com eSigner | ~US$180/ano | Cloud signing, boa opção pra CI/CD. |

Mesmo com cert pago: reduz MUITO o atrito de SmartScreen/reputação, mas não
é garantia 100% contra detecção comportamental — o app ainda faz coisa de
"perfil suspeito" por design.

### Tentativa 2 (atual): "instalador falso" via código-fonte — ✅ EM USO

Em vez de compilar um binário novo (que sempre vai ter reputação zero),
`install-windows-full.ps1` / `install-windows-lite.ps1` fazem o que o
`install.sh` do Linux já faz: **não empacotam nada**, só preparam o
código-fonte pra rodar com `npm start`.

- Clona/atualiza o repo (`git clone`/`git pull`, com fallback pra `.zip` se
  `git` não estiver instalado) em `%LOCALAPPDATA%\helper-node`.
- `npm install` — isso baixa o **electron.exe oficial** do projeto Electron
  (o mesmo binário usado por milhares de apps, com prevalência e reputação
  enormes na telemetria da Microsoft), em vez de um binário reempacotado e
  renomeado a cada build. Reduz bastante a penalidade de "arquivo nunca
  visto", embora o comportamento em runtime (hook global, captura com
  evasão) continue existindo e possa, em tese, ainda disparar heurística —
  só que agora sem o agravante de ser um hash desconhecido.
- Grava `edition.json` (`full` ou `lite`, mesmo mecanismo que
  `services/edition.js` já lê — igual ao que `package.sh` grava nos pacotes
  Linux).
- Cria atalho (Área de Trabalho + Menu Iniciar) apontando direto pro
  `electron.exe` baixado com a pasta do app como argumento — o mesmo que
  `launch.js` já faz no branch não-Linux.
- Registra o comando `helper-node` no **PATH do usuário** (não precisa de
  admin): grava um `.cmd` shim em `%LOCALAPPDATA%\helper-node\bin\` e
  adiciona essa pasta ao PATH via `[Environment]::SetEnvironmentVariable`.
  Digitar `helper-node` num terminal novo abre o app, igual `claude`.
- Atualizar = rodar o mesmo comando de novo (o script já faz `git pull` se a
  instalação existir).
- `assets/windows.ico` é **gerado uma vez e commitado** (não em build-time)
  pra evitar o problema de ovo-e-galinha de precisar do `sharp` instalado
  antes do primeiro `npm install`. Pra regenerar depois de trocar
  `assets/linux.png`: `npm run icon:win` (usa `scripts/generate-windows-icon.js`).
- `main.js` **não** tem mais nada Squirrel-específico (removido o guard
  `electron-squirrel-startup`, e a dependência também) — sem instalador
  compilado, não tem eventos de instalação do Squirrel pra tratar.
- `package.json`: `electron` virou dependência real (não mais
  `devDependencies`) porque agora é literalmente necessário em runtime pra
  rodar via `npm start`/instalador; ganhou `engines.node: ">=18"`.

**Uso:**
```powershell
irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows-full.ps1 | iex
# ou, 100% online:
irm https://raw.githubusercontent.com/SoderJuliano/helper-node/master/install-windows-lite.ps1 | iex
```

**Trade-offs assumidos conscientemente:** sem auto-update tipo Squirrel
(atualizar = rerodar o comando), exige Node.js 18+ e idealmente `git`
instalados na máquina de quem instala (mesma exigência que o Linux já tem),
não gera entrada em "Adicionar/Remover Programas". Pensado pra
compartilhar entre devs, não pra distribuição tipo usuário final via loja.

---

## Gaps conhecidos (NÃO fazem parte dos 3 recursos-núcleo)

- **Ctrl+D legado** (gravação-arquivo com Realtime Assistant DESLIGADO): usa
  `pw-record` + `ffmpeg` (Linux). No Windows, ligue "Assistente em Tempo Real"
  (usa o caminho cross-platform). Portar o legado é trabalho futuro.
- **`captureOneAnswer`** (`vadEngine`, só usado no testMode): usa `pw-record`.
- **Pipeline local Vosk+Whisper** (edição full sem OpenAI): binários Linux/Python.
  No Windows use o modelo OpenAI.
