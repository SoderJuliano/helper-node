// main/overlays.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  ROOT_DIR, APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  BrowserWindow, screen,
  _confirmActionPending
} = require('./globals.js');

helpers.createTranslationOverlay = function() {
  if (state.translationOverlayWindow && !state.translationOverlayWindow.isDestroyed()) {
    // Já existe — só reposiciona, caso o compositor tenha movido.
    helpers.forceTranslationOverlayPosition('recreate-reposition');
    return state.translationOverlayWindow;
  }

  const b = helpers.computeTranslationOverlayBounds();
  console.log(`[translation-overlay] criando: x=${b.x} y=${b.y} w=${b.width} h=${b.height} display=${b.displayId}`);

  state.translationOverlayWindow = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    backgroundColor: '#00000000',
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
      preload: path.join(ROOT_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  state.translationOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  state.translationOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  // Stealth (não aparece em gravação/compartilhamento de tela)
  helpers.applyStealthProtection(state.translationOverlayWindow);

  state.translationOverlayWindow.loadFile(
    path.join(ROOT_DIR, 'os-integration', 'notifications', 'translation-overlay.html')
  );

  // Reforça posição em múltiplos hooks — COSMIC/Wayland costuma reposicionar
  // janelas frame:false+transparent:true para o centro da tela.
  helpers.forceTranslationOverlayPosition('post-create');

  state.translationOverlayWindow.once('ready-to-show', () => {
    helpers.forceTranslationOverlayPosition('ready-to-show');
    try { state.translationOverlayWindow.show(); } catch (_) {}
    helpers.forceTranslationOverlayPosition('post-show');
    // NÃO usamos setIgnoreMouseEvents — em Linux/Wayland o `forward: true`
    // não funciona, então mouseenter no header nunca chega ao JS e o drag
    // quebra. focusable=false já garante que a janela não rouba foco.
  });

  state.translationOverlayWindow.webContents.on('did-finish-load', () => {
    helpers.forceTranslationOverlayPosition('did-finish-load');
    // Click-through inicial — JS no overlay religa via IPC ao hover no header.
    // SÓ em macOS/Windows: lá `forward: true` entrega mouseenter/leave ao DOM.
    // Em Linux pulamos: senão mousedown do drag manual também não chega.
    // focusable=false já garante que a janela não rouba foco do teclado.
    if (process.platform !== 'linux') {
      try { state.translationOverlayWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
    }
  });

  // Reposicionamento tardio: alguns compositors movem a janela 500ms após
  // o mapping. Aplica setBounds uma vez depois desse delay.
  setTimeout(() => helpers.forceTranslationOverlayPosition('delayed-500ms'), 500);

  // Mantém "sempre na frente" mesmo se o compositor rebaixar a janela ao trocar
  // de área de trabalho ou abrir outra janela. Barato: só reafirma o topo.
  const keepOnTop = setInterval(() => {
    if (!state.translationOverlayWindow || state.translationOverlayWindow.isDestroyed()) {
      clearInterval(keepOnTop);
      return;
    }
    try {
      if (!state.translationOverlayWindow.isAlwaysOnTop()) {
        state.translationOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      state.translationOverlayWindow.moveTop();
    } catch (_) {}
  }, 2000);

  state.translationOverlayWindow.on('closed', () => {
    clearInterval(keepOnTop);
    state.translationOverlayWindow = null;
  });

  return state.translationOverlayWindow;
}

helpers.destroyTranslationOverlay = function() {
  if (state.translationOverlayWindow && !state.translationOverlayWindow.isDestroyed()) {
    try { state.translationOverlayWindow.close(); } catch (_) {}
  }
  state.translationOverlayWindow = null;
}

helpers.sendToTranslationOverlay = function(channel, payload) {
  if (state.translationOverlayWindow && !state.translationOverlayWindow.isDestroyed()) {
    try { state.translationOverlayWindow.webContents.send(channel, payload); } catch (_) {}
  }
}

helpers.createVisionGuideOverlay = function() {
  if (state.visionGuideOverlayWindow && !state.visionGuideOverlayWindow.isDestroyed()) {
    return state.visionGuideOverlayWindow;
  }
  const b = helpers.computeVisionGuideOverlayBounds();
  console.log(`[vision-guide-overlay] criando: x=${b.x} y=${b.y} w=${b.width} h=${b.height}`);

  state.visionGuideOverlayWindow = new BrowserWindow({
    width: b.width, height: b.height, x: b.x, y: b.y,
    backgroundColor: '#00000000',
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
      preload: path.join(ROOT_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  state.visionGuideOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  state.visionGuideOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  helpers.applyStealthProtection(state.visionGuideOverlayWindow);

  state.visionGuideOverlayWindow.loadFile(
    path.join(ROOT_DIR, 'os-integration', 'notifications', 'vision-guide-overlay.html')
  );

  state.visionGuideOverlayWindow.once('ready-to-show', () => {
    try { state.visionGuideOverlayWindow.setBounds(helpers.computeVisionGuideOverlayBounds()); } catch (_) {}
    try { state.visionGuideOverlayWindow.show(); } catch (_) {}
  });

  state.visionGuideOverlayWindow.webContents.on('did-finish-load', () => {
    if (process.platform !== 'linux') {
      try { state.visionGuideOverlayWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
    }
  });

  const keepOnTop = setInterval(() => {
    if (!state.visionGuideOverlayWindow || state.visionGuideOverlayWindow.isDestroyed()) {
      clearInterval(keepOnTop);
      return;
    }
    // Enquanto minimizado (botão "-"), não força topo/reexibição.
    if (state.visionGuideMinimized) return;
    try {
      if (!state.visionGuideOverlayWindow.isAlwaysOnTop()) {
        state.visionGuideOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      state.visionGuideOverlayWindow.moveTop();
    } catch (_) {}
  }, 2000);

  state.visionGuideOverlayWindow.on('closed', () => {
    clearInterval(keepOnTop);
    state.visionGuideOverlayWindow = null;
  });

  return state.visionGuideOverlayWindow;
}

helpers.destroyVisionGuideOverlay = function() {
  if (state.visionGuideOverlayWindow && !state.visionGuideOverlayWindow.isDestroyed()) {
    try { state.visionGuideOverlayWindow.close(); } catch (_) {}
  }
  state.visionGuideOverlayWindow = null;
}

helpers.sendToVisionGuideOverlay = function(channel, payload) {
  if (state.visionGuideOverlayWindow && !state.visionGuideOverlayWindow.isDestroyed()) {
    try { state.visionGuideOverlayWindow.webContents.send(channel, payload); } catch (_) {}
  }
}

helpers.destroyNotificationWindow = function() {
  helpers.clearOsNotifAutoClose();
  if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    console.log(`🔔 DESTROYING notification window completely`);
    try {
      state.osNotificationWindow.removeAllListeners(); // Remove all event listeners
      state.osNotificationWindow.destroy(); // Use destroy instead of close for immediate effect
      console.log(`🔔 Notification window destroyed successfully`);
    } catch (e) {
      console.log(`🔔 Error destroying notification:`, e);
    }
    state.osNotificationWindow = null;
  }
}

helpers.createCaptureWindow = function() {
  if (state.osCaptureWindow && !state.osCaptureWindow.isDestroyed()) {
    return; // Already exists
  }

  // Only show capture window if OS integration mode is active
  if (!state.isOsIntegrationMode) {
    return;
  }

  // Don't create capture window if notification is already active
  if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    console.log('🎯 Notification ativa, não criando janela de captura');
    return;
  }

  console.log('🎯 Criando janela de captura');
  
  state.osCaptureWindow = new BrowserWindow({
    width: 120,
    height: 120,
    backgroundColor: '#00000000',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Position in top right corner (same as loading/response notifications)
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 120;
  state.osCaptureWindow.setPosition(width - windowWidth - 20, 60);

  // STEALTH: a janela de captura também não pode vazar em gravação/compartilhamento
  // (antes era a única overlay sem proteção — leak em Teams/Meet/OBS).
  helpers.applyStealthProtection(state.osCaptureWindow);
  try { state.osCaptureWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { state.osCaptureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}

  // Passa cliques do mouse pra tras no Windows/macOS (icone de captura nao deve bloquear cliques)
  if (process.platform !== 'linux') {
    try { state.osCaptureWindow.setIgnoreMouseEvents(true, { forward: true }); } catch (_) {}
  }

  // Load capture animation
  const capturePath = path.join(ROOT_DIR, 'os-integration', 'notifications', 'capture.html');
  state.osCaptureWindow.loadFile(capturePath).catch(error => {
    console.error('Erro ao carregar janela de captura:', error);
  });

  state.osCaptureWindow.on('closed', () => {
    console.log('🎯 Janela de captura fechada');
    state.osCaptureWindow = null;
  });
}

helpers.destroyCaptureWindow = function() {
  if (state.osCaptureWindow && !state.osCaptureWindow.isDestroyed()) {
    console.log('🎯 Destruindo janela de captura');
    state.osCaptureWindow.close();
    state.osCaptureWindow = null;
  }
}

helpers.showConfirmActionOverlay = function(opts) {
  if (state.globalBypassAllConfirmations) {
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
        preload: path.join(ROOT_DIR, "preload.js"),
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    helpers.applyStealthProtection(win);

    const filePath = path.join(ROOT_DIR, 'os-integration', 'notifications', 'confirmAction.html');
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
