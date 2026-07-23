const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  desktopCapturer,
  nativeImage,
  clipboard,
} = require("electron");

// === STDIO SAFETY ===
// Quando o app é lançado de forma desanexada (.desktop, systemd, autostart),
// stdout/stderr pode estar conectado a um pipe que fecha durante a vida do
// processo. Qualquer console.log subsequente lança EIO/EPIPE, que como
// "uncaughtException" causa o diálogo "A JavaScript error occurred in the
// main process" e trava os atalhos globais. Aqui silenciamos esses erros.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (err && (err.code === "EPIPE" || err.code === "EIO")) return;
  });
}
process.on("uncaughtException", (err) => {
  if (err && (err.code === "EPIPE" || err.code === "EIO")) return;
  try { console.error("[uncaughtException]", err); } catch (_) {}
});
process.on("unhandledRejection", (reason) => {
  try { console.error("[unhandledRejection]", reason); } catch (_) {}
});

// Overriding emit to log all IPC messages received from the renderer
const originalEmit = ipcMain.emit;
ipcMain.emit = function (event, ...args) {
  if (typeof event === 'string' && !event.startsWith('__')) {
    if (event !== 'native-audio-pcm' && event !== 'native-audio-log' && event !== 'terminal:input' && event !== 'terminal:output') {
      try {
        console.log(`[IPC LOG] Channel: ${event}, Args:`, JSON.stringify(args.slice(1)).slice(0, 400));
      } catch (e) {
        console.log(`[IPC LOG] Channel: ${event} (Args serialization failed)`);
      }
    }
  }
  return originalEmit.apply(ipcMain, arguments);
};

// === STEALTH MODE ===
// Substituímos `Notification` (notificação nativa do SO) por um stub vazio.
// Motivo: o app deve passar despercebido em reuniões/chamadas — ninguém
// olhando para a tela do usuário deve ver "Helper-Node: Gravando..." ou
// qualquer popup do sistema indicando que uma IA está escutando.
// Toda comunicação com o usuário acontece exclusivamente nas nossas
// próprias janelas (BrowserWindow) controladas via createOsNotificationWindow().
class Notification {
  constructor() {}
  show() {}
  close() {}
  on() { return this; }
  once() { return this; }
  removeAllListeners() { return this; }
  static isSupported() { return false; }
}
const path = require("path");
const os = require("os");

// Icone da janela por plataforma. No Windows usar o .ico - senao o Electron cai
// no default e/ou no linux.png (pinguim), que aparece na barra de tarefas.
const APP_ICON = path.join(
  __dirname,
  "assets",
  process.platform === "win32" ? "windows.ico" : "linux.png"
);
// Stealth: no Windows nenhuma janela deve aparecer na barra de tarefas.
const HIDE_FROM_TASKBAR = process.platform === "win32";
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const fs = require("fs").promises;
const fs2 = require("fs");
// const LlamaService = require('./services/llamaService.js');
// GeminiService removido em 0.2.4: dependia do binario `gemini` CLI que nao\n// existe no sistema. Backend Ollama + OpenAI cobrem todos os casos.
const BackendService = require("./services/backendService.js");
// Gemini CLI provider — processo persistente por projeto, isolado dos outros providers.
const GeminiCliProvider = require("./services/providers/gemini-cli/GeminiCliProvider");
// Claude Code CLI provider — spawn por mensagem + --resume para continuidade.
const ClaudeCliProvider = require("./services/providers/claude-cli/ClaudeCliProvider");
const TesseractService = require("./services/tesseractService.js");
const OpenAIService = require("./services/openAIService.js");
const RealtimeAssistantService = require("./services/realtimeAssistantService.js");
const RealtimeOpenAiService = require("./services/realtimeOpenAiService.js");
const ipcService = require("./services/ipcService.js");
const configService = require("./services/configService.js");
const edition = require("./services/edition.js");
const knowledgeBase = require("./services/knowledgeBase.js");
const fileEditService = require("./services/fileEditService.js");
const historyService = require("./services/historyService.js");
const helperTools = require("./services/helperTools");
const workspace = require("./services/workspace");
const agenticWorkflow = require("./services/agenticWorkflowService");
const ollamaAgenticWorkflow = require("./services/ollamaAgenticWorkflowService");
const translationAssistant = require("./services/translationAssistant");
const visionGuide = require("./services/visionGuideService");
const platformScreenCapture = require("./services/platform/screenCapture.js");
const { runTestMode } = require("./services/translationAssistant/testMode");
const { analyzeInterviewImage } = require("./services/translationAssistant/imageAnalysis");
// Transcrição cloud (gpt-4o-mini-transcribe) — usada no Ctrl+D da edição Lite.
const { transcribeAudio: cloudTranscribeAudio } = require("./services/translationAssistant/openaiClient");

let terminalProcess = null;   // child_process (Linux: python-pty)
let terminalPty = null;       // node-pty ConPTY (Windows/macOS)
let currentTerminalProjectPath = null;

// Escreve no terminal ativo, seja ele o pty (node-pty) ou o child_process.
function writeToTerminal(data) {
  try {
    if (terminalPty) { terminalPty.write(data); return true; }
    if (terminalProcess && terminalProcess.stdin && terminalProcess.stdin.writable) {
      terminalProcess.stdin.write(data);
      return true;
    }
  } catch (e) {
    console.error("[terminal write] error:", e.message);
  }
  return false;
}

// Encerra qualquer terminal ativo (pty ou child_process).
function killTerminal() {
  if (terminalPty) { try { terminalPty.kill(); } catch (_) {} terminalPty = null; }
  if (terminalProcess) { try { terminalProcess.kill(); } catch (_) {} terminalProcess = null; }
}

function getActiveProjectPath() {
  const workspace = require("./services/workspace");
  const dirItem = (workspace.list() || []).find((a) => a.type === "dir");
  if (dirItem && dirItem.path) {
    try {
      if (fs2.existsSync(dirItem.path) && fs2.statSync(dirItem.path).isDirectory()) {
        return dirItem.path;
      }
    } catch (_) {}
  }
  return os.homedir();
}

