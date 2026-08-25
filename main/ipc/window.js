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
  const offsetX = cursor.x - wx;
  const offsetY = cursor.y - wy;
  let lastX = wx;
  let lastY = wy;
  let dragTicks = 0;
  const maxTicks = 60 * 5; // 5 segundos timeout de segurança
  const timer = setInterval(() => {
    dragTicks++;
    if (!win || win.isDestroyed() || dragTicks > maxTicks) {
      helpers.stopFramelessDrag();
      return;
    }
    const c = screen.getCursorScreenPoint();
    const newX = Math.round(c.x - offsetX);
    const newY = Math.round(c.y - offsetY);
    if (newX !== lastX || newY !== lastY) {
      lastX = newX;
      lastY = newY;
      try {
        win.setPosition(newX, newY);
      } catch (_) {}
    }
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

ipcMain.handle("read-clipboard-text", async () => {
  try {
    return clipboard.readText() || "";
  } catch (e) {
    return "";
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
