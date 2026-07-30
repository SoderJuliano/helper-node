const electron = require("electron");
const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  desktopCapturer,
  nativeImage,
  clipboard,
  Tray,
  Menu,
} = electron;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const util = require("util");
const fs = require("fs").promises;
const fs2 = require("fs");
const execPromise = util.promisify(exec);

const VoskStreamService = require("../services/voskStreamService.js");

const appConfig = {
  notificationsEnabled: true,
};

// requestId -> { resolve, win, timer, finalize }
// Compartilhado entre overlays.js (cria) e ipc/window.js (resolve).
const _confirmActionPending = new Map();

// Stub de Notification (modo stealth) — mantido do main.js original.
class Notification {
  constructor() {}
  show() {}
  close() {}
  on() { return this; }
  once() { return this; }
  removeAllListeners() { return this; }
  static isSupported() { return false; }
}

const BackendService = require("../services/backendService.js");
const GeminiCliProvider = require("../services/providers/gemini-cli/GeminiCliProvider");
const ClaudeCliProvider = require("../services/providers/claude-cli/ClaudeCliProvider");
const TesseractService = require("../services/tesseractService.js");
const OpenAIService = require("../services/openAIService.js");
const RealtimeAssistantService = require("../services/realtimeAssistantService.js");
const RealtimeOpenAiService = require("../services/realtimeOpenAiService.js");
const ipcService = require("../services/ipcService.js");
const configService = require("../services/configService.js");
const edition = require("../services/edition.js");
const knowledgeBase = require("../services/knowledgeBase.js");
const fileEditService = require("../services/fileEditService.js");
const historyService = require("../services/historyService.js");
const helperTools = require("../services/helperTools");
const workspace = require("../services/workspace");
const agenticWorkflow = require("../services/agenticWorkflowService");
const ollamaAgenticWorkflow = require("../services/ollamaAgenticWorkflowService");
const translationAssistant = require("../services/translationAssistant");
const visionGuide = require("../services/visionGuideService");
const platformScreenCapture = require("../services/platform/screenCapture.js");
const { runTestMode } = require("../services/translationAssistant/testMode");
const { analyzeInterviewImage } = require("../services/translationAssistant/imageAnalysis");
const { transcribeAudio: cloudTranscribeAudio } = require("../services/translationAssistant/openaiClient");

// Raiz do projeto. Os modulos vivem em main/ e main/**, mas os assets
// (index.html, preload.js, os-integration/, whisper/) seguem na raiz — entao
// todo path.join(__dirname, ...) do main.js original vira path.join(ROOT_DIR, ...).
const ROOT_DIR = path.join(__dirname, "..");

const APP_ICON = path.join(
  ROOT_DIR,
  "assets",
  process.platform === "win32" ? "windows.ico" : "linux.png"
);
const HIDE_FROM_TASKBAR = process.platform === "win32";
const IMAGE_COOLDOWN_MS = 3000;
const AUDIO_TMP_DIR = path.join(os.tmpdir(), "helper-node-audio");
const audioFilePath = path.join(AUDIO_TMP_DIR, "recording.wav");
const SCREENSHOT_DIRS = [
  path.join(os.homedir(), "Pictures", "Screenshots"),
  path.join(os.homedir(), "Imagens", "Capturas de tela"),
  path.join(os.homedir(), "Pictures"),
  path.join(os.homedir(), "Imagens"),
  path.join(os.homedir(), "Desktop"),
  path.join(os.homedir(), "Área de Trabalho"),
];
// Sets (nao arrays): o codigo chama .has() nesses dois.
const PROJECT_SEARCH_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode', '.claude', '.gemini',
  'vendor', 'bin', 'obj', '.next', '.nuxt', '.cache', '__pycache__', 'venv', '.venv', 'env',
  'coverage', '.output', 'out', 'temp', 'tmp', 'logs', '.bundle'
]);
const TREE_HEAVY_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode', '.claude', '.gemini',
  'vendor', 'bin', 'obj', '.next', '.nuxt', '.cache', '__pycache__', 'venv', '.venv', 'env',
  'coverage', '.output', 'out', 'temp', 'tmp', 'logs', '.bundle'
]);
const OS_LIVE_CONTINUATION_WINDOW_MS = 1200;
const OS_LIVE_SAMPLE_RATE = 16000;
const OS_LIVE_SILENCE_RMS = 0.015;
const OS_LIVE_SILENCE_MS = 1200;
const OS_LIVE_MAX_MS = 15000;
const OS_LIVE_TMP_DIR = path.join(os.tmpdir(), "helper-node-vosk");