function syncTerminalCwd(forceMessage = false) {
  const newProjectPath = getActiveProjectPath();
  if (currentTerminalProjectPath !== newProjectPath || forceMessage) {
    currentTerminalProjectPath = newProjectPath;
    if (terminalPty || (terminalProcess && terminalProcess.stdin && terminalProcess.stdin.writable)) {
      try {
        // `cd "caminho"` funciona tanto em bash/zsh quanto em cmd.exe/PowerShell.
        const nl = terminalPty ? "\r" : "\n";
        writeToTerminal(`cd "${newProjectPath.replace(/"/g, '\\"')}"${nl}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("terminal:output", {
            type: "stdout",
            data: `\x1b[32m\n[📁 Terminal sincronizado com projeto: ${newProjectPath}]\x1b[0m\n\n`
          });
        }
      } catch (e) {
        console.error("[terminal:sync] error:", e.message);
      }
    }
  }
}


/**
 * Monta opts pra OpenAIService.makeOpenAIRequest acoplando o helperTools quando:
 *   1) o módulo está habilitado nas configs
 *   2) o texto do usuário casa com algum gatilho (shouldEngage)
 *
 * Devolve também a instruction (system prompt) e o model corretos quando o
 * módulo engaja — caller pode usar ou ignorar.
 *
 * Retorno:
 *   { opts, instruction?, model? }
 *   - opts é sempre seguro pra spread; vazio quando helperTools não engaja.
 */
function buildHelperToolsOpenAIOpts(userText, baseInstruction, baseModel) {
  try {
    if (!helperTools.isEnabled || !helperTools.isEnabled()) {
      return { opts: {} };
    }
    const schema = helperTools.getOpenAIToolsSchema ? helperTools.getOpenAIToolsSchema() : [];
    if (!schema || schema.length === 0) {
      console.warn("🧰 helperTools ON mas schema vazio (nenhuma tool registrada).");
      return { opts: {} };
    }
    const cfg = helperTools.getConfig ? helperTools.getConfig() : {};
    const addon = helperTools.getSystemPromptAddon ? helperTools.getSystemPromptAddon() : "";
    const instruction = [baseInstruction || "", addon].filter(Boolean).join("\n\n");

    // Heurística pra ESCOLHA DE MODELO (não pra ligar/desligar tools):
    //   - se a pergunta tem cara de tarefa pesada (edita arquivo, instala
    //     pacote, comandos) → upgrade pra modelHeavy
    //   - MAS só fazemos upgrade se o modelo do usuário for MAIS BARATO/FRACO
    //     que o modelHeavy. Se ele já escolheu 4.1 ou 5.1, RESPEITA — quem
    //     paga 8x mais por token não quer ser silenciosamente downgrade pra
    //     gpt-4o-mini só porque pediu pra editar um arquivo. Se o user paga
    //     mais, ele quer o modelo mais capaz também nas tools.
    //   - Se o usuário tá no default nano (barato), aí sim upgrade pra heavy.
    // Tools são SEMPRE oferecidas quando o módulo está ON; a IA decide via
    // tool_choice:'auto' se chama ou não.
    //
    // Tier (maior = mais caro/capaz). Reflete pricing OpenAI:
    //   nano family       ~ $0.05-0.10 input  → tier 1
    //   mini family       ~ $0.15-0.25 input  → tier 2 (gpt-4o-mini, gpt-5-mini)
    //   gpt-4.1           ~ $2.00 input       → tier 3
    //   gpt-4o            ~ $2.50 input       → tier 3
    //   gpt-5/5.1/5.2     ~ $1.25-1.75 input  → tier 4 (mais novo, melhor)
    //   gpt-5.4/5.5       ~ $2.50-5.00 input  → tier 5
    const modelTier = (m) => {
      const s = String(m || "").toLowerCase();
      if (!s) return 0;
      // Família 5.6 tem variantes nomeadas (sol/terra/luna) em vez de mini/nano.
      if (/gpt-5\.6-sol/.test(s)) return 5;
      if (/gpt-5\.6-terra/.test(s)) return 4;
      if (/gpt-5\.6-luna/.test(s)) return 2;
      if (/gpt-5\.[45]/.test(s) && !/(mini|nano)/.test(s)) return 5;
      if (/gpt-5(\.\d)?($|[^.\d])/.test(s) && !/(mini|nano)/.test(s)) return 4;
      if (/gpt-4\.1($|[^-])/.test(s) && !/(mini|nano)/.test(s)) return 3;
      if (/gpt-4o($|[^-])/.test(s) && !/mini/.test(s)) return 3;
      if (/mini/.test(s)) return 2;
      if (/nano/.test(s)) return 1;
      return 2; // desconhecido — assume médio
    };
    let model = baseModel;
    // Sinal de intenção pesada por palavra-chave (escrita/edição/comandos).
    const heavyIntent = helperTools.shouldForceHeavyModel
      ? helperTools.shouldForceHeavyModel(userText || "")
      : false;
    // Trabalhando sobre um PROJETO/arquivos anexados, qualquer pergunta (mesmo
    // de leitura, ex.: "qual versão de node?") precisa raciocinar sobre código
    // → o nano default dá respostas rasas/preguiçosas. Nesse contexto forçamos
    // o upgrade também. A regra abaixo (heavyTier > userTier) garante que quem
    // já escolheu um modelo melhor NÃO é rebaixado.
    let hasWorkspaceCtx = false;
    try {
      hasWorkspaceCtx = !!(configService.getWorkspaceAccessEnabled &&
        configService.getWorkspaceAccessEnabled() &&
        workspace.list && workspace.list().length > 0);
    } catch (_) {}
    const forceHeavy = heavyIntent || hasWorkspaceCtx;
    if (forceHeavy) {
      const rawModel = cfg.modelHeavy || "";
      if (rawModel.startsWith("openai:")) {
        const heavyName = rawModel.slice("openai:".length);
        const userTier = modelTier(baseModel);
        const heavyTier = modelTier(heavyName);
        // Só faz upgrade se o modelo do user é mais fraco que o heavy.
        // Senão respeita escolha do user (que já está pagando por algo melhor).
        if (heavyName && heavyTier > userTier) {
          model = heavyName;
        }
      }
    }

    const maxToolCalls = Number.isInteger(cfg.maxToolCallsPerRequest)
      ? cfg.maxToolCallsPerRequest
      : 50;

    const modelTag = forceHeavy
      ? (model === baseModel ? " [HEAVY-kept-user]" : " [HEAVY-upgraded]")
      : "";
    console.log(
      `🧰 helperTools engajado: tools=${schema.length} model=${model}${modelTag} maxToolCalls=${maxToolCalls}`
    );

    return {
      opts: {
        tools: schema,
        maxToolCalls,
        onToolCall: (() => {
          // Anti-duplicação POR PERGUNTA: se a IA pedir writeFile/appendToFile/
          // patchFile com o MESMO (path+content/patch) duas vezes no mesmo turno,
          // a segunda vez retorna ok:true sem rodar. Bug observado: qwen25
          // repete writeFile 3-4x do mesmo README após confirmação.
          const crypto = require('crypto');
          const seen = new Map(); // key → first result
          const hashKey = (name, args) => {
            try {
              const a = args || {};
              if (name === 'writeFile' || name === 'appendToFile') {
                const h = crypto.createHash('sha256')
                  .update(String(a.path || '')).update('\0')
                  .update(String(a.content || ''))
                  .digest('hex').slice(0, 16);
                return `${name}:${h}`;
              }
              if (name === 'patchFile') {
                const h = crypto.createHash('sha256')
                  .update(String(a.path || '')).update('\0')
                  .update(String(a.oldText || '')).update('\0')
                  .update(String(a.newText || '')).update('\0')
                  .update(String(a.startLine || '')).update('\0')
                  .update(String(a.endLine || ''))
                  .digest('hex').slice(0, 16);
                return `${name}:${h}`;
              }
              if (name === 'deleteFile') {
                return `${name}:${String(a.path || '')}`;
              }
            } catch (_) {}
            return null;
          };
          // Resumo legível da ação pra mostrar o "thinking"/ações na UI.
          const baseName = (p) => String(p || "").split("/").filter(Boolean).slice(-1)[0] || String(p || "");
          const summarizeTool = (name, a = {}) => {
            switch (name) {
              case "readFile": return `Lendo ${baseName(a.path)}`;
              case "findFiles": return `Procurando ${a.glob || a.pattern || "arquivos"}`;
              case "listDir": case "readDir": return `Listando ${baseName(a.path) || "diretório"}`;
              case "writeFile": return `Escrevendo ${baseName(a.path)}`;
              case "appendToFile": return `Anexando em ${baseName(a.path)}`;
              case "patchFile": return `Editando ${baseName(a.path)}`;
              case "deleteFile": return `Removendo ${baseName(a.path)}`;
              case "runCommand": case "runTerminal": return `Rodando: ${String(a.command || a.cmd || "").slice(0, 70)}`;
              case "grep": case "searchInFiles": return `Buscando "${String(a.query || a.pattern || "").slice(0, 50)}"`;
              default: return name;
            }
          };
          const emitActivity = (payload) => {
            try {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("ai-tool-activity", payload);
              }
            } catch (_) {}
          };
          return async (name, args /*, meta */) => {
            const callId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            emitActivity({ id: callId, name, label: summarizeTool(name, args), phase: "start" });
            const key = hashKey(name, args);
            if (key && seen.has(key)) {
              console.log(`🚫 anti-dup: ${name} já executado neste turno (key=${key}); retornando resultado anterior sem reexecutar.`);
              const prev = seen.get(key);
              emitActivity({ id: callId, name, phase: "done", ok: true });
              return {
                ok: true,
                result: {
                  duplicate: true,
                  note: "Esta operação já foi executada neste turno. Prossiga para a próxima ação (ex: commit, push). NÃO repita.",
                  previousResult: prev && prev.result ? prev.result : undefined,
                },
              };
            }
            const res = await helperTools.executeTool(name, args, {
              source: "openai-tool-call",
            });
            if (key && res && res.ok !== false) seen.set(key, res);
            emitActivity({ id: callId, name, phase: "done", ok: res && res.ok !== false });
            return res;
          };
        })(),
      },
      instruction,
      model,
    };
  } catch (e) {
    console.warn("buildHelperToolsOpenAIOpts falhou, seguindo sem tools:", e && e.message);
    return { opts: {} };
  }
}

// Decide se uma mensagem deve usar o Agentic Workflow (multi-fase) ou só o
// caminho normal de tool-calling. Comando DIRETO (git/npm/commit/push/rode/
// test/build…) NUNCA planeja — só executa. Receba SEMPRE o texto cru do
// usuário (não a versão com contexto do projeto, que tem ruído).
function shouldUseAgentic(rawText) {
  if (!configService.getHelperToolsEnabled || !configService.getHelperToolsEnabled()) return false;
  if (!configService.getWorkspaceAccessEnabled || !configService.getWorkspaceAccessEnabled()) return false;
  if (!(helperTools.shouldForceHeavyModel && helperTools.shouldForceHeavyModel(rawText || ""))) return false;
  const t = (rawText || "").toLowerCase();
  const isDirectCommand =
    /\b(git|npm|yarn|pnpm|cargo|docker|kubectl|systemctl|make)\b/.test(t) ||
    /\b(commit|push|pull|rebase|merge|clone|checkout|stash)\b/.test(t) ||
    /\b(rode|roda|rodar|execut|\brun\b|test|build|deploy|lint|instal)\b/.test(t);
  return !isDirectCommand;
}

// === Workspace context injection ===
// Se workspaceAccess + helperTools estao ON e ha anexos, prepend o bloco
// de contexto (listagem + conteudo de arquivos pequenos) na primeira
// pergunta da sessao. Apos enviar, marca contextSent pra nao re-injetar.
// Retorna o texto possivelmente modificado.
async function prependWorkspaceContextIfNeeded(text, modelKey) {
  try {
    const wsOn = configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled();
    const htOn = helperTools.isEnabled && helperTools.isEnabled();
    const attCount = workspace.list().length;
    if (!wsOn) {
      console.log(`[workspace] SKIP: toggle Acesso a diretorios OFF`);
      return text;
    }
    if (!htOn) {
      console.log(`[workspace] SKIP: Ferramentas avancadas OFF`);
      return text;
    }
    if (attCount === 0) {
      console.log(`[workspace] SKIP: nenhum anexo no painel`);
      return text;
    }
    // Âncora CURTA do projeto ativo — vai em TODO turno (barato). Sem isso o
    // modelo esquece a raiz do projeto após a 1ª msg e começa a varrer ~ ("achei
    // 3 projetos, qual o caminho?"). O blueprint completo (árvore) vai só 1x.
    const dirs = workspace.list().filter((a) => a.type === "dir");
    let anchor = "";
    if (dirs.length) {
      const root = dirs[0].path;
      anchor =
        `[PROJETO ATIVO: ${root}]\n` +
        `Esta é a RAIZ do projeto em que estamos trabalhando. Faça TODAS as operações ` +
        `de arquivo/busca/comando DENTRO deste diretório (use-o como cwd). ` +
        `NÃO procure em ~ nem em outros projetos. Caminho relativo = relativo a esta raiz.`;
    }

    const ctx = await workspace.buildContextIfNeeded(modelKey || "", { userText: text });
    if (!ctx) {
      console.log(`[workspace] contexto ja injetado; mandando só a âncora do projeto (anexos=${attCount}).`);
      return anchor ? anchor + "\n\n---\n\n" + (text || "") : text;
    }
    workspace.markContextSent();
    console.log(`[workspace] ✅ contexto injetado (${ctx.length} chars, ${attCount} anexos, model=${modelKey})`);
    return (anchor ? anchor + "\n\n" : "") + ctx + "\n\n---\n\n" + (text || "");
  } catch (e) {
    console.warn("[workspace] prependContext falhou:", e.message);
    return text;
  }
}

// Improve global shortcut reliability on Linux Wayland compositors
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

  // ─── Overlay flutuante x Wayland nativo ────────────────────────────────
  // No Wayland nativo (COSMIC/Garuda) um client NÃO pode definir a própria
  // posição global, é "tiled" pelo compositor e não fica de forma confiável
  // acima das outras janelas. Isso quebra os botões de posição do overlay de
  // tradução, o arraste e o "sempre na frente". Sob XWayland (X11) tudo isso
  // volta a funcionar: setPosition/setBounds são honrados, alwaysOnTop é
  // respeitado e a janela flutua em vez de entrar no tiling.
  // Permite desligar com HELPER_FORCE_WAYLAND=1 caso o usuário prefira.
  if (
    process.env.XDG_SESSION_TYPE === "wayland" &&
    process.env.HELPER_FORCE_WAYLAND !== "1"
  ) {
    app.commandLine.appendSwitch("ozone-platform-hint", "x11");
    console.log("[platform] Wayland detectado → forçando XWayland (x11) para overlay flutuante confiável. HELPER_FORCE_WAYLAND=1 para desligar.");
  }

  // WM_CLASS de TODAS as janelas X11/XWayland → "helper-node".
  // setName() sozinho só marcava a 1ª janela; as janelas flutuantes/overlay
  // nasciam com WM_CLASS="electron" e por isso o match stealth do compositor
  // (app_id.contains("helper-node")) NÃO pegava nelas — apareciam na gravação.
  // A switch --class força o WM_CLASS no nível do Chromium para todo top-level.
  app.commandLine.appendSwitch("class", "helper-node");

  // Identidade estável para o compositor. Sob XWayland o cosmic-comp lê o
  // WM_CLASS do X11 como "app_id"; o modo stealth do compositor casa por
  // app_id.contains("helper-node"). Sem isto, o Electron reporta o nome do
  // package ("meu-electron-app"), a regra nunca casa e a janela aparece na
  // gravação. setName define o WM_CLASS que o cosmic-comp enxerga.
  app.setName("helper-node");

  // EFEITO COLATERAL do setName acima: app.getPath("userData") passa a apontar
  // para ~/.config/helper-node/ em vez de ~/.config/meu-electron-app/. Isso
  // "some" com o config (e a API key) no modo dev (npm start), porque o app
  // instalado usa "meu-electron-app". Fixamos o userData no caminho histórico
  // para que app_id=helper-node (stealth) NÃO mude onde o config é lido/salvo.
  app.setPath("userData", path.join(app.getPath("appData"), "meu-electron-app"));
}

// Function to calculate image hash for duplicate detection
function calculateImageHash(imageBuffer) {
  return crypto.createHash('md5').update(imageBuffer).digest('hex');
}

// --- SINGLE INSTANCE LOCK ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Outra instância já está rodando: encerra imediatamente para não tentar
  // criar/carregar a janela (o que abortava o loadFile e gerava o erro
  // enganoso "index.html not found / ERR_FAILED"). A instância original
  // recebe o evento 'second-instance' e foca a janela existente.
  app.exit(0);
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    // Focus existing window if a second instance is started
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

let backendIsOnline = false;
let configWindow = null;
let preferencesWindow = null;
let shortcutsRegistered = false;

async function checkBackendStatus() {
  backendIsOnline = await BackendService.ping();
  if (backendIsOnline) {
    console.log("Backend is online.");
  } else {
  }
}

// Configurações do aplicativo
const appConfig = {
  notificationsEnabled: true,
};

let mainWindow;
let sharingCheckInterval;
let currentDisplayId = null;
let sharingActive = false;
let recordingProcess = null;
let isRecording = false;
let waitingNotificationInterval = null;
let clipboardMonitoringInterval = null;
let clipboardWatchProc = null; // wl-paste --watch (Wayland event-driven)
let lastClipboardImageHash = null;
let lastProcessedImageHash = null;
let lastProcessedTimestamp = null;
const IMAGE_COOLDOWN_MS = 30000; // 30 seconds cooldown
let isProcessingImage = false; // Simple lock for image processing
// Trava anti-spam do Ctrl+D: true enquanto o áudio do toque anterior está sendo
// transcrito/respondido. Evita que apertar Ctrl+D repetidamente dispare vários
// envios do mesmo/novos áudios em paralelo (modo integrado e janela).
let recordingBusy = false;
// Gravações de áudio vão para um diretório temporário do usuário (gravável em
// qualquer OS). __dirname pode ser read-only quando instalado (ex.: /opt no
// Linux, /Applications no macOS, Program Files no Windows), o que fazia
// pw-record/ffmpeg falharem com EACCES e a gravação morrer em silêncio.
const AUDIO_TMP_DIR = path.join(os.tmpdir(), "helper-node-audio");
try { fs2.mkdirSync(AUDIO_TMP_DIR, { recursive: true }); } catch (_) {}
const audioFilePath = path.join(AUDIO_TMP_DIR, "output.wav");
// Monitoramento da pasta de screenshots do COSMIC (PrintScreen nativo)
let screenshotFolderWatcher = null;
let screenshotFolderWatcherPath = null;

// OS Integration windows
let osInputWindow = null;
let osNotificationWindow = null;
let osNotifAutoCloseTimer = null; // poller do auto-close da janela 'response'
// Janela SECUND\u00c1RIA pra mostrar resposta de imagem quando recording-live
// est\u00e1 ativa \u2014 sen\u00e3o destruir\u00edamos a bolha de conversa pra mostrar a img.
let osImageResponseWindow = null;
let osCaptureWindow = null;
let isOsIntegrationMode = false;
let captureToolInterval = null;
let osVoskSilenceTimer = null;

// === Conversa contínua OS Mode (Vosk + Whisper) ===
// Mesmo pipeline do RealtimeAssistantService, simplificado para uso no
// recording-live overlay. Cada "turno" e' um segmento: buffer de PCM +
// transcricao Vosk acumulada. Fecha por silencio (3s) ou tempo maximo (25s).
// IA responde com texto Vosk imediatamente, depois Whisper corrige em
// background e re-pergunta se a transcricao diferir significativamente.
let osLiveSegment = null;
let osLiveSilenceInterval = null;
let osLiveTurnCount = 0;
// Fusao de fala fragmentada por pausa — se o proximo segmento fechar dentro
// dessa janela apos o anterior, junta os dois textos e reprocessa a pergunta
// inteira (ver closeOsLiveSegment).
let osLiveLastClosed = null; // { id, text, closedAt }
const OS_LIVE_CONTINUATION_WINDOW_MS = 3000;
const OS_LIVE_SAMPLE_RATE = 16000;
const OS_LIVE_SILENCE_RMS = 250;
// Silêncio antes de fechar segmento. 3s era muito agressivo: cortava perguntas
// longas em 2-3 partes nas pausas naturais de leitura/respiração — por isso
// tinha sido subido pra 6s como paliativo. Agora a fusao de fala (acima) resolve
// isso de verdade, entao voltamos a um valor mais responsivo.
const OS_LIVE_SILENCE_MS = 2800;
// Tempo máximo de um único segmento. 60s acomoda explicações técnicas
// longas ("como faz X dado Y com Z...").
const OS_LIVE_MAX_MS = 60000;
const OS_LIVE_TMP_DIR = path.join(os.tmpdir(), "helper-node-os-live");
try { fs2.mkdirSync(OS_LIVE_TMP_DIR, { recursive: true }); } catch (_) {}

function clearOsVoskSilenceTimer() {
  if (osVoskSilenceTimer) { clearTimeout(osVoskSilenceTimer); osVoskSilenceTimer = null; }
  if (osLiveSilenceInterval) { clearInterval(osLiveSilenceInterval); osLiveSilenceInterval = null; }
  osLiveSegment = null;
  osLiveTurnCount = 0;
  osLiveLastClosed = null;
}

const VoskStreamService = require("./services/voskStreamService.js");

// Responder do realtime OFFLINE (Vosk live + correção Whisper). A transcrição é
// local, mas a RESPOSTA vai pro provider SELECIONADO (backend/Ollama) — nunca
// OpenAI. Respeita "sem fallback automático entre providers". Só é usado na Full
// com backend (llama/llama-stream) ou ollamaLocal selecionado.
// Decide, via chamada EXTRA ao llama3 (thread separada, sem o contexto), se a
// pergunta precisa da base de conhecimento atualizada. Evita poluir/confundir
// modelos pequenos com contexto irrelevante. Só pro caminho Ollama/backend.
async function ollamaNeedsKnowledge(query) {
  try {
    const r = await BackendService.responder(
      `Pergunta do candidato/interlocutor: "${String(query).slice(0, 400)}"\n\n` +
      `Responda APENAS com SIM ou NAO: essa fala precisa de informação ATUALIZADA ` +
      `sobre tecnologias, versões de libs/frameworks ou mercado recente pra ser bem respondida?`,
      { sessionId: "kb-classifier", instruction: "Você é um classificador binário. Responda SOMENTE com SIM ou NAO, nada mais." }
    );
    return /\bsim\b/i.test(r || "");
  } catch (_) { return false; }
}

// Bloco da base de conhecimento pro caminho Ollama (keyword retrieval + classificador).
async function knowledgeBlockForOllama(query) {
  try {
    if (!configService.getKnowledgeBaseConfig().enabled) return "";
    if (!(await ollamaNeedsKnowledge(query))) return "";
    return await knowledgeBase.augment(query, { topK: 5 }); // sem token → keyword
  } catch (_) { return ""; }
}

// Bloco da base de conhecimento pro caminho OpenAI/ChatGPT (embeddings, sem classificador).
async function knowledgeBlockForOpenAI(query) {
  try {
    if (!configService.getKnowledgeBaseConfig().enabled) return "";
    return await knowledgeBase.augment(query, { token: configService.getOpenIaToken(), topK: 5 });
  } catch (_) { return ""; }
}

async function realtimeProviderResponder(transcript) {
  const aiModel = configService.getAiModel();
  const kb = await knowledgeBlockForOllama(transcript);
  const text = kb ? `${kb}\n\n---\n\nFALA: ${transcript}` : transcript;
  if (aiModel === "ollamaLocal") {
    const OllamaLocalService = require("./services/ollamaLocalService");
    return await OllamaLocalService.responder(text);
  }
  // backend remoto (llama / llama-stream)
  return await BackendService.responder(text, {
    sessionId: "realtime-assistant",
    instruction: REALTIME_COPILOT_INSTRUCTION,
  });
}

const REALTIME_COPILOT_INSTRUCTION = [
  "Você é um COPILOTO DISCRETO em tempo real durante entrevistas, reuniões e ligações.",
  "Recebe uma TRANSCRIÇÃO do que está sendo falado. Dê ao usuário o que ele precisa pra responder COM AS PRÓPRIAS PALAVRAS.",
  "LINGUAGEM: português falado BR, simples e natural (padrão SP/SC). PROIBIDO formalês e clichê de RH ('soluções escaláveis', 'agregar valor', 'sinergia').",
  "Pergunta aberta/comportamental ('me fala os desafios') → NÃO dê resposta pronta; dê 3-5 bullets curtos com os PONTOS-CHAVE em **negrito** pro usuário montar a fala.",
  "Pergunta técnica de profundidade ('como você implementa X') → resposta completa, termos-chave em **negrito**, exemplo de código só aqui se ajudar.",
  "Pergunta objetiva → curto e direto. Conversa casual/ruído/sem pergunta → responda só '(trecho sem conteúdo relevante)'.",
  "SEMPRE destaque os termos/tecnologias-chave em **negrito**. Sem preâmbulo, não repita a pergunta.",
].join("\n");

const realtimeAssistantService = new RealtimeAssistantService({
  configService,
  getMainWindow: () => mainWindow,
  historyService,
  aiResponder: realtimeProviderResponder,
  onFatalStop: () => {
    // Called when the service stops itself due to a fatal error (e.g. quota exceeded)
    isRecording = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
    }
  },
});

// Realtime ONLINE (100% OpenAI): transcrição + resposta na OpenAI, sem Vosk/Whisper.
// Usado quando o provider selecionado é ChatGPT (openIa) ou na edição Lite.
const realtimeOpenAiService = new RealtimeOpenAiService({
  configService,
  getMainWindow: () => mainWindow,
  historyService,
  onFatalStop: () => {
    isRecording = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
    }
  },
});

// Seleciona o serviço de realtime conforme o provider efetivo:
//   ChatGPT/Lite → online (OpenAI)   |   backend/Ollama (Full) → offline (Vosk+Whisper).
function pickRealtimeService() {
  return getEffectiveAiModel() === "openIa" ? realtimeOpenAiService : realtimeAssistantService;
}
function anyRealtimeActive() {
  return realtimeOpenAiService.isActive() || realtimeAssistantService.isActive();
}
function stopAllRealtime() {
  const tasks = [];
  if (realtimeOpenAiService.isActive()) tasks.push(realtimeOpenAiService.stop().catch(() => {}));
  if (realtimeAssistantService.isActive()) tasks.push(realtimeAssistantService.stop().catch(() => {}));
  return Promise.all(tasks);
}

// Entrega resultados do Assistente de Tradução.
// Em OS Integration: usa a janela DEDICADA (translation-overlay.html), persistente
// no canto direito, sem auto-close. Não toca em osNotificationWindow (que é do Vosk).
translationAssistant.onResult(({ transcript, response, mode, id, streaming }) => {
  try {
    // streaming===true → é um delta (texto parcial acumulado): só atualiza o bloco,
    // sem piscar o status processing/mic_open a cada pedaço.
    const isDelta = streaming === true;
    const cfg = configService.getConfig();
    const send = (channel, data) => {
      if (cfg.osIntegration) {
        if (!translationOverlayWindow || translationOverlayWindow.isDestroyed()) createTranslationOverlay();
        sendToTranslationOverlay(channel, data);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
      }
    };
    if (!isDelta) send('translation-status', 'processing');
    send('translation-result', { transcript, response, mode: mode || 'interviewer', id, streaming });
    if (!isDelta) send('translation-status', 'mic_open');
  } catch (e) {
    console.error('[TranslationAssistant] erro ao entregar resultado:', e.message);
  }
});

// Nível de áudio em tempo real (barra de volume embaixo da bolinha do live).
// Enviado ~10x/s por fonte; o renderer normaliza e desenha a barra.
translationAssistant.onLevel((source, rms) => {
  try {
    const payload = { source, rms };
    const cfg = configService.getConfig();
    if (cfg.osIntegration) {
      sendToTranslationOverlay('translation-level', payload);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('translation-level', payload);
    }
  } catch (_) {}
});

// "Processando" — loading enquanto a IA transcreve/traduz aquele trecho.
translationAssistant.onLoading((loading) => {
  try {
    const cfg = configService.getConfig();
    if (cfg.osIntegration) {
      sendToTranslationOverlay('translation-loading', loading);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('translation-loading', loading);
    }
  } catch (_) {}
});

// === Translation Assistant Overlay ===
// Janela dedicada do Assistente de Tradução. NÃO toca em osNotificationWindow
// (que continua sendo usada por Vosk recording-live + outras notificações).
// - Lado direito da tela, ~20% de largura (mínimo 380px = mesma do Vosk).
// - 80% de altura, margem 10px da borda direita.
// - Stealth: setContentProtection + xprop X11 UTILITY (via applyStealthProtection).
// - Click-through: overlay tipo FPS counter. Mouse só pega no header/lista.
// - Sem timer de auto-close — fica aberta enquanto TA estiver ativo.
let translationOverlayWindow = null;

// Calcula posição/tamanho do overlay com base no display do cursor (multi-monitor).
function computeTranslationOverlayBounds() {
  // getCursorScreenPoint + getDisplayNearestPoint = display onde o usuário
  // está agora (em vez de sempre o primary). Importante em multi-monitor.
  let display;
  try {
    const cursor = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(cursor);
  } catch (_) {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea; // {x, y, width, height} — respeita docks
  const VOSK_MIN_WIDTH = 380;
  const winWidth = Math.max(VOSK_MIN_WIDTH, Math.round(wa.width * 0.20));
  const winHeight = Math.round(wa.height * 0.80);
  // 10px da borda direita, clampeado para não sair da tela
  const posX = Math.max(wa.x, wa.x + wa.width - winWidth - 10);
  const posY = Math.max(wa.y, wa.y + Math.round((wa.height - winHeight) / 2));
  return { x: posX, y: posY, width: winWidth, height: winHeight, displayId: display.id };
}

function forceTranslationOverlayPosition(label) {
  if (!translationOverlayWindow || translationOverlayWindow.isDestroyed()) return;
  const b = computeTranslationOverlayBounds();
  try { translationOverlayWindow.setBounds(b); } catch (_) {}
  try { translationOverlayWindow.setPosition(b.x, b.y); } catch (_) {}
  try {
    const got = translationOverlayWindow.getBounds();
    console.log(`[translation-overlay] ${label}: alvo=${b.x},${b.y} ${b.width}x${b.height} | real=${got.x},${got.y} ${got.width}x${got.height}`);
  } catch (_) {}
}

function createTranslationOverlay() {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()) {
    // Já existe — só reposiciona, caso o compositor tenha movido.
    forceTranslationOverlayPosition('recreate-reposition');
    return translationOverlayWindow;
  }

  const b = computeTranslationOverlayBounds();
  console.log(`[translation-overlay] criando: x=${b.x} y=${b.y} w=${b.width} h=${b.height} display=${b.displayId}`);

  translationOverlayWindow = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    useContentSize: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,         // header pode arrastar via -webkit-app-region
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,      // overlay tipo FPS counter — nunca rouba foco
    hasShadow: false,
    // Sem `type: 'toolbar'` — em COSMIC/XWayland causa erro kAtomsToCache
    // e parece levar o compositor a centralizar a janela.
    show: false,
    title: 'helper-node-translation-overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  translationOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  translationOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Stealth (não aparece em gravação/compartilhamento de tela)
  applyStealthProtection(translationOverlayWindow);

  translationOverlayWindow.loadFile(
    path.join(__dirname, 'os-integration', 'notifications', 'translation-overlay.html')
  );

  // Reforça posição em múltiplos hooks — COSMIC/Wayland costuma reposicionar
  // janelas frame:false+transparent:true para o centro da tela.
  forceTranslationOverlayPosition('post-create');

  translationOverlayWindow.once('ready-to-show', () => {
    forceTranslationOverlayPosition('ready-to-show');
    try { translationOverlayWindow.show(); } catch (_) {}
    forceTranslationOverlayPosition('post-show');
    // NÃO usamos setIgnoreMouseEvents — em Linux/Wayland o `forward: true`
    // não funciona, então mouseenter no header nunca chega ao JS e o drag
    // quebra. focusable=false já garante que a janela não rouba foco.
  });

  translationOverlayWindow.webContents.on('did-finish-load', () => {
    forceTranslationOverlayPosition('did-finish-load');
    // Click-through inicial — JS no overlay religa via IPC ao hover no header.
    // SÓ em macOS/Windows: lá `forward: true` entrega mouseenter/leave ao DOM.
    // Em Linux pulamos: senão mousedown do drag manual também não chega.
    // focusable=false já garante que a janela não rouba foco do teclado.
    if (process.platform !== 'linux') {
      try { translationOverlayWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
    }
  });

  // Reposicionamento tardio: alguns compositors movem a janela 500ms após
  // o mapping. Aplica setBounds uma vez depois desse delay.
  setTimeout(() => forceTranslationOverlayPosition('delayed-500ms'), 500);

  // Mantém "sempre na frente" mesmo se o compositor rebaixar a janela ao trocar
  // de área de trabalho ou abrir outra janela. Barato: só reafirma o topo.
  const keepOnTop = setInterval(() => {
    if (!translationOverlayWindow || translationOverlayWindow.isDestroyed()) {
      clearInterval(keepOnTop);
      return;
    }
    try {
      if (!translationOverlayWindow.isAlwaysOnTop()) {
        translationOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      translationOverlayWindow.moveTop();
    } catch (_) {}
  }, 2000);

  translationOverlayWindow.on('closed', () => {
    clearInterval(keepOnTop);
    translationOverlayWindow = null;
  });

  return translationOverlayWindow;
}

function destroyTranslationOverlay() {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()) {
    try { translationOverlayWindow.close(); } catch (_) {}
  }
  translationOverlayWindow = null;
}

function sendToTranslationOverlay(channel, payload) {
  if (translationOverlayWindow && !translationOverlayWindow.isDestroyed()) {
    try { translationOverlayWindow.webContents.send(channel, payload); } catch (_) {}
  }
}

// Estica a janela em +200px quando o conteúdo passa do tamanho atual,
// até um máximo de 40% da tela. Depois disso o scroll interno toma conta.
function expandTranslationOverlayIfNeeded() {
  if (!translationOverlayWindow || translationOverlayWindow.isDestroyed()) return;
  // Usa o mesmo display em que a janela está
  const bounds = translationOverlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const wa = display.workArea;
  const maxW = Math.round(wa.width * 0.40);
  if (bounds.width >= maxW) return;
  const newW = Math.min(bounds.width + 200, maxW);
  const x = wa.x + wa.width - newW - 10;
  try {
    translationOverlayWindow.setBounds({ x, y: bounds.y, width: newW, height: bounds.height });
  } catch (_) {}
}

// =========================================================================
// OVERLAY DO ASSISTENTE GUIADO POR VISÃO (vision-guide-overlay.html)
// Mesmo padrão da translation-overlay: translúcido, always-on-top, stealth,
// arrasta pelo header. Fica na ESQUERDA por padrão (o do tradutor fica na
// direita) pra não colidir quando os dois estiverem abertos.
// =========================================================================
let visionGuideOverlayWindow = null;

function computeVisionGuideOverlayBounds() {
  let display;
  try {
    const cursor = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(cursor);
  } catch (_) {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea;
  const winWidth = Math.max(400, Math.round(wa.width * 0.22));
  const winHeight = Math.round(wa.height * 0.72);
  const posX = Math.max(wa.x, wa.x + 12);              // encostado à esquerda
  const posY = Math.max(wa.y, wa.y + Math.round((wa.height - winHeight) / 2));
  return { x: posX, y: posY, width: winWidth, height: winHeight };
}

function createVisionGuideOverlay() {
  if (visionGuideOverlayWindow && !visionGuideOverlayWindow.isDestroyed()) {
    return visionGuideOverlayWindow;
  }
  const b = computeVisionGuideOverlayBounds();
  console.log(`[vision-guide-overlay] criando: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`);

  visionGuideOverlayWindow = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    useContentSize: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    hasShadow: false,
    show: false,
    title: 'helper-node-vision-guide-overlay',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  visionGuideOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  visionGuideOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyStealthProtection(visionGuideOverlayWindow);

  visionGuideOverlayWindow.loadFile(
    path.join(__dirname, 'os-integration', 'notifications', 'vision-guide-overlay.html')
  );

  visionGuideOverlayWindow.once('ready-to-show', () => {
    try { visionGuideOverlayWindow.setBounds(computeVisionGuideOverlayBounds()); } catch (_) {}
    try { visionGuideOverlayWindow.show(); } catch (_) {}
  });

  visionGuideOverlayWindow.webContents.on('did-finish-load', () => {
    if (process.platform !== 'linux') {
      try { visionGuideOverlayWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
    }
  });

  const keepOnTop = setInterval(() => {
    if (!visionGuideOverlayWindow || visionGuideOverlayWindow.isDestroyed()) {
      clearInterval(keepOnTop);
      return;
    }
    try {
      if (!visionGuideOverlayWindow.isAlwaysOnTop()) {
        visionGuideOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      visionGuideOverlayWindow.moveTop();
    } catch (_) {}
  }, 2000);

  visionGuideOverlayWindow.on('closed', () => {
    clearInterval(keepOnTop);
    visionGuideOverlayWindow = null;
  });

  return visionGuideOverlayWindow;
}

function destroyVisionGuideOverlay() {
  if (visionGuideOverlayWindow && !visionGuideOverlayWindow.isDestroyed()) {
    try { visionGuideOverlayWindow.close(); } catch (_) {}
  }
  visionGuideOverlayWindow = null;
}

function sendToVisionGuideOverlay(channel, payload) {
  if (visionGuideOverlayWindow && !visionGuideOverlayWindow.isDestroyed()) {
    try { visionGuideOverlayWindow.webContents.send(channel, payload); } catch (_) {}
  }
}

// Estica a janela do tutor +200px quando o conteúdo cresce, até 42% da tela.
function expandVisionGuideOverlayIfNeeded() {
  if (!visionGuideOverlayWindow || visionGuideOverlayWindow.isDestroyed()) return;
  const bounds = visionGuideOverlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const wa = display.workArea;
  const maxW = Math.round(wa.width * 0.42);
  if (bounds.width >= maxW) return;
  const newW = Math.min(bounds.width + 200, maxW);
  try {
    visionGuideOverlayWindow.setBounds({ x: bounds.x, y: bounds.y, width: newW, height: bounds.height });
  } catch (_) {}
}

// Roteia guidance/status do serviço → overlay (modo integrado OU janela) + main.
visionGuide.onGuidance(({ text }) => {
  if (!text) return;
  if (configService.getOsIntegrationStatus()) {
    if (!visionGuideOverlayWindow || visionGuideOverlayWindow.isDestroyed()) createVisionGuideOverlay();
    sendToVisionGuideOverlay('vision-guide-message', { text });
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    // Modo janela/IDE: envia para o renderer da janela principal!
    mainWindow.webContents.send('vision-guide-message', { text });
  }
});

visionGuide.onStatus((status) => {
  sendToVisionGuideOverlay('vision-guide-status', status);
});

let currentEditorState = null;
ipcMain.on("set-editor-state", (event, state) => {
  currentEditorState = state;
});

// Metadados do editor/modo pro contexto do tutor (modo IDE: arquivo/pasta anexada).
visionGuide.setContextProvider(() => {
  try {
    const parts = [];
    const osOn = configService.getOsIntegrationStatus();
    const wsOn = configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled();
    parts.push(`Modo: ${osOn ? 'integrado com SO' : (wsOn ? 'IDE (pasta anexada)' : 'janela')}.`);
    if (wsOn) {
      try {
        const ctx = typeof getProjectContextSummary === 'function' ? getProjectContextSummary() : '';
        if (ctx) parts.push(ctx);
      } catch (_) {}
    }

    // Só envia o editorState se a janela principal estiver visível, não estiver minimizada e não estivermos no modo integrado
    const isMainActive = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
    const useEditorState = !osOn && isMainActive && currentEditorState;

    return {
      text: parts.join('\n'),
      editorState: useEditorState ? currentEditorState : null
    };
  } catch (_) { return { text: '', editorState: null }; }
});

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 640,
    height: 680,
    minWidth: 480,
    minHeight: 420,
    title: "Configurações",
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    skipTaskbar: HIDE_FROM_TASKBAR,
    icon: APP_ICON,
  });

  configWindow.loadFile("config.html");

  configWindow.on("closed", () => {
    configWindow = null;
  });
}

function createPreferencesWindow() {
  if (preferencesWindow) {
    preferencesWindow.focus();
    return;
  }

  preferencesWindow = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 480,
    minHeight: 460,
    title: "Preferências do Usuário",
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    skipTaskbar: HIDE_FROM_TASKBAR,
    icon: APP_ICON,
  });

  preferencesWindow.loadFile("preferences.html");

  preferencesWindow.on("closed", () => {
    preferencesWindow = null;
  });
}

// Botão de tela cheia/maximizar das janelas frameless (Configurações e
// Preferências abrem sem moldura nativa, então não têm o botão de maximizar
// do sistema). Alterna maximizado ↔ tamanho normal na janela que enviou o IPC.
ipcMain.on("window-toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  try {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } catch (_) {}
});

ipcMain.on("window-minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    try { win.minimize(); } catch (_) {}
  }
});

ipcMain.on("window-close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    try { win.close(); } catch (_) {}
  }
});

// OS Integration Mode Functions
function createOsInputWindow() {
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.focus();
    return;
  }

  osInputWindow = new BrowserWindow({
    width: 600,
    height: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Center on screen
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  osInputWindow.setPosition(
    Math.floor((width - 600) / 2), 
    Math.floor(height / 3)
  );

  // STEALTH: a caixa onde o usuário digita a pergunta não pode vazar em
  // gravação/compartilhamento (era a única overlay do fluxo sem proteção).
  applyStealthProtection(osInputWindow);
  try { osInputWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { osInputWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}

  const inputHtml = path.join(__dirname, 'os-integration', 'notifications', 'integratedInput.html');

  osInputWindow.loadFile(inputHtml);

  // NOTE: deliberadamente NÃO fechamos no blur. Em Wayland/COSMIC operações de
  // paste de imagem do clipboard podem disparar um blur transitório, que
  // fechava a janela antes do usuário enviar. Use Esc para fechar.

  osInputWindow.on('closed', () => {
    osInputWindow = null;
  });
}

// Mutex global: quando OS Integration + Translation Assistant estão ambos
// ativos, suprime TUDO o resto (atalhos de Vosk/captura/manual-input, monitor
// de clipboard, monitor de screenshots). Só o overlay do Translation Assistant
// aparece — comportamento "stealth interview".
function isTranslationOnlyMode() {
  try {
    return configService.getOsIntegrationStatus() && translationAssistant.isActive();
  } catch (_) { return false; }
}

// Proteção contra captura de tela — stealth window
// Chamada após criar qualquer janela overlay que não deve aparecer em gravações/compartilhamentos.
function applyStealthProtection(win) {
  if (process.platform === 'win32') {
    // Windows 10 2004+ / 11: setContentProtection chama
    // SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) — a janela é excluída
    // de TODA captura de tela (OBS, Zoom, Meet, PrintScreen). Stealth real,
    // ao contrário do Linux onde essa chamada é no-op.
    try { win.setContentProtection(true); } catch (_) {}
    return;
  }
  if (process.platform === 'darwin') {
    try { win.setContentProtection(true); } catch (_) {}
    return;
  }
  if (process.platform === 'linux') {
    try { win.setContentProtection(true); } catch (_) {}
    // X11: define tipo de janela como UTILITY — invisível para a maioria dos
    // compositors e ferramentas de captura (OBS "Window Capture", ffmpeg x11grab).
    win.webContents.once('did-finish-load', () => {
      try {
        const { execFile } = require('child_process');
        const handle = win.getNativeWindowHandle();
        const winId = (handle.length >= 8)
          ? handle.readBigUInt64LE(0).toString(16)
          : handle.readUInt32LE(0).toString(16);
        execFile('xprop', [
          '-id', `0x${winId}`,
          '-format', '_NET_WM_WINDOW_TYPE', '32a',
          '-set', '_NET_WM_WINDOW_TYPE', '_NET_WM_WINDOW_TYPE_UTILITY',
        ], (err) => {
          if (err) console.log('[stealth] xprop indisponível (normal em Wayland puro):', err.message);
          else console.log(`[stealth] X11 UTILITY atom aplicado (winId=0x${winId})`);
        });
      } catch (e) {
        console.log('[stealth] proteção X11 não aplicada:', e.message);
      }
    });
  }
}

// === Auto-close da janela 'response' (controlado pelo MAIN) ===
// O timer ficava no renderer (response.html) reagindo a mouseover/mouseout.
// Em COSMIC/Wayland a janela stealth só recebe esses eventos de forma confiável
// quando tem foco — daí o hover-pause "às vezes funcionava, às vezes só depois
// de sair/voltar o foco". Aqui detectamos o cursor por posição GLOBAL
// (screen.getCursorScreenPoint) vs. os bounds da janela: independe de foco e
// de eventos do DOM. O renderer só anima a barrinha conforme o estado que
// mandamos. O fechamento é decidido SEMPRE aqui.
function clearOsNotifAutoClose() {
  if (osNotifAutoCloseTimer) { clearInterval(osNotifAutoCloseTimer); osNotifAutoCloseTimer = null; }
}

function startResponseAutoClose() {
  clearOsNotifAutoClose();
  const AUTO_CLOSE_MS = 10000;
  const POLL_MS = 200;
  let remaining = AUTO_CLOSE_MS;
  let last = Date.now();
  let started = false; // já enviamos o 1º estado 'running'?
  osNotifAutoCloseTimer = setInterval(() => {
    const win = osNotificationWindow;
    if (!win || win.isDestroyed()) { clearOsNotifAutoClose(); return; }

    let inside = false;
    try {
      const p = screen.getCursorScreenPoint();
      const b = win.getBounds();
      inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    } catch (_) {}

    // Passar o mouse por cima UMA vez desabilita o auto-close DE VEZ:
    // a resposta fica aberta até o usuário fechar no X. (Antes só resetava
    // o contador e ele voltava a correr quando o mouse saía.)
    if (inside) {
      try { win.webContents.send('autoclose-state', { state: 'paused' }); } catch (_) {}
      clearOsNotifAutoClose(); // para o poll de vez — não fecha mais sozinho
      return;
    }

    // Mouse fora: conta o tempo regressivo. Se nunca passar por cima, some.
    const now = Date.now();
    if (!started) {
      started = true;
      last = now;
      try { win.webContents.send('autoclose-state', { state: 'running', ms: AUTO_CLOSE_MS }); } catch (_) {}
      return;
    }
    remaining -= (now - last);
    last = now;
    if (remaining <= 0) {
      clearOsNotifAutoClose();
      try { win.close(); } catch (_) {}
    }
  }, POLL_MS);
}

// Helper function to completely destroy the notification window
function destroyNotificationWindow() {
  clearOsNotifAutoClose();
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    console.log(`🔔 DESTROYING notification window completely`);
    try {
      osNotificationWindow.removeAllListeners(); // Remove all event listeners
      osNotificationWindow.destroy(); // Use destroy instead of close for immediate effect
      console.log(`🔔 Notification window destroyed successfully`);
    } catch (e) {
      console.log(`🔔 Error destroying notification:`, e);
    }
    osNotificationWindow = null;
  }
}

function createOsNotificationWindow(type, content) {
  const isOsOn = configService.getOsIntegrationStatus();
  if (!isOsOn) {
    console.log(`⚠️ Blocked createOsNotificationWindow of type ${type} because OS Integration is disabled.`);
    return;
  }
  console.log(`🔔 Creating OS notification - Type: ${type}, Content: ${content ? content.substring(0, 50) + '...' : 'no content'}`);
  
  // FORCE CLOSE existing notification using new helper function
  destroyNotificationWindow();

  // Close capture window when loading or response appears
  if (type === 'loading' || type === 'response') {
    destroyCaptureWindow();
  }

  // Set dynamic dimensions based on type - matching the original HTML file dimensions
  let windowWidth = 160;
  let windowHeight = 96;

  if (type === 'response') {
    // 2x mais alta — entrevistas têm respostas longas (TRADUÇÃO + RESPOSTA + código)
    // Forçada no canto direito (posY baixo + posX = direita) — não centralizar.
    // 500px: largura maior pra blocos de código não cortarem palavras/linhas.
    windowWidth = 500;
    windowHeight = 560;
  } else if (type === 'recording-live') {
    // Tamanho inicial confortável: cabe header + 1 linha de fala
    // sem precisar de scrollbar. Cresce dinamicamente via resize-overlay.
    // 380px: largura suficiente pra não cortar palavras grandes em PT-BR.
    windowWidth = 380;
    windowHeight = 110;
  }

  // Position in top right corner (afasta 30px da borda direita
  // pra evitar corte em compositores que reservam barra de scroll/overflow)
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const posX = Math.max(0, width - windowWidth - 30);
  const posY = 60;

  const isMovableOverlay = (type === 'recording-live' || type === 'response');
  // recording-live PRECISA de focusable=true em COSMIC/Wayland pro X fechar
  // e pra seleção de texto/copy funcionar. Sem foco, eventos de clique e
  // seleção são dropados pelo compositor.
  const isFocusable = (type === 'recording-live' || type === 'response');

  osNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    // x/y nas options é mais respeitado pelo COSMIC/Wayland do que setPosition()
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: isMovableOverlay,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Cria escondida e só mostra DEPOIS de posicionar — COSMIC/Wayland
    // centraliza janelas frameless ao mapear (mesma técnica da translation-overlay).
    show: false,
    // STEALTH OVERLAY: não rouba foco da janela ativa por padrão,
    // mas habilita pra recording-live/response (X + copy funcionarem)
    focusable: isFocusable,
    // Some no compartilhamento de tela (Teams/Meet/Zoom screen-share)
    // — funciona em X11; em Wayland depende do compositor
    type: 'toolbar',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Proteção multicamada: setContentProtection + xprop X11 UTILITY atom
  applyStealthProtection(osNotificationWindow);
  // Mantém SEMPRE acima de tudo (inclusive janelas em fullscreen de browser)
  osNotificationWindow.setAlwaysOnTop(true, 'screen-saver');
  osNotificationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Reforça posição para compositores que ignoram x/y das options (COSMIC/Hyprland centralizam às vezes)
  try { osNotificationWindow.setPosition(posX, posY); } catch (_) {}
  try { osNotificationWindow.setBounds({ x: posX, y: posY, width: windowWidth, height: windowHeight }); } catch (_) {}
  // Re-aplica depois do load — alguns compositors movem a janela ao mostrar
  osNotificationWindow.once('ready-to-show', () => {
    try { osNotificationWindow.setBounds({ x: posX, y: posY, width: windowWidth, height: windowHeight }); } catch (_) {}
    try { osNotificationWindow.show(); } catch (_) {}
    // Auto-close controlado pelo main (cursor por posição global, não por foco).
    // Pequeno atraso pra garantir que o listener de IPC do renderer já registrou.
    if (type === 'response') {
      setTimeout(() => {
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) startResponseAutoClose();
      }, 300);
    }
  });
  // COSMIC/Hyprland às vezes movem/centralizam a janela DEPOIS do mapping —
  // reaplica a posição uma vez após o delay (mesma técnica da translation-overlay).
  setTimeout(() => {
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      try { osNotificationWindow.setBounds({ x: posX, y: posY, width: windowWidth, height: windowHeight }); } catch (_) {}
    }
  }, 500);

  // Simply load the appropriate HTML file - let the files handle their own content
  let filePath;
  
  if (type === 'loading') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'loading.html');
  } else if (type === 'recording') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'recording.html');
  } else if (type === 'recording-live') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'recording-live.html');
  } else if (type === 'response') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'response.html');
  }

  // Load the HTML file
  osNotificationWindow.loadFile(filePath).catch(error => {
    console.error(`Error loading ${type} notification file:`, error);
  });

  // Store content for response notifications - the HTML file will handle displaying it
  if (type === 'response' && content) {
    // The response.html file will handle the content display
    osNotificationWindow.webContents.once('dom-ready', () => {
      osNotificationWindow.webContents.executeJavaScript(`
        if (typeof window.setResponseContent === 'function') {
          window.setResponseContent(${JSON.stringify(content)});
        } else {
          document.body.innerHTML = ${JSON.stringify(content)} + '<button class="close-btn" onclick="window.close()" style="position:absolute;top:5px;right:8px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0;width:20px;height:20px;z-index:1000;">×</button>';
        }
      `);
    });
  }

  osNotificationWindow.on('closed', () => {
    console.log(`🔔 OS notification window closed - Type: ${type}`);
    osNotificationWindow = null;
  });
}

function switchToOsIntegrationMode() {
  isOsIntegrationMode = true;
  currentEditorState = null; // Evita que estado antigo do editor bloqueie os prints de tela
  // Start capture tool monitoring when entering OS integration mode
  startCaptureToolMonitoring();
  // Monitora pasta de screenshots do COSMIC (captura via PrintScreen nativo)
  startScreenshotFolderMonitoring();
  // Hide main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  // Se o tutor estiver ativo, abre o overlay no modo integrado
  if (visionGuide.isActive()) {
    createVisionGuideOverlay();
    sendToVisionGuideOverlay('vision-guide-status', 'watching');
    try { visionGuide.triggerIntroduction(); } catch (e) { console.warn('[vision-guide] falha ao triggar intro:', e.message); }
  }
}

function switchToNormalMode() {
  isOsIntegrationMode = false;
  // Stop capture tool monitoring when leaving OS integration mode
  stopCaptureToolMonitoring();
  // Para monitoramento da pasta de screenshots
  stopScreenshotFolderMonitoring();
  // Close OS integration windows
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.close();
  }
  destroyNotificationWindow(); // Use helper function instead
  destroyCaptureWindow(); // Close capture window
  destroyTranslationOverlay(); // Fecha overlay dedicado do tradutor se aberto
  destroyVisionGuideOverlay(); // Fecha overlay dedicado do tutor se aberto

  // Stop capture tool monitoring when leaving OS integration mode
  stopCaptureToolMonitoring();

  // Show main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

// Capture tool detection and window functions
function createCaptureWindow() {
  if (osCaptureWindow && !osCaptureWindow.isDestroyed()) {
    return; // Already exists
  }

  // Only show capture window if OS integration mode is active
  if (!isOsIntegrationMode) {
    return;
  }

  // Don't create capture window if notification is already active
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    console.log('🎯 Notification ativa, não criando janela de captura');
    return;
  }

  console.log('🎯 Criando janela de captura');
  
  osCaptureWindow = new BrowserWindow({
    width: 120,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Position in top right corner (same as loading/response notifications)
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 120;
  osCaptureWindow.setPosition(width - windowWidth - 20, 60);

  // STEALTH: a janela de captura também não pode vazar em gravação/compartilhamento
  // (antes era a única overlay sem proteção — leak em Teams/Meet/OBS).
  applyStealthProtection(osCaptureWindow);
  try { osCaptureWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { osCaptureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}

  // Load capture animation
  const capturePath = path.join(__dirname, 'os-integration', 'notifications', 'capture.html');
  osCaptureWindow.loadFile(capturePath).catch(error => {
    console.error('Erro ao carregar janela de captura:', error);
  });

  osCaptureWindow.on('closed', () => {
    console.log('🎯 Janela de captura fechada');
    osCaptureWindow = null;
  });
}

function destroyCaptureWindow() {
  if (osCaptureWindow && !osCaptureWindow.isDestroyed()) {
    console.log('🎯 Destruindo janela de captura');
    osCaptureWindow.close();
    osCaptureWindow = null;
  }
}

// Simple and reliable detection for when user is actively selecting screenshot area
async function detectActiveSelectionInterface() {
  try {
    // Check for active screenshot selection processes - don't fail if no matches
    const { stdout } = await execPromise('ps aux | grep -E "(gnome-screenshot|flameshot|spectacle|maim|scrot|grim|slurp|grimshot|ksnip|deepin-screenshot|xfce4-screenshooter)" | grep -v grep || true');
    
    if (!stdout.trim()) {
      return false;
    }

    const processes = stdout.split('\n').filter(line => line.trim());
    
    for (const process of processes) {
      // GNOME Screenshot in area selection mode
      if (process.includes('gnome-screenshot') && (process.includes('-a') || process.includes('--area'))) {
        return true;
      }
      
      // Flameshot in GUI mode (interactive selection)
      if (process.includes('flameshot') && process.includes('gui')) {
        return true;
      }
      
      // Spectacle in region mode
      if (process.includes('spectacle') && (process.includes('-r') || process.includes('--region'))) {
        return true;
      }
      
      // Maim with selection flag
      if (process.includes('maim') && (process.includes('-s') || process.includes('--select'))) {
        return true;
      }
      
      // Scrot with selection flag
      if (process.includes('scrot') && process.includes('-s')) {
        return true;
      }
      
      // Wayland tools
      if (process.includes('grim') || process.includes('slurp') || process.includes('grimshot')) {
        return true;
      }
      
      // Other tools
      if (process.includes('ksnip') || process.includes('deepin-screenshot') || process.includes('xfce4-screenshooter')) {
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

function startCaptureToolMonitoring() {
  if (isTranslationOnlyMode()) {
    console.log('[mutex] captureToolMonitoring suprimido — Translation Assistant ativo');
    return;
  }
  if (captureToolInterval) {
    clearInterval(captureToolInterval);
  }

  console.log('🎯 Iniciando monitoramento de interface de seleção');
  
  let captureActive = false;
  
  captureToolInterval = setInterval(async () => {
    const isCapturing = await detectActiveSelectionInterface();
    
    if (isCapturing && !captureActive) {
      // Selection interface just opened
      captureActive = true;
      createCaptureWindow();
      console.log('📸 Interface de seleção aberta');
    } else if (!isCapturing && captureActive) {
      // Selection interface just closed
      captureActive = false;
      destroyCaptureWindow();
      console.log('📸 Interface de seleção fechada');
    }
  }, 500); // Check every 500ms for better responsiveness
}

function stopCaptureToolMonitoring() {
  if (captureToolInterval) {
    clearInterval(captureToolInterval);
    captureToolInterval = null;
    console.log('🎯 Monitoramento de captura parado');
  }
  
  destroyCaptureWindow();
}

async function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      backgroundColor: "#00000000",
      transparent: true,
      frame: process.platform === "linux",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
        backgroundThrottling: false,
      },
      focusable: true,
      alwaysOnTop: false,
      show: false,
      skipTaskbar: true,
      icon: APP_ICON,
      nodeIntegration: false,
    });

    mainWindow.setContentProtection(true);

    // macOS específico - oculta o ícone da Dock
    if (process.platform === "darwin") {
      app.dock.hide();
    }

    // Tentativa adicional para KDE para ocultar app na dock
    if (process.platform === "linux") {
      mainWindow.setSkipTaskbar(true);
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setTitle(""); // Janela sem título pode ajudar
    }

    if (process.env.XDG_SESSION_TYPE === "wayland") {
      mainWindow.setSkipTaskbar(true);
      console.log("Running on Wayland");
    } else {
      console.log("Running on X11");
    }

    mainWindow.on("ready-to-show", () => {
      console.log("Window ready to show");
      mainWindow.show();
      ensureWindowVisible(mainWindow);
      currentDisplayId = screen.getDisplayNearestPoint(
        mainWindow.getBounds()
      ).id;
      // Re-registra atalhos quando a janela ganha foco
      registerGlobalShortcuts();
    });

    mainWindow.on("closed", () => {
      console.log("Main window closed");
      mainWindow = null;
    });

    const indexPath = path.join(__dirname, "index.html");
    try {
      await fs.access(indexPath);
      await mainWindow.loadFile(indexPath);
      console.log("Loaded index.html successfully");
    } catch (error) {
      console.error("Error: index.html not found at", indexPath, error);
      app.quit();
      return;
    }

    // Desabilitar detecção de compartilhamento de tela
    //setupScreenSharingDetection();

    // Configuração de permissões
    mainWindow.webContents.session.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        if (permission === "autofill") {
          return callback(false);
        }
        callback(true);
      }
    );

    if (process.platform === "linux") {
      app.setAppUserModelId("com.seuapp.nome"); // ajuda o sistema a identificar melhor o app
    }
  } catch (error) {
    console.error("Error creating window:", error);
    app.quit();
  }
}

async function captureScreen() {
  // Check if OS integration mode is active
  const isOsIntegration = configService.getOsIntegrationStatus();
  
  if (isOsIntegration) {
    // Em COSMIC/Wayland o portal pode ser inconsistente com tools externas.
    // Tentamos primeiro a captura nativa via Electron desktopCapturer; se
    // o usuário pediu Ctrl+Shift+X explicitamente, ainda deixamos o fluxo
    // legacy abaixo rodar como fallback.
    const isCosmic = process.env.XDG_CURRENT_DESKTOP === "COSMIC";
    if (isCosmic) {
      console.log('📸 COSMIC detectado: usando captura nativa por seleção');
      try { await captureRegionNative(); return; } catch (e) {
        console.error('Captura nativa falhou, caindo no fluxo legacy:', e);
      }
    }
    
    // OS Integration Mode - show notification and process through AI
    console.log('📸 Captura iniciada no modo de integração com SO');
    
    // Show capture window while screenshot tool is running
    createCaptureWindow();
    
    const tmpPng = path.join(app.getPath("temp"), `helpernode-shot-${Date.now()}.png`);
    const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
    
    try {
      let screenshotSuccess = false;
      
      // Priority 1: Wayland - use external script for better compatibility
      if (isWayland && await commandExists("grim") && await commandExists("slurp")) {
        destroyCaptureWindow();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        try {
          const scriptPath = path.join(__dirname, 'capture-screenshot.sh');
          await execPromise(`bash "${scriptPath}" "${tmpPng}"`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } catch (err) {
          console.error('Erro ao capturar:', err.message);
          destroyCaptureWindow();
          createOsNotificationWindow('response', 'Captura cancelada ou falhou.');
          return;
        }
      } 
      // Priority 2: Hyprland specific (if not caught above)
      else if (isHyprland() && await commandExists("grim") && await commandExists("slurp")) {
        const { stdout: region } = await execPromise("slurp -f '%x %y %w %h'");
        const [x, y, w, h] = region.trim().split(/\s+/);
        await execPromise(`grim -g '${x},${y} ${w}x${h}' '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      }
      // Priority 3: gnome-screenshot (works better on X11)
      else if (await commandExists("gnome-screenshot")) {
        await execPromise(`gnome-screenshot -a -f '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // Priority 4: Wayland with just grim (full screen)
      else if (isWayland && await commandExists("grim")) {
        await execPromise(`grim '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // Priority 5: ImageMagick import (X11 fallback)
      else if (await commandExists("import")) {
        await execPromise(`import -window root '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // No tool found
      else {
        destroyCaptureWindow();
        createOsNotificationWindow('response', 'Nenhuma ferramenta de captura encontrada.');
        return;
      }
      
      if (screenshotSuccess) {
        // Destroy capture window and show loading
        destroyCaptureWindow();
        createOsNotificationWindow('loading', 'Processando imagem...');
        
        try {
          await fs.access(tmpPng);
          
          // Validar se o arquivo tem um tamanho mínimo
          const stats = await fs.stat(tmpPng);
          if (stats.size < 100) {
            throw new Error('Screenshot file too small, probably corrupted');
          }
          
          // Read and convert to base64
          const imgBuffer = await fs.readFile(tmpPng);
          const base64Image = `data:image/png;base64,${imgBuffer.toString('base64')}`;
          
          if (edition.isLite()) {
            // Lite (100% online): sem OCR local — manda a imagem direto pro
            // gpt-4o (visão), que lê o texto e responde no mesmo fluxo.
            console.log('🔍 Lite: captura → visão gpt-4o (sem OCR local)');
            createOsNotificationWindow('loading', 'Enviando para IA...');
            await processOsQuestion('', base64Image, { forceVision: true });
          } else {
            // Extract text with OCR
            console.log('🔍 Extraindo texto da captura...');
            const ocrText = await TesseractService.getTextFromImage(base64Image);

            if (!ocrText || ocrText.trim().length === 0) {
              console.warn('⚠️ Nenhum texto encontrado na captura');
              destroyNotificationWindow();
              await new Promise(resolve => setTimeout(resolve, 200));
              createOsNotificationWindow('response', 'Nenhum texto encontrado na imagem.');
              return;
            }

            console.log('📝 Texto extraído da captura:', ocrText);

            // Send to AI
            createOsNotificationWindow('loading', 'Enviando para IA...');
            await processOsQuestion(ocrText);
          }
          
        } catch (e) {
          console.error("Erro ao processar captura:", e);
          destroyNotificationWindow();
          await new Promise(resolve => setTimeout(resolve, 200));
          createOsNotificationWindow('response', 'Erro ao processar a captura.');
        } finally {
          // Clean up temp file
          try {
            await fs.unlink(tmpPng);
          } catch (unlinkError) {
            console.error('Erro ao deletar arquivo temporário:', unlinkError);
          }
        }
      } else {
        destroyCaptureWindow();
        createOsNotificationWindow('response', 'Falha ao capturar a tela.');
      }
    } catch (err) {
      console.error("Capture failed:", err);
      destroyCaptureWindow();
      createOsNotificationWindow('response', 'Erro na captura da tela.');
    }
    
  } else {
    // Normal Mode - send to main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("screen-capturing", true);

      const tmpPng = path.join(app.getPath("temp"), `helpernode-shot-${Date.now()}.png`);
      const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
      try {
        let screenshotSuccess = false;
        if (await commandExists("gnome-screenshot")) {
          await execPromise(`gnome-screenshot -a -f '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (isHyprland() && await commandExists("grim") && await commandExists("slurp")) {
          const { stdout: region } = await execPromise("slurp -f '%x %y %w %h'");
          const [x, y, w, h] = region.trim().split(/\s+/);
          await execPromise(`grim -g '${x},${y} ${w}x${h}' '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (isWayland && await commandExists("grim")) {
          await execPromise(`grim '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (await commandExists("import")) {
          await execPromise(`import -window root '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else {
          // Sem ferramenta de sistema: tenta método interno
          try {
            const data = await TesseractService.captureAndProcessScreenshot(mainWindow);
            console.log("OCR Data (internal):", data);
            if (data) return;
            throw new Error("Internal capture returned empty data");
          } catch (error) {
            console.error("Internal capture failed:", error);
            throw new Error("No screenshot tools available");
          }
        }

        // After successful capture and before sending result, read file as base64
        if (screenshotSuccess) {
          const imgBuffer = await fs.readFile(tmpPng);
          const base64Image = `data:image/png;base64,${imgBuffer.toString('base64')}`;
          // Proceed with OCR only if file exists
          try {
            await fs.access(tmpPng);
            
            // Validar se o arquivo tem um tamanho mínimo
            const stats = await fs.stat(tmpPng);
            if (stats.size < 100) {
              throw new Error('Screenshot file too small, probably corrupted');
            }
            
            const ocrText = await TesseractService.getTextFromImage(base64Image);
            mainWindow.webContents.send("ocr-result", { 
              text: ocrText || '', 
              screenshotPath: tmpPng, 
              base64Image 
            });
          } catch (e) {
            console.error("Screenshot file not accessible for OCR:", e);
            
            // Enviar resultado com erro em vez de texto vazio
            mainWindow.webContents.send("ocr-result", { 
              text: "", 
              screenshotPath: tmpPng, 
              base64Image,
              error: "Não foi possível processar a imagem" 
            });
          }
        } else {
          mainWindow.webContents.send("screen-capturing", false);
        }
      } catch (err) {
        console.error("Capture failed:", err);
      } finally {
        mainWindow.webContents.send("screen-capturing", false);
      }
    }
  }
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    exec(`command -v ${cmd}`, (error) => resolve(!error));
  });
}

ipcMain.on("process-pasted-image", (event, base64Image) => {
  // Dedup compartilhado com clipboard monitor: evita processar 2x
  // (cenario: monitor pegou o screenshot, user da Ctrl+V em seguida)
  try {
    const stripped = (base64Image || '').replace(/^data:image\/[a-z]+;base64,/, '');
    if (stripped) {
      const currentHash = calculateImageHash(Buffer.from(stripped, 'base64'));
      const now = Date.now();
      if (lastProcessedImageHash === currentHash &&
          lastProcessedTimestamp && (now - lastProcessedTimestamp) < IMAGE_COOLDOWN_MS) {
        console.log('🚫 [paste] imagem ja processada pelo clipboard monitor, ignorando Ctrl+V duplicado');
        return;
      }
      // Marca como processada pra o monitor nao re-disparar
      lastProcessedImageHash = currentHash;
      lastProcessedTimestamp = now;
      lastClipboardImageHash = currentHash;
    }
  } catch (e) {
    console.warn('[paste] falha ao calcular hash de dedup:', e && e.message);
  }

  console.log("Main process received pasted image.");
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Feedback visual (idempotente — se JS paste handler ja disparou, vira no-op rapido)
    mainWindow.webContents.send('screen-capturing', true);
    TesseractService.processPastedImage(base64Image, mainWindow).catch(
      (error) => {
        console.error("Error processing pasted image in main process:", error);
        
        // Enviar resultado com erro em vez de falhar silenciosamente
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ocr-result', {
            text: '',
            screenshotPath: '',
            base64Image: base64Image,
            error: 'Erro ao processar imagem colada'
          });
        }
      }
    );
  }
});

ipcMain.on(
  "process-manual-input-with-image",
  async (event, { text, image }) => {
    try {
      const imageTranscription = await TesseractService.getTextFromImage(image);
      const promptInstruction = await configService.getPromptInstruction();

      const finalPrompt = `${promptInstruction}<br>${text}<br>${imageTranscription}`;

      console.log("Final prompt with image transcription:", finalPrompt);

      // Validar se há texto suficiente para enviar
      if (!text?.trim() && !imageTranscription?.trim()) {
        console.warn("No text or image transcription found, not sending to AI");
        mainWindow.webContents.send(
          "transcription-error",
          "Nenhum texto encontrado na imagem ou entrada manual"
        );
        return;
      }

      await getIaResponse(finalPrompt);
    } catch (error) {
      console.error("Error processing manual input with image:", error);
      mainWindow.webContents.send(
        "transcription-error",
        "Failed to process image with manual input."
      );
    }
  }
);

// Função para detectar ferramentas de captura ativas
async function detectCaptureTools() {
  try {
    // Lista de ferramentas de captura comuns no Linux
    const captureTools = [
      'gnome-screenshot',
      'spectacle', 
      'flameshot',
      'shutter',
      'deepin-screenshot',
      'grim',
      'slurp',
      'ksnip',
      'xfce4-screenshooter',
      'kcreenshot'
    ];
    
    // Verificar se alguma ferramenta está rodando
    for (const tool of captureTools) {
      try {
        const { stdout } = await execPromise(`pgrep -f ${tool} 2>/dev/null || echo ''`);
        if (stdout.trim()) {
          console.log(`📸 Ferramenta de captura detectada: ${tool}`);
          return tool;
        }
      } catch (e) {
        // Continua para próxima ferramenta
      }
    }
    return false;
  } catch (error) {
    console.error('Erro ao detectar ferramentas de captura:', error);
    return false;
  }
}

// Função para criar notificação intermediária simples
function createIntermediateNotification() {
  console.log('📸 Mostrando notificação de captura detectada...');
  
  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    createOsNotificationWindow('loading', 'Ferramenta de captura detectada - aguardando imagem...');
  } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
    new Notification({
      title: 'Helper-Node',
      body: 'Ferramenta de captura detectada - aguardando imagem...',
      silent: true,
    }).show();
  }
}

// Detecta qualquer MIME de imagem na lista de tipos do clipboard.
// Prioridade: PNG (lossless, melhor pra OCR) > JPEG > WEBP > BMP > TIFF.
// Tinha lugares que só buscavam image/png e ignoravam screenshots em JPEG/BMP
// (alguns apps de captura cospem JPEG por padrão).
function pickImageMime(typesText) {
  if (!typesText) return null;
  const t = typesText.toLowerCase();
  const order = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/bmp', 'image/tiff', 'image/x-bmp'];
  for (const m of order) {
    if (t.includes(m)) return m;
  }
  // Último recurso: qualquer image/*
  const generic = t.match(/image\/[a-z0-9.+-]+/i);
  return generic ? generic[0] : null;
}

// Inicializar baseline do clipboard para evitar processar imagens existentes
async function initializeClipboardBaseline() {
  try {
    console.log('📋 Tentando inicializar baseline do clipboard...');
    const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
    let hasImage = false;
    let imageData = null;
    
    if (isWayland) {
      try {
        const wlResult = await execPromise('timeout 2 wl-paste --list-types 2>/dev/null || echo ""');
        const types = (wlResult && wlResult.stdout || '').toLowerCase();
        const mime = pickImageMime(types);
        if (mime) {
          const imageResult = await execPromise(`timeout 3 wl-paste --type ${mime} | base64 -w 0 2>/dev/null || echo ""`);
          if (imageResult && imageResult.stdout.trim()) {
            hasImage = true;
            imageData = `data:${mime};base64,` + imageResult.stdout.trim();
          }
        } else if (types.trim()) {
          console.log('📋 [baseline] clipboard tipos disponíveis (sem imagem):', types.split('\n').filter(Boolean).join(', '));
        }
      } catch (e) {
        console.log('📋 Wayland clipboard não disponível, tentando X11...');
      }
    }
    
    if (!hasImage) {
      try {
        const xclipResult = await execPromise('timeout 2 xclip -selection clipboard -t TARGETS -o 2>/dev/null || echo ""');
        const types = (xclipResult && xclipResult.stdout || '').toLowerCase();
        const mime = pickImageMime(types);
        if (mime) {
          const imageResult = await execPromise(`timeout 3 xclip -selection clipboard -t ${mime} -o | base64 -w 0 2>/dev/null || echo ""`);
          if (imageResult && imageResult.stdout.trim()) {
            hasImage = true;
            imageData = `data:${mime};base64,` + imageResult.stdout.trim();
          }
        } else if (types.trim()) {
          console.log('📋 [baseline] X11 clipboard tipos (sem imagem):', types.split('\n').filter(Boolean).join(', '));
        }
      } catch (e) {
        console.log('📋 X11 clipboard não disponível');
      }
    }
    
    if (hasImage && imageData) {
      const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
      const currentHash = calculateImageHash(Buffer.from(base64Data, 'base64'));
      lastClipboardImageHash = currentHash;
      // CRITICAL: marca a imagem que ja estava no clipboard como "recem-processada"
      // pra evitar que ela dispare auto-envio quando o monitor (re)inicia ao trocar
      // de modo (Normal <-> OS Integration). Sem isso, abrir Ctrl+I em OS mode com
      // uma imagem antiga no clipboard dispara OCR+IA dessa imagem velha.
      lastProcessedImageHash = currentHash;
      lastProcessedTimestamp = Date.now();
      console.log('📋 Clipboard baseline inicializado:', currentHash.substring(0, 8));
    } else {
      console.log('📋 Nenhuma imagem no clipboard para baseline');
    }
  } catch (error) {
    console.log('📋 Baseline falhou, mas não é crítico:', error.message);
    // Não é crítico, sistema funciona sem baseline
  }
}

// Em Wayland (especialmente COSMIC), wl-paste em polling background é
// frequentemente bloqueado pelo compositor até a app ganhar foco. Solução:
// 'wl-paste --watch <cmd>' usa o protocolo data-device e o compositor empurra
// notificações de mudança no clipboard, FUNCIONANDO SEM foco da app.
// Quando dispara, forçamos um "tick" imediato do polling pra ler o conteúdo.
function startWaylandClipboardWatch(triggerCheck) {
  if (clipboardWatchProc) { try { clipboardWatchProc.kill('SIGTERM'); } catch (_) {} clipboardWatchProc = null; }
  if (process.env.XDG_SESSION_TYPE !== 'wayland') return;
  try {
    // 'true' como comando: só queremos a notificação de mudança, não o conteúdo
    clipboardWatchProc = spawn('wl-paste', ['--watch', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] });
    clipboardWatchProc.stdout.on('data', () => triggerCheck && triggerCheck());
    clipboardWatchProc.on('error', (e) => console.log('📋 wl-paste --watch indisponível:', e.message));
    clipboardWatchProc.on('exit', (code) => {
      console.log('📋 wl-paste --watch encerrou (code=' + code + ')');
      clipboardWatchProc = null;
    });
    console.log('📋 wl-paste --watch ativo (event-driven, não precisa de foco da app)');
  } catch (e) {
    console.log('📋 falha ao iniciar wl-paste --watch:', e.message);
  }
}

// Função para iniciar monitoramento do clipboard usando ferramentas nativas
function startClipboardMonitoring() {
  if (isTranslationOnlyMode()) {
    console.log('[mutex] clipboardMonitoring suprimido — Translation Assistant ativo');
    return;
  }
  if (clipboardMonitoringInterval) {
    clearInterval(clipboardMonitoringInterval);
  }

  console.log('🎯 Iniciando monitoramento NATIVO de clipboard para novas imagens...');
  
  // Initialize with current clipboard content to avoid processing existing images
  initializeClipboardBaseline();

  // Função de checagem extraída pra ser chamada tanto pelo polling quanto
  // pelo wl-paste --watch (Wayland event-driven).
  const checkClipboardNow = async () => {
    try {
      const isPrintModeEnabled = configService.getPrintModeStatus();
      if (!isPrintModeEnabled) return;
      
      // Detect which environment we're in first to avoid running both commands
      const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
      let hasImage = false;
      let imageData = null;
      let currentHash = null;
      
      if (isWayland) {
        // Try Wayland first
        try {
          const wlResult = await execPromise('wl-paste --list-types 2>/dev/null').catch(() => null);
          const types = (wlResult && wlResult.stdout || '').toLowerCase();
          const mime = pickImageMime(types);
          if (mime) {
            try {
              const imageResult = await execPromise(`wl-paste --type ${mime} | base64 -w 0`);
              if (imageResult && imageResult.stdout && imageResult.stdout.trim()) {
                hasImage = true;
                imageData = `data:${mime};base64,` + imageResult.stdout.trim();
                const base64Data = imageResult.stdout.trim();
                currentHash = calculateImageHash(Buffer.from(base64Data, 'base64'));
              }
            } catch (extractError) {
              // Silent error handling for Wayland
            }
          }
        } catch (e) {
          // Silent error handling
          // Fallback to X11 if Wayland fails
        }
      }
      
      // Try X11 if not Wayland or if Wayland failed
      if (!hasImage) {
        try {
          const xclipResult = await execPromise('xclip -selection clipboard -t TARGETS -o 2>/dev/null').catch(() => null);
          const types = (xclipResult && xclipResult.stdout || '').toLowerCase();
          const mime = pickImageMime(types);
          if (mime) {
            const imageResult = await execPromise(`xclip -selection clipboard -t ${mime} -o | base64 -w 0`).catch(() => null);
            if (imageResult && imageResult.stdout) {
              hasImage = true;
              imageData = `data:${mime};base64,` + imageResult.stdout.trim();
              const base64Data = imageResult.stdout.trim();
              currentHash = calculateImageHash(Buffer.from(base64Data, 'base64'));
            }
          }
        } catch (e) {
          // Silent error handling
        }
      }
      
      if (hasImage && imageData && currentHash) {
        // Check if this is the same image as before
        if (currentHash === lastClipboardImageHash) {
          // Same image still in clipboard, no need to log repeatedly
          return;
        }
        
        // Check if this image was recently processed (cooldown check)
        const now = Date.now();
        const isRecentlyProcessed = lastProcessedImageHash === currentHash && 
                                   lastProcessedTimestamp && 
                                   (now - lastProcessedTimestamp) < IMAGE_COOLDOWN_MS;
        
        if (isRecentlyProcessed) {
          console.log('🚫 Image recently processed, waiting for cooldown period...');
          lastClipboardImageHash = currentHash; // Update clipboard hash but don't process
          return;
        }
        
        // This is a new image or cooldown period has passed
        if (currentHash !== lastClipboardImageHash) {
          // Check if already processing an image
          if (isProcessingImage) {
            console.log('🔒 Já processando uma imagem, aguardando...');
            lastClipboardImageHash = currentHash; // Update hash but don't process
            return;
          }
          
          console.log('📸 NOVA IMAGEM DETECTADA no clipboard! Processando automaticamente...');
          
          // Sinaliza loading no renderer (robot.gif) ate IA responder
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('screen-capturing', true);
          }
          
          // Set processing lock
          isProcessingImage = true;
          
          // Check if OS integration mode is enabled
          const isOsIntegration = configService.getOsIntegrationStatus();
          if (isOsIntegration) {
            // Se Vosk (recording-live) est\u00e1 rodando, N\u00c3O cria janela loading
            // \u2014 isso destruiria a bolha de conversa. A resposta vai abrir
            // numa janela secund\u00e1ria via showImageResponseInSecondaryWindow.
            if (!VoskStreamService.isRunning()) {
              createOsNotificationWindow('loading', 'Nova imagem detectada! Processando...');
            } else {
              console.log('[os-image] Vosk ativo \u2014 pulando janela loading (preserva recording-live)');
            }
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({
              title: 'Helper-Node',
              body: 'Nova imagem detectada! Processando...',
              silent: true,
            }).show();
          }
          
          // Mark as processed with timestamp
          lastProcessedImageHash = currentHash;
          lastProcessedTimestamp = now;
          
          await processNewClipboardImage(imageData);
        }
        
        lastClipboardImageHash = currentHash;
      } else {
        // No image found, reset clipboard hash
        if (lastClipboardImageHash !== null) {
          console.log('🔄 No image in clipboard anymore');
          lastClipboardImageHash = null;
        }
      }
    } catch (error) {
      console.error('❌ Erro no monitoramento de clipboard:', error);
    }
  }; // fim checkClipboardNow

  // Polling: 2s em X11, 5s em Wayland (Wayland confia no --watch pra notificação rápida).
  const pollMs = process.env.XDG_SESSION_TYPE === 'wayland' ? 5000 : 2000;
  clipboardMonitoringInterval = setInterval(checkClipboardNow, pollMs);

  // Wayland: instala watcher event-driven (dispara checkClipboardNow imediatamente em qualquer mudança).
  startWaylandClipboardWatch(() => {
    console.log('📋 wl-paste --watch: clipboard mudou → verificando...');
    checkClipboardNow();
  });
}

// Função para parar monitoramento do clipboard
function stopClipboardMonitoring() {
  if (clipboardMonitoringInterval) {
    clearInterval(clipboardMonitoringInterval);
    clipboardMonitoringInterval = null;
    lastClipboardImageHash = null;
    console.log('🛑 Monitoramento de clipboard parado');
  }
  if (clipboardWatchProc) {
    try { clipboardWatchProc.kill('SIGTERM'); } catch (_) {}
    clipboardWatchProc = null;
  }
  
  // Parar também o monitoramento de captura
  stopCaptureToolMonitoring();
  stopScreenshotFolderMonitoring();
}

// ─── Monitoramento da pasta de screenshots do COSMIC ─────────────────────────
// O COSMIC intercepta o PrintScreen antes do Electron — a gente nunca vê o
// evento. Mas o COSMIC salva o arquivo em ~/Pictures/Screenshots/ (ou
// ~/Pictures/ dependendo da config). Monitoramos com fs.watch: quando um
// novo PNG aparecer, lemos e processamos como se viesse do clipboard.
// Funciona sem foco, sem gambiarras, sem alterar nada no sistema.
// Caminhos conhecidos onde cada SO/DE salva screenshots por padrão.
// Monitoramos TODOS que existirem simultaneamente.
// PT-BR: ~/Imagens, ~/Documentos, ~/Área de Trabalho
// EN:    ~/Pictures, ~/Documents, ~/Desktop
// KDE Plasma: ~/Pictures/Screenshots
// macOS:      ~/Desktop, ~/Documents
// Xfce/LXDE:  diretório home diretamente
const SCREENSHOT_DIRS = [
  // PT-BR (Pop!_OS, Ubuntu, Fedora, Mint, Debian locale pt-BR)
  path.join(os.homedir(), 'Imagens'),
  path.join(os.homedir(), 'Documentos'),
  path.join(os.homedir(), 'Área de Trabalho'),
  path.join(os.homedir(), 'Area_de_Trabalho'),
  // EN (Ubuntu, Arch, Fedora, macOS locale en)
  path.join(os.homedir(), 'Pictures'),
  path.join(os.homedir(), 'Pictures', 'Screenshots'), // KDE Spectacle
  path.join(os.homedir(), 'Documents'),
  path.join(os.homedir(), 'Desktop'),
  // macOS
  path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop'),
];

function resolveScreenshotDir() {
  // Retorna TODAS as pastas existentes pra monitorar em paralelo
  return SCREENSHOT_DIRS.filter(dir => {
    try { return fs2.existsSync(dir) && fs2.statSync(dir).isDirectory(); } catch (_) { return false; }
  });
}

// watcher pode ser um array agora (múltiplas pastas)
function startScreenshotFolderMonitoring() {
  if (isTranslationOnlyMode()) {
    console.log('[mutex] screenshotFolderMonitoring suprimido — Translation Assistant ativo');
    return;
  }
  if (screenshotFolderWatcher) return; // já ativo

  const watchDirs = resolveScreenshotDir();
  if (!watchDirs.length) {
    // nenhuma pasta existe ainda — tenta criar ~/Imagens e monitorar
    const fallback = path.join(os.homedir(), 'Imagens');
    try { fs2.mkdirSync(fallback, { recursive: true }); } catch (_) {}
    watchDirs.push(fallback);
  }

  console.log(`[screenshot-watch] Monitorando ${watchDirs.length} pasta(s): ${watchDirs.join(', ')}`);

  // Baseline global: ignora arquivos já existentes em todas as pastas
  const knownFiles = new Set();
  for (const dir of watchDirs) {
    try {
      fs2.readdirSync(dir)
        .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .forEach(f => knownFiles.add(path.join(dir, f)));
    } catch (_) {}
  }
  console.log(`[screenshot-watch] Baseline: ${knownFiles.size} arquivo(s) ignorado(s)`);

  const watchers = [];

  const handleNewFile = async (dir, filename) => {
    if (!filename) return;
    if (!/\.(png|jpg|jpeg|webp)$/i.test(filename)) return;
    const filePath = path.join(dir, filename);
    if (knownFiles.has(filePath)) return;

    // Aguarda até 2s para o arquivo ser escrito completamente
    let attempts = 0;
    while (attempts < 20) {
      await new Promise(r => setTimeout(r, 100));
      try {
        const stat = fs2.statSync(filePath);
        if (stat.size > 0) break;
      } catch (_) { return; }
      attempts++;
    }
    if (!fs2.existsSync(filePath)) return;

    knownFiles.add(filePath);

    const isPrintModeEnabled = configService.getPrintModeStatus();
    if (!isPrintModeEnabled) return;

    try {
      const buf = fs2.readFileSync(filePath);
      const base64Image = `data:image/png;base64,${buf.toString('base64')}`;
      const hash = calculateImageHash(buf);
      const now = Date.now();

      if (lastProcessedImageHash === hash && lastProcessedTimestamp && (now - lastProcessedTimestamp) < IMAGE_COOLDOWN_MS) {
        console.log('[screenshot-watch] 🚫 imagem já processada, ignorando');
        return;
      }
      if (isProcessingImage) {
        console.log('[screenshot-watch] 🔒 já processando outra imagem, ignorando');
        return;
      }

      lastProcessedImageHash = hash;
      lastProcessedTimestamp = now;
      lastClipboardImageHash = hash;

      console.log(`[screenshot-watch] 📸 novo screenshot: ${filePath}`);
      await processNewClipboardImage(base64Image);
    } catch (e) {
      console.error('[screenshot-watch] erro ao processar arquivo:', e.message);
    }
  };

  for (const dir of watchDirs) {
    try {
      const w = fs2.watch(dir, (eventType, filename) => {
        if (eventType === 'rename') handleNewFile(dir, filename);
      });
      w.on('error', (e) => console.error(`[screenshot-watch] erro em ${dir}:`, e.message));
      watchers.push(w);
    } catch (e) {
      console.error(`[screenshot-watch] falha ao observar ${dir}:`, e.message);
    }
  }

  // Guarda array de watchers como objeto com close()
  screenshotFolderWatcher = {
    close: () => watchers.forEach(w => { try { w.close(); } catch (_) {} })
  };
  screenshotFolderWatcherPath = watchDirs.join(', ');
}

function stopScreenshotFolderMonitoring() {
  if (screenshotFolderWatcher) {
    try { screenshotFolderWatcher.close(); } catch (_) {}
    screenshotFolderWatcher = null;
    console.log('[screenshot-watch] 🛑 Monitoramento de pasta de screenshots parado');
  }
}

// Função para processar nova imagem do clipboard
async function processNewClipboardImage(base64Image) {
  try {
    console.log('🎯 Processando nova imagem do clipboard...');
    
    // Check if OS integration mode is enabled
    const isOsIntegration = configService.getOsIntegrationStatus();
    
    // A primeira notificação já foi exibida no clipboard monitoring
    // Não precisamos de segunda notificação de loading
    
    // Usar o TesseractService existente
    const text = await TesseractService.getTextFromImage(base64Image);
    
    if (!text || text.trim().length === 0) {
      console.warn('⚠️ OCR vazio — mandando direto pra visão da IA');

      if (isOsIntegration) {
        createOsNotificationWindow('loading', 'Analisando imagem (visão)...');
        try {
          await processOsQuestion('', base64Image, { forceVision: true });
        } catch (error) {
          console.error('Error in processOsQuestion (vision fallback):', error);
          if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
            osNotificationWindow.close();
            osNotificationWindow = null;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
          createOsNotificationWindow('response', 'Erro ao analisar imagem.');
        }
      } else {
        // Fora do OS mode: tambem manda visao se o renderer principal estiver disponivel
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('process-image-vision', base64Image);
        }
      }
      return;
    }
    
    console.log('📝 Texto extraído:', text);
    
    // Notificação de envio para IA
    if (isOsIntegration) {
      createOsNotificationWindow('loading', 'Enviando para IA...');
      // Process using OS integration mode
      // CRITICAL: passa a IMAGEM também (não só OCR). Capturas de UI/canvas/quiz
      // geram OCR vazio ou ruim — o auto-router em processOsQuestion decide
      // se manda só texto ou visão. Sem isso, OS mode silenciosamente "perde"
      // capturas onde o OCR não pega o conteúdo.
      try {
        await processOsQuestion(text, base64Image);
      } catch (error) {
        console.error('Error in processOsQuestion for clipboard image:', error);
        // Explicitly close any existing notification before showing error
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
          osNotificationWindow.close();
          osNotificationWindow = null;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        createOsNotificationWindow('response', 'Erro ao processar imagem.');
      }
    } else {
      if (appConfig.notificationsEnabled && Notification.isSupported()) {
        new Notification({
          title: 'Helper-Node',
          body: 'Enviando para IA...',
          silent: true,
        }).show();
      }
      // Usar o método existente getIaResponse
      await getIaResponse(text);
    }
    
  } catch (error) {
    console.error('❌ Erro ao processar imagem do clipboard:', error);
    
    // Check if OS integration mode is enabled for error notification
    const isOsIntegration = configService.getOsIntegrationStatus();
    
    // Notificação de erro
    if (isOsIntegration) {
      createOsNotificationWindow('response', 'Erro ao processar imagem');
    } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Erro ao processar imagem',
        silent: true,
      }).show();
    }
    
    // Enviar erro para o frontend se a janela estiver disponível
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription-error', 'Erro ao processar imagem do clipboard');
    }
  } finally {
    // Always release the processing lock
    isProcessingImage = false;
    console.log('🔓 Lock de processamento liberado');
  }
}

async function registerGlobalShortcuts() {
  if (!mainWindow) return;

  globalShortcut.unregisterAll();

  const isLinux = process.platform === "linux";
  const baseShortcuts = isLinux
    ? [
        { combo: "Ctrl+D", action: "toggle-recording" },
        { combo: "Ctrl+I", action: "manual-input" },
        // Ctrl+A NAO e' registrado: precisa ser livre pra selectAll nativo em textarea/input.
        { combo: "Ctrl+Shift+C", action: "open-config" },
        { combo: "Ctrl+Shift+X", action: "capture-screen" },
        { combo: "Ctrl+Shift+S", action: "capture-region-native" },
        { combo: "Ctrl+Shift+1", action: "move-to-display-0" },
        { combo: "Ctrl+Shift+2", action: "move-to-display-1" },
      ]
    : [
        { combo: "CommandOrControl+D", action: "toggle-recording" },
        { combo: "CommandOrControl+I", action: "manual-input" },
        // Cmd/Ctrl+A NAO e' registrado: livre pra selectAll nativo.
        { combo: "CommandOrControl+Shift+C", action: "open-config" },
        { combo: "CommandOrControl+Shift+X", action: "capture-screen" },
        { combo: "CommandOrControl+Shift+S", action: "capture-region-native" },
        { combo: "CommandOrControl+Shift+1", action: "move-to-display-0" },
        { combo: "CommandOrControl+Shift+2", action: "move-to-display-1" },
      ];

  // Fallback variants for Linux to improve reliability across environments
  const fallbackShortcuts = isLinux
    ? [
        { combo: "CommandOrControl+I", action: "manual-input" },
        { combo: "CommandOrControl+Shift+X", action: "capture-screen" },
        { combo: "CommandOrControl+Shift+1", action: "move-to-display-0" },
        { combo: "CommandOrControl+Shift+2", action: "move-to-display-1" },
      ]
    : [];

  const allShortcuts = [...baseShortcuts, ...fallbackShortcuts];

  allShortcuts.forEach(({ combo, action }) => {
    const registered = globalShortcut.register(combo, async () => {
      // Mutex amplo: TA + OS Integration ativos suprime todos os atalhos
      // exceto open-config (necessário pro usuário desligar o modo).
      if (isTranslationOnlyMode() && action !== "open-config" && action !== "capture-region-native") {
        console.log(`[mutex] atalho ${combo} (${action}) ignorado — TA + OS Integration ativos`);
        return;
      }

      if (action === "open-config") {
        createConfigWindow();
        return;
      }

      // Handle manual-input action for OS integration mode
      if (action === "manual-input") {
        await bringWindowToFocus(); // This function already handles OS integration mode
        return;
      }
      
      // Handle recording action (works in both modes)
      if (action === "toggle-recording") {
        await toggleRecording();
        return;
      }
      
      // Handle capture screen action (works in both modes)
      if (action === "capture-screen") {
        await captureScreen();
        return;
      }

      // Captura full-screen automática (sem seleção, sem prompt) → OCR → IA
      if (action === "capture-region-native") {
        try { await captureFullScreenAuto(); } catch (e) { console.error('captureFullScreenAuto failed:', e); }
        return;
      }
      
      // Handle display movement (only works in normal mode)
      if (action === "move-to-display-0") {
        moveToDisplay(0);
        return;
      }
      if (action === "move-to-display-1") {
        moveToDisplay(1);
        return;
      }
      
      // Other actions that require main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(action);
        if (action === "focus-window" && mainWindow.isMinimized()) {
          mainWindow.restore();
        }
      }
    });
    console.log(
      registered
        ? `Shortcut registered: ${combo}`
        : `Failed to register shortcut: ${combo}`
    );
  });

  // Log final registration state for key shortcuts
  ["Ctrl+I", "CommandOrControl+I", "Ctrl+Shift+X", "CommandOrControl+Shift+X", "Ctrl+Shift+1", "CommandOrControl+Shift+1", "Ctrl+Shift+2", "CommandOrControl+Shift+2"].forEach(
    (accel) => {
      try {
        const ok = globalShortcut.isRegistered(accel);
        console.log(`isRegistered(${accel}): ${ok}`);
      } catch (e) {
        // noop
      }
    }
  );
}

// Retorna as fontes de áudio: microfone + monitor do sistema
async function getAudioSources() {
  const sources = ['@DEFAULT_SOURCE@'];
  try {
    const { stdout } = await execPromise('pactl get-default-sink');
    sources.push(stdout.trim() + '.monitor');
  } catch (e) {
    sources.push('@DEFAULT_MONITOR@');
  }
  return sources;
}

async function toggleRealtimeAssistantRecording() {
  if (anyRealtimeActive()) {
    await stopAllRealtime();
    isRecording = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", {
        isRecording,
        audioFilePath,
      });
    }

    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Assistente em tempo real desativado.",
        silent: true,
      }).show();
    }
    return;
  }

  const service = pickRealtimeService();
  const isOnline = service === realtimeOpenAiService;

  // Só o caminho ONLINE (OpenAI) precisa do token. backend/Ollama não usa OpenAI.
  if (isOnline && !configService.getOpenIaToken()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("transcription-error", "Token da OpenAI não configurado.");
    }
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Erro de Configuração",
        body: "Configure o token da OpenAI para usar o assistente em tempo real.",
        silent: true,
      }).show();
    }
    return;
  }

  // Realtime e Assistente de Tradução são modos exclusivos — para a tradução
  // antes de iniciar o realtime (cada um tem seu próprio motor de áudio agora).
  if (isOnline && translationAssistant.isActive()) {
    await translationAssistant.stop().catch(() => {});
  }

  await service.start();
  isRecording = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("toggle-recording", {
      isRecording,
      audioFilePath,
    });
  }

  if (appConfig.notificationsEnabled && Notification.isSupported()) {
    new Notification({
      title: "Helper-Node",
      body: "Assistente em tempo real ativado. Transcrição ao vivo.",
      silent: true,
    }).show();
  }
}

// Na edição Lite, o app é 100% online → sempre OpenAI cloud, ignorando qualquer
// aiModel local (llama/llama-stream/ollamaLocal/backend) que tenha sobrado no config.
function getEffectiveAiModel() {
  return edition.isLite() ? 'openIa' : configService.getAiModel();
}

let dictationActive = false;
let dictationPcmChunks = [];
let dictationPcmBytes = 0;
let dictationProcessing = false;

// ── Ditado em janela no Windows/macOS (press-to-talk) ──────────────────────
// O caminho de janela (Ctrl+D fora do modo integrado) usava VoskStreamService,
// que depende de `parec` (PulseAudio) + Python — Linux-only. No Windows/macOS
// isso nunca capturava áudio: mostrava o "ouvindo" e nunca transcrevia.
// Aqui gravamos o PCM do bridge cross-platform (services/platform/nativeAudio),
// e transcrevemos via OpenAI ao apertar Ctrl+D de novo (press-to-talk). Gated
// a !linux — o caminho Vosk do Linux fica byte-idêntico.
let winDictationActive = false;
let winDictationChunks = [];
let winDictationBytes = 0;
let winDictationMicCb = null;

async function startWinDictation() {
  const nativeAudio = require('./services/platform/nativeAudio');
  winDictationChunks = [];
  winDictationBytes = 0;
  winDictationMicCb = (buf) => { winDictationChunks.push(buf); winDictationBytes += buf.length; };
  await nativeAudio.subscribe('mic', winDictationMicCb);
  winDictationActive = true;
  isRecording = true;
  try { mainWindow.webContents.send('toggle-recording', { isRecording: true, audioFilePath: null, isIdeMode: true }); } catch (_) {}
}

async function stopWinDictationAndTranscribe() {
  const nativeAudio = require('./services/platform/nativeAudio');
  try { if (winDictationMicCb) nativeAudio.unsubscribe('mic', winDictationMicCb); } catch (_) {}
  winDictationMicCb = null;
  winDictationActive = false;
  isRecording = false;

  const pcm = Buffer.concat(winDictationChunks, winDictationBytes);
  winDictationChunks = [];
  winDictationBytes = 0;

  // Esconde o "ouvindo" no renderer.
  try { mainWindow.webContents.send('toggle-recording', { isRecording: false, audioFilePath: null, isIdeMode: true }); } catch (_) {}

  if (!pcm || pcm.length < 3200) { // < ~0.1s de áudio útil
    try { mainWindow.webContents.send('transcription-error', 'Nenhum áudio detectado. Tente de novo.'); } catch (_) {}
    return;
  }

  const token = configService.getOpenIaToken();
  if (!token) {
    try { mainWindow.webContents.send('transcription-error', 'Configure a chave da OpenAI (Configurações) para transcrever no Windows.'); } catch (_) {}
    return;
  }

  recordingBusy = true;
  try {
    fs2.mkdirSync(AUDIO_TMP_DIR, { recursive: true });
    const wavPath = path.join(AUDIO_TMP_DIR, `windict_${Date.now()}.wav`);
    fs2.writeFileSync(wavPath, _buildWavFile(pcm, 16000, 1, 16));

    let text = '';
    try {
      text = await cloudTranscribeAudio(wavPath, token);
    } finally {
      try { await fs.unlink(wavPath); } catch (_) {}
    }

    if (!text || !text.trim() || text === '[BLANK_AUDIO]') {
      mainWindow.webContents.send('transcription-error', 'Nenhum áudio detectado. Tente de novo.');
      return;
    }

    const isIdeModeNow = (workspace.list() || []).length > 0;
    const aiModel = getEffectiveAiModel();
    if (isIdeModeNow) {
      mainWindow.webContents.send('ide-audio-transcribed', { text: text + ' ' });
    } else if (aiModel === 'llama-stream') {
      mainWindow.webContents.send('send-to-gemini-stream-auto', text);
    } else {
      getIaResponse(text);
    }
  } catch (e) {
    console.error('[win-dictation] erro:', e.message);
    try { mainWindow.webContents.send('transcription-error', 'Falha ao transcrever o áudio: ' + e.message); } catch (_) {}
  } finally {
    recordingBusy = false;
  }
}

async function toggleRecording() {
  try {
    // Realtime existe em todas as edições: na Lite/ChatGPT é 100% online (OpenAI),
    // na Full com backend/Ollama é o pipeline local (Vosk+Whisper). pickRealtimeService decide.
    const isRealtimeAssistantEnabled = configService.getRealtimeAssistantStatus();
    if (isRealtimeAssistantEnabled) {
      await toggleRealtimeAssistantRecording();
      return;
    }

    // Tradutor é um modo exclusivo, sem input de texto — nunca deve gravar/transcrever
    // via Ctrl+D nem jogar texto no composer (isso é exclusividade do modo IDE).
    // Sem esse guard, com pasta de projeto aberta (modo IDE) + Tradutor ativo numa
    // janela normal (não OS Integration), o Ctrl+D caía na rota de baixo e enchia
    // o composer mesmo com o Tradutor ligado.
    if (translationAssistant.isActive()) {
      console.log("Ctrl+D ignorado — Assistente de Tradução ativo (modo exclusivo, sem input de texto).");
      return;
    }

    // Anti-spam: ignora Ctrl+D enquanto ainda estamos transcrevendo/respondendo
    // o áudio do toque anterior (senão múltiplos toques enviam o mesmo áudio).
    if (recordingBusy) {
      console.log("Ctrl+D ignorado — ainda processando o áudio anterior.");
      return;
    }

    if (isRecording) {
      // === STOP RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();

      // Windows/macOS modo janela: para o press-to-talk e transcreve.
      if (winDictationActive) {
        await stopWinDictationAndTranscribe();
        return;
      }

      if (isOsIntegration && VoskStreamService.isRunning()) {
        const pending = osLiveSegment;
        VoskStreamService.stop();
        isRecording = false;
        clearOsVoskSilenceTimer();
        console.log("OS Integration: conversa contínua encerrada");
        if (pending && pending.hasSpeech && !pending.closing) {
          osLiveSegment = pending;
          closeOsLiveSegment().catch(e => console.error('[os-live] flush on stop:', e.message));
        }
        return;
      }

      if (dictationActive) {
        VoskStreamService.stop();
        dictationActive = false;
        isRecording = false;
        if (!isOsIntegration) {
          mainWindow.webContents.send("toggle-recording", { isRecording: false, audioFilePath: null, isIdeMode: true });
        }
        return;
      }

      if (recordingProcess) {
        recordingProcess.kill("SIGTERM");
        recordingProcess = null;
      }
      isRecording = false;
      console.log("Recording stopped");
      recordingBusy = true;

      if (!isOsIntegration) {
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({ title: "Helper-Node", body: "Ok, aguarde...", silent: true }).show();
        }
        mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
      } else {
        destroyNotificationWindow();
        createOsNotificationWindow('loading', 'Processando áudio...');
      }

      try {
        await fs.access(audioFilePath);
        console.log("Audio file created:", audioFilePath);

        if (!isOsIntegration) {
          mainWindow.webContents.send("transcription-start", { audioFilePath });
        }

        const convertedAudioPath = path.join(AUDIO_TMP_DIR, "output_converted.wav");
        await execPromise(`ffmpeg -i ${audioFilePath} -ar 16000 -ac 1 -sample_fmt s16 -y ${convertedAudioPath}`);

        const audioText = edition.isLite()
          ? await cloudTranscribeAudio(convertedAudioPath, configService.getOpenIaToken())
          : await transcribeAudio(convertedAudioPath);

        try { await fs.unlink(audioFilePath); } catch (_) {}
        try { await fs.unlink(convertedAudioPath); } catch (_) {}

        if (!audioText || !audioText.trim() || audioText === "[BLANK_AUDIO]") {
          if (isOsIntegration) {
            createOsNotificationWindow('response', 'Nenhum áudio detectado. Tente novamente.');
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({ title: "Helper-Node", body: "Nenhum áudio detectado.", silent: true }).show();
          }
          return;
        }

        const aiModel = getEffectiveAiModel();
        const isIdeModeNow = (workspace.list() || []).length > 0;
        if (isIdeModeNow) {
          mainWindow.webContents.send("ide-audio-transcribed", { text: audioText + " " });
        } else if (isOsIntegration) {
          await processOsQuestion(audioText);
        } else if (aiModel === 'llama-stream') {
          mainWindow.webContents.send("send-to-gemini-stream-auto", audioText);
        } else {
          getIaResponse(audioText);
        }
      } catch (error) {
        console.error("Audio processing failed:", error);
      } finally {
        recordingBusy = false;
      }
    } else {
      // === START RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();
      const isIdeMode = (workspace.list() || []).length > 0;

      if (isOsIntegration && translationAssistant.isActive()) {
        console.log("OS Integration: Translation Assistant ativo — Ctrl+D ignorado (mutex).");
        return;
      }

      // Windows/macOS modo janela: Vosk/parec não existem fora do Linux. Usa o
      // bridge nativo (press-to-talk): Ctrl+D grava, Ctrl+D de novo transcreve.
      if (!isOsIntegration && process.platform !== 'linux') {
        try {
          await startWinDictation();
        } catch (e) {
          console.error('[win-dictation] falha ao iniciar:', e.message);
          try { mainWindow.webContents.send('transcription-error', 'Falha ao acessar o microfone: ' + e.message); } catch (_) {}
          winDictationActive = false;
          isRecording = false;
        }
        return;
      }

      if (!isOsIntegration) {
        // App Full / Janela / CLI -> Modo Ditado com 2s de silêncio (Vosk + Whisper Progressivo)
        dictationActive = true;
        dictationPcmChunks = [];
        dictationPcmBytes = 0;
        dictationProcessing = false;

        mainWindow.webContents.send("toggle-recording", { isRecording: true, audioFilePath: null, isIdeMode: true });

        VoskStreamService.start({
          audioSources: ['@DEFAULT_SOURCE@'],
          onEvent: async (event) => {
            if (event.type === 'audio') {
              dictationPcmChunks.push(event.data);
              dictationPcmBytes += event.data.length;
            } else if (event.type === 'result') {
              if (dictationPcmBytes > 0 && !dictationProcessing) {
                dictationProcessing = true;
                const pcm = Buffer.concat(dictationPcmChunks, dictationPcmBytes);
                dictationPcmChunks = [];
                dictationPcmBytes = 0;
                const wavPath = path.join(AUDIO_TMP_DIR, `dictation_${Date.now()}.wav`);
                try {
                  fs2.mkdirSync(AUDIO_TMP_DIR, { recursive: true });
                  fs2.writeFileSync(wavPath, _buildWavFile(pcm, 16000, 1, 16));
                  
                  const text = edition.isLite() 
                    ? await cloudTranscribeAudio(wavPath, configService.getOpenIaToken()) 
                    : await transcribeAudio(wavPath, { emitRenderer: false, emitNotifications: false });
                    
                  if (text && text.trim() && text !== "[BLANK_AUDIO]") {
                    // Manda colar no input
                    mainWindow.webContents.send("ide-audio-transcribed", { text: text + " " });
                    // Garante que o icone 'listening' volte após colar, pois o frontend esconde
                    mainWindow.webContents.send("toggle-recording", { isRecording: true, audioFilePath: null, isIdeMode: true });
                  }
                } catch (e) {
                  console.error("[dictation] error:", e.message);
                } finally {
                  try { await fs.unlink(wavPath); } catch (_) {}
                  dictationProcessing = false;
                }
              }
            }
          }
        });
        isRecording = true;
        return;
      }

      // OS Integration Legacy Start
      await fs.unlink(audioFilePath).catch(() => {});
      const command = `pw-record "${audioFilePath}"`;
      recordingProcess = exec(command, (error) => {});
      isRecording = true;

      destroyNotificationWindow();
      createOsNotificationWindow('recording', '');
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
  }
}

function formatForPlainTextNotification(html) {
  let text = html;
  // Substitui tags de bloco por quebras de linha para melhor legibilidade
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");

  // Converte tags de ênfase para uma sintaxe similar a markdown
  text = text.replace(/<strong>(.*?)<\/strong>/gi, "**");
  text = text.replace(/<b>(.*?)<\/b>/gi, "**");
  text = text.replace(/<em>(.*?)<\/em>/gi, "__");
  text = text.replace(/<i>(.*?)<\/i>/gi, "__");

  // Remove quaisquer tags HTML restantes
  text = text.replace(/<[^>]*>/g, "");

  // Decodifica entidades HTML comuns
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  return text.trim();
}

function chunkText(text, chunkSize = 250) {
  const finalChunks = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (line.trim() === "") continue;

    if (line.length <= chunkSize) {
      finalChunks.push(line.trim());
    } else {
      // This line is too long, so we chunk it.
      let remaining = line;
      while (remaining.length > 0) {
        let chunk = remaining.substring(0, chunkSize);
        const lastSpace = chunk.lastIndexOf(" ");

        if (lastSpace > 0 && remaining.length > chunkSize) {
          chunk = chunk.substring(0, lastSpace);
        }

        finalChunks.push(chunk.trim());
        remaining = remaining.substring(chunk.length).trim();
      }
    }
  }
  return finalChunks;
}

function formatToHTML(text) {
  if (!text) return "";

  const escapeHTML = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  let formatted = text;
  const codeBlocks = [];

  // Capturar blocos de código
  formatted = formatted.replace(
    /```(\w+)?\n([\s\S]*?)\n```/g,
    (match, lang, code) => {
      const codeId = `code-block-${codeBlocks.length}`;
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(
        `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${
          lang || "text"
        }">${escapeHTML(code)}</code></pre>`
      );
      return placeholder;
    }
  );

  const lines = formatted.split("\n");
  const formattedLines = [];

  for (let line of lines) {
    if (line.match(/__CODE_BLOCK_\d+__/)) {
      formattedLines.push(line);
      continue;
    }

    line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, "<strong>$1$2</strong>");
    line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, "<em>$1$2</em>");
    if (line.match(/^\s*[-*]\s+(.+)/)) {
      line = line.replace(/^\s*[-*]\s+(.+)/, "<li>$1</li>");
    } else if (line.trim()) {
      line = `<p>${line}</p>`;
    }

    formattedLines.push(line);
  }

  // Não usar <br> entre <p>/<li> — eles já têm margem própria.
  // <br> só faz sentido entre linhas "soltas" (placeholders de bloco de código).
  formatted = formattedLines
    .filter((line) => line.trim())
    .map((line) => {
      // Linha já é tag de bloco? mantém sem <br> extra.
      if (/^\s*(<p>|<li>|__CODE_BLOCK_)/.test(line)) return line;
      return line + "<br>";
    })
    .join("");

  if (formatted.includes("<li>")) {
    // Agrupa <li> consecutivos em <ul>
    formatted = formatted.replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  }

  codeBlocks.forEach((block, index) => {
    formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
  });

  formatted = formatted.replace(/(<br>)+$/, "").replace(/^(<br>)+/, "");
  return formatted;
}

async function getIaResponse(text) {
  globalBypassAllConfirmations = false;
  console.log("getIaResponse called with text:", text);
  waitingNotificationInterval = setInterval(() => {
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Aguarde, gerando uma resposta...",
        silent: true,
      }).show();
    }
  }, 10000);

  let resposta;
  let usedKnowledge = false; // base de conhecimento foi injetada nesta resposta?
  try {
    const aiModel = getEffectiveAiModel();
    console.log("Current AI Model:", aiModel);

    if (aiModel === 'openIa') {
        const token = configService.getOpenIaToken();
        const instruction = configService.getPromptInstruction();
        if (!token) {
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({
                    title: "Erro de Configuração",
                    body: "O token da OpenAI não está configurado. Por favor, adicione o token nas configurações.",
                    silent: true,
                }).show();
            }
            clearInterval(waitingNotificationInterval);
            waitingNotificationInterval = null;
            return;
        }
        const openAiModel = configService.getOpenAiModel();

        // Comando direto não planeja (só executa); tarefa complexa → agentic.
        const useAgentic = shouldUseAgentic(text);

        // O agentic limpa as sessões da IA; sem re-injetar o contexto do
        // workspace a IA "esquece" o projeto. Reseta a flag ANTES de montar o
        // contexto pra garantir que a estrutura do projeto entre neste turno.
        if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }

        const _wsText1 = await prependWorkspaceContextIfNeeded(text, openAiModel);

        if (useAgentic) {
            console.log('🤖 Iniciando AGENTIC WORKFLOW (multi-fase)...');
            // Limpa a sessão anterior pra evitar contaminação entre tarefas distintas.
            if (OpenAIService.sessions) OpenAIService.sessions = {};

            try {
              resposta = await agenticWorkflow.run(
                  _wsText1,
                  { token, model: openAiModel, baseInstruction: instruction },
                  mainWindow.webContents
              );
            } catch (err) {
              resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
            } finally {
              // Próximo turno re-injeta o contexto do projeto (a sessão foi limpa).
              try { workspace.resetContextSent(); } catch (_) {}
            }
        } else {
            const _kb1 = await knowledgeBlockForOpenAI(text);
            if (_kb1) usedKnowledge = true;
            const _augText1 = _kb1 ? _kb1 + "\n\n---\n\n" + _wsText1 : _wsText1;
            const ht = buildHelperToolsOpenAIOpts(_augText1, instruction, openAiModel);
            resposta = await OpenAIService.makeOpenAIRequest(
              _augText1,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              null,
              ht.opts
            );
        }
    } else if (aiModel === 'ollamaLocal') {
        const OllamaLocalService = require('./services/ollamaLocalService');
        const _kbL = await knowledgeBlockForOllama(text);
        if (_kbL) usedKnowledge = true;
        const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + text : text;

        const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
        if (htEnabled) {
          const instructionO = configService.getPromptInstruction();
          const _wsTxtO = await prependWorkspaceContextIfNeeded(_augTextL, 'ollama');
          const _htO = buildHelperToolsOpenAIOpts(_wsTxtO, instructionO, configService.getOpenAiModel());
          resposta = await OllamaLocalService.responder(_wsTxtO, _htO.opts);
        } else {
          resposta = await OllamaLocalService.responder(_augTextL);
        }
    } else {
        // Ollama/Backend e' o unico provider nao-OpenAI suportado.
        // Helper tools agora funcionam tambem no Ollama (via structured prompt + parser).
        try {
          const instructionO = configService.getPromptInstruction();
          const useAgentic = shouldUseAgentic(text);
          if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }
          const _wsTxtO = await prependWorkspaceContextIfNeeded(text, 'ollama');

          if (useAgentic) {
              console.log('🤖 Iniciando AGENTIC WORKFLOW OLLAMA (multi-fase)...');
              BackendService.clearSessions();
              try {
                resposta = await ollamaAgenticWorkflow.run(
                    _wsTxtO, 
                    { baseInstruction: instructionO },
                    mainWindow.webContents
                );
              } catch (err) {
                resposta = `[Ollama Agentic] Interrompido ou falhou: ${err.message}`;
              }
          } else {
              const _kbO = await knowledgeBlockForOllama(text);
              if (_kbO) usedKnowledge = true;
              const _augTxtO = _kbO ? _kbO + "\n\n---\n\n" + _wsTxtO : _wsTxtO;
              const _htO = buildHelperToolsOpenAIOpts(_augTxtO, instructionO, configService.getOpenAiModel());
              resposta = await BackendService.responder(_augTxtO, _htO.opts);
          }
          backendIsOnline = true;
        } catch (backendError) {
          console.error("Backend Ollama falhou:", backendError && backendError.message);
          backendIsOnline = false;
          throw new Error(
            "Backend Ollama indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
          );
        }
    }

    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;

    // Formata a resposta para exibição na UI
    const formattedResposta = formatToHTML(resposta);
    mainWindow.webContents.send("gemini-response", { resposta: formattedResposta, usedKnowledge });

    // Usa a resposta crua para a notificação de texto simples
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      const plainTextBody = formatForPlainTextNotification(resposta);
      const chunks = chunkText(plainTextBody);

      (async () => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (chunk) {
            new Notification({
              title: `Resposta do Assistente (${i + 1}/${chunks.length})`,
              body: chunk,
              silent: true,
            }).show();

            if (i < chunks.length - 1) {
              await new Promise((res) => setTimeout(res, 2000));
            }
          }
        }
      })();
    }
  } catch (error) {
    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;

    console.error("IA service error:", error);
    mainWindow.webContents.send(
      "transcription-error",
      "Failed to process IA response"
    );
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Erro do Assistente",
        body: "Não foi possível gerar uma resposta de nenhuma fonte.",
        silent: true,
      }).show();
    }
  }
}

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of json "${filePath}"`
    );
    const data = JSON.parse(stdout);
    const duration = parseFloat(data.format.duration);
    console.log(`Duração do áudio: ${duration} segundos`);
    return duration;
  } catch (error) {
    console.error("Erro ao obter duração do áudio:", error.message);
  }
}

async function transcribeAudio(filePath, options = {}) {
  const { emitRenderer = true, emitNotifications = true } = options;

  try {
    // Obter a duração do áudio
    const duration = await getAudioDuration(filePath);

    const whisperPath = path.join(__dirname, "whisper/build/bin/whisper-cli");
    const modelPathSmall = path.join(__dirname, "whisper/models/ggml-small.bin");
    const modelPathMedium = path.join(__dirname, "whisper/models/ggml-medium.bin");

    // Determinar idioma do whisper com base na configuração do app
    const savedLang = configService.getLanguage();
    const whisperLang = savedLang === 'us-en' ? 'en' : 'pt';

    // Escolher modelo e parâmetros com base na duração
    // medium = melhor qualidade, entende nomes próprios e termos em inglês misturados com pt-br
    // small = fallback para áudios longos (> 60s) onde velocidade importa mais
    let modelPath, command;
    if (duration > 60) {
      modelPath = modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l ${whisperLang} --threads 16 --no-timestamps --best-of 3 --beam-size 3`;
      console.log("Usando modelo small (áudio longo)");
    } else {
      modelPath = fs2.existsSync(modelPathMedium) ? modelPathMedium : modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l ${whisperLang} --threads 18 --no-timestamps --best-of 5 --beam-size 5`;
      console.log(`Usando modelo ${modelPath.includes('medium') ? 'medium' : 'small'}`);
    }

    console.log("Executing whisper:", command);
    return new Promise((resolve, reject) => {
      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error("Whisper error:", stderr);
          mainWindow.webContents.send(
            "transcription-error",
            "Failed to transcribe audio"
          );
          reject(error);
          return;
        }
        const text = stdout.trim();
        console.log("Transcription:", text || "No text recognized");
        const cleanText = await limparTranscricao(text);
        if (emitRenderer && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("transcription-result", { cleanText });
        }

        if (
          emitNotifications &&
          appConfig.notificationsEnabled &&
          Notification.isSupported() &&
          cleanText
        ) {
          const notification = new Notification({
            title: "Helper-Node",
            body: "Usuário perguntou: " + cleanText,
            silent: true,
          });
          notification.show();
        }

        resolve(cleanText);
      });
    });
  } catch (error) {
    console.error("Transcription error:", error);
    if (emitRenderer && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(
        "transcription-error",
        "Failed to transcribe audio"
      );
    }
  }
}

async function limparTranscricao(texto) {
  return texto
    .replace(
      /\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g,
      ""
    )
    .trim();
}

function setupScreenSharingDetection() {
  checkScreenSharing();
  sharingCheckInterval = setInterval(checkScreenSharing, 3000);

  screen.on("display-metrics-changed", () => {
    console.log("Display metrics changed");
    checkScreenSharing();
    updateWindowPosition();
  });
}

async function checkScreenSharing() {
  try {
    const isSharing = await detectScreenSharing();
    if (isSharing !== sharingActive) {
      console.log("Chrome gravando a tela");
      sharingActive = isSharing;
      handleScreenSharing();
    }
  } catch (error) {
    console.error("Erro na verificação:", error);
  }
}

async function detectChromeScreenSharing() {
  try {
    const { stdout } = await execPromise(
      `ps aux | grep '[c]hrome' | grep -E -- '--type=renderer.*(pipewire|screen-capture|WebRTCPipeWireCapturer)'`
    );
    const isSharing =
      stdout.toLowerCase().includes("chrome") && stdout.includes("pipewire");
    if (isSharing) {
      console.log("Chrome screen-sharing detected in process:", stdout.trim());
    }
    return isSharing;
  } catch (error) {
    console.log("No Chrome screen-sharing detected:", error.message);
    return false;
  }
}

async function detectScreenSharing() {
  try {
    const sharingApps = ["chrome", "teams", "zoom", "obs", "discord"];
    const { stdout } = await execPromise(
      `ps aux | grep -E '${sharingApps.join("|")}' | grep -v grep`
    );
    const processes = stdout.toString().toLowerCase();
    const sharingIndicators = [
      "--type=renderer",
      "--enable-features=WebRTCPipeWireCapturer",
      "screen-sharing",
    ];
    return (
      sharingApps.some(
        (app) =>
          processes.includes(app) &&
          sharingIndicators.some((indicator) => processes.includes(indicator))
      ) || detectChromeScreenSharing()
    );
  } catch (error) {
    console.error("Error detecting screen sharing:", error);
    return false;
  }
}

function updateWindowPosition() {
  try {
    const displays = screen.getAllDisplays();
    const currentDisplay = screen.getDisplayNearestPoint(
      mainWindow.getBounds()
    );

    if (displays.length < 2) {
      console.log("Single display detected, hiding window");
      mainWindow.hide();
      return;
    }

    const sharingDisplay = getSharingDisplay();
    if (sharingDisplay && sharingDisplay.id === currentDisplay.id) {
      const otherDisplay = displays.find((d) => d.id !== currentDisplay.id);
      if (otherDisplay) {
        const otherIndex = displays.findIndex((d) => d.id === otherDisplay.id);
        console.log("Attempting to move to display index:", otherIndex);
        moveToDisplay(otherIndex);
        // Verify movement
        const newBounds = mainWindow.getBounds();
        const newDisplay = screen.getDisplayNearestPoint(newBounds);
        if (newDisplay.id === otherDisplay.id) {
          currentDisplayId = otherDisplay.id;
          console.log(
            "Successfully moved to display index:",
            otherIndex,
            "ID:",
            currentDisplayId
          );
        } else {
          console.error("Failed to move to display index:", otherIndex);
        }
      }
    } else {
      mainWindow.show();
      console.log("Window already on non-shared display");
    }
  } catch (error) {
    console.error("Error updating window position:", error);
  }
}

function getSharingDisplay() {
  return screen.getPrimaryDisplay();
}

function handleScreenSharing() {
  try {
    if (sharingActive && mainWindow && !mainWindow.isDestroyed()) {
      console.log("Screen sharing active, updating position");
      updateWindowPosition();
      mainWindow.setContentProtection(true);
    } else {
      console.log("No screen sharing, showing window");
      mainWindow.show();
    }
  } catch (error) {
    console.error("Error handling screen sharing:", error);
  }
}

function ensureWindowVisible(win) {
  const windowBounds = win.getBounds();
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    return (
      windowBounds.x >= x &&
      windowBounds.x < x + width &&
      windowBounds.y >= y &&
      windowBounds.y < y + height
    );
  });

  if (!visible) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    const newX = x + Math.round((width - windowBounds.width) / 2);
    const newY = y + Math.round((height - windowBounds.height) / 2);
    console.log("Janela fora da tela. Reposicionando para:", newX, newY);
    win.setBounds({
      x: newX,
      y: newY,
      width: windowBounds.width,
      height: windowBounds.height,
    });
  }
}

function isHyprland() {
  return !!process.env.HYPRLAND_INSTANCE_SIGNATURE;
}

function moveToDisplay(targetIndex) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return;

  // Clamp index
  const idx = Math.max(0, Math.min(targetIndex, displays.length - 1));
  const targetDisplay = displays[idx];
  const bounds = targetDisplay.workArea || targetDisplay.bounds;

  // Position window centered on target display
  const [winW, winH] = mainWindow.getSize();
  const x = Math.floor(bounds.x + (bounds.width - winW) / 2);
  const y = Math.floor(bounds.y + (bounds.height - winH) / 2);

  mainWindow.setBounds({ x, y, width: winW, height: winH });
  mainWindow.focus();
  currentDisplayId = targetDisplay.id;
  console.log(`Moved window to display index ${idx} (id=${targetDisplay.id})`);
}

async function bringWindowToFocus() {
  console.log(
    "bringWindowToFocus: Tentando trazer a janela para o foco e abrir o input."
  );
  
  // Check if OS integration mode is enabled
  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    // Use OS integration input instead
    createOsInputWindow();
    return;
  }
  
  if (!mainWindow) return;

  if (isHyprland()) {
    try {
      const pid = process.pid;
      // Obter o workspace ativo atual
      const { stdout: wsStdout } = await execPromise(
        "hyprctl activeworkspace -j"
      );
      const activeWorkspace = JSON.parse(wsStdout);
      const workspaceId = activeWorkspace.id;

      console.log(
        `Hyprland: Movendo janela para o workspace ${workspaceId} e tornando flutuante.`
      );

      // Mover para o workspace atual
      await execPromise(
        `hyprctl dispatch movetoworkspace ${workspaceId},pid:${pid}`
      );
      // Tornar flutuante
      await execPromise(`hyprctl dispatch setprop pid:${pid} floating 1`);
      // Focar a janela
      await execPromise(`hyprctl dispatch focuswindow pid:${pid}`);

      mainWindow.show();
      console.log("Hyprland: Janela movida e focada com input manual.");
    } catch (error) {
      console.error("Erro ao mover/focar janela no Hyprland:", error);
    }
  } else {
    // Lógica para ambientes que não são Hyprland
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

    const { x, y } = currentDisplay.workArea;
    const winWidth = mainWindow.getBounds().width;
    const winHeight = mainWindow.getBounds().height;

    const newX = x + Math.round((currentDisplay.workArea.width - winWidth) / 2);
    const newY =
      y + Math.round((currentDisplay.workArea.height - winHeight) / 2);

    mainWindow.setBounds({
      x: newX,
      y: newY,
      width: winWidth,
      height: winHeight,
    });
    mainWindow.show();
    mainWindow.focus();
    console.log("Janela movida e focada com input manual (ambiente padrão).");
  }

  // Abrir o input manual no renderizador
  mainWindow.webContents.send("manual-input");
}

ipcMain.on("send-to-gemini", async (event, text, sessionId) => {
  try {
    const aiModel = getEffectiveAiModel();
    let resposta;
    let usedKnowledge = false; // base de conhecimento injetada nesta resposta?

    let promptWithHistory = text;
    let pastMessages = [];
    if (sessionId) {
      const session = historyService.getSessionById(Number(sessionId)) || historyService.getSessionById(sessionId);
      if (session && session.conversations && session.conversations.length > 1) {
        // Exclui a última mensagem, que é o prompt atual que já foi adicionado
        pastMessages = session.conversations.slice(0, -1);
        if (pastMessages.length > 0) {
          let historyContext = "=== HISTÓRICO DA CONVERSA ANTERIOR ===\n";
          for (const msg of pastMessages) {
            const roleName = msg.role === 'user' ? 'Usuário' : 'IA';
            historyContext += `[${roleName}]: ${msg.content}\n\n`;
          }
          historyContext += "=== FIM DO HISTÓRICO ===\n\nUse o histórico acima como contexto para responder à pergunta atual.\n\nPergunta atual: ";
          promptWithHistory = historyContext + text;
        }
      }
    }

    // ── Gemini CLI provider ──────────────────────────────────────────────────
    if (aiModel === 'geminiCli') {
      const projectPath = workspace.getProjectPath();
      const geminiModel = configService.getGeminiCliModel();
      GeminiCliProvider.setModel(geminiModel);
      try {
        await GeminiCliProvider.send(text, projectPath, event.sender, sessionId, pastMessages);
      } catch (gcliErr) {
        console.error('[gemini-cli] send error:', gcliErr.message);
      }
      return;
    }

    // ── Claude Code CLI provider ─────────────────────────────────────────────
    if (aiModel === 'claudeCli') {
      const projectPath = workspace.getProjectPath();
      const claudeModel = configService.getClaudeCliModel();
      ClaudeCliProvider.setModel(claudeModel);
      try {
        await ClaudeCliProvider.send(promptWithHistory, projectPath, event.sender);
      } catch (ccliErr) {
        console.error('[claude-cli] send error:', ccliErr.message);
        // Garante que o loading fecha mesmo que o provider não tenha emitido gemini-stream-complete
        try { event.sender.send('gemini-stream-complete'); } catch (_) {}
      }
      return;
    }

    if (aiModel === 'openIa') {
        const token = configService.getOpenIaToken();
        const instruction = configService.getPromptInstruction();
        if (!token) {
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({
                    title: "Erro de Configuração",
                    body: "O token da OpenAI não está configurado. Por favor, adicione o token nas configurações.",
                    silent: true,
                }).show();
            }
            return;
        }
        const openAiModel = configService.getOpenAiModel();

        // Comando direto não planeja (só executa); tarefa complexa → agentic.
        const useAgentic = shouldUseAgentic(text);
        if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }

        const _wsText2 = await prependWorkspaceContextIfNeeded(promptWithHistory, openAiModel);

        if (useAgentic) {
            console.log('🤖 IPC: Iniciando AGENTIC WORKFLOW (multi-fase)...');
            // Limpa qualquer sessão anterior pra evitar contaminação
            if (OpenAIService.sessions) OpenAIService.sessions = {};

            try {
              resposta = await agenticWorkflow.run(
                  _wsText2,
                  { token, model: openAiModel, baseInstruction: instruction },
                  event.sender
              );
            } catch (err) {
              resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
            } finally {
              try { workspace.resetContextSent(); } catch (_) {}
            }
        } else {
            const _kb2 = await knowledgeBlockForOpenAI(text);
            if (_kb2) usedKnowledge = true;
            const _augText2 = _kb2 ? _kb2 + "\n\n---\n\n" + _wsText2 : _wsText2;
            const ht = buildHelperToolsOpenAIOpts(_augText2, instruction, openAiModel);
            resposta = await OpenAIService.makeOpenAIRequest(
              _augText2,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              null,
              ht.opts
            );
        }
        event.sender.send("openai-final-response", { resposta, usedKnowledge });
        return;
    } else if (aiModel === 'ollamaLocal') {
        try {
          const OllamaLocalService = require('./services/ollamaLocalService');
          const _kbL = await knowledgeBlockForOllama(text);
          if (_kbL) usedKnowledge = true;
          const _augTextL = _kbL ? _kbL + "\n\n---\n\n" + promptWithHistory : promptWithHistory;

          const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
          if (htEnabled) {
            const instructionO = configService.getPromptInstruction();
            const _wsTxtO = await prependWorkspaceContextIfNeeded(_augTextL, 'ollama');
            const _htO = buildHelperToolsOpenAIOpts(_wsTxtO, instructionO, configService.getOpenAiModel());
            resposta = await OllamaLocalService.responder(_wsTxtO, _htO.opts);
          } else {
            resposta = await OllamaLocalService.responder(_augTextL);
          }
        } catch (ollamaError) {
          console.error("IPC: Ollama Local falhou:", ollamaError && ollamaError.message);
          throw new Error(
            "Ollama Local indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
          );
        }
    } else {
        // Ollama/Backend e' o unico provider nao-OpenAI suportado.
        try {
          const instructionO2 = configService.getPromptInstruction();
          const useAgentic = shouldUseAgentic(text);
          if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }
          const _wsTxtO2 = await prependWorkspaceContextIfNeeded(promptWithHistory, 'ollama');

          if (useAgentic) {
              console.log('🤖 IPC: Iniciando AGENTIC WORKFLOW OLLAMA (multi-fase)...');
              BackendService.clearSessions();
              try {
                resposta = await ollamaAgenticWorkflow.run(
                    _wsTxtO2, 
                    { baseInstruction: instructionO2 },
                    event.sender
                );
              } catch (err) {
                resposta = `[Ollama Agentic] Interrompido ou falhou: ${err.message}`;
              }
          } else {
              const _kbO2 = await knowledgeBlockForOllama(text);
              if (_kbO2) usedKnowledge = true;
              const _augTxtO2 = _kbO2 ? _kbO2 + "\n\n---\n\n" + _wsTxtO2 : _wsTxtO2;
              const _htO2 = buildHelperToolsOpenAIOpts(_augTxtO2, instructionO2, configService.getOpenAiModel());
              resposta = await BackendService.responder(_augTxtO2, _htO2.opts);
          }
          backendIsOnline = true;
        } catch (backendError) {
          console.error("IPC: Backend Ollama falhou:", backendError && backendError.message);
          backendIsOnline = false;
          throw new Error(
            "Backend Ollama indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
          );
        }
    }
    event.sender.send("gemini-response", { resposta, usedKnowledge });
  } catch (error) {
    console.error("IPC: IA service error:", error);
    event.sender.send(
      "transcription-error",
      "Failed to process IA response from any source"
    );
  }
});

// Chat com IMAGEM → visão (gpt-4o). O fluxo antigo de paste/captura no chat só
// rodava OCR local (Tesseract) e mandava o TEXTO — a imagem nunca chegava no
// modelo. Na Lite isso quebrava tudo (quiz/código/canvas geram OCR vazio ou
// lixo). Aqui a imagem é a FONTE: manda direto pra visão, one-shot/stateless,
// sem injeção de base de conhecimento (a imagem fala por si).
ipcMain.on("send-to-gemini-vision", async (event, { text, image }) => {
  try {
    if (!image) {
      event.sender.send("transcription-error", "Imagem ausente para análise visual.");
      return;
    }
    const aiModel = getEffectiveAiModel();
    if (aiModel === 'ollamaLocal') {
      const OllamaLocalService = require('./services/ollamaLocalService');
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const instructionO = configService.getPromptInstruction();
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const _wsTxt = await prependWorkspaceContextIfNeeded(baseTxt, 'ollama');
      let resposta;
      const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
      if (htEnabled) {
        const _ht = buildHelperToolsOpenAIOpts(_wsTxt, instructionO, configService.getOpenAiModel());
        resposta = await OllamaLocalService.responder(_wsTxt, _ht.opts);
      } else {
        resposta = await OllamaLocalService.responder(_wsTxt);
      }
      event.sender.send("gemini-response", { resposta, usedKnowledge: false });
      return;
    } else if (aiModel !== 'openIa') {
      // Backends sem visão (Ollama/full offline): cai no OCR + texto.
      const ocr = await TesseractService.getTextFromImage(image).catch(() => '');
      const instructionO = configService.getPromptInstruction();
      const baseTxt = (text && text.trim() ? `${text}\n\n` : '')
        + (ocr && ocr.trim() ? `Conteúdo extraído da imagem:\n${ocr}` : '');
      const _wsTxt = await prependWorkspaceContextIfNeeded(baseTxt, 'ollama');
      const _ht = buildHelperToolsOpenAIOpts(_wsTxt, instructionO, configService.getOpenAiModel());
      const resposta = await BackendService.responder(_wsTxt, _ht.opts);
      event.sender.send("gemini-response", { resposta, usedKnowledge: false });
      return;
    }

    const token = configService.getOpenIaToken();
    const instruction = configService.getPromptInstruction();
    if (!token) {
      event.sender.send("transcription-error", "Token da OpenAI não configurado.");
      return;
    }
    const visionModel = configService.getOpenAiVisionModel();
    const visionPrompt = (text && text.trim() ? `${text}\n\n` : '')
      + 'Analise a IMAGEM com atenção. Responda conforme as regras do sistema.\n\n'
      + 'IMPORTANTE: na imagem, "x" entre dois números significa MULTIPLICAÇÃO '
      + '(ex.: "11x2" = 11 × 2 = 22, NÃO é 11 ao quadrado). '
      + 'Notação de potência seria "11²" ou "11^2".';
    console.log(`🤖 IPC visão: OpenAI ${visionModel} [VISÃO high] (chat)...`);
    const resposta = await OpenAIService.makeOpenAIRequest(
      visionPrompt,
      token,
      instruction,
      visionModel,
      image,
      { stateless: true }
    );
    event.sender.send("openai-final-response", { resposta, usedKnowledge: false });
  } catch (error) {
    console.error("IPC visão: erro ao analisar imagem:", error && error.message);
    event.sender.send("transcription-error", "Falha ao analisar a imagem com a IA.");
  }
});

ipcMain.on("stop-agentic-workflow", (event, sessionId) => {
  agenticWorkflow.stop(sessionId);
  if (typeof ollamaAgenticWorkflow !== 'undefined') {
    ollamaAgenticWorkflow.stop(sessionId);
  }
  // Para CLIs: aborta o processo em curso para o projeto ativo.
  const projectPath = workspace.getProjectPath();
  ClaudeCliProvider.abortCurrent(projectPath).catch(() => {});
  GeminiCliProvider.abortCurrent && GeminiCliProvider.abortCurrent(projectPath).catch(() => {});
});

ipcMain.on("clear-ai-sessions", () => {
  console.log("🧹 Limpando sessões de IA (OpenAI + Backend + Gemini)...");
  if (OpenAIService.sessions) OpenAIService.sessions = {};
  BackendService.clearSessions();
  GeminiCliProvider.shutdown().catch((e) => {
    console.warn('[gemini-cli] clear-ai-sessions shutdown error:', e.message);
  });
});

ipcMain.on("send-to-gemini-stream", async (event, text) => {
  try {
    console.log("IPC: Usando Backend Stream Service...");
    
    await BackendService.responderStream(
      text,
      // onChunk
      (chunk) => {
        event.sender.send("gemini-stream-chunk", chunk);
      },
      // onComplete
      () => {
        event.sender.send("gemini-stream-complete");
      },
      // onError
      (error) => {
        console.error("Stream error:", error);
        event.sender.send("transcription-error", error.message);
      }
    );
  } catch (error) {
    console.error("IPC: Stream service error:", error);
    event.sender.send("transcription-error", "Failed to process stream response");
  }
});

ipcMain.on("stop-notifications", () => {
  if (waitingNotificationInterval) {
    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;
  }
  console.log("Notifications stopped");
});

ipcMain.on("start-notifications", () => {
  console.log("Notifications restarted");
});

ipcMain.on("cancel-ia-request", () => {
  // Backend Ollama / OpenAI nao tem cancelamento implementado por enquanto.
  if (waitingNotificationInterval) {
    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;
  }
  console.log("IA request cancelled");
});

// Fallback Wayland: global shortcuts falham no Wayland, então o renderer envia
// este IPC quando Ctrl+D é pressionado enquanto a janela está focada.
ipcMain.on("renderer-toggle-recording", async () => {
  try { await toggleRecording(); } catch (e) { console.error("[renderer-toggle-recording]", e.message); }
});

ipcMain.handle("is-hyprland", () => {
  return isHyprland();
});

// === Atalhos dispon\u00edveis dinamicamente (por SO + DE + modo) ===
// Retorna apenas atalhos que REALMENTE funcionam no contexto atual.
// O renderer consome isso e renderiza o tooltip; nada \u00e9 hardcoded l\u00e1.
ipcMain.handle("get-available-shortcuts", () => {
  const sessionType = (process.env.XDG_SESSION_TYPE || "").toLowerCase();
  const desktop = (process.env.XDG_CURRENT_DESKTOP || "").toUpperCase();
  const isWayland = sessionType === "wayland";
  const isCosmic = desktop.includes("COSMIC");
  const isHyprlandEnv = !!process.env.HYPRLAND_INSTANCE_SIGNATURE;
  const isX11 = sessionType === "x11" || (!isWayland && !isHyprlandEnv);

  const osIntegrationOn = configService.getOsIntegrationStatus();
  const printModeOn = configService.getPrintModeStatus();

  // Prefixo de tecla varia: Hyprland usa SUPER, demais usam CTRL
  const mod = isHyprlandEnv ? "SUPER" : "CTRL";
  const shift = isHyprlandEnv ? "SUPER+SHIFT" : "CTRL+SHIFT";

  const items = [];

  // Sempre dispon\u00edvel (registrado via gsettings/COSMIC/Hyprland config)
  items.push({ id: "recording", keys: `${mod}+D`, action: "Iniciar/Parar grava\u00e7\u00e3o", icon: "\ud83c\udf99\ufe0f" });
  items.push({ id: "manual-input", keys: `${mod}+I`, altKeys: `${shift}+I`, action: "Inserir pergunta", icon: "\u270d\ufe0f" });
  items.push({ id: "open-config", keys: `${shift}+C`, action: "Configura\u00e7\u00f5es", icon: "\u2699\ufe0f" });

  // Captura stealth (Ctrl+Shift+S): s\u00f3 faz sentido com OS Integration ON.
  // Quando print-mode est\u00e1 OFF, o user prefere usar ferramenta nativa do SO
  // + Ctrl+V no input. N\u00e3o mostramos.
  if (osIntegrationOn && printModeOn) {
    items.push({ id: "capture-stealth", keys: `${shift}+S`, action: "Captura stealth + IA", icon: "\ud83d\udcf8" });
  }

  // Mover janela entre telas: s\u00f3 funciona em X11 ou Hyprland.
  // Wayland puro (COSMIC, GNOME Wayland) ignora setBounds() pelo compositor.
  if (isX11 || isHyprlandEnv) {
    if (isHyprlandEnv) {
      items.push({ id: "move-1", keys: `${shift}+1`, action: "Mover para workspace 1", icon: "\ud83d\udccd" });
      items.push({ id: "move-2", keys: `${shift}+2`, action: "Mover para workspace 2", icon: "\ud83d\udccd" });
    } else {
      items.push({ id: "move-1", keys: `${shift}+1`, action: "Mover para tela 1", icon: "\ud83d\uddb5\u2190" });
      items.push({ id: "move-2", keys: `${shift}+2`, action: "Mover para tela 2", icon: "\ud83d\uddb5\u2192" });
    }
  }

  return {
    env: { sessionType, desktop, isWayland, isCosmic, isHyprland: isHyprlandEnv, isX11 },
    flags: { osIntegrationOn, printModeOn },
    items,
  };
});

// Notifica o renderer sempre que algo que muda os atalhos for alterado.
// O renderer escuta isso e repede get-available-shortcuts.
function notifyShortcutsChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send("shortcuts-changed"); } catch (_) {}
  }
}

ipcMain.handle("get-backend-url", async () => {
  return await BackendService.getApiUrl();
});

// IPC Handlers for Config
ipcMain.handle("get-app-version", () => {
  try {
    const pkg = require("./package.json");
    return pkg.version;
  } catch (e) {
    return "0.0.0";
  }
});

ipcMain.handle("get-prompt-instruction", () => {
  return configService.getPromptInstruction();
});

ipcMain.on("save-prompt-instruction", (event, instruction) => {
  configService.setPromptInstruction(instruction);
});

ipcMain.handle("get-backend-api-key", () => {
  return configService.getBackendApiKey();
});

ipcMain.on("save-backend-api-key", (event, key) => {
  configService.setBackendApiKey(key);
});

ipcMain.handle("get-debug-mode-status", () => {
  return configService.getDebugModeStatus();
});

ipcMain.on("save-debug-mode-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    stopAllRealtime();
  }

  configService.setDebugModeStatus(status);
  // Notifica a janela principal e a de configuração sobre a mudança
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("debug-status-changed", status);
  }
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.webContents.send("debug-status-changed", status);
  }
});

// IPC Handlers for Print Mode
ipcMain.handle("get-print-mode-status", () => {
  return configService.getPrintModeStatus();
});

ipcMain.on("save-print-mode-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    stopAllRealtime();
  }

  configService.setPrintModeStatus(status);
  console.log('Print mode status changed to:', status);
  notifyShortcutsChanged();
  
  if (status) {
    // Notificação de ativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Modo automático ativado! Tire prints e aguarde as respostas...',
        silent: true,
      }).show();
    }
    
    startClipboardMonitoring();
    // Capture tool monitoring só funciona no OS integration mode
  } else {
    // Notificação de desativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Modo automático desativado',
        silent: true,
      }).show();
    }
    
    stopClipboardMonitoring();
  }
});

// IPC Handlers for OS Integration
ipcMain.handle("get-os-integration-status", () => {
  return configService.getOsIntegrationStatus();
});

// ===== HelperTools (m\u00f3dulo de ferramentas avan\u00e7adas) =====
ipcMain.handle("get-helper-tools-enabled", () => {
  return configService.getHelperToolsEnabled();
});

ipcMain.handle("get-helper-tools-config", () => {
  return configService.getHelperToolsConfig();
});

ipcMain.on("set-helper-tools-enabled", (event, enabled) => {
  const wasEnabled = configService.getHelperToolsEnabled();
  configService.setHelperToolsEnabled(!!enabled);
  helperTools.updateConfig(configService.getHelperToolsConfig());
  console.log(
    `\ud83d\udd27 HelperTools: ${wasEnabled ? "ON" : "OFF"} \u2192 ${enabled ? "ON" : "OFF"}`
  );
  if (enabled) {
    // Mutex: garantia extra. Configservice j\u00e1 desliga osIntegration; aqui
    // s\u00f3 notificamos o renderer pra atualizar o UI dos outros toggles.
    if (event && event.sender) {
      event.sender.send("helper-tools-enabled-changed", {
        enabled: true,
        osIntegrationDisabled: true,
      });
    }
  } else if (event && event.sender) {
    event.sender.send("helper-tools-enabled-changed", { enabled: false });
  }
});

// ===== Workspace Access (anexar diretórios/arquivos como contexto) =====
ipcMain.handle("get-workspace-access-enabled", () => {
  return configService.getWorkspaceAccessEnabled
    ? configService.getWorkspaceAccessEnabled()
    : false;
});
ipcMain.on("set-workspace-access-enabled", (event, enabled) => {
  if (!configService.setWorkspaceAccessEnabled) return;
  configService.setWorkspaceAccessEnabled(!!enabled);
  console.log(`📂 WorkspaceAccess: → ${enabled ? "ON" : "OFF"}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { enabled: !!enabled, attachments: workspace.list() });
  }
});

