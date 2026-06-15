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
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const fs = require("fs").promises;
const fs2 = require("fs");
// const LlamaService = require('./services/llamaService.js');
// GeminiService removido em 0.2.4: dependia do binario `gemini` CLI que nao\n// existe no sistema. Backend Ollama + OpenAI cobrem todos os casos.
const BackendService = require("./services/backendService.js");
const TesseractService = require("./services/tesseractService.js");
const OpenAIService = require("./services/openAIService.js");
const RealtimeAssistantService = require("./services/realtimeAssistantService.js");
const RealtimeOpenAiService = require("./services/realtimeOpenAiService.js");
const ipcService = require("./services/ipcService.js");
const configService = require("./services/configService.js");
const edition = require("./services/edition.js");
const historyService = require("./services/historyService.js");
const helperTools = require("./services/helperTools");
const workspace = require("./services/workspace");
const agenticWorkflow = require("./services/agenticWorkflowService");
const ollamaAgenticWorkflow = require("./services/ollamaAgenticWorkflowService");
const translationAssistant = require("./services/translationAssistant");
const { runTestMode } = require("./services/translationAssistant/testMode");
const { analyzeInterviewImage } = require("./services/translationAssistant/imageAnalysis");
// Transcrição cloud (gpt-4o-mini-transcribe) — usada no Ctrl+D da edição Lite.
const { transcribeAudio: cloudTranscribeAudio } = require("./services/translationAssistant/openaiClient");

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
      if (/gpt-5\.[45]/.test(s)) return 5;
      if (/gpt-5(\.\d)?($|[^.\d])/.test(s) && !/(mini|nano)/.test(s)) return 4;
      if (/gpt-4\.1($|[^-])/.test(s) && !/(mini|nano)/.test(s)) return 3;
      if (/gpt-4o($|[^-])/.test(s) && !/mini/.test(s)) return 3;
      if (/mini/.test(s)) return 2;
      if (/nano/.test(s)) return 1;
      return 2; // desconhecido — assume médio
    };
    let model = baseModel;
    const forceHeavy = helperTools.shouldForceHeavyModel
      ? helperTools.shouldForceHeavyModel(userText || "")
      : false;
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
                  .update(String(a.patch || a.diff || ''))
                  .digest('hex').slice(0, 16);
                return `${name}:${h}`;
              }
              if (name === 'deleteFile') {
                return `${name}:${String(a.path || '')}`;
              }
            } catch (_) {}
            return null;
          };
          return async (name, args /*, meta */) => {
            const key = hashKey(name, args);
            if (key && seen.has(key)) {
              console.log(`🚫 anti-dup: ${name} já executado neste turno (key=${key}); retornando resultado anterior sem reexecutar.`);
              const prev = seen.get(key);
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
    const ctx = await workspace.buildContextIfNeeded(modelKey || "", { userText: text });
    if (!ctx) {
      console.log(`[workspace] SKIP: contexto ja injetado nesta sessao (anexos=${attCount}). Use 'Novo Chat' pra reinjetar.`);
      return text;
    }
    workspace.markContextSent();
    console.log(`[workspace] ✅ contexto injetado (${ctx.length} chars, ${attCount} anexos, model=${modelKey})`);
    return ctx + "\n\n---\n\n" + (text || "");
  } catch (e) {
    console.warn("[workspace] prependContext falhou:", e.message);
    return text;
  }
}

// Improve global shortcut reliability on Linux Wayland compositors
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}

// Function to calculate image hash for duplicate detection
function calculateImageHash(imageBuffer) {
  return crypto.createHash('md5').update(imageBuffer).digest('hex');
}

// --- SINGLE INSTANCE LOCK ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    // Focus existing window if a second instance is started
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let backendIsOnline = false;
let configWindow = null;
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
const OS_LIVE_SAMPLE_RATE = 16000;
const OS_LIVE_SILENCE_RMS = 250;
// Silêncio antes de fechar segmento. 3s era muito agressivo: cortava
// perguntas longas em 2-3 partes nas pausas naturais de leitura/respiração.
// 6s dá conforto para fala humana sem perder responsividade.
const OS_LIVE_SILENCE_MS = 6000;
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
}

const VoskStreamService = require("./services/voskStreamService.js");