const state = {
  terminalProcess: null,
  terminalPty: null,
  currentTerminalProjectPath: null,
  backendIsOnline: false,
  configWindow: null,
  preferencesWindow: null,
  shortcutsRegistered: false,
  currentDisplayId: null,
  sharingActive: false,
  recordingProcess: null,
  isRecording: false,
  waitingNotificationInterval: null,
  clipboardMonitoringInterval: null,
  clipboardWatchProc: null,
  lastClipboardImageHash: null,
  lastProcessedImageHash: null,
  lastProcessedTimestamp: 0,
  isProcessingImage: false,
  recordingBusy: false,
  screenshotFolderWatcher: null,
  screenshotFolderWatcherPath: null,
  osInputWindow: null,
  osNotificationWindow: null,
  osNotifAutoCloseTimer: null,
  osImageResponseWindow: null,
  osCaptureWindow: null,
  isOsIntegrationMode: false,
  captureToolInterval: null,
  osVoskSilenceTimer: null,
  osLiveSegment: null,
  osLiveSilenceInterval: null,
  osLiveTurnCount: 0,
  osLiveLastClosed: null,
  translationOverlayWindow: null,
  visionGuideOverlayWindow: null,
  visionGuideMinimized: false,
  currentEditorState: null,
  dictationActive: false,
  dictationPcmChunks: [],
  dictationPcmBytes: 0,
  dictationProcessing: false,
  winDictationActive: false,
  winDictationChunks: [],
  winDictationBytes: 0,
  winDictationMicCb: null,
  _framelessDrag: null,
  regionSelectWindow: null,
  regionCaptureBuffer: null,
  mainWindow: null,
  sharingCheckInterval: null,
  globalBypassAllConfirmations: false
};

const helpers = {};

const REALTIME_COPILOT_INSTRUCTION = [
  "Você é um COPILOTO DISCRETO em tempo real durante entrevistas, reuniões e ligações.",
  "Recebe uma TRANSCRIÇÃO do que está sendo falado. Dê ao usuário o que ele precisa pra responder COM AS PRÓPRIAS PALAVRAS.",
  "LINGUAGEM: português falado BR, simples e natural (padrão SP/SC). PROIBIDO formalês e clichê de RH ('soluções escaláveis', 'agregar valor', 'sinergia').",
  "Pergunta aberta/comportamental ('me fala os desafios') → NÃO dê resposta pronta; dê 3-5 bullets curtos com os PONTOS-CHAVE em **negrito** pro usuário montar a fala.",
  "Pergunta técnica de profundidade ('como você implementa X') → resposta completa, termos-chave em **negrito**, exemplo de código só aqui se ajudar.",
  "Pergunta objetiva → curto e direto. Conversa casual/ruído/sem pergunta → responda só '(trecho sem conteúdo relevante)'.",
  "SEMPRE destaque os termos/tecnologias-chave em **negrito**. Sem preâmbulo, não repita a pergunta.",
].join("\n");

// Notifica o renderer que a gravacao caiu sozinha (erro fatal do servico).
function onRealtimeFatalStop() {
  state.isRecording = false;
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("toggle-recording", {
      isRecording: state.isRecording,
      audioFilePath,
    });
  }
}

// aiResponder e resolvido preguicosamente: helpers.* so e populado depois
// que os modulos que consomem este arquivo terminam de carregar.
const realtimeAssistantService = new RealtimeAssistantService({
  configService,
  getMainWindow: () => state.mainWindow,
  historyService,
  aiResponder: (transcript) => helpers.realtimeProviderResponder(transcript),
  onFatalStop: onRealtimeFatalStop,
});

// Realtime ONLINE (100% OpenAI): transcrição + resposta na OpenAI, sem Vosk/Whisper.
// Usado quando o provider selecionado é ChatGPT (openIa) ou na edição Lite.
const realtimeOpenAiService = new RealtimeOpenAiService({
  configService,
  getMainWindow: () => state.mainWindow,
  historyService,
  onFatalStop: onRealtimeFatalStop,
});

module.exports = {
  electron,
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  desktopCapturer,
  nativeImage,
  clipboard,
  Tray,
  Menu,
  execPromise,
  appConfig,
  _confirmActionPending,
  Notification,
  VoskStreamService,
  path,
  os,
  crypto,
  exec,
  spawn,
  util,
  fs,
  fs2,
  
  BackendService,
  GeminiCliProvider,
  ClaudeCliProvider,
  TesseractService,
  OpenAIService,
  RealtimeAssistantService,
  RealtimeOpenAiService,
  ipcService,
  configService,
  edition,
  knowledgeBase,
  fileEditService,
  historyService,
  helperTools,
  workspace,
  agenticWorkflow,
  ollamaAgenticWorkflow,
  translationAssistant,
  visionGuide,
  platformScreenCapture,
  runTestMode,
  analyzeInterviewImage,
  cloudTranscribeAudio,

  ROOT_DIR,
  APP_ICON,
  HIDE_FROM_TASKBAR,
  IMAGE_COOLDOWN_MS,
  AUDIO_TMP_DIR,
  audioFilePath,
  SCREENSHOT_DIRS,
  PROJECT_SEARCH_SKIP_DIRS,
  TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS,
  OS_LIVE_SAMPLE_RATE,
  OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS,
  OS_LIVE_MAX_MS,
  OS_LIVE_TMP_DIR,
  REALTIME_COPILOT_INSTRUCTION,

  realtimeAssistantService,
  realtimeOpenAiService,

  state,
  helpers
};