ipcMain.handle("workspace:pick-file", async () => {
  const { dialog } = require("electron");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Anexar arquivo ao workspace",
    properties: ["openFile", "multiSelections"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const added = [];
  for (const p of res.filePaths) {
    try { await workspace.addPath(p, "file"); added.push(p); }
    catch (e) { console.warn("[workspace] add file falhou:", e.message); }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return { ok: true, added, attachments: workspace.list() };
});

ipcMain.handle("workspace:pick-dir", async () => {
  const { dialog } = require("electron");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Anexar diretório ao workspace",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const added = [];
  // Modelo IDE: um projeto por vez — openProject substitui a pasta anterior.
  const prevDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
  for (const p of res.filePaths) {
    try { await workspace.openProject(p); added.push(p); }
    catch (e) { console.warn("[workspace] open project falhou:", e.message); }
  }
  syncTerminalCwd();
  // Gemini CLI: reinicia sessão quando o projeto muda.
  const newDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
  const oldPath = prevDirs[0] || null;
  const newPath = newDirs[0] || null;
  const activeProvider = configService.getAiModel();
  if (oldPath !== newPath && activeProvider === 'geminiCli') {
    GeminiCliProvider.changeProject(oldPath, newPath).catch(e =>
      console.warn('[gemini-cli] changeProject error:', e.message)
    );
  }
  if (oldPath !== newPath && activeProvider === 'claudeCli') {
    ClaudeCliProvider.changeProject(oldPath, newPath).catch(e =>
      console.warn('[claude-cli] changeProject error:', e.message)
    );
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return { ok: true, added, attachments: workspace.list() };
});

ipcMain.handle("workspace:add-path", async (event, { path, type }) => {
  try {
    await workspace.addPath(path, type || "file");
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
    }
    return { ok: true, attachments: workspace.list() };
  } catch (e) {
    console.warn("[workspace] add path falhou:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:list", () => workspace.list());

ipcMain.handle("workspace:rename-item", async (event, { oldPath, newPath }) => {
  try {
    if (!fs2.existsSync(oldPath)) {
      return { ok: false, error: "Arquivo ou pasta de origem não existe." };
    }
    if (fs2.existsSync(newPath)) {
      return { ok: false, error: "Já existe um arquivo ou pasta com o novo nome." };
    }
    fs2.renameSync(oldPath, newPath);
    return { ok: true };
  } catch (e) {
    console.error("[workspace:rename-item] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:move-item", async (event, { srcPath, destPath }) => {
  try {
    if (!fs2.existsSync(srcPath)) {
      return { ok: false, error: "Item de origem não existe." };
    }
    if (!fs2.existsSync(destPath)) {
      return { ok: false, error: "Diretório de destino não existe." };
    }
    const stat = fs2.statSync(destPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: "Destino precisa ser uma pasta." };
    }
    const filename = path.basename(srcPath);
    const targetPath = path.join(destPath, filename);
    if (fs2.existsSync(targetPath)) {
      return { ok: false, error: `Já existe um item chamado "${filename}" na pasta de destino.` };
    }
    fs2.renameSync(srcPath, targetPath);
    return { ok: true };
  } catch (e) {
    console.error("[workspace:move-item] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:create-file", async (event, { filePath }) => {
  try {
    if (fs2.existsSync(filePath)) {
      return { ok: false, error: "Arquivo já existe." };
    }
    const dir = path.dirname(filePath);
    if (!fs2.existsSync(dir)) {
      fs2.mkdirSync(dir, { recursive: true });
    }
    fs2.writeFileSync(filePath, "", "utf8");
    return { ok: true };
  } catch (e) {
    console.error("[workspace:create-file] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:create-dir", async (event, { dirPath }) => {
  try {
    if (fs2.existsSync(dirPath)) {
      return { ok: false, error: "Diretório já existe." };
    }
    fs2.mkdirSync(dirPath, { recursive: true });
    return { ok: true };
  } catch (e) {
    console.error("[workspace:create-dir] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:delete-items", async (event, { paths }) => {
  try {
    for (const p of paths) {
      if (fs2.existsSync(p)) {
        fs2.rmSync(p, { recursive: true, force: true });
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("[workspace:delete-items] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:pick-parent-dir", async () => {
  const { dialog } = require("electron");
  const res = await dialog.showOpenDialog(mainWindow, {
    title: "Selecionar pasta onde criar o projeto",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("workspace:create-and-open-project", async (event, { parentPath, folderName }) => {
  try {
    const newProjectPath = path.join(parentPath, folderName);
    if (fs2.existsSync(newProjectPath)) {
      return { ok: false, error: "Uma pasta com esse nome já existe neste local." };
    }
    fs2.mkdirSync(newProjectPath, { recursive: true });
    
    // Agora abre o projeto!
    const prevDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
    await workspace.openProject(newProjectPath);
    syncTerminalCwd();
    
    // Reinicia sessões da IA se mudou
    const newDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
    const oldPath = prevDirs[0] || null;
    const newPath = newDirs[0] || null;
    const activeProvider = configService.getAiModel();
    if (oldPath !== newPath && activeProvider === 'geminiCli') {
      GeminiCliProvider.changeProject(oldPath, newPath).catch(e =>
        console.warn('[gemini-cli] changeProject error:', e.message)
      );
    }
    if (oldPath !== newPath && activeProvider === 'claudeCli') {
      ClaudeCliProvider.changeProject(oldPath, newPath).catch(e =>
        console.warn('[claude-cli] changeProject error:', e.message)
      );
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
    }
    return { ok: true, attachments: workspace.list() };
  } catch (e) {
    console.error("[workspace:create-and-open-project] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

// Contexto ativo do projeto (pasta anexada + branch git) — exibido como pills
// discretos acima do composer, ao estilo de uma IDE. Retorna null quando não há
// pasta no workspace (modo chat puro).
ipcMain.handle("get-project-context", async () => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir) return null;
    const name = path.basename(dir.path);
    let branch = null;
    try {
      const { execFile } = require("child_process");
      branch = await new Promise((resolve) => {
        execFile(
          "git",
          ["-C", dir.path, "rev-parse", "--abbrev-ref", "HEAD"],
          { timeout: 2500 },
          (err, stdout) => resolve(err ? null : (stdout || "").trim() || null)
        );
      });
    } catch (_) { /* sem git: mostra só o projeto */ }
    return { id: dir.id, name, path: dir.path, branch };
  } catch (e) {
    console.warn("[project-context] falhou:", e.message);
    return null;
  }
});

// Retorna arquivos modificados/não comitados e total de alterações via git status
ipcMain.handle("get-project-git-status", async () => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir || !dir.path) {
      return { isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };
    }
    const projectPath = dir.path;
    const { execFile } = require("child_process");
    return await new Promise((resolve) => {
      execFile(
        "git",
        ["-C", projectPath, "status", "--porcelain", "-uall"],
        { timeout: 3500 },
        (err, stdout) => {
          if (err || !stdout) {
            return resolve({ isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} });
          }
          const lines = stdout.split("\n");
          const modifiedFiles = {};
          const modifiedDirs = {};
          let count = 0;

          for (const line of lines) {
            if (!line || line.length < 3) continue;
            const code = line.substring(0, 2);
            let relPath = line.substring(3).trim();
            if (relPath.includes(" -> ")) {
              relPath = relPath.split(" -> ")[1].trim();
            }
            if (relPath.startsWith('"') && relPath.endsWith('"')) {
              relPath = relPath.substring(1, relPath.length - 1);
            }
            relPath = relPath.replace(/\\/g, "/");
            if (!relPath) continue;

            let status = 'M';
            if (code.includes('?') || code.includes('U')) status = 'U';
            else if (code.includes('A')) status = 'A';
            else if (code.includes('D')) status = 'D';

            modifiedFiles[relPath] = status;
            count++;

            const parts = relPath.split('/');
            let currentParent = '';
            for (let i = 0; i < parts.length - 1; i++) {
              currentParent = currentParent ? `${currentParent}/${parts[i]}` : parts[i];
              modifiedDirs[currentParent] = true;
            }
          }
          resolve({ isGit: true, changesCount: count, modifiedFiles, modifiedDirs });
        }
      );
    });
  } catch (e) {
    console.warn("[get-project-git-status] falhou:", e.message);
    return { isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };
  }
});

// Diff linha-a-linha (LCS) entre dois textos — sem dependências externas.
function computeLineDiff(oldText, newText) {
  const a = String(oldText || "").split("\n");
  const b = String(newText || "").split("\n");
  const n = a.length, m = b.length;
  if (n > 4000 || m > 4000) return null; // grande demais p/ exibir
  const dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0, j = 0, ln = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) { lines.push({ t: "ctx", text: a[i], ln: ln++ }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { lines.push({ t: "del", text: a[i] }); i++; }
    else { lines.push({ t: "add", text: b[j], ln: ln++ }); j++; }
  }
  while (i < n) { lines.push({ t: "del", text: a[i] }); i++; }
  while (j < m) { lines.push({ t: "add", text: b[j], ln: ln++ }); j++; }
  return lines;
}

// Diff de um arquivo editado pela IA: backup (antes) × atual (depois).
ipcMain.handle("get-file-diff", async (event, payload) => {
  try {
    const filePath = payload && payload.path;
    const backupAt = payload && payload.backupAt;
    if (!filePath) return null;
    let oldText = "";
    if (backupAt && fs2.existsSync(backupAt)) {
      try { oldText = fs2.readFileSync(backupAt, "utf8"); } catch (_) {}
    }
    let newText = "";
    try { if (fs2.existsSync(filePath)) newText = fs2.readFileSync(filePath, "utf8"); } catch (_) {}
    const lines = computeLineDiff(oldText, newText);
    const adds = lines ? lines.filter((l) => l.t === "add").length : 0;
    const dels = lines ? lines.filter((l) => l.t === "del").length : 0;
    return { path: filePath, lines: lines || [], adds, dels, tooBig: !lines, isNew: !backupAt };
  } catch (e) {
    console.warn("[file-diff] falhou:", e.message);
    return null;
  }
});

// Usado SÓ pela busca de conteúdo (Ctrl+Shift+F) — aí faz sentido não varrer
// node_modules/build. A ÁRVORE da sidebar NÃO esconde mais esses diretórios
// (ver TREE_HEAVY_DIRS): eles aparecem como nós e carregam sob demanda.
const PROJECT_SEARCH_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "build",
  ".idea",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "vendor",
  ".tooling",
  ".cache",
  ".next",
  ".nuxt",
  "coverage",
  ".pytest_cache",
  ".m2",
  ".gradle",
  ".terraform",
  "out",
]);

// Diretórios "pesados": APARECEM na árvore como nós, mas não são percorridos
// de imediato — seus filhos são carregados sob demanda (get-dir-children)
// quando o usuário expande. Sem isso, um node_modules com 100k arquivos ou
// estouraria o orçamento (sumindo o resto do projeto) ou travaria a UI. Antes
// esses diretórios eram simplesmente escondidos (bug: "não vejo node_modules/
// dist/build no sidebar").
const TREE_HEAVY_DIRS = new Set([
  ".git",
  "node_modules",
  "target",
  "build",
  "dist",
  "vendor",
  ".venv",
  "venv",
  ".idea",
  "__pycache__",
  ".cache",
  ".next",
  ".nuxt",
  "coverage",
  ".pytest_cache",
  ".m2",
  ".gradle",
  ".terraform",
  "out",
  ".tooling",
]);

function isLikelyBinaryBuffer(buffer) {
  if (!buffer || !buffer.length) return false;
  const limit = Math.min(buffer.length, 1024);
  let suspicious = 0;
  for (let i = 0; i < limit; i += 1) {
    const byte = buffer[i];
    if (byte === 0) return true;
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) suspicious += 1;
  }
  return suspicious / limit > 0.2;
}

// IMPORTANTE: o array final precisa ficar em ordem DFS pre-order (pasta
// imediatamente seguida por todos os seus filhos) porque o renderer da
// sidebar usa isso pra decidir o que esconder quando uma pasta está
// colapsada. Por isso não dá pra simplesmente fazer BFS pra "priorizar"
// pastas rasas — a solução é dar um orçamento (budget) de entradas PRÓPRIO
// pra cada subárvore de topo, assim uma pasta gigante (ex: vendor/ criado
// pelo composer, ou node_modules) nunca consome o budget inteiro e deixa
// o resto do projeto sem aparecer (bug reportado: "só mostra os arquivos
// novos depois do build").
// Empurra um nó da árvore. Diretórios pesados recebem `lazy: true` e NÃO são
// percorridos pelo walker — o front carrega os filhos deles sob demanda.
// Retorna true se o diretório é pesado (pra o chamador não recursar nele).
function pushTreeNode(entries, absPath, name, depth, isDir) {
  const heavy = isDir && TREE_HEAVY_DIRS.has(name);
  entries.push(
    heavy
      ? { path: absPath, name, depth, isDir, lazy: true }
      : { path: absPath, name, depth, isDir }
  );
  return heavy;
}

// Percorre `dirPath` em DFS pre-order (pasta seguida dos filhos), respeitando
// um orçamento local por subárvore e um limite global de entradas. Diretórios
// pesados aparecem mas não são expandidos aqui (viram nós lazy).
function walkTreeInto(entries, dirPath, depth, localBudget, globalLimit) {
  let dirEntries = [];
  try {
    dirEntries = fs2.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  dirEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  let used = 0;
  for (const dirent of dirEntries) {
    if (entries.length >= globalLimit) return used;
    if (used >= localBudget) return used;
    const absPath = path.join(dirPath, dirent.name);
    const isDir = dirent.isDirectory();
    const heavy = pushTreeNode(entries, absPath, dirent.name, depth, isDir);
    used += 1;
    if (isDir && !heavy) {
      // Filhos herdam o que sobrou do budget local (não o global) — garante
      // que essa subárvore nunca ultrapasse sua cota, seja lá quão profunda for.
      used += walkTreeInto(entries, absPath, depth + 1, localBudget - used, globalLimit);
    }
    if (entries.length >= globalLimit || used >= localBudget) return used;
  }
  return used;
}

function collectProjectEntries(root, limit = 4000, perTopLevelBudget = 800) {
  const entries = [];

  // Passo 1: todas as entradas de topo (raiz do projeto) SEMPRE aparecem,
  // sem limite — é o que garante que nenhuma pasta/arquivo do nível
  // principal "suma" depois de um build.
  let topLevel = [];
  try {
    topLevel = fs2.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return entries;
  }
  topLevel.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of topLevel) {
    const absPath = path.join(root, dirent.name);
    const isDir = dirent.isDirectory();
    const heavy = pushTreeNode(entries, absPath, dirent.name, 0, isDir);
    if (isDir && !heavy) walkTreeInto(entries, absPath, 1, perTopLevelBudget, limit);
    if (entries.length >= limit) break;
  }
  return entries;
}

// Filhos de UM diretório específico — usado quando o usuário expande uma pasta
// lazy (node_modules, build, etc.) na sidebar. Profundidade relativa: filhos
// imediatos = 0 (o renderer soma a profundidade do pai + 1).
function collectDirChildren(dirPath, limit = 3000, perTopLevelBudget = 800) {
  const entries = [];
  let top = [];
  try {
    top = fs2.readdirSync(dirPath, { withFileTypes: true });
  } catch (_) {
    return entries;
  }
  top.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  for (const dirent of top) {
    if (entries.length >= limit) break;
    const absPath = path.join(dirPath, dirent.name);
    const isDir = dirent.isDirectory();
    const heavy = pushTreeNode(entries, absPath, dirent.name, 0, isDir);
    if (isDir && !heavy) walkTreeInto(entries, absPath, 1, perTopLevelBudget, limit);
  }
  return entries;
}

ipcMain.handle("get-project-tree", async () => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir) return null;
    const root = dir.path;
    const entries = collectProjectEntries(root);
    return { root, path: root, entries, tree: workspace.tree(root) || "" };
  } catch (e) {
    console.warn("[project-tree] falhou:", e.message);
    return null;
  }
});

// Carrega os filhos de uma pasta lazy (node_modules, build, etc.) quando o
// usuário a expande na sidebar. Ver collectDirChildren / TREE_HEAVY_DIRS.
ipcMain.handle("get-dir-children", async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: "path vazio", entries: [] };
    if (workspace.isPathAllowed && !workspace.isPathAllowed(dirPath)) {
      return { ok: false, error: "pasta fora do projeto/workspace", entries: [] };
    }
    const entries = collectDirChildren(dirPath);
    return { ok: true, path: dirPath, entries };
  } catch (e) {
    console.warn("[get-dir-children] falhou:", e.message);
    return { ok: false, error: e.message, entries: [] };
  }
});

ipcMain.handle("search-project-content", async (_event, query) => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir) return { ok: false, error: "nenhum projeto aberto", matches: [] };
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (normalizedQuery.length < 4) return { ok: true, query: normalizedQuery, matches: [] };

    const root = dir.path;
    const matches = [];
    const MAX_RESULTS = 200;
    const MAX_FILE_SIZE = 1024 * 1024;

    const walk = (dirPath) => {
      if (matches.length >= MAX_RESULTS) return;
      let dirEntries = [];
      try {
        dirEntries = fs2.readdirSync(dirPath, { withFileTypes: true });
      } catch (_) {
        return;
      }
      dirEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      for (const dirent of dirEntries) {
        if (matches.length >= MAX_RESULTS) return;
        if (PROJECT_SEARCH_SKIP_DIRS.has(dirent.name)) continue;
        const absPath = path.join(dirPath, dirent.name);
        if (workspace.isPathAllowed && !workspace.isPathAllowed(absPath)) continue;
        if (dirent.isDirectory()) {
          walk(absPath);
          continue;
        }
        if (!dirent.isFile()) continue;
        let st;
        try {
          st = fs2.statSync(absPath);
        } catch (_) {
          continue;
        }
        if (!st.isFile() || st.size > MAX_FILE_SIZE) continue;
        let buffer;
        try {
          buffer = fs2.readFileSync(absPath);
        } catch (_) {
          continue;
        }
        if (isLikelyBinaryBuffer(buffer)) continue;
        const text = buffer.toString("utf8").toLowerCase();
        if (text.includes(normalizedQuery)) matches.push(absPath);
      }
    };

    walk(root);
    return { ok: true, query: normalizedQuery, matches, limited: matches.length >= MAX_RESULTS };
  } catch (e) {
    console.warn("[search-project-content] falhou:", e.message);
    return { ok: false, error: e.message, matches: [] };
  }
});

// Lê o conteúdo de um arquivo do projeto — usado pelo visualizador/editor da IDE
// (editorController.js chama isso pra abrir um arquivo pra edição).
ipcMain.handle("read-file-content", async (event, filePath) => {
  try {
    if (!filePath) return { ok: false, error: "path vazio" };
    if (workspace.isPathAllowed && !workspace.isPathAllowed(filePath)) {
      return { ok: false, error: "arquivo fora do projeto/workspace" };
    }
    if (!fs2.existsSync(filePath)) return { ok: false, error: "arquivo não existe" };
    const st = fs2.statSync(filePath);
    if (!st.isFile()) return { ok: false, error: "não é um arquivo" };
    if (st.size > 20 * 1024 * 1024) return { ok: false, error: "arquivo grande demais (>20MB)" };
    const content = fs2.readFileSync(filePath, "utf8");
    // mtimeMs: o editor guarda esse valor como "baseline" pra detectar conflito
    // (arquivo mudou por fora entre abrir e salvar) — ver fileEditService.writeFile.
    return { ok: true, path: filePath, content, ext: path.extname(filePath).slice(1).toLowerCase(), bytes: st.size, mtimeMs: st.mtimeMs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Notifica a janela principal que um arquivo mudou, seja por quem for
// (humano no editor, OpenAI, Claude Code CLI, Gemini CLI). O editor, se tiver
// esse arquivo aberto, usa isso só pra SINALIZAR concorrência — não recarrega
// nem bloqueia nada sozinho. Ver ARCHITECTURE.md > Editor de código.
function emitFileMutated(payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("file-mutated", payload);
    }
  } catch (_) {}
}

// Salva o conteúdo do editor humano (Ctrl+S / botão Salvar em #file-viewer).
// Único caminho de ESCRITA do editor — ver fileEditService.js.
ipcMain.handle("editor-save-file", async (event, payload) => {
  try {
    const { path: filePath, content, expectedMtimeMs } = payload || {};
    if (!filePath) return { ok: false, error: "path vazio" };
    if (workspace.isPathAllowed && !workspace.isPathAllowed(filePath)) {
      return { ok: false, error: "arquivo fora do projeto/workspace" };
    }
    const res = fileEditService.writeFile(filePath, content || "", { expectedMtimeMs });
    emitFileMutated({ path: filePath, origin: "user" });
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:remove", (event, id) => {
  workspace.removePath(id);
  syncTerminalCwd();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return workspace.list();
});

ipcMain.handle("workspace:clear", () => {
  workspace.clear();
  syncTerminalCwd();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { attachments: [] });
  }
  return [];
});

ipcMain.handle("workspace:open-external", async (event, p) => {
  const { shell } = require("electron");
  try {
    // shell.openPath devolve string vazia em sucesso, ou msg de erro
    const err = await shell.openPath(p);
    if (!err) return { ok: true };
    // Fallback xdg-open (COSMIC as vezes recusa shell.openPath em dirs)
    const { spawn } = require("child_process");
    spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, fallback: "xdg-open", shellErr: err };
  } catch (e) {
    try {
      const { spawn } = require("child_process");
      spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, fallback: "xdg-open" };
    } catch (e2) {
      return { ok: false, error: e.message };
    }
  }
});

ipcMain.handle("terminal:init", async (event) => {
  killTerminal();

  const projectPath = getActiveProjectPath();
  currentTerminalProjectPath = projectPath;

  const isWin = process.platform === "win32";
  const env = {
    ...process.env,
    TERM: "linux", // Evita que o fish mande queries de DA1 que causam timeout em terminais simples
    FISH_NO_SHELL_INTEGRATION: "1", // Desativa as sequências ]133; que poluem a saída
    COLORTERM: "truecolor",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1",
    FORCE_COLOR: "1",
    PYTHONUNBUFFERED: "1",
    GIT_CONFIG_PARAMETERS: "'color.ui=always'",
    // Desativa pagers interativos (less) que travavam git log/diff/branch,
    // systemctl, man etc. num terminal line-buffered sem como enviar 'q'.
    GIT_PAGER: "cat",
    PAGER: "cat",
    SYSTEMD_PAGER: "cat",
    MANPAGER: "cat",
  };

  // === Windows: ConPTY de verdade via node-pty ===
  // O `import pty` do Python é Unix-only; no Windows usamos node-pty, que expõe
  // o ConPTY (mesmo motor do terminal do VS Code). Assim Ctrl+C, prompt vivo,
  // cores e programas interativos funcionam. O binário é N-API (prebuild
  // win32-x64/arm64), então carrega no Electron sem recompilar.
  if (isWin) {
    try {
      const pty = require("node-pty");
      const shell = process.env.COMSPEC || "cmd.exe";
      terminalPty = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd: projectPath,
        env: { ...env, TERM: "xterm-256color" },
      });

      terminalPty.onData((chunk) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("terminal:output", { type: "stdout", data: chunk });
        }
      });

      terminalPty.onExit(({ exitCode }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("terminal:closed", { code: exitCode });
        }
        terminalPty = null;
      });

      return { ok: true, shell, projectPath, pty: true };
    } catch (e) {
      console.error("[terminal:init] node-pty falhou:", e.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("terminal:output", { type: "stderr", data: `Falha ao iniciar o terminal (node-pty): ${e.message}\r\n` });
        mainWindow.webContents.send("terminal:closed", { code: -1 });
      }
      terminalPty = null;
      return { ok: false, error: e.message };
    }
  }

  // === Linux/macOS: pty via Python (comportamento original, intocado) ===
  const shell = process.env.SHELL || "/bin/bash";
  const ptyCode = `import pty, os; os.environ['TERM']='linux'; pty.spawn(['${shell}', '-i'])`;
  try {
    terminalProcess = spawn("python3", ["-c", ptyCode], {
      env,
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (_) {
    terminalProcess = spawn(shell, ["-i"], {
      env,
      cwd: projectPath,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  // `spawn` não lança pra shell inexistente/ENOENT — emite 'error' de forma
  // assíncrona. Sem este handler, o terminal ficava morto sem avisar.
  terminalProcess.on("error", (err) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:output", { type: "stderr", data: `Erro no terminal: ${err.message}\r\n` });
      mainWindow.webContents.send("terminal:closed", { code: -1 });
    }
    terminalProcess = null;
  });

  terminalProcess.stdout.setEncoding("utf8");
  terminalProcess.stderr.setEncoding("utf8");

  // Injeta função cd personalizada e helper do git (feedback visual de 'git
  // add'/'commit') — sintaxe bash, só faz sentido em shell POSIX.
  if (terminalProcess.stdin && terminalProcess.stdin.writable) {
    terminalProcess.stdin.write('cd() { builtin cd "$@" && printf "\\033[32m📁 Pasta atual: %s\\033[0m\\n" "$(pwd)"; }\n');
    terminalProcess.stdin.write('git() { if [ "$1" = "add" ]; then command git "$@" && command git status -s; else command git "$@"; fi; }\n');
  }

  terminalProcess.stdout.on("data", (chunk) => {
    // Intercept terminal queries to prevent shells like fish from hanging for 10s
    if (terminalProcess && terminalProcess.stdin && terminalProcess.stdin.writable) {
      if (chunk.includes('\x1b[c') || chunk.includes('\x1b[0c')) {
        try { terminalProcess.stdin.write('\x1b[?1;0c'); } catch (_) {}
      }
      if (chunk.includes('\x1b]11;?')) {
        try { terminalProcess.stdin.write('\x1b]11;rgb:0000/0000/0000\x1b\\'); } catch (_) {}
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:output", { type: "stdout", data: chunk });
    }
  });

  terminalProcess.stderr.on("data", (chunk) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:output", { type: "stderr", data: chunk });
    }
  });

  terminalProcess.on("close", (code) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("terminal:closed", { code });
    }
    terminalProcess = null;
  });

  return { ok: true, shell, projectPath };
});

ipcMain.on("terminal:input", (event, data) => {
  // ConPTY (node-pty) espera CR (\r) como Enter; o front-end manda \n. Os chars
  // de controle (Ctrl+C = \x03 etc.) passam intactos. No child_process (Linux)
  // manda como está.
  const payload = terminalPty ? String(data).replace(/\n/g, "\r") : data;
  writeToTerminal(payload);
});

ipcMain.on("save-os-integration-status", (event, status) => {
  // Mutex: helperTools e osIntegration são incompatíveis por enquanto.
  if (status && configService.getHelperToolsEnabled()) {
    console.log(
      "⚠️ save-os-integration-status: bloqueado, helperTools está ativo. Desligue-o primeiro."
    );
    if (event && event.sender) {
      event.sender.send("os-integration-blocked-by-helper-tools");
    }
    return;
  }
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    stopAllRealtime();
  }

  configService.setOsIntegrationStatus(status);
  console.log('OS Integration status changed to:', status);
  notifyShortcutsChanged();
  
  if (status) {
    // NÃO forçamos mais o print mode aqui: "Integrar com SO" e "enviar print
    // direto" são independentes. O monitoramento abaixo roda, mas os watchers
    // já checam getPrintModeStatus() e não enviam nada se estiver desligado.

    // Notificação de ativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Integração com SO ativada! Interface minimalista habilitada.',
        silent: true,
      }).show();
    }
    
    startClipboardMonitoring();
    startCaptureToolMonitoring(); // Monitoramento de ferramentas de captura apenas no OS integration
    // Switch to OS integration mode
    switchToOsIntegrationMode();
  } else {
    // Notificação de desativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Integração com SO desativada',
        silent: true,
      }).show();
    }
    
    // Switch back to normal mode
    switchToNormalMode();
  }
});

