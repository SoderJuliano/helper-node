// main/ipc/window.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  BrowserWindow, ipcMain, screen, clipboard,
  _confirmActionPending
} = require('../globals.js');

module.exports = function registerIpc() {
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

ipcMain.on('frameless-drag-start', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;
  helpers.stopFramelessDrag();
  const cursor = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const [ww, wh] = win.getSize();            // trava o tamanho no início do arraste
  const offsetX = cursor.x - wx;
  const offsetY = cursor.y - wy;
  const timer = setInterval(() => {
    if (!win || win.isDestroyed()) { helpers.stopFramelessDrag(); return; }
    const c = screen.getCursorScreenPoint();
    // setBounds com largura/altura FIXAS (não setPosition): em telas com DPI
    // fracionário (125%/150%), setPosition repetido numa janela transparent
    // acumula erro de arredondamento e a janela vai CRESCENDO enquanto arrasta.
    // Reafirmar o tamanho + arredondar as coordenadas a cada frame trava isso.
    try {
      win.setBounds({ x: Math.round(c.x - offsetX), y: Math.round(c.y - offsetY), width: ww, height: wh });
    } catch (_) {}
  }, 16);
  state._framelessDrag = { win, timer };
});

ipcMain.on('frameless-drag-end', () => helpers.stopFramelessDrag());
ipcMain.on('set-ignore-mouse-events', (event, ignore, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) {
    try { win.setIgnoreMouseEvents(ignore, options); } catch (_) {}
  }
});

ipcMain.on("close-os-input", () => {
  if (state.osInputWindow && !state.osInputWindow.isDestroyed()) {
    state.osInputWindow.close();
  }
});

ipcMain.on("copy-to-clipboard", (event, text) => {
  try {
    clipboard.writeText(text || "");
    console.log(`📋 Copiado pro clipboard: ${(text || '').length} chars`);
  } catch (e) {
    console.warn("Falha ao copiar pro clipboard:", e.message);
  }
});

ipcMain.on("resize-overlay", (event, height) => {
  if (!state.osNotificationWindow || state.osNotificationWindow.isDestroyed()) return;
  try {
    const [w] = state.osNotificationWindow.getSize();
    const newH = Math.max(110, Math.min(700, parseInt(height, 10) || 110));
    state.osNotificationWindow.setSize(w, newH);
  } catch (_) {}
});

ipcMain.on("confirm-action-respond", (event, payload) => {
  if (!payload || !payload.requestId) return;
  const entry = _confirmActionPending.get(payload.requestId);
  if (!entry) return;
  console.log(`[confirm] ${payload.requestId} respondido: ok=${payload.ok}, always=${payload.always}`);
  if (payload.ok && payload.always) {
    state.globalBypassAllConfirmations = true;
    console.log(`[confirm] Bypassing all subsequent confirmations for this conversation turn.`);
  }
  entry.finalize(!!payload.ok);
});

};
