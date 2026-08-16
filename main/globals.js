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
const CopilotCliProvider = require("../services/providers/copilot-cli/CopilotCliProvider");
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
const googleTtsService = require("../services/googleTtsService.js");
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
const state = {
  terminalProcess: null,
  terminalPty: null,
  // Último cols/rows informado pelo xterm. Guardado pra descartar os resizes
  // repetidos que o ResizeObserver dispara sem o tamanho ter mudado.
  terminalSize: null,
  currentTerminalProjectPath: null,
  backendIsOnline: false,
  configWindow: null,
  preferencesWindow: null,
  shortcutsRegistered: false,
  currentDisplayId: null,
  sharingActive: false,
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
  osCaptureWindow: null,
  isOsIntegrationMode: false,
  captureToolInterval: null,
  translationOverlayWindow: null,
  visionGuideOverlayWindow: null,
  visionGuideMinimized: false,
  realtimeOverlayWindow: null,
  realtimeOverlayMinimized: false,
  currentEditorState: null,
  dictationActive: false,
  dictationChunks: [],
  dictationBytes: 0,
  dictationMicCb: null,
  _framelessDrag: null,
  regionSelectWindow: null,
  regionCaptureBuffer: null,
  mainWindow: null,
  nexaWindow: null,
  sharingCheckInterval: null,
  globalBypassAllConfirmations: false
};

const helpers = {};

const REALTIME_COPILOT_INSTRUCTION = [
  "Você é um COPILOTO TÉCNICO ULTRA-CONCISO em tempo real durante entrevistas e reuniões.",
  "Você recebe a TRANSCRIÇÃO do áudio capturado. Respostas ULTRA-CURTAS para bater o olho na janela pequena.",
  "1. CONCEITO TÉCNICO (ex: 'o que é DDD'): apenas 1 a 2 LINHAS com o termo em **negrito** e definição direta.",
  "2. PERGUNTA DE FOLLOW-UP (ex: 'quando usar ele?'): use o tópico recente e responda em no máximo 2 a 3 bullets CURTÍSSIMOS (1 linha cada) com pontos-chave em **negrito**.",
  "3. PERGUNTA OBJETIVA: apenas 1 linha direta com termo em **negrito**.",
  "4. RUÍDO / CASUAL SEM PERGUNTA: apenas '(trecho sem conteúdo relevante)'.",
  "5. PROIBIDO: redações, textos longos, preâmbulos ('Certamente...') e repetição de perguntas/respostas anteriores."
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
  aiResponder: (transcript, image, onDelta, context) => helpers.realtimeProviderResponder(transcript, image, onDelta, context),
  onFatalStop: onRealtimeFatalStop,
});

// Realtime ONLINE (100% OpenAI): transcrição + resposta na OpenAI, sem Whisper local.
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
  CopilotCliProvider,
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
  googleTtsService,
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
  REALTIME_COPILOT_INSTRUCTION,

  realtimeAssistantService,
  realtimeOpenAiService,

  state,
  helpers
};