ipcMain.handle("get-realtime-assistant-status", () => {
  return configService.getRealtimeAssistantStatus();
});

ipcMain.on("save-realtime-assistant-status", async (event, status) => {
  configService.setRealtimeAssistantStatus(status);
  console.log('Realtime assistant status changed to:', status);

  if (status) {
    // Exclusividade: desliga os modos que podem conflitar
    configService.setDebugModeStatus(false);
    configService.setPrintModeStatus(false);
    configService.setOsIntegrationStatus(false);

    stopClipboardMonitoring();
    stopCaptureToolMonitoring();
    switchToNormalMode();

    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Assistente em tempo real habilitado. Inicie/parar com Ctrl+D.',
        silent: true,
      }).show();
    }
  } else {
    await stopAllRealtime();
    isRecording = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", {
        isRecording,
        audioFilePath,
      });
    }
  }
});

// IPC Handlers for Language
ipcMain.handle("get-language", () => {
  return configService.getLanguage();
});

ipcMain.on("set-language", (event, language) => {
  configService.setLanguage(language);
});

// === Assistente de Tradução ===
// ===== Base de Conhecimento (mini-RAG) =====
ipcMain.handle("kb-get", () => {
  const cfg = configService.getKnowledgeBaseConfig();
  return {
    // Não manda mais o texto consolidado inteiro pro renderer — o input de
    // Configurações é só pra ADICIONAR, não edita/recarrega o arquivo. O link
    // "ver base completa" abre o arquivo real via sourcePath.
    sourcePath: knowledgeBase.getSourcePath(),
    enabled: cfg.enabled,
    aiRewrite: cfg.aiRewrite,
    chunks: knowledgeBase.chunkCount(),
  };
});