// Responder do realtime OFFLINE (Vosk live + correção Whisper). A transcrição é
// local, mas a RESPOSTA vai pro provider SELECIONADO (backend/Ollama) — nunca
// OpenAI. Respeita "sem fallback automático entre providers". Só é usado na Full
// com backend (llama/llama-stream) ou ollamaLocal selecionado.
async function realtimeProviderResponder(transcript) {
  const aiModel = configService.getAiModel();
  if (aiModel === "ollamaLocal") {
    const OllamaLocalService = require("./services/ollamaLocalService");
    return await OllamaLocalService.responder(transcript);
  }
  // backend remoto (llama / llama-stream)
  return await BackendService.responder(transcript, {
    sessionId: "realtime-assistant",
    instruction: REALTIME_COPILOT_INSTRUCTION,
  });
}

const REALTIME_COPILOT_INSTRUCTION = [
  "Você é um COPILOTO DISCRETO em tempo real durante reuniões, ligações, entrevistas e estudos.",
  "Recebe uma TRANSCRIÇÃO do que está sendo falado. AJUDE o usuário a responder, entender ou agir — não resuma.",
  "Pergunta técnica → responda direto (cálculo/código/definição). Pergunta feita ao usuário → 'Sugestão:' com resposta pronta, específica e completa. Termo obscuro → defina em 1 linha. Conversa casual/ruído → responda só '(trecho sem conteúdo relevante)'.",
  "Seja direto, sem preâmbulos ('a fala menciona...'). Não repita o que foi dito. Entregue o valor.",
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
translationAssistant.onResult(({ transcript, response, mode }) => {
  try {
    const cfg = configService.getConfig();
    if (cfg.osIntegration) {
      // Garante que o overlay existe (recria se foi fechado)
      if (!translationOverlayWindow || translationOverlayWindow.isDestroyed()) {
        createTranslationOverlay();
      }
      sendToTranslationOverlay('translation-status', 'processing');
      sendToTranslationOverlay('translation-result', { transcript, response, mode: mode || 'interviewer' });
      sendToTranslationOverlay('translation-status', 'mic_open');
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('translation-status', 'processing');
      mainWindow.webContents.send('translation-result', { transcript, response });
      mainWindow.webContents.send('translation-status', 'mic_open');
    }
  } catch (e) {
    console.error('[TranslationAssistant] erro ao entregar resultado:', e.message);
  }
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

  translationOverlayWindow.on('closed', () => {
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

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 500,
    height: 420,
    title: "Configurações",
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    skipTaskbar: false,
    icon: path.join(__dirname, "assets", "linux.png"),
  });

  configWindow.loadFile("config.html");

  configWindow.on("closed", () => {
    configWindow = null;
  });
}

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

// Helper function to completely destroy the notification window
function destroyNotificationWindow() {
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
    windowWidth = 440;
    windowHeight = 520;
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
  // Start capture tool monitoring when entering OS integration mode
  startCaptureToolMonitoring();
  // Monitora pasta de screenshots do COSMIC (captura via PrintScreen nativo)
  startScreenshotFolderMonitoring();
  // Hide main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
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
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#222222",
        symbolColor: "#ffffff",
      },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
      focusable: true,
      alwaysOnTop: false,
      show: false,
      skipTaskbar: true,
      icon: path.join(__dirname, "assets", "linux.png"),
      titleBarStyle: "hidden",
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

  // O caminho online compartilha o vadEngine com o Assistente de Tradução —
  // garante exclusividade parando a tradução antes de iniciar.
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

async function toggleRecording() {
  try {
    // Realtime existe em todas as edições: na Lite/ChatGPT é 100% online (OpenAI),
    // na Full com backend/Ollama é o pipeline local (Vosk+Whisper). pickRealtimeService decide.
    const isRealtimeAssistantEnabled = configService.getRealtimeAssistantStatus();
    if (isRealtimeAssistantEnabled) {
      await toggleRealtimeAssistantRecording();
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

      if (isOsIntegration && VoskStreamService.isRunning()) {
        // OS Integration + Vosk (modo conversa contínua):
        // Ctrl+D segundo toque = encerra. NAO bloqueia esperando IA: para
        // Vosk já (sem entrada nova) e fecha o segmento pendente em
        // background — senão o usuário fica achando que travou.
        const pending = osLiveSegment;
        // Para captura ANTES de mexer em segmento, pra não nascer novo
        VoskStreamService.stop();
        isRecording = false;
        clearOsVoskSilenceTimer();
        console.log("OS Integration: conversa contínua encerrada");
        if (pending && pending.hasSpeech && !pending.closing) {
          // Reanexa pra closeOsLiveSegment achar
          osLiveSegment = pending;
          console.log('[os-live] stop manual — fechando segmento pendente em background');
          closeOsLiveSegment().catch(e => console.error('[os-live] flush on stop:', e.message));
        }
        return;
      }

      if (recordingProcess) {
        recordingProcess.kill("SIGTERM");
        recordingProcess = null;
      }
      isRecording = false;
      console.log("Recording stopped");
      // A partir daqui processamos o áudio — trava o Ctrl+D até mostrar a resposta.
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

        // Converter áudio para formato compatível com Whisper.
        // pw-record gera WAV com header valido no sample rate/format do device
        // (geralmente 48kHz, s32le). Whisper exige 16kHz mono s16, entao convertemos aqui.
        const convertedAudioPath = path.join(AUDIO_TMP_DIR, "output_converted.wav");
        await execPromise(`ffmpeg -i ${audioFilePath} -ar 16000 -ac 1 -sample_fmt s16 -y ${convertedAudioPath}`);

        // Lite (100% online): transcreve via OpenAI cloud. Full: whisper-cli local.
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
        if (isOsIntegration) {
          await processOsQuestion(audioText);
        } else if (aiModel === 'llama-stream') {
          mainWindow.webContents.send("send-to-gemini-stream-auto", audioText);
        } else {
          getIaResponse(audioText);
        }
      } catch (error) {
        isRecording = false;
        console.error("Audio processing failed:", error);
        try { await fs.unlink(audioFilePath).catch(() => {}); } catch (_) {}
        try { await fs.unlink(path.join(AUDIO_TMP_DIR, "output_converted.wav")).catch(() => {}); } catch (_) {}
      } finally {
        // Libera o Ctrl+D — áudio processado (com sucesso ou erro).
        recordingBusy = false;
      }
    } else {
      // === START RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();

      // Mutex: em modo integrado, se o Translation Assistant está ativo ele já
      // escuta mic+sys e responde sozinho — não sobe gravação em paralelo.
      if (isOsIntegration && translationAssistant.isActive()) {
        console.log("OS Integration: Translation Assistant ativo — Ctrl+D ignorado (mutex).");
        return;
      }

      // Ctrl+D = gravação CURTA transcrita por Whisper — tanto no modo janela
      // quanto no integrado com SO. O Vosk "conversa contínua" NÃO pertence ao
      // Ctrl+D: isso é o Assistente em Tempo Real, um modo separado.
      // pw-record grava WAV com header válido (sample rate/format do device).
      // Evita o problema do parec --raw que precisava de header forçado no ffmpeg
      // e silenciosamente perdia áudio na conversão 48kHz s32le -> 16kHz s16le.
      await fs.unlink(audioFilePath).catch(() => {});
      const command = `pw-record "${audioFilePath}"`;
      console.log("Executing:", command);
      recordingProcess = exec(command, (error) => {
        if (error && error.signal !== "SIGTERM" && error.code !== 0) {
          console.error("Recording error:", error);
        }
      });
      isRecording = true;
      console.log("Recording started");

      if (isOsIntegration) {
        // Feedback de GRAVANDO: mesma overlay transparente/sem moldura do robot.gif
        // (loading), porém com as bolinhas de "ouvindo". Assim o usuário sabe que
        // está gravando, e o robot.gif só aparece depois (processando). Mesma posição.
        destroyNotificationWindow();
        createOsNotificationWindow('recording', '');
      } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
        new Notification({ title: "Helper-Node", body: "Gravando...", silent: true }).show();
      }
      mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
    mainWindow.webContents.send(
      "transcription-error",
      "Failed to toggle recording"
    );
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
        const _wsText1 = await prependWorkspaceContextIfNeeded(text, openAiModel);

        // Decide se usa o Agentic Workflow (multi-fases) ou single-shot.
        // Requisitos: OpenAI + Advanced Tools ON + Workspace Access ON + Intent de escrita/complexa.
        const useAgentic = configService.getHelperToolsEnabled() && 
                          configService.getWorkspaceAccessEnabled() && 
                          helperTools.shouldForceHeavyModel(text);

        if (useAgentic) {
            console.log('🤖 Iniciando AGENTIC WORKFLOW (multi-fase)...');
            // Limpa qualquer sessão anterior pra evitar contaminação de contexto (ex: Pikachu vs Helper-Node)
            if (OpenAIService.sessions) OpenAIService.sessions = {};
            
            try {
              resposta = await agenticWorkflow.run(
                  _wsText1, 
                  { token, model: openAiModel, baseInstruction: instruction },
                  mainWindow.webContents
              );
            } catch (err) {
              resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
            }
        } else {
            const ht = buildHelperToolsOpenAIOpts(_wsText1, instruction, openAiModel);
            resposta = await OpenAIService.makeOpenAIRequest(
              _wsText1,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              null,
              ht.opts
            );
        }
    } else if (aiModel === 'ollamaLocal') {
        // Ollama rodando no PC do user. SEM helperTools/workspaceAccess (mutex
        // em configService). Erros de Ollama-down / modelo-ausente vem como
        // texto markdown amigavel direto pra UI.
        const OllamaLocalService = require('./services/ollamaLocalService');
        resposta = await OllamaLocalService.responder(text);
    } else {
        // Ollama/Backend e' o unico provider nao-OpenAI suportado.
        // Helper tools agora funcionam tambem no Ollama (via structured prompt + parser).
        try {
          const instructionO = configService.getPromptInstruction();
          const _wsTxtO = await prependWorkspaceContextIfNeeded(text, 'ollama');

          const useAgentic = configService.getHelperToolsEnabled() && 
                            configService.getWorkspaceAccessEnabled() && 
                            helperTools.shouldForceHeavyModel(_wsTxtO);

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
              const _htO = buildHelperToolsOpenAIOpts(_wsTxtO, instructionO, configService.getOpenAiModel());
              resposta = await BackendService.responder(_wsTxtO, _htO.opts);
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
    mainWindow.webContents.send("gemini-response", { resposta: formattedResposta });

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

ipcMain.on("send-to-gemini", async (event, text) => {
  try {
    const aiModel = getEffectiveAiModel();
    let resposta;

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
        const _wsText2 = await prependWorkspaceContextIfNeeded(text, openAiModel);

        const useAgentic = configService.getHelperToolsEnabled() && 
                          configService.getWorkspaceAccessEnabled() && 
                          helperTools.shouldForceHeavyModel(text);

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
            }
        } else {
            const ht = buildHelperToolsOpenAIOpts(_wsText2, instruction, openAiModel);
            resposta = await OpenAIService.makeOpenAIRequest(
              _wsText2,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              null,
              ht.opts
            );
        }
        event.sender.send("openai-final-response", { resposta });
        return; 
    } else {
        // Ollama/Backend e' o unico provider nao-OpenAI suportado.
        try {
          const instructionO2 = configService.getPromptInstruction();
          const _wsTxtO2 = await prependWorkspaceContextIfNeeded(text, 'ollama');

          const useAgentic = configService.getHelperToolsEnabled() && 
                            configService.getWorkspaceAccessEnabled() && 
                            helperTools.shouldForceHeavyModel(_wsTxtO2);

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
              const _htO2 = buildHelperToolsOpenAIOpts(_wsTxtO2, instructionO2, configService.getOpenAiModel());
              resposta = await BackendService.responder(_wsTxtO2, _htO2.opts);
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
    event.sender.send("gemini-response", { resposta });
  } catch (error) {
    console.error("IPC: IA service error:", error);
    event.sender.send(
      "transcription-error",
      "Failed to process IA response from any source"
    );
  }
});

ipcMain.on("stop-agentic-workflow", (event, sessionId) => {
  agenticWorkflow.stop(sessionId);
  if (typeof ollamaAgenticWorkflow !== 'undefined') {
    ollamaAgenticWorkflow.stop(sessionId);
  }
});

ipcMain.on("clear-ai-sessions", () => {
  console.log("🧹 Limpando sessões de IA (OpenAI + Backend)...");
  if (OpenAIService.sessions) OpenAIService.sessions = {};
  BackendService.clearSessions();
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
  for (const p of res.filePaths) {
    try { await workspace.addPath(p, "dir"); added.push(p); }
    catch (e) { console.warn("[workspace] add dir falhou:", e.message); }
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return { ok: true, added, attachments: workspace.list() };
});

ipcMain.handle("workspace:list", () => workspace.list());

ipcMain.handle("workspace:remove", (event, id) => {
  workspace.removePath(id);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return workspace.list();
});

ipcMain.handle("workspace:clear", () => {
  workspace.clear();
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
ipcMain.handle("get-translation-assistant-config", () => {
  return configService.getTranslationAssistantConfig();
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

function positionTranslationOverlay(position) {
  if (!translationOverlayWindow || translationOverlayWindow.isDestroyed()) return;

  const currentBounds = translationOverlayWindow.getBounds();
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
  const [winW, winH] = translationOverlayWindow.getSize();

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
  try { translationOverlayWindow.setBounds({ x: newX, y: newY, width: winW, height: winH }, true); } catch (_) {}
}

ipcMain.on('overlay-position', (_event, position) => {
  positionTranslationOverlay(position);
});

// Pedido de expansão de largura (+200px até 40% da tela) — chamado depois de
// renderizar cada nova mensagem.
ipcMain.on("request-translation-resize", () => {
  expandTranslationOverlayIfNeeded();
});

// IPC Handlers for AI Model
ipcMain.handle("get-ai-model", () => {
  return configService.getAiModel();
});

ipcMain.handle("get-edition", () => {
  return edition.getEdition();
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
    // Process the question using existing getIaResponse logic but with OS notifications
    await processOsQuestion(text, image);
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

function showConfirmActionOverlay(opts) {
  return new Promise((resolve) => {
    const requestId = `cfm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const payload = { ...opts, requestId };
    const json = Buffer.from(JSON.stringify(payload)).toString('base64');

    const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
    const w = 420, h = 200;
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
  console.log(`[confirm] ${payload.requestId} respondido: ${payload.ok}`);
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
        createOsNotificationWindow('response',
          '<b>cosmic-screenshot</b> não está instalado.<br>' +
          'É necessário para captura silenciosa no COSMIC.<br><br>' +
          'Instale com:<br><code>sudo apt install cosmic-screenshot</code>');
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
      createOsNotificationWindow('response',
        `Não foi possível capturar a tela silenciosamente.<br>${hint}`);
      return;
    }

    // Mostra loading discreto
    createOsNotificationWindow('loading', 'Analisando captura...');

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
        createOsNotificationWindow('response', '❌ API key não configurada. Configure em Ajustes.');
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
        createOsNotificationWindow('response', `❌ Erro ao analisar imagem: ${err.message}`);
      }
      return;
    }

    // Delega TODO o trabalho (OCR + roteamento texto/visão + IA) para
    // processOsQuestion. NÃO montamos prompt aqui — evita duplicação de OCR.
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      await processOsQuestion('', base64, { forceVision: true });
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      // Modo janela: roda OCR só pra exibir
      let ocrText = '';
      try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
      mainWindow.webContents.send('ocr-result', {
        text: ocrText,
        image: `data:image/png;base64,${base64}`,
      });
    }
  } catch (e) {
    console.error('captureFullScreenAuto failed:', e);
    createOsNotificationWindow('response', 'Erro ao capturar a tela.');
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
    createOsNotificationWindow('response', 'Não foi possível acessar a captura de tela.');
    return;
  }
  if (!sources || sources.length === 0) {
    createOsNotificationWindow('response', 'Nenhuma fonte de tela disponível.');
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

    // Mostra loading discreto
    createOsNotificationWindow('loading', 'Analisando captura...');

    // Delega tudo a processOsQuestion (faz OCR + roteamento internamente)
    try {
      const isOsIntegration = configService.getOsIntegrationStatus();
      if (isOsIntegration) {
        await processOsQuestion('', base64, { forceVision: true });
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        let ocrText = '';
        try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
        mainWindow.webContents.send('ocr-result', { text: ocrText, image: `data:image/png;base64,${base64}` });
      }
    } catch (e) {
      console.error('Erro OCR/IA na captura nativa:', e);
      createOsNotificationWindow('response', 'Erro ao processar a captura.');
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

  // Marca bolha como "processando"
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    osNotificationWindow.webContents.executeJavaScript(
      `window.markTurnFinal && window.markTurnFinal(${JSON.stringify(seg.id)}, ${JSON.stringify(seg.voskText)})`
    ).catch(() => {});
  }

  // 1) Pergunta IA com texto Vosk (rapido)
  try {
    const resp = await _askOsLiveAI(seg.voskText, null);
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
      const instruction = configService.getPromptInstruction();
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

      const useAgentic = !sendImage && 
                        configService.getHelperToolsEnabled() && 
                        configService.getWorkspaceAccessEnabled() && 
                        helperTools.shouldForceHeavyModel(_wsText3);

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
    } else {
      // Backends sem visão (Ollama): só TEXTO. Mas com tool calling agora.
      try {
        const instructionO3 = configService.getPromptInstruction();
        const _wsTxtO3 = await prependWorkspaceContextIfNeeded(text, 'ollama');

        const useAgentic = configService.getHelperToolsEnabled() && 
                          configService.getWorkspaceAccessEnabled() && 
                          helperTools.shouldForceHeavyModel(text || _wsTxtO3);

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
});