// Anexa conteúdo NOVO ao final da base já consolidada (não recarrega/reprocessa o
// arquivo inteiro). É o que resolve o "Salvar e Fechar" demorado: antes, salvar
// SEMPRE re-embedava a base INTEIRA de novo, mesmo se o usuário não tivesse mexido
// na base de conhecimento (o campo vinha pré-carregado com tudo). Agora, texto
// vazio = no-op instantâneo; texto novo = só ELE é resumido/embedado.
ipcMain.handle("kb-append", async (event, payload) => {
  const { text = "", aiRewrite = true, enabled = true } = payload || {};
  configService.setKnowledgeBaseConfig({ aiRewrite: !!aiRewrite, enabled: !!enabled });
  if (!(text || "").trim()) {
    return { ok: true, appended: false, chunks: knowledgeBase.chunkCount() };
  }
  // ChatGPT/Lite → token (embeddings + reescrita nano). Ollama/Full → backend (keyword + reescrita Ollama).
  const useOpenAI = getEffectiveAiModel() === "openIa";
  const token = useOpenAI ? configService.getOpenIaToken() : "";
  const backendResponder = useOpenAI ? null : (t, opts) => BackendService.responder(t, opts);
  try {
    const res = await knowledgeBase.appendSource(text, { aiRewrite: !!aiRewrite, token, backendResponder });
    return { ok: true, chunks: res.chunks, rewritten: res.rewritten, shrunk: res.shrunk, codeSkipped: res.codeSkipped, appended: res.appended };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// Abre o arquivo consolidado da base de conhecimento no visualizador de arquivos
// da janela principal (não um editor externo) — a janela de Configurações é uma
// BrowserWindow separada, sem acesso direto ao viewer do index.html.
ipcMain.on("kb-open-source-file", () => {
  try {
    const p = knowledgeBase.getSourcePath();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("open-file-in-viewer", p);
    }
  } catch (_) {}
});

// Reorganiza o texto da base com IA SEM salvar (botão "Resumir e organizar com IA").
ipcMain.handle("kb-rewrite", async (event, payload) => {
  const { text = "" } = payload || {};
  const useOpenAI = getEffectiveAiModel() === "openIa";
  const token = useOpenAI ? configService.getOpenIaToken() : "";
  const backendResponder = useOpenAI ? null : (t, opts) => BackendService.responder(t, opts);
  try {
    const res = await knowledgeBase.rewrite(text, { token, backendResponder });
    return { ok: true, ...res };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-translation-assistant-config", () => {
  return configService.getTranslationAssistantConfig();
});

// Lista os microfones (sources) conectados AGORA — exclui monitores de saída.
// Usado pelo seletor de mic do Assistente de Tradução nas Configurações.
ipcMain.handle("get-audio-input-devices", async () => {
  try {
    const { stdout } = await execPromise("LANG=C pactl list sources");
    const devices = [];
    let cur = null;
    for (const line of stdout.split("\n")) {
      const mName = line.match(/^\s*Name:\s*(.+)$/);
      const mDesc = line.match(/^\s*Description:\s*(.+)$/);
      if (line.match(/^Source #/)) { cur = { name: "", description: "" }; }
      else if (mName && cur) { cur.name = mName[1].trim();
        // fecha o device anterior quando acha o Name (Name vem antes de Description)
      }
      else if (mDesc && cur) {
        cur.description = mDesc[1].trim();
        // monitores de saída terminam em .monitor → não são microfones
        if (cur.name && !cur.name.endsWith(".monitor")) {
          devices.push({ name: cur.name, description: cur.description || cur.name });
        }
        cur = null;
      }
    }
    return devices;
  } catch (e) {
    console.error("[config] get-audio-input-devices falhou:", e.message);
    return [];
  }
});

ipcMain.on("set-translation-assistant-config", (event, partial) => {
  configService.setTranslationAssistantConfig(partial || {});

  // Auto-inicia ou para o assistente ao vivo conforme o toggle de habilitação
  if (typeof partial.enabled === 'boolean') {
    const cfg = configService.getConfig();
    if (partial.enabled) {
      if (!cfg.openIaToken) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('translation-result', {
            transcript: '',
            response: '❌ Configure sua API key da OpenAI antes de usar o Assistente de Tradução.',
          });
        }
        return;
      }
      if (!translationAssistant.isActive()) {
        const ta = cfg.translationAssistant || {};
        translationAssistant.start({
          apiKey: cfg.openIaToken,
          userName: ta.userName || '',
          userBackground: ta.userBackground || '',
          targetLanguage: ta.targetLanguage || 'pt-br',
          micDevice: ta.micDevice || '',
        }).then(() => {
          // Em OS Integration, parar tudo o que não é o TA (clipboard, screenshot watch,
          // capture tool) — só o overlay de tradução fica ativo.
          if (cfg.osIntegration) {
            try { stopClipboardMonitoring(); } catch (_) {}
            try { stopCaptureToolMonitoring(); } catch (_) {}
            try { stopScreenshotFolderMonitoring(); } catch (_) {}
            console.log('[mutex] TA ativo + OS Integration: monitorings de print/captura/screenshot parados');
            // Sobe o overlay dedicado do tradutor
            createTranslationOverlay();
            sendToTranslationOverlay('translation-status', 'mic_open');
          }
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('translation-status', 'mic_open');
        }).catch((e) => console.error('[TranslationAssistant] falha ao iniciar:', e.message));
      }
    } else {
      if (translationAssistant.isActive()) {
        translationAssistant.stop().then(() => {
          // Ao desligar o TA, se OS Integration ainda estiver ativo, restaura
          // os monitorings normais (print mode + ferramentas de captura).
          if (cfg.osIntegration) {
            if (configService.getPrintModeStatus()) {
              try { startClipboardMonitoring(); } catch (_) {}
              try { startScreenshotFolderMonitoring(); } catch (_) {}
            }
            try { startCaptureToolMonitoring(); } catch (_) {}
            console.log('[mutex] TA desligado: monitorings restaurados');
          }
          destroyTranslationOverlay();
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('translation-status', 'idle');
        }).catch(() => {});
      }
    }
  }
});

ipcMain.on("set-translation-test-mode", (event, enabled) => {
  // Salva o estado no config
  configService.setTranslationAssistantConfig({ testMode: !!enabled });

  if (!enabled) return;

  const cfg = configService.getConfig();

  // Sem API key: desmarca imediatamente e avisa o usuário
  if (!cfg.openIaToken) {
    configService.setTranslationAssistantConfig({ testMode: false });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('translation-result', {
        transcript: '',
        response: '❌ Configure sua API key da OpenAI antes de usar o modo de teste.',
      });
    }
    return;
  }

  const ta = cfg.translationAssistant || {};

  // Entrega eventos para o renderer com o objeto de status completo
  const deliver = (data) => {
    try {
      if (cfg.osIntegration) {
        const text = data.response || data.evaluation || data.error || data.message || '';
        if (text) createOsNotificationWindow('response', text);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('translation-result', data);
      }
    } catch (e) {
      console.error('[TranslationAssistant] testMode deliver error:', e.message);
    }
  };

  // Executa em background para não bloquear o IPC
  runTestMode({
    apiKey: cfg.openIaToken,
    userName: ta.userName || '',
    userBackground: ta.userBackground || '',
    targetLanguage: ta.targetLanguage || 'pt-br',

    onResult: (data) => deliver(data),

    onDone: () => {
      deliver({ status: 'complete', message: '✅ Teste concluído — 5 perguntas processadas.' });
      configService.setTranslationAssistantConfig({ testMode: false });
    },
  }).catch((err) => {
    console.error('[TranslationAssistant] testMode falhou:', err.message);
    configService.setTranslationAssistantConfig({ testMode: false });
  });
});

ipcMain.handle("translation-start", async () => {
  const cfg = configService.getConfig();
  if (!cfg.openIaToken) return { error: 'API key não configurada' };
  // Para o assistente em tempo real se estiver ativo (evita conflito de mic)
  if (anyRealtimeActive()) {
    await stopAllRealtime();
  }
  const ta = cfg.translationAssistant || {};
  await translationAssistant.start({
    apiKey: cfg.openIaToken,
    userName: ta.userName || '',
    userBackground: ta.userBackground || '',
    targetLanguage: ta.targetLanguage || 'pt-br',
    micDevice: ta.micDevice || '',
  });
  if (cfg.osIntegration) {
    createTranslationOverlay();
    sendToTranslationOverlay('translation-status', 'mic_open');
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('translation-status', 'mic_open');
  return { ok: true };
});

ipcMain.handle("translation-stop", async () => {
  await translationAssistant.stop();
  destroyTranslationOverlay();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('translation-status', 'idle');
  return { ok: true };
});

function positionTranslationOverlay(position, targetWin) {
  const win = targetWin || translationOverlayWindow;
  if (!win || win.isDestroyed()) return;

  const currentBounds = win.getBounds();
  const currentCenter = {
    x: currentBounds.x + Math.round(currentBounds.width / 2),
    y: currentBounds.y + Math.round(currentBounds.height / 2),
  };

  let display;
  if (position === 'next-monitor') {
    const all = screen.getAllDisplays();
    const current = screen.getDisplayNearestPoint(currentCenter);
    const idx = all.findIndex(d => d.id === current.id);
    display = all[(idx + 1) % all.length];
  } else {
    display = screen.getDisplayNearestPoint(currentCenter);
  }

  const { x: dX, y: dY, width: dW, height: dH } = display.workArea;
  const [winW, winH] = win.getSize();

  const newY = dY + Math.round((dH - winH) / 2);
  let newX;
  if (position === 'left') {
    newX = dX + 10;
  } else if (position === 'center') {
    newX = dX + Math.round((dW - winW) / 2);
  } else {
    newX = dX + dW - winW - 10; // right / next-monitor / default
  }

  console.log(`[overlay-position] ${position} → display ${display.id} x=${newX} y=${newY}`);
  try { win.setBounds({ x: newX, y: newY, width: winW, height: winH }); } catch (_) {}
  try { win.setPosition(newX, newY); } catch (_) {}
  // Reafirma flutuar acima de tudo: o compositor pode ter rebaixado/encaixado
  // a janela ao movê-la entre monitores/áreas de trabalho.
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.moveTop();
  } catch (_) {}
  // Confere o resultado real (útil pra diagnosticar Wayland ignorando posição).
  try {
    const got = win.getBounds();
    console.log(`[overlay-position] real=${got.x},${got.y} ${got.width}x${got.height}`);
  } catch (_) {}
}

ipcMain.on('overlay-position', (event, position) => {
  // Resolve a janela que pediu (tradutor OU tutor de visão) pelo sender.
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender && visionGuideOverlayWindow && sender === visionGuideOverlayWindow) {
    positionTranslationOverlay(position, visionGuideOverlayWindow);
  } else {
    positionTranslationOverlay(position, translationOverlayWindow);
  }
});

// === Arrastar janelas frameless (drag manual, cross-platform) ===
// No Windows/macOS, `-webkit-app-region: drag` é instável em janelas
// transparent+frameless (bug antigo do Electron — a região de arraste engole
// o mousedown mas o compositor não move a janela). Este drag manual funciona
// em todos os SOs: o renderer avisa início (mousedown) e fim (mouseup); o main
// segue o cursor global (screen.getCursorScreenPoint) e reposiciona a janela
// mantendo o offset do ponto onde o usuário clicou. Só é acionado no renderer
// quando platform !== 'linux' — no Linux o app-region nativo continua no comando.
let _framelessDrag = null;
function stopFramelessDrag() {
  if (_framelessDrag) {
    try { clearInterval(_framelessDrag.timer); } catch (_) {}
    _framelessDrag = null;
  }
}
ipcMain.on('frameless-drag-start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  stopFramelessDrag();
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const offsetX = cursor.x - wx;
  const offsetY = cursor.y - wy;
  const timer = setInterval(() => {
    if (!win || win.isDestroyed()) { stopFramelessDrag(); return; }
    const c = screen.getCursorScreenPoint();
    try { win.setPosition(c.x - offsetX, c.y - offsetY); } catch (_) {}
  }, 16);
  _framelessDrag = { win, timer };
});
ipcMain.on('frameless-drag-end', () => stopFramelessDrag());
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    try { win.setIgnoreMouseEvents(ignore, options); } catch (_) {}
  }
});

// Pedido de expansão de largura (+200px até 40% da tela) — chamado depois de
// renderizar cada nova mensagem.
ipcMain.on("request-translation-resize", () => {
  expandTranslationOverlayIfNeeded();
});

ipcMain.on("request-vision-guide-resize", () => {
  expandVisionGuideOverlayIfNeeded();
});

ipcMain.handle("get-vision-guide-config", () => {
  return configService.getVisionGuideConfig();
});

ipcMain.handle("ide-autocomplete", async (event, { prefix, suffix, lang }) => {
  const vg = configService.getVisionGuideConfig();
  if (!vg || !vg.enabled) return null; // Só funciona se Tutor estiver ligado
  return await visionGuide.getIdeAutocomplete(prefix, suffix, lang);
});

// Liga/desliga o Assistente Guiado por Visão pelo toggle das Configurações.
ipcMain.on("set-vision-guide-config", (event, partial) => {
  configService.setVisionGuideConfig(partial || {});

  if (typeof partial?.enabled === 'boolean') {
    const cfg = configService.getConfig();
    if (partial.enabled) {
      if (!cfg.openIaToken) {
        const msg = '❌ Configure sua API key da OpenAI antes de usar o Assistente Guiado por Visão.';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('translation-result', { transcript: '', response: msg });
        }
        // Reverte o toggle salvo (não ficou ativo de fato).
        configService.setVisionGuideConfig({ enabled: false });
        return;
      }
      if (!visionGuide.isActive()) {
        const vg = cfg.visionGuide || {};
        visionGuide.start({
          apiKey: cfg.openIaToken,
          intervalSeconds: vg.intervalSeconds,
          minInterventionSeconds: vg.minInterventionSeconds,
          listenAudio: vg.listenAudio,
          useKnowledgeBase: vg.useKnowledgeBase,
        }).then(() => {
          if (configService.getOsIntegrationStatus()) {
            createVisionGuideOverlay();
            sendToVisionGuideOverlay('vision-guide-status', 'watching');
          }
        }).catch((e) => {
          console.error('[vision-guide] falha ao iniciar:', e.message);
          configService.setVisionGuideConfig({ enabled: false });
        });
      }
    } else {
      if (visionGuide.isActive()) {
        visionGuide.stop().then(() => {
          destroyVisionGuideOverlay();
        }).catch(() => {});
      } else {
        destroyVisionGuideOverlay();
      }
    }
  }
});

// IPC Handlers for AI Model
ipcMain.handle("get-ai-model", () => {
  return configService.getAiModel();
});

ipcMain.handle("get-edition", () => {
  return edition.getEdition();
});

ipcMain.on("open-config-ui", () => {
  createConfigWindow();
});

ipcMain.on("open-preferences-ui", () => {
  createPreferencesWindow();
});

ipcMain.on("set-ai-model", (event, aiModel) => {
  configService.setAiModel(aiModel);
});

// IPC Handlers for OpenAI Model
ipcMain.handle("get-openai-model", () => {
  return configService.getOpenAiModel();
});

ipcMain.on("set-openai-model", (event, model) => {
  configService.setOpenAiModel(model);
});

// IPC Handlers for OpenAI reasoning effort (gpt-5.x/o-series)
ipcMain.handle("get-openai-reasoning-effort", () => {
  return configService.getOpenAiReasoningEffort();
});

ipcMain.on("set-openai-reasoning-effort", (event, effort) => {
  configService.setOpenAiReasoningEffort(effort);
});

// IPC Handlers for OpenAI Vision Model
ipcMain.handle("get-openai-vision-model", () => {
  return configService.getOpenAiVisionModel();
});

ipcMain.on("set-openai-vision-model", (event, model) => {
  configService.setOpenAiVisionModel(model);
});

// IPC Handlers for Ollama Local
ipcMain.handle("get-ollama-local-model", () => {
  return configService.getOllamaLocalModel();
});

ipcMain.on("set-ollama-local-model", (event, model) => {
  configService.setOllamaLocalModel(model);
});

ipcMain.handle("get-ollama-local-host", () => {
  return configService.getOllamaLocalHost();
});

// ── Gemini CLI IPC handlers ──────────────────────────────────────────────────

ipcMain.handle("get-gemini-cli-model", () => configService.getGeminiCliModel());

ipcMain.on("set-gemini-cli-model", (event, model) => {
  configService.setGeminiCliModel(model);
  GeminiCliProvider.setModel(model);
});

ipcMain.handle("get-gemini-cli-models", () => GeminiCliProvider.getModels());

ipcMain.handle("check-gemini-cli-installed", async () => {
  try {
    const ok = await GeminiCliProvider.checkInstalled();
    return { installed: ok };
  } catch (e) {
    return { installed: false, error: String(e && e.message) };
  }
});

// Force session restart (e.g. user clicks "Reconectar" in UI).
ipcMain.handle("gemini-cli-restart-session", async () => {
  const projectPath = workspace.getProjectPath();
  await GeminiCliProvider.changeProject(projectPath, projectPath).catch(() => {});
  return { ok: true };
});

// ── Claude Code CLI IPC handlers ─────────────────────────────────────────────

ipcMain.handle("get-claude-cli-model", () => configService.getClaudeCliModel());

ipcMain.on("set-claude-cli-model", (event, model) => {
  configService.setClaudeCliModel(model);
  ClaudeCliProvider.setModel(model);
});

ipcMain.handle("get-claude-cli-models", () => ClaudeCliProvider.getModels());

ipcMain.handle("check-claude-cli-installed", async () => {
  try {
    const ok = await ClaudeCliProvider.checkInstalled();
    return { installed: ok };
  } catch (e) {
    return { installed: false, error: String(e && e.message) };
  }
});

ipcMain.handle("claude-cli-restart-session", async () => {
  const projectPath = workspace.getProjectPath();
  await ClaudeCliProvider.changeProject(projectPath, projectPath).catch(() => {});
  return { ok: true };
});

// Status check: o user clica "verificar" no painel pra ver se Ollama tá up.
ipcMain.handle("check-ollama-local-status", async () => {
  try {
    const svc = require("./services/ollamaLocalService");
    const ok = await svc.ping();
    if (!ok) return { running: false, models: null };
    const models = await svc.listInstalledModels();
    return { running: true, models: models || [] };
  } catch (e) {
    return { running: false, error: String(e && e.message), models: null };
  }
});

// IPC Handlers for OpenAI Token
ipcMain.handle("get-open-ia-token", () => {
    return configService.getOpenIaToken();
});

ipcMain.on("set-open-ia-token", (event, token) => {
    configService.setOpenIaToken(token);
});

// OS Integration IPC handlers
ipcMain.on("close-os-input", () => {
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.close();
  }
});

ipcMain.on("send-os-question", async (event, data) => {
  const text = typeof data === 'string' ? data : data.text;
  const image = typeof data === 'object' ? data.image : null;
  
  // Close input window
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.close();
  }
  
  // Show loading notification
  createOsNotificationWindow('loading', 'Processando pergunta...');
  
  try {
    // Imagem colada no input integrado = a imagem É a fonte da pergunta. Força
    // visão (não deixa o roteador OCR decidir mandar só texto e descartar a
    // imagem). Sem imagem, segue o fluxo de texto normal.
    await processOsQuestion(text, image, image ? { forceVision: true } : {});
  } catch (error) {
    console.error('Error processing OS question:', error);
    createOsNotificationWindow('response', 'Erro ao processar pergunta.');
  }
});

// Resize do overlay recording-live conforme o conteúdo cresce.
// Copia texto pro clipboard do sistema (overlay tem focusable=false,
// então navigator.clipboard não funciona — precisa do main process)
ipcMain.on("copy-to-clipboard", (event, text) => {
  try {
    clipboard.writeText(text || "");
    console.log(`📋 Copiado pro clipboard: ${(text || '').length} chars`);
  } catch (e) {
    console.warn("Falha ao copiar pro clipboard:", e.message);
  }
});

ipcMain.on("resize-overlay", (event, height) => {
  if (!osNotificationWindow || osNotificationWindow.isDestroyed()) return;
  try {
    const [w] = osNotificationWindow.getSize();
    const newH = Math.max(110, Math.min(700, parseInt(height, 10) || 110));
    osNotificationWindow.setSize(w, newH);
  } catch (_) {}
});

// === Confirm action overlay ===
// Usado por tools mutantes (systemPowerAction etc.) pra pedir clique humano
// antes de executar algo destrutivo. Retorna Promise<boolean>.
const _confirmActionPending = new Map(); // requestId -> { resolve, win, timer }
let globalBypassAllConfirmations = false;

function showConfirmActionOverlay(opts) {
  if (globalBypassAllConfirmations) {
    console.log(`[confirm] Bypassing confirmation automatically due to active 'always approve' bypass.`);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const requestId = `cfm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = { ...opts, requestId };
    const json = encodeURIComponent(Buffer.from(JSON.stringify(payload)).toString('base64'));

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const w = 480, h = 250;
    const win = new BrowserWindow({
      width: w, height: h,
      x: Math.floor((sw - w) / 2),
      y: Math.floor((sh - h) / 3),
      frame: false, transparent: true, alwaysOnTop: true,
      skipTaskbar: true, resizable: false, movable: true,
      focusable: true, hasShadow: true,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    try { win.setContentProtection(true); } catch (_) {}

    const filePath = path.join(__dirname, 'os-integration', 'notifications', 'confirmAction.html');
    win.loadFile(filePath, { search: `json=${json}` }).catch(err =>
      console.error('[confirm] load failed:', err)
    );
    win.focus();

    const timer = setTimeout(() => {
      if (_confirmActionPending.has(requestId)) {
        console.log(`[confirm] ${requestId} timeout -> cancelado`);
        finalize(false);
      }
    }, (opts.timeoutMs || 20000) + 500);

    function finalize(ok) {
      const entry = _confirmActionPending.get(requestId);
      if (!entry) return;
      _confirmActionPending.delete(requestId);
      clearTimeout(entry.timer);
      try { if (!entry.win.isDestroyed()) entry.win.close(); } catch (_) {}
      entry.resolve(!!ok);
    }

    _confirmActionPending.set(requestId, { resolve, win, timer, finalize });

    win.on('closed', () => {
      // Se fechou sem responder, assume cancelado
      if (_confirmActionPending.has(requestId)) finalize(false);
    });
  });
}

ipcMain.on("confirm-action-respond", (event, payload) => {
  if (!payload || !payload.requestId) return;
  const entry = _confirmActionPending.get(payload.requestId);
  if (!entry) return;
  console.log(`[confirm] ${payload.requestId} respondido: ok=${payload.ok}, always=${payload.always}`);
  if (payload.ok && payload.always) {
    globalBypassAllConfirmations = true;
    console.log(`[confirm] Bypassing all subsequent confirmations for this conversation turn.`);
  }
  entry.finalize(!!payload.ok);
});

// === Compressão de imagem para envio à OpenAI ===
// PNG full-screen 1080p ≈ 5-7 MB → 6.7-9 MB em base64. Caro e lento.
// OpenAI recomenda max 1568px por lado pra "high detail" (vision).
// JPEG q75 mantém OCR/visão perfeitos com ~40x menos bytes.
// Retorna { dataUrl, kb } pra log.
async function compressImageForVision(inputBase64OrBuffer, label = '') {
  try {
    const sharp = require('sharp');
    const inputBuffer = Buffer.isBuffer(inputBase64OrBuffer)
      ? inputBase64OrBuffer
      : Buffer.from(inputBase64OrBuffer, 'base64');
    const beforeKB = Math.round(inputBuffer.length / 1024);

    const output = await sharp(inputBuffer)
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75, mozjpeg: true })
      .toBuffer();

    const afterKB = Math.round(output.length / 1024);
    console.log(`📦 imagem comprimida${label ? ' [' + label + ']' : ''}: ${beforeKB} KB → ${afterKB} KB`);
    return {
      dataUrl: `data:image/jpeg;base64,${output.toString('base64')}`,
      base64: output.toString('base64'),
      kb: afterKB,
    };
  } catch (e) {
    console.warn('⚠️ falha ao comprimir imagem (mandando original):', e.message);
    const base64 = Buffer.isBuffer(inputBase64OrBuffer)
      ? inputBase64OrBuffer.toString('base64')
      : inputBase64OrBuffer;
    return { dataUrl: `data:image/png;base64,${base64}`, base64, kb: Math.round(base64.length * 0.75 / 1024) };
  }
}

// === Captura full-screen automática (sem seleção, sem prompt do portal) ===
// Usa ferramentas nativas do compositor (grim/gnome-screenshot/scrot/import).
// É o que mais se aproxima da experiência "PrintScreen → vai direto pra IA"
// que o usuário tinha no Garuda. Sem clique extra, sem janela de seleção.
async function captureFullScreenAuto() {
  const osOn = configService.getOsIntegrationStatus();
  const printOn = configService.getPrintModeStatus();
  const taCurrentlyActive = translationAssistant.isActive() &&
    translationOverlayWindow && !translationOverlayWindow.isDestroyed();

  // Pula se nenhum modo está ativo para tratar o screenshot
  if (!osOn && !printOn && !taCurrentlyActive) { return; }

  const tmpDir = path.join(app.getPath('temp'), `helpernode-shot-${Date.now()}`);
  const tmpPng = path.join(app.getPath('temp'), `helpernode-shot-${Date.now()}.png`);
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
  const isCosmic = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase().includes('COSMIC');
  let success = false;
  let capturedPath = null;

  // Helper: tenta um comando que escreve direto em tmpPng
  async function tryCmd(label, cmd) {
    try {
      await execPromise(cmd);
      const ok = fs2.existsSync(tmpPng);
      if (ok) console.log(`📸 captura via ${label} OK`);
      capturedPath = ok ? tmpPng : null;
      return ok;
    } catch (e) {
      console.warn(`📸 ${label} falhou: ${(e && e.stderr ? e.stderr : e.message || e).toString().trim()}`);
      try { if (fs2.existsSync(tmpPng)) fs2.unlinkSync(tmpPng); } catch (_) {}
      return false;
    }
  }

  try {
    // === ORDEM DE PRIORIDADE — TODAS STEALTH (sem prompt do portal) ===

    // 0) Windows/macOS: desktopCapturer captura SILENCIOSAMENTE (sem diálogo do
    //    portal, que só existe no Linux/Wayland). A janela do helper fica fora
    //    da gravação via setContentProtection — efetivo aqui, diferente do Linux.
    //    Este é o caminho stealth NATIVO dessas plataformas.
    if (process.platform !== 'linux') {
      try {
        capturedPath = await platformScreenCapture.captureFullScreenToFile(tmpPng);
        success = !!capturedPath;
      } catch (e) {
        console.warn('📸 desktopCapturer (win/mac) falhou:', (e && e.message) || e);
      }
    }

    // 1) COSMIC: cosmic-screenshot
    //    Sintaxe correta: --interactive=false --notify=false --save-dir <dir>
    //    A ferramenta gera um arquivo dentro de save-dir; pegamos o mais recente.
    if (isCosmic) {
      if (await commandExists('cosmic-screenshot')) {
        try {
          await fs.mkdir(tmpDir, { recursive: true });
          await execPromise(
            `cosmic-screenshot --interactive=false --notify=false --save-dir '${tmpDir}'`
          );
          // Encontra o arquivo gerado (PNG mais recente no diretório)
          const files = (await fs.readdir(tmpDir))
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => path.join(tmpDir, f));
          if (files.length > 0) {
            capturedPath = files[0];
            success = true;
            console.log('📸 captura via cosmic-screenshot OK:', capturedPath);
          }
        } catch (e) {
          console.warn('📸 cosmic-screenshot falhou:',
            (e && e.stderr ? e.stderr : e.message || e).toString().trim());
        }
      } else {
        // STEALTH NÃO É POSSÍVEL EM COSMIC SEM ESTA FERRAMENTA.
        // O Electron desktopCapturer abriria o diálogo "Compartilhar tela",
        // que é justamente o que queremos evitar. Falhamos com instrução clara.
        if (osOn) {
          createOsNotificationWindow('response',
            '<b>cosmic-screenshot</b> não está instalado.<br>' +
            'É necessário para captura silenciosa no COSMIC.<br><br>' +
            'Instale com:<br><code>sudo apt install cosmic-screenshot</code>');
        } else if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('transcription-error',
            'cosmic-screenshot não está instalado. Instale: sudo apt install cosmic-screenshot');
        }
        return;
      }
    }

    // 2) Wayland NÃO-COSMIC (Sway/Hyprland/Wayfire): grim
    if (!success && isWayland && !isCosmic && await commandExists('grim')) {
      success = await tryCmd('grim', `grim '${tmpPng}'`);
    }

    // 3) X11: gnome-screenshot (sem prompt, captura full-screen)
    if (!success && !isWayland && await commandExists('gnome-screenshot')) {
      success = await tryCmd('gnome-screenshot', `gnome-screenshot -f '${tmpPng}'`);
    }

    // 4) X11: spectacle (KDE)
    if (!success && !isWayland && await commandExists('spectacle')) {
      success = await tryCmd('spectacle', `spectacle -b -n -o '${tmpPng}'`);
    }

    // 5) X11: scrot
    if (!success && !isWayland && await commandExists('scrot')) {
      success = await tryCmd('scrot', `scrot -o '${tmpPng}'`);
    }

    // 6) X11: ImageMagick import
    if (!success && !isWayland && await commandExists('import')) {
      success = await tryCmd('import', `import -window root '${tmpPng}'`);
    }

    // ⚠️ NÃO usamos desktopCapturer do Electron como fallback:
    //    em Wayland ele SEMPRE dispara o diálogo "Compartilhar a tela"
    //    do XDG Portal — quebra o stealth e exige clique do usuário.
    //    Melhor falhar com mensagem clara do que vazar a presença do app.

    if (!success) {
      const hint = isCosmic
        ? 'Instale: <code>sudo apt install cosmic-screenshot</code>'
        : isWayland
          ? 'Instale: <code>sudo apt install grim</code>'
          : 'Instale: <code>sudo apt install gnome-screenshot</code>';
      if (osOn) {
        createOsNotificationWindow('response',
          `Não foi possível capturar a tela silenciosamente.<br>${hint}`);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcription-error',
          `Não foi possível capturar a tela. ${hint.replace(/<[^>]+>/g, '')}`);
      }
      return;
    }

    // Loading: a overlay flutuante é EXCLUSIVA do modo integrado (OS Integration).
    // No modo janela (print mode) o indicador de carregamento é o robot da própria
    // janela principal — criar a overlay aqui deixava o gif girando pra sempre,
    // pois nada a fechava fora do fluxo integrado.
    if (osOn) createOsNotificationWindow('loading', 'Analisando captura...');

    const imgBuffer = await fs.readFile(capturedPath);
    // limpeza
    try { await fs.unlink(capturedPath); } catch (_) {}
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}

    // Comprime ANTES de qualquer processamento. Reduz tráfego pra OpenAI
    // em ~40x sem perda perceptivél de qualidade visual / OCR.
    const compressed = await compressImageForVision(imgBuffer, 'fullscreen');
    const base64 = compressed.dataUrl;

    // Quando Translation Assistant está ativo, usa análise de entrevista dedicada
    // e injeta o resultado diretamente no overlay — sem OCR, sem processOsQuestion.
    if (taCurrentlyActive) {
      if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
        try { osNotificationWindow.close(); } catch (_) {}
        osNotificationWindow = null;
      }
      const apiKey = configService.getOpenIaToken();
      if (!apiKey) {
        sendToTranslationOverlay('translation-result', {
          type: 'image', mode: 'image',
          transcript: '❌ API key não configurada. Configure em Ajustes.',
          response: '',
        });
        return;
      }
      sendToTranslationOverlay('translation-result', {
        type: 'image', mode: 'image',
        transcript: '📸 Analisando captura de tela...',
        response: '',
      });
      try {
        const analysis = await analyzeInterviewImage(base64, apiKey);
        sendToTranslationOverlay('translation-result', {
          type: 'image', mode: 'image',
          transcript: '',
          response: analysis,
        });
      } catch (err) {
        console.error('[screenshot-interview] erro:', err.message);
        sendToTranslationOverlay('translation-result', {
          type: 'image', mode: 'image',
          transcript: `❌ Erro ao analisar imagem: ${err.message}`,
          response: '',
        });
      }
      return;
    }

    // TA ativo em modo janela (sem overlay) → análise de entrevista via visão, resultado no chat
    if (!osOn && translationAssistant.isActive() && mainWindow && !mainWindow.isDestroyed()) {
      const apiKey = configService.getOpenIaToken();
      if (!apiKey) {
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
          try { osNotificationWindow.close(); } catch (_) {}
          osNotificationWindow = null;
        }
        mainWindow.webContents.send('transcription-error', '❌ API key não configurada. Configure em Ajustes.');
        return;
      }
      // Mantém a notificação de loading visível como feedback enquanto analisa
      try {
        const analysis = await analyzeInterviewImage(base64, apiKey);
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
          try { osNotificationWindow.close(); } catch (_) {}
          osNotificationWindow = null;
        }
        mainWindow.webContents.send('openai-final-response', { resposta: analysis });
      } catch (err) {
        console.error('[screenshot-interview-window] erro:', err.message);
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
          try { osNotificationWindow.close(); } catch (_) {}
          osNotificationWindow = null;
        }
        mainWindow.webContents.send('transcription-error', `❌ Erro ao analisar imagem: ${err.message}`);
      }
      return;
    }

    // Delega TODO o trabalho (OCR + roteamento texto/visão + IA) para
    // processOsQuestion. NÃO montamos prompt aqui — evita duplicação de OCR.
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      await processOsQuestion('', base64, { forceVision: true });
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      // Modo janela: roda OCR só pra exibir; manda a IMAGEM pro renderer (que
      // decide visão vs texto). `base64` já é um data URL completo — não
      // re-prefixar, e a chave é `base64Image` (o que o handler ocr-result lê).
      let ocrText = '';
      try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
      mainWindow.webContents.send('ocr-result', {
        text: ocrText,
        base64Image: base64,
      });
    }
  } catch (e) {
    console.error('captureFullScreenAuto failed:', e);
    // Erro: overlay só no modo integrado; no modo janela avisa a janela principal.
    if (osOn) {
      createOsNotificationWindow('response', 'Erro ao capturar a tela.');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription-error', 'Erro ao capturar a tela.');
    }
  }
}

// === Captura nativa por seleção de região (sem dependências externas) ===
let regionSelectWindow = null;
let regionCaptureBuffer = null; // PNG buffer da tela inteira durante a seleção

async function captureRegionNative() {
  // Evita reentrância
  if (regionSelectWindow && !regionSelectWindow.isDestroyed()) {
    regionSelectWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.size;
  const sf = display.scaleFactor || 1;

  // 1) Captura a tela inteira via desktopCapturer (funciona em X11/Wayland via portal)
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(dw * sf), height: Math.round(dh * sf) },
    });
  } catch (e) {
    console.error('desktopCapturer falhou:', e);
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      createOsNotificationWindow('response', 'Não foi possível acessar a captura de tela.');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription-error', 'Não foi possível acessar a captura de tela.');
    }
    return;
  }
  if (!sources || sources.length === 0) {
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      createOsNotificationWindow('response', 'Nenhuma fonte de tela disponível.');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription-error', 'Nenhuma fonte de tela disponível.');
    }
    return;
  }
  // Pega a primária (Linux geralmente devolve a principal primeiro)
  const screenSource = sources[0];
  const fullImage = screenSource.thumbnail;
  regionCaptureBuffer = fullImage.toPNG();

  // 2) Abre overlay transparente fullscreen para seleção
  regionSelectWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: dw,
    height: dh,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreen: true,
    focusable: true, // precisa receber clique/drag
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // Stealth no screen-share
  try { regionSelectWindow.setContentProtection(true); } catch (_) {}
  regionSelectWindow.setAlwaysOnTop(true, 'screen-saver');

  await regionSelectWindow.loadFile(path.join(__dirname, 'os-integration', 'notifications', 'regionSelect.html'));

  regionSelectWindow.on('closed', () => {
    regionSelectWindow = null;
  });
}

ipcMain.on('region-cancelled', () => {
  if (regionSelectWindow && !regionSelectWindow.isDestroyed()) regionSelectWindow.close();
  regionCaptureBuffer = null;
});

ipcMain.on('region-selected', async (event, rect) => {
  // rect: { x, y, width, height } em px CSS do overlay
  try {
    if (regionSelectWindow && !regionSelectWindow.isDestroyed()) regionSelectWindow.close();
    if (!regionCaptureBuffer) return;
    if (!rect || rect.width < 5 || rect.height < 5) {
      regionCaptureBuffer = null;
      return;
    }

    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;

    // Reconstrói NativeImage a partir do PNG já capturado
    const fullImg = nativeImage.createFromBuffer(regionCaptureBuffer);
    regionCaptureBuffer = null;

    const cropRect = {
      x: Math.max(0, Math.round(rect.x * sf)),
      y: Math.max(0, Math.round(rect.y * sf)),
      width: Math.max(1, Math.round(rect.width * sf)),
      height: Math.max(1, Math.round(rect.height * sf)),
    };
    const cropped = fullImg.crop(cropRect);
    const pngBuf = cropped.toPNG();
    const compressed = await compressImageForVision(pngBuf, 'region');
    const base64 = compressed.dataUrl;

    // Mostra loading discreto se integrado
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      createOsNotificationWindow('loading', 'Analisando captura...');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screen-capturing', true);
    }

    // Delega tudo a processOsQuestion (faz OCR + roteamento internamente)
    try {
      if (isOsIntegration) {
        await processOsQuestion('', base64, { forceVision: true });
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        let ocrText = '';
        try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
        // `base64` já é data URL completo; chave `base64Image` (lida pelo renderer).
        mainWindow.webContents.send('ocr-result', { text: ocrText, base64Image: base64 });
      }
    } catch (e) {
      console.error('Erro OCR/IA na captura nativa:', e);
      if (isOsIntegration) {
        createOsNotificationWindow('response', 'Erro ao processar a captura.');
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('screen-capturing', false);
        mainWindow.webContents.send('transcription-error', 'Erro ao processar a captura.');
      }
    }
  } catch (e) {
    console.error('region-selected handler error:', e);
  }
});

// Handler to cancel recording from OS notification
ipcMain.on("cancel-recording", () => {
  console.log('Cancel recording requested from OS notification');

  if (anyRealtimeActive()) {
    stopAllRealtime();
    isRecording = false;
    return;
  }
  
  if (isRecording && recordingProcess) {
    recordingProcess.kill("SIGTERM");
    recordingProcess = null;
    isRecording = false;
    
    console.log("Recording cancelled by user");
    
    // Close the recording notification
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.close();
    }
    
    // Show cancelled notification
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      createOsNotificationWindow('response', 'Gravação cancelada.');
    } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Gravação cancelada.",
        silent: true,
      }).show();
    }
  }
});

// === Conversa contínua OS Mode: pipeline Vosk + Whisper ===
// Mesma ideia do RealtimeAssistantService, simplificado para o overlay
// recording-live. NAO usa heuristica "looksLikeQuestion" — manda todo
// segmento pra IA, ela decide via system prompt se responde ou ignora.
// Multi-turno: depois de responder, novo segmento comeca limpo na bolha
// seguinte, igual chat.

function handleOsLiveVoskEvent(event) {
  if (!event) return;
  if (event.type === 'ready' || event.type === 'stopped') return;
  if (event.type === 'error') {
    console.warn('[os-live] vosk error:', event.message);
    return;
  }
  if (event.type === 'audio') return _onOsLiveAudioChunk(event.data);

  if (event.type === 'partial') {
    const seg = _ensureOsLiveSegment();
    seg.partial = event.text || '';
    _renderOsLiveTurn(seg);
    return;
  }
  if (event.type === 'result') {
    const txt = (event.text || '').trim();
    if (!txt) return;
    const seg = _ensureOsLiveSegment();
    seg.voskBuffer.push(txt);
    seg.partial = '';
    seg.hasSpeech = true;
    _renderOsLiveTurn(seg);
  }
}

function _ensureOsLiveSegment() {
  if (osLiveSegment && !osLiveSegment.closing) return osLiveSegment;
  osLiveTurnCount += 1;
  const seg = {
    id: 'osseg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    turnNumber: osLiveTurnCount,
    voskBuffer: [],
    partial: '',
    pcmChunks: [],
    pcmBytes: 0,
    startedAt: Date.now(),
    lastLoudAt: Date.now(),
    hasSpeech: false,
    closing: false,
    voskText: '',
    whisperText: null,
    responseVosk: null,
    responseWhisper: null,
  };
  osLiveSegment = seg;
  // Cria bolha nova no overlay
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    osNotificationWindow.webContents.executeJavaScript(
      `window.startTurn && window.startTurn(${JSON.stringify(seg.id)}, ${seg.turnNumber})`
    ).catch(() => {});
  }
  return seg;
}

function _onOsLiveAudioChunk(chunk) {
  if (!chunk) return;
  const seg = _ensureOsLiveSegment();
  seg.pcmChunks.push(chunk);
  seg.pcmBytes += chunk.length;
  if (_computeRMS(chunk) > OS_LIVE_SILENCE_RMS) seg.lastLoudAt = Date.now();
}

function _segmentTextOsLive(seg) {
  const finalized = seg.voskBuffer.join(' ').trim();
  const partial = (seg.partial || '').trim();
  return [finalized, partial].filter(Boolean).join(' ');
}

function _renderOsLiveTurn(seg) {
  if (!osNotificationWindow || osNotificationWindow.isDestroyed()) return;
  const text = _segmentTextOsLive(seg);
  osNotificationWindow.webContents.executeJavaScript(
    `window.updateTurn && window.updateTurn(${JSON.stringify(seg.id)}, ${JSON.stringify(text)})`
  ).catch(() => {});
}

function checkOsLiveSegmentLimits() {
  const seg = osLiveSegment;
  if (!seg || seg.closing || !seg.hasSpeech) return;
  const now = Date.now();
  if (now - seg.startedAt >= OS_LIVE_MAX_MS) {
    console.log(`[os-live] ${seg.id}: max duracao -> fechar`);
    return void closeOsLiveSegment().catch(console.error);
  }
  if (now - seg.lastLoudAt >= OS_LIVE_SILENCE_MS) {
    console.log(`[os-live] ${seg.id}: silencio -> fechar`);
    closeOsLiveSegment().catch(console.error);
  }
}

async function closeOsLiveSegment() {
  const seg = osLiveSegment;
  if (!seg || seg.closing) return;
  seg.closing = true;
  osLiveSegment = null;

  seg.voskText = _segmentTextOsLive(seg);
  if (!seg.voskText || !seg.hasSpeech) return;

  // Salva WAV pra Whisper rodar em paralelo
  const pcm = Buffer.concat(seg.pcmChunks, seg.pcmBytes);
  seg.pcmChunks = [];
  const wavPath = path.join(OS_LIVE_TMP_DIR, seg.id + '.wav');
  try {
    fs2.mkdirSync(OS_LIVE_TMP_DIR, { recursive: true });
    fs2.writeFileSync(wavPath, _buildWavFile(pcm, OS_LIVE_SAMPLE_RATE, 1, 16));
  } catch (e) { console.error('[os-live] WAV write failed:', e.message); }

  // Continuacao de fala: se o segmento anterior fechou ha pouco tempo (pausa pra
  // respirar, nao fim de pergunta), junta os textos e reprocessa a pergunta INTEIRA.
  const prevClosed = osLiveLastClosed;
  const isContinuation = !!(prevClosed && (Date.now() - prevClosed.closedAt) <= OS_LIVE_CONTINUATION_WINDOW_MS);
  const askVoskText = isContinuation ? `${prevClosed.text} ${seg.voskText}`.trim() : seg.voskText;

  // Marca bolha como "processando" — mostra a pergunta completa se for continuacao.
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    osNotificationWindow.webContents.executeJavaScript(
      `window.markTurnFinal && window.markTurnFinal(${JSON.stringify(seg.id)}, ${JSON.stringify(askVoskText)})`
    ).catch(() => {});
  }

  // Marca a resposta do turno anterior como superada — a pergunta continuava.
  if (isContinuation && osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    osNotificationWindow.webContents.executeJavaScript(
      `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(prevClosed.id)}, ${JSON.stringify('↳ pergunta continuou no trecho seguinte — veja a resposta completa abaixo.')}, true)`
    ).catch(() => {});
  }

  osLiveLastClosed = { id: seg.id, text: askVoskText, closedAt: Date.now() };

  // 1) Pergunta IA com texto Vosk (rapido, ja mesclado se continuacao)
  try {
    const resp = await _askOsLiveAI(askVoskText, null);
    seg.responseVosk = resp;
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.webContents.executeJavaScript(
        `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(seg.id)}, ${JSON.stringify(resp)}, false)`
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[os-live] AI vosk error:', err.message);
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.webContents.executeJavaScript(
        `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(seg.id)}, ${JSON.stringify('Erro: ' + err.message)}, false)`
      ).catch(() => {});
    }
  }

  // 2) Whisper async pra corrigir e re-perguntar se diferir
  if (fs2.existsSync(wavPath)) {
    _runOsLiveWhisper(seg, wavPath).catch(e => console.error('[os-live] whisper:', e.message));
  }
}

async function _runOsLiveWhisper(seg, wavPath) {
  const whisperBin = path.join(__dirname, 'whisper', 'build', 'bin', 'whisper-cli');
  const modelMed = path.join(__dirname, 'whisper', 'models', 'ggml-medium.bin');
  const modelSm = path.join(__dirname, 'whisper', 'models', 'ggml-small.bin');
  const model = fs2.existsSync(modelMed) ? modelMed : (fs2.existsSync(modelSm) ? modelSm : null);
  if (!fs2.existsSync(whisperBin) || !model) {
    try { fs2.unlinkSync(wavPath); } catch (_) {}
    return;
  }
  const lang = (configService.getLanguage && configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
  const cmd = `"${whisperBin}" -m "${model}" -f "${wavPath}" -l ${lang} --threads 8 --no-timestamps --best-of 3 --beam-size 3`;
  console.log('[os-live] whisper rodando para', seg.id);

  let text = '';
  try {
    const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
    text = (stdout || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.error('[os-live] whisper exec error:', e.message);
    try { fs2.unlinkSync(wavPath); } catch (_) {}
    return;
  }
  try { fs2.unlinkSync(wavPath); } catch (_) {}

  if (!text || text === seg.voskText) return;
  if (_textsAreEquivalent(text, seg.voskText)) return;
  console.log(`[os-live] whisper corrigiu ${seg.id}: "${seg.voskText}" -> "${text}"`);
  seg.whisperText = text;

  // Atualiza a bolha do user com texto corrigido
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    osNotificationWindow.webContents.executeJavaScript(
      `window.replaceTurnText && window.replaceTurnText(${JSON.stringify(seg.id)}, ${JSON.stringify(text)})`
    ).catch(() => {});
  }

  // Re-pergunta IA com versao corrigida
  try {
    const resp = await _askOsLiveAI(text, seg.responseVosk);
    seg.responseWhisper = resp;
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.webContents.executeJavaScript(
        `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(seg.id)}, ${JSON.stringify(resp)}, true)`
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[os-live] AI whisper error:', err.message);
  }
}

async function _askOsLiveAI(transcript, previousResponse) {
  const token = configService.getOpenIaToken();
  if (!token) throw new Error('Token da OpenAI nao configurado.');
  const model = configService.getOpenAiModel();
  const instruction = configService.getPromptInstruction();

  const userPrompt = previousResponse
    ? `TRANSCRIÇÃO CORRIGIDA (Whisper, mais precisa) de um trecho que ja foi enviado em versao menos precisa (Vosk):\n\n"${transcript}"\n\nResposta anterior (com base na versao imprecisa): "${previousResponse}"\n\nRefaca sua ajuda com base APENAS na versao corrigida.`
    : `TRANSCRIÇÃO ao vivo (modelo Vosk, pode conter erros) do audio captado:\n\n"${transcript}"\n\nResponda conforme as regras do system prompt. Se for incompreensivel ou sem conteudo, responda APENAS '(trecho sem conteudo relevante)'.`;

  // Tool calling fica desligado aqui (latencia). Stateless tambem — cada
  // turno e' independente pra IA conseguir tratar contexto via prompt.
  return await OpenAIService.makeOpenAIRequest(
    userPrompt,
    token,
    instruction,
    model,
    null,
    { stateless: true }
  );
}

function _textsAreEquivalent(a, b) {
  const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}

function _computeRMS(buf) {
  if (!buf || buf.length < 2) return 0;
  let sumSq = 0, count = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sumSq += s * s; count++;
  }
  if (!count) return 0;
  return Math.sqrt(sumSq / count);
}

function _buildWavFile(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm], 44 + dataSize);
}

// === Heurística de roteamento OCR vs VISÃO ===
// Decide se vale a pena pagar pelo modo "image_url" (caro, ~150-1000 tokens
// extras) ou se o OCR já foi suficiente (TEXTO puro, barato).
//
// Manda pra VISÃO quando:
//  - OCR vazio ou muito curto (provavelmente print de gráfico/equação imagem-only)
//  - Texto tem ruído alto (muitos chars não-alfanuméricos: símbolos quebrados de OCR)
//  - Detecta operadores matemáticos (×, ÷, =, ², √, ∫, Σ, π, ≈, ≤, ≥, frações)
//  - Detecta padrão de múltipla escolha (linhas com A) B) C) ou A. B. C.)
//  - Detecta tabelas/grids (muitas linhas curtas alinhadas, separadores |)
//  - Razão "ruído/total" > 30%
function shouldUseVisionFor(ocrText) {
  if (!ocrText || !ocrText.trim()) {
    return { useVision: true, reason: 'OCR vazio (provável imagem sem texto)' };
  }
  const t = ocrText.trim();
  if (t.length < 25) {
    return { useVision: true, reason: `OCR curto demais (${t.length} chars)` };
  }

  // 1) Símbolos matemáticos / equações
  const mathSymbols = /[×÷±≠≈≤≥∞√∫∑∏πθλμωΩ²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅]/;
  if (mathSymbols.test(t)) {
    return { useVision: true, reason: 'símbolos matemáticos detectados' };
  }
  // Operadores ASCII: x= ou =? em contexto numérico (sinal de "conta")
  if (/\d\s*[x*+\-/=]\s*\d/.test(t) && /=\s*\?/.test(t)) {
    return { useVision: true, reason: 'expressão matemática com "=?" (problema a resolver)' };
  }
  // Frações tipo "1/2", "3/4" misturadas com palavras curtas
  if (/\d+\/\d+/.test(t) && t.split(/\s+/).filter(w => w.length < 3).length > 5) {
    return { useVision: true, reason: 'fração + texto picotado' };
  }

  // 2) Padrão de múltipla escolha (A) B) C)) ou (A. B. C.)
  const choicePattern = /(^|\n)\s*[A-Fa-f][).]\s+\S/g;
  const choices = (t.match(choicePattern) || []).length;
  if (choices >= 3) {
    // Tem 3+ alternativas mas OCR pode ter perdido as opções
    // Se as linhas das alternativas forem curtas/quebradas, manda visão
    return { useVision: true, reason: `múltipla escolha (${choices} alternativas)` };
  }

  // 3) Razão de ruído (caracteres não-imprimíveis-comuns)
  const totalChars = t.length;
  // Conta caracteres "esquisitos" típicos de OCR ruim:
  // chars Unicode raros, sequências de pontuação, símbolos isolados
  const noiseChars = (t.match(/[^\w\s.,!?;:()'"\-–—\/áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ\u00A0]/g) || []).length;
  const noiseRatio = noiseChars / totalChars;
  if (noiseRatio > 0.20) {
    return { useVision: true, reason: `OCR ruidoso (${(noiseRatio * 100).toFixed(0)}% chars estranhos)` };
  }

  // 4) Muitas "palavras" de 1-2 caracteres seguidas → texto picotado
  const words = t.split(/\s+/).filter(Boolean);
  const tinyWords = words.filter(w => w.length <= 2 && /[a-zA-Z]/.test(w)).length;
  if (words.length > 10 && tinyWords / words.length > 0.40) {
    return { useVision: true, reason: `texto picotado (${tinyWords}/${words.length} palavras de 1-2 chars)` };
  }

  // 5) Tabelas/grids: muitos | em linhas curtas
  const pipeLines = t.split('\n').filter(l => (l.match(/\|/g) || []).length >= 2).length;
  if (pipeLines >= 3) {
    return { useVision: true, reason: 'aparenta tabela/grid' };
  }

  // OCR limpo o suficiente — TEXTO basta
  return { useVision: false, reason: `OCR limpo (${words.length} palavras, ruído ${(noiseRatio * 100).toFixed(0)}%)` };
}

// Janela SECUND\u00c1RIA pra resposta de imagem quando recording-live (Vosk)
// est\u00e1 ativa. Reutiliza response.html, posiciona um pouco abaixo da
// recording-live (que fica top-right) pra n\u00e3o sobrepor.
function showImageResponseInSecondaryWindow(htmlContent) {
  try {
    if (osImageResponseWindow && !osImageResponseWindow.isDestroyed()) {
      osImageResponseWindow.close();
      osImageResponseWindow = null;
    }
  } catch (_) {}

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winW = 420, winH = 320;
  // Posiciona abaixo da recording-live (~y=60 + h=400 + gap). Se n\u00e3o couber, joga na meia altura.
  const posX = Math.max(0, width - winW - 30);
  const desiredY = 60 + 420 + 12;
  const posY = (desiredY + winH > height - 20) ? Math.max(20, Math.floor(height / 2 - winH / 2)) : desiredY;

  osImageResponseWindow = new BrowserWindow({
    width: winW, height: winH,
    x: posX, y: posY,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, resizable: false, movable: true,
    minimizable: false, maximizable: false, fullscreenable: false,
    focusable: false, type: 'toolbar', hasShadow: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  try { osImageResponseWindow.setContentProtection(true); } catch (_) {}
  osImageResponseWindow.setAlwaysOnTop(true, 'screen-saver');
  osImageResponseWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const filePath = path.join(__dirname, 'os-integration', 'notifications', 'response.html');
  osImageResponseWindow.loadFile(filePath).catch(err => console.error('[os-image] load response.html:', err));
  osImageResponseWindow.webContents.once('dom-ready', () => {
    osImageResponseWindow.webContents.executeJavaScript(`
      if (typeof window.setResponseContent === 'function') {
        window.setResponseContent(${JSON.stringify(htmlContent)});
      } else {
        document.body.innerHTML = ${JSON.stringify(htmlContent)} + '<button class="close-btn" onclick="window.close()" style="position:absolute;top:5px;right:8px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0;width:20px;height:20px;z-index:1000;">×</button>';
      }
    `).catch(() => {});
  });
  osImageResponseWindow.on('closed', () => { osImageResponseWindow = null; });
}

// Prepende o contexto do usuário (nome + background das Preferências) à
// instrução de sistema. Antes só o Tradutor personalizava; agora o modo
// integrado / print / paste de imagem também usa o background configurado.
function withUserContext(instruction) {
  try {
    const ctx = configService.getUserContextBlock ? configService.getUserContextBlock() : '';
    if (ctx && ctx.trim()) return `${ctx}\n\n${instruction}`;
  } catch (_) {}
  return instruction;
}

async function processOsQuestion(text, image = null, opts = {}) {
  // opts.forceVision = true  →  pula o roteador, manda imagem sempre.
  //   Use isto quando a imagem é a FONTE da pergunta (capturas de tela,
  //   paste image). O OCR de tela cheia tipicamente captura a UI do navegador
  //   e barra de tarefas, ignorando o conteúdo real (que pode ser texto
  //   renderizado em canvas/SVG, números em quiz, etc).
  console.log(`🤖 processOsQuestion called - FORCEFULLY closing any notifications`);

  try {
    const aiModel = getEffectiveAiModel();
    let resposta;

    // === ROTEAMENTO INTELIGENTE: TEXTO vs VISÃO ===
    // Política: imagem é ~150 tokens (low) ou ~1000+ tokens (high). Caro pra
    // mandar sempre. Estratégia:
    //   1) Roda OCR
    //   2) Decide se o OCR "basta" (texto limpo, sem matemática complexa,
    //      sem ruído fonético) → manda só TEXTO (barato)
    //   3) Se o OCR estiver bagunçado, tiver matemática/equação, tabela,
    //      gráfico, símbolos, ou for muito curto → manda IMAGEM em high detail
    let extractedText = '';
    let useVision = false;
    let visionReason = '';

    if (image) {
      // Force-vision pula OCR completamente (mais rápido, e o OCR de tela
      // cheia geralmente é só lixo de UI). A imagem fala por si.
      if (opts.forceVision) {
        useVision = true;
        visionReason = 'forceVision (captura direta de tela/imagem)';
        console.log(`🧭 Roteamento: VISÃO — ${visionReason}`);
      } else {
        try {
          extractedText = await TesseractService.getTextFromImage(image);
          console.log(`✅ OCR: ${extractedText.substring(0, 100).replace(/\n/g, ' ')}...`);
        } catch (ocrError) {
          console.warn('OCR falhou:', ocrError.message || ocrError);
          extractedText = '';
        }

        const decision = shouldUseVisionFor(extractedText);
        useVision = decision.useVision;
        visionReason = decision.reason;
        console.log(`🧭 Roteamento: ${useVision ? 'VISÃO' : 'TEXTO'} — ${visionReason}`);
      }

      if (useVision) {
        // PROMPT LIMPO no modo visão: o OCR ruim só confunde o modelo.
        // O texto extra é mínimo — a imagem fala por si. Damos só dicas
        // que o modelo precisa pra desambiguar (ex.: "x" pode ser multiplicação).
        text = (text && text.trim() ? `${text}\n\n` : '')
          + 'Analise a IMAGEM com atenção. Responda conforme as regras do sistema.\n\n'
          + 'IMPORTANTE: na imagem, "x" entre dois números significa MULTIPLICAÇÃO '
          + '(ex.: "11x2" = 11 × 2 = 22, NÃO é 11 ao quadrado). '
          + 'Notação de potência seria "11²" ou "11^2".';
      } else {
        // OCR limpo: monta um prompt de texto puro com o conteúdo extraído
        text = (text && text.trim() ? `${text}\n\n` : '')
          + `Conteúdo extraído de uma captura de tela:\n\n${extractedText}\n\nResponda conforme as regras do sistema.`;
      }
    }

    if (aiModel === 'openIa') {
      const token = configService.getOpenIaToken();
      const instruction = withUserContext(configService.getPromptInstruction());
      if (!token) {
        console.log(`🔔 No OpenAI token, closing notification and showing error`);
        // Immediately close any loading notification and wait
        destroyNotificationWindow();
        await new Promise(resolve => setTimeout(resolve, 200));
        createOsNotificationWindow('response', 'Token da OpenAI não configurado.');
        return;
      }
      const sendImage = image && useVision;
      // Modelo dedicado pra visão: nano confunde notação básica em imagens.
      // gpt-4o-mini é barato e muito mais preciso em OCR/visual reasoning.
      const openAiModel = sendImage
        ? configService.getOpenAiVisionModel()
        : configService.getOpenAiModel();
      console.log(`🤖 OpenAI ${openAiModel}${sendImage ? ' [VISÃO high]' : ' [TEXTO]'}...`);
      const _wsText3 = sendImage ? text : await prependWorkspaceContextIfNeeded(text, openAiModel);

      const useAgentic = !sendImage && shouldUseAgentic(text);

      if (useAgentic) {
          console.log('🤖 OCR: Iniciando AGENTIC WORKFLOW (multi-fase)...');
          try {
            resposta = await agenticWorkflow.run(
                _wsText3, 
                { token, model: openAiModel, baseInstruction: instruction },
                osNotificationWindow.webContents
            );
          } catch (err) {
            resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
          }
      } else {
          // helperTools só engaja em modo TEXTO (visão é one-shot stateless)
          const ht = sendImage
            ? { opts: { stateless: !!image } }
            : (() => {
                const _ht = buildHelperToolsOpenAIOpts(_wsText3, instruction, openAiModel);
                _ht.opts = { ..._ht.opts, stateless: !!image };
                return _ht;
              })();
          resposta = await OpenAIService.makeOpenAIRequest(
            _wsText3,
            token,
            ht.instruction || instruction,
            ht.model || openAiModel,
            sendImage ? image : null,
            // Capturas de tela são sempre one-shot: não reaproveita histórico
            // (não faz sentido carregar a imagem anterior junto da próxima).
            // Isso também elimina QUALQUER cache/contexto entre requests.
            ht.opts
          );
      }
      console.log(`🤖 Got OpenAI response: ${resposta.substring(0, 50)}...`);
    } else if (aiModel === 'ollamaLocal') {
      try {
        const OllamaLocalService = require('./services/ollamaLocalService');
        const instructionO3 = withUserContext(configService.getPromptInstruction());
        const _wsTxtO3 = await prependWorkspaceContextIfNeeded(text, 'ollama');

        const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
        if (htEnabled) {
          const _htO3 = buildHelperToolsOpenAIOpts(_wsTxtO3, instructionO3, configService.getOpenAiModel());
          resposta = await OllamaLocalService.responder(_wsTxtO3, _htO3.opts);
        } else {
          resposta = await OllamaLocalService.responder(_wsTxtO3);
        }
      } catch (ollamaErr) {
        console.error("Local Ollama falhou:", ollamaErr && ollamaErr.message);
        resposta = `Ollama Local falhou: ${ollamaErr.message}`;
      }
    } else {
      // Backends sem visão (Ollama): só TEXTO. Mas com tool calling agora.
      try {
        const instructionO3 = withUserContext(configService.getPromptInstruction());
        const useAgentic = shouldUseAgentic(text);
        if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }
        const _wsTxtO3 = await prependWorkspaceContextIfNeeded(text, 'ollama');

        if (useAgentic) {
            console.log('🤖 OCR: Iniciando AGENTIC WORKFLOW OLLAMA (multi-fase)...');
            BackendService.clearSessions();
            try {
              resposta = await ollamaAgenticWorkflow.run(
                  _wsTxtO3, 
                  { baseInstruction: instructionO3 },
                  osNotificationWindow.webContents
              );
            } catch (err) {
              resposta = `[Ollama Agentic] Interrompido ou falhou: ${err.message}`;
            }
        } else {
            const _htO3 = buildHelperToolsOpenAIOpts(_wsTxtO3, instructionO3, configService.getOpenAiModel());
            resposta = await BackendService.responder(_wsTxtO3, _htO3.opts);
        }
        backendIsOnline = true;
      } catch (backendError) {
        console.error("Backend Ollama falhou:", backendError && backendError.message);
        backendIsOnline = false;
        throw new Error(
          "Backend Ollama indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
        );
      }
    }

    console.log(`🔔 Destroying loading notification and showing response`);

    // Se a recording-live (Vosk) est\u00e1 ativa, NAO destroi essa janela \u2014
    // mostra a resposta numa janela secund\u00e1ria pra n\u00e3o engolir a conversa.
    const formattedResponse = formatToHTML(resposta);
    if (VoskStreamService.isRunning()) {
      console.log('[os-image] Vosk ativo \u2014 abrindo response em janela secund\u00e1ria');
      showImageResponseInSecondaryWindow(formattedResponse);
    } else {
      // CRITICAL: Ensure the loading notification is completely destroyed before creating response
      destroyNotificationWindow();
      // Wait a bit longer to ensure the window is fully destroyed
      await new Promise(resolve => setTimeout(resolve, 300));
      createOsNotificationWindow('response', formattedResponse);
    }
    
  } catch (error) {
    console.error('Error in processOsQuestion:', error);
    
    // Destroy any existing notification before showing error
    destroyNotificationWindow();
    
    // Wait to ensure previous notification is completely destroyed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    createOsNotificationWindow('response', 'Erro ao gerar resposta.');
  }
}

// ========== History IPC Handlers ==========
ipcMain.handle('get-last-three-sessions', async () => {
  try {
    return historyService.getLastThreeSessions();
  } catch (error) {
    console.error('Erro ao obter últimas 3 sessões:', error);
    return [];
  }
});

ipcMain.handle('get-all-sessions', async () => {
  try {
    return historyService.getAllSessions();
  } catch (error) {
    console.error('Erro ao obter todas as sessões:', error);
    return [];
  }
});

// Restaura o contexto de uma conversa na sessão da IA (OpenAI), pra continuar
// de onde parou. Recebe os pares {role, content} da conversa restaurada.
ipcMain.handle('seed-ai-session', async (event, messages) => {
  try {
    const n = OpenAIService.seedSession(Array.isArray(messages) ? messages : []);
    return { ok: true, seeded: n };
  } catch (error) {
    console.error('Erro ao restaurar contexto da IA:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('get-session-by-id', async (event, sessionId) => {
  try {
    return historyService.getSessionById(sessionId);
  } catch (error) {
    console.error('Erro ao obter sessão:', error);
    return null;
  }
});

/**
 * Salva o conteudo de uma sessao como .txt em ~/Downloads (com fallback pra
 * ~/Documents, depois /tmp). Retorna { ok, path, error } pro renderer.
 *
 * Formato do arquivo:
 *   # Helper Node - <titulo>
 *   # Sessao: <id>  Data: <iso>
 *
 *   P: <pergunta>
 *
 *   R: <resposta>
 *   ───────────────
 */
ipcMain.handle('download-conversation-txt', async (event, sessionId) => {
  try {
    // dataset.sessionId vem como string; historyService usa Date.now() (number).
    // Tenta number primeiro, fallback pra string original.
    const numericId = Number(sessionId);
    const session = historyService.getSessionById(Number.isFinite(numericId) ? numericId : sessionId)
      || historyService.getSessionById(sessionId);
    if (!session) return { ok: false, error: 'Sessao nao encontrada.' };

    const homeDir = require('os').homedir();
    const candidates = [
      path.join(homeDir, 'Downloads'),
      path.join(homeDir, 'Documents'),
      '/tmp',
    ];
    let outDir = null;
    for (const d of candidates) {
      try {
        await fs.access(d);
        outDir = d;
        break;
      } catch (_) {}
    }
    if (!outDir) outDir = require('os').tmpdir();

    const safeTitle = (session.title || 'conversa')
      .toString()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `helper-node_${stamp}_${safeTitle}.txt`;
    const fullPath = path.join(outDir, fileName);

    const header = [
      `# Helper Node - ${session.title || '(sem titulo)'}`,
      `# Sessao: ${session.id}`,
      `# Data: ${new Date().toISOString()}`,
      '',
      '',
    ].join('\n');

    const body = (session.conversations || []).map((msg) => {
      const label = msg.role === 'user' ? 'P:' : 'R:';
      return `${label}\n${msg.content}\n${'─'.repeat(60)}\n`;
    }).join('\n');

    await fs.writeFile(fullPath, header + body, 'utf8');
    console.log(`📥 Conversa exportada: ${fullPath}`);
    return { ok: true, path: fullPath };
  } catch (error) {
    console.error('Erro ao exportar conversa:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('add-message', async (event, sessionId, role, content) => {
  try {
    const finalSessionId = await historyService.addMessage(sessionId, role, content);
    return { success: true, sessionId: finalSessionId };
  } catch (error) {
    console.error('Erro ao adicionar mensagem ao histórico:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-new-session', async (event, title) => {
  try {
    const session = await historyService.createNewSession(title);
    return session;
  } catch (error) {
    console.error('Erro ao criar sessão:', error);
    return null;
  }
});

ipcMain.handle('new-chat', async () => {
  try {
    const session = await historyService.createNewSession('Nova conversa');
    // Nova sessao = re-injeta contexto do workspace na proxima pergunta.
    try { workspace.resetContextSent && workspace.resetContextSent(); } catch (_) {}
    return session;
  } catch (error) {
    console.error('Erro ao criar novo chat:', error);
    return null;
  }
});

ipcMain.handle('delete-session', async (event, sessionId) => {
  try {
    const success = await historyService.deleteSession(sessionId);
    if (success) {
      console.log(`✓ Sessão ${sessionId} deletada com sucesso`);
    }
    return { success };
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    return { success: false, error: error.message };
  }
});

// ========== End History Handlers ==========

app.whenReady().then(async () => {
  configService.initialize();
  // Modo de Teste do Tradutor é só por sessão — nunca persiste entre aberturas.
  try { configService.setTranslationAssistantConfig({ testMode: false }); } catch (_) {}
  helperTools.initialize(configService.getHelperToolsConfig());
  // Registra confirmer para tools mutantes (systemPowerAction etc.)
  try {
    const spa = require('./services/helperTools/tools/systemPowerAction');
    if (spa && typeof spa.setConfirmer === 'function') {
      spa.setConfirmer((opts) => showConfirmActionOverlay(opts));
    }
    // Write tools: confirmer + listener pra notificar UI quando arquivo for editado
    const _writeNotifier = (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('workspace-file-written', data);
        }
      } catch (_) {}
      // Também emite no canal genérico do editor (file-mutated) — se o humano
      // tiver esse arquivo aberto, vê o indicativo de concorrência em tempo real.
      emitFileMutated({ path: data && data.path, origin: 'openai' });
    };
    for (const toolName of ['writeFile', 'appendToFile', 'deleteFile', 'patchFile', 'runShellAdvanced']) {
      try {
        const t = require(`./services/helperTools/tools/${toolName}`);
        if (t && typeof t.setConfirmer === 'function') {
          t.setConfirmer((opts) => showConfirmActionOverlay(opts));
        }
        if (t && typeof t.setOnFileWritten === 'function') {
          t.setOnFileWritten(_writeNotifier);
        }
      } catch (e) {
        console.warn(`[main] falha ao registrar confirmer pra ${toolName}:`, e.message);
      }
    }
  } catch (e) { console.warn('Confirmer setup falhou:', e.message); }
  OpenAIService.initialize();
  await historyService.initialize();
  await createWindow();
  ipcService.start({
    toggleRecording,
    moveToDisplay,
    bringWindowToFocus,
    captureScreenAuto: captureFullScreenAuto,
    openConfig: createConfigWindow,
  });

  // Envia o status inicial do modo debug para a janela principal
  if (mainWindow && !mainWindow.isDestroyed()) {
    const initialDebugStatus = configService.getDebugModeStatus();
    mainWindow.webContents.send("debug-status-changed", initialDebugStatus);
  }
  
  // Inicializar monitoramento de clipboard se print mode estiver ativo
  const initialPrintMode = configService.getPrintModeStatus();
  if (initialPrintMode) {
    console.log('🎯 Print mode estava ativo, iniciando monitoramento de clipboard...');
    startClipboardMonitoring();
    // Capture tool monitoring só no OS integration mode, não no print mode básico
  }
  
  // Inicializar Translation Assistant se estiver ativo
  const initialTaCfg = configService.getTranslationAssistantConfig ? configService.getTranslationAssistantConfig() : null;
  if (initialTaCfg && initialTaCfg.enabled) {
    const cfg = configService.getConfig();
    if (cfg.openIaToken) {
      console.log('[TranslationAssistant] enabled in config, auto-starting...');
      setTimeout(() => {
        if (!translationAssistant.isActive()) {
          const ta = cfg.translationAssistant || {};
          translationAssistant.start({
            apiKey: cfg.openIaToken,
            userName: ta.userName || '',
            userBackground: ta.userBackground || '',
            targetLanguage: ta.targetLanguage || 'pt-br',
            micDevice: ta.micDevice || '',
          }).then(() => {
            // Mutex: se OS Integration ativo, suprime monitorings que possam ter subido
            if (configService.getOsIntegrationStatus()) {
              try { stopClipboardMonitoring(); } catch (_) {}
              try { stopCaptureToolMonitoring(); } catch (_) {}
              try { stopScreenshotFolderMonitoring(); } catch (_) {}
              console.log('[mutex] auto-start TA + OS Integration: monitorings suprimidos');
              createTranslationOverlay();
              sendToTranslationOverlay('translation-status', 'mic_open');
            }
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('translation-status', 'mic_open');
          }).catch((e) => console.error('[TranslationAssistant] auto-start falhou:', e.message));
        }
      }, 1500);
    }
  }

  // Inicializar OS integration mode se estiver ativo
  const initialOsIntegration = configService.getOsIntegrationStatus();
  console.log('🔗 Checking OS integration status:', initialOsIntegration);
  if (initialOsIntegration) {
    console.log('🔗 OS integration estava ativo, iniciando modo de integração...');
    // Delay to ensure everything is loaded
    setTimeout(() => {
      switchToOsIntegrationMode();
    }, 1000);
    
    // Ensure clipboard monitoring is started for OS integration mode.
    // NÃO forçamos print mode: respeitamos a escolha do usuário. Os watchers
    // checam getPrintModeStatus() e não enviam imagens se estiver desligado.
    if (!initialPrintMode) {
      startClipboardMonitoring();
    }
    // Start capture tool monitoring for OS integration
    startCaptureToolMonitoring();
  }

  // Verifica o status do backend ao iniciar e depois periodicamente
  checkBackendStatus();
  setInterval(checkBackendStatus, 60000); // Verifica a cada 60 segundos
});

// Ensure shortcuts are active after app is ready
app.on("browser-window-focus", () => {
  registerGlobalShortcuts();
});

app.on("window-all-closed", () => {
  console.log("All windows closed");
  clearInterval(sharingCheckInterval);
  if (recordingProcess) {
    recordingProcess.kill("SIGTERM");
  }
  stopAllRealtime();
  if (process.platform !== "darwin" && !mainWindow) {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopClipboardMonitoring();
  stopAllRealtime();
  // CLI providers: encerra processos de forma limpa.
  GeminiCliProvider.shutdown().catch(e => console.warn('[gemini-cli] shutdown error:', e.message));
  ClaudeCliProvider.shutdown().catch(e => console.warn('[claude-cli] shutdown error:', e.message));
});

