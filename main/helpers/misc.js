// main/helpers/misc.js
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
  REALTIME_COPILOT_INSTRUCTION, realtimeOpenAiService,
  state, helpers,
  globalShortcut, screen, execPromise, appConfig, Notification
} = require('../globals.js');

helpers.checkBackendStatus = async function() {
  state.backendIsOnline = await BackendService.ping();
  if (state.backendIsOnline) {
    console.log("Backend is online.");
  } else {
  }
}

helpers.realtimeProviderResponder = async function(transcript) {
  const aiModel = configService.getAiModel();
  const kb = await helpers.knowledgeBlockForOllama(transcript);
  const text = kb ? `${kb}\n\n---\n\nFALA: ${transcript}` : transcript;
  if (aiModel === "ollamaLocal") {
    const OllamaLocalService = require('../../services/ollamaLocalService');
    return await OllamaLocalService.responder(text);
  }
  // backend remoto (llama / llama-stream)
  return await BackendService.responder(text, {
    sessionId: "realtime-assistant",
    instruction: REALTIME_COPILOT_INSTRUCTION,
  });
}

helpers.clearOsNotifAutoClose = function() {
  if (state.osNotifAutoCloseTimer) { clearInterval(state.osNotifAutoCloseTimer); state.osNotifAutoCloseTimer = null; }
}

helpers.startResponseAutoClose = function() {
  helpers.clearOsNotifAutoClose();
  const AUTO_CLOSE_MS = 10000;
  const POLL_MS = 200;
  let remaining = AUTO_CLOSE_MS;
  let last = Date.now();
  let started = false; // já enviamos o 1º estado 'running'?
  state.osNotifAutoCloseTimer = setInterval(() => {
    const win = state.osNotificationWindow;
    if (!win || win.isDestroyed()) { helpers.clearOsNotifAutoClose(); return; }

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
      helpers.clearOsNotifAutoClose(); // para o poll de vez — não fecha mais sozinho
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
      helpers.clearOsNotifAutoClose();
      try { win.close(); } catch (_) {}
    }
  }, POLL_MS);
}

helpers.switchToOsIntegrationMode = function() {
  state.isOsIntegrationMode = true;
  state.currentEditorState = null; // Evita que estado antigo do editor bloqueie os prints de tela
  // Start capture tool monitoring when entering OS integration mode
  helpers.startCaptureToolMonitoring();
  // Monitora pasta de screenshots do COSMIC (captura via PrintScreen nativo)
  helpers.startScreenshotFolderMonitoring();
  // Hide main window
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.hide();
  }
  // Se o tutor estiver ativo, abre o overlay no modo integrado
  if (visionGuide.isActive()) {
    helpers.createVisionGuideOverlay();
    helpers.sendToVisionGuideOverlay('vision-guide-status', 'watching');
    try { visionGuide.triggerIntroduction(); } catch (e) { console.warn('[vision-guide] falha ao triggar intro:', e.message); }
  }
}

helpers.switchToNormalMode = function() {
  state.isOsIntegrationMode = false;
  // Stop capture tool monitoring when leaving OS integration mode
  helpers.stopCaptureToolMonitoring();
  // Para monitoramento da pasta de screenshots
  helpers.stopScreenshotFolderMonitoring();
  // Close OS integration windows
  if (state.osInputWindow && !state.osInputWindow.isDestroyed()) {
    state.osInputWindow.close();
  }
  helpers.destroyNotificationWindow(); // Use helper function instead
  helpers.destroyCaptureWindow(); // Close capture window
  helpers.destroyTranslationOverlay(); // Fecha overlay dedicado do tradutor se aberto
  helpers.destroyVisionGuideOverlay(); // Fecha overlay dedicado do tutor se aberto

  // Stop capture tool monitoring when leaving OS integration mode
  helpers.stopCaptureToolMonitoring();

  // Show main window
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.show();
  }
}

helpers.createIntermediateNotification = function() {
  console.log('📸 Mostrando notificação de captura detectada...');
  
  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    helpers.createOsNotificationWindow('loading', 'Ferramenta de captura detectada - aguardando imagem...');
  } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
    new Notification({
      title: 'Helper-Node',
      body: 'Ferramenta de captura detectada - aguardando imagem...',
      silent: true,
    }).show();
  }
}

helpers.registerGlobalShortcuts = async function() {
  if (!state.mainWindow) return;

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
      if (helpers.isTranslationOnlyMode() && action !== "open-config" && action !== "capture-region-native") {
        console.log(`[mutex] atalho ${combo} (${action}) ignorado — TA + OS Integration ativos`);
        return;
      }

      if (action === "open-config") {
        helpers.createConfigWindow();
        return;
      }

      // Handle manual-input action for OS integration mode
      if (action === "manual-input") {
        await helpers.bringWindowToFocus(); // This function already handles OS integration mode
        return;
      }
      
      // Handle recording action (works in both modes)
      if (action === "toggle-recording") {
        await helpers.toggleRecording();
        return;
      }
      
      // Handle capture screen action (works in both modes)
      if (action === "capture-screen") {
        await helpers.captureScreen();
        return;
      }

      // Captura full-screen automática (sem seleção, sem prompt) → OCR → IA
      if (action === "capture-region-native") {
        // Com o Tutor ligado no modo integrado, o print silencioso vira um pedido
        // de ajuda AO TUTOR (ele já enxerga a tela) — responde na telinha dele,
        // em vez de abrir a janela separada de OCR sem contexto.
        if (configService.getOsIntegrationStatus() && visionGuide.isActive()) {
          try { visionGuide.analyzeNow(); } catch (e) { console.warn('[vision-guide] analyzeNow falhou:', e.message); }
          return;
        }
        try { await helpers.captureFullScreenAuto(); } catch (e) { console.error('captureFullScreenAuto failed:', e); }
        return;
      }
      
      // Handle display movement (only works in normal mode)
      if (action === "move-to-display-0") {
        helpers.moveToDisplay(0);
        return;
      }
      if (action === "move-to-display-1") {
        helpers.moveToDisplay(1);
        return;
      }
      
      // Other actions that require main window
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send(action);
        if (action === "focus-window" && state.mainWindow.isMinimized()) {
          state.mainWindow.restore();
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

helpers.getAudioSources = async function() {
  const sources = ['@DEFAULT_SOURCE@'];
  try {
    const { stdout } = await execPromise('pactl get-default-sink');
    sources.push(stdout.trim() + '.monitor');
  } catch (e) {
    sources.push('@DEFAULT_MONITOR@');
  }
  return sources;
}

helpers.toggleRealtimeAssistantRecording = async function() {
  if (helpers.anyRealtimeActive()) {
    await helpers.stopAllRealtime();
    state.isRecording = false;

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("toggle-recording", {
        isRecording: state.isRecording,
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

  const service = helpers.pickRealtimeService();
  const isOnline = service === realtimeOpenAiService;

  // Só o caminho ONLINE (OpenAI) precisa do token. backend/Ollama não usa OpenAI.
  if (isOnline && !configService.getOpenIaToken()) {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("transcription-error", "Token da OpenAI não configurado.");
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
  state.isRecording = true;

  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("toggle-recording", {
      isRecording: state.isRecording,
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

helpers.getEffectiveAiModel = function() {
  return edition.isLite() ? 'openIa' : configService.getAiModel();
}

// Arquivo binário lido como utf8 vira lixo cheio de bytes NUL. Isso nunca fez
// sentido no prompt (queima contexto sem informar nada), e no Copilot CLI era
// FATAL: o prompt vai como argv (`-p <texto>`) e o Node recusa argumento com
// NUL — `ERR_INVALID_ARG_VALUE`, o que derrubava o envio ao anexar QUALQUER
// imagem, até um PNG de 1x1. Detecta pelo conteúdo (não pela extensão) pra
// pegar também .zip/.class/.bin sem manter lista.
helpers.isBinaryFile = function(filePath) {
  const fsMod = require('fs');
  let fd = null;
  try {
    fd = fsMod.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const read = fsMod.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, read).includes(0);
  } catch (_) {
    return false;
  } finally {
    if (fd !== null) { try { fsMod.closeSync(fd); } catch (_) {} }
  }
}

// Extensões que o Copilot CLI aceita em `--attachment` ("image or native
// document", conforme `copilot --help`). Só imagem/PDF entram: mandar um .zip
// nessa flag faz o CLI recusar a invocação inteira.
const ATTACHABLE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf']);

// Anexos que devem ir como arquivo de verdade pro CLI em vez de inline no
// prompt. Usado pelo provider do Copilot (`--attachment`).
helpers.getAttachableFilePaths = function() {
  try {
    const fsMod = require('fs');
    const pathMod = require('path');
    return workspace.list()
      .filter(a => a.type === 'file' && ATTACHABLE_EXT.has(pathMod.extname(a.path).toLowerCase()))
      .map(a => a.path)
      .filter(p => { try { return fsMod.statSync(p).isFile(); } catch (_) { return false; } });
  } catch (err) {
    console.warn("Falhou ao listar anexos de imagem/documento:", err.message);
    return [];
  }
}

helpers.appendAttachmentsContext = function(prompt) {
  try {
    const attachments = workspace.list().filter(a => a.type === 'file');
    if (attachments.length > 0) {
      let contextHeader = "=== ARQUIVOS ANEXADOS AO CONTEXTO ===\n";
      contextHeader += "O usuário selecionou e anexou manualmente os seguintes arquivos no workspace:\n";
      for (const att of attachments) {
        try {
          const fs = require('fs');
          if (!fs.existsSync(att.path)) { contextHeader += `- Caminho: ${att.path}\n`; continue; }
          const stat = fs.statSync(att.path);
          const binary = stat.isFile() && helpers.isBinaryFile(att.path);
          contextHeader += `- Caminho: ${att.path}${binary ? ' (binário/imagem — anexado como arquivo, não transcrito aqui)' : ''}\n`;
          if (!binary && stat.isFile() && stat.size < 150 * 1024) {
            const content = fs.readFileSync(att.path, 'utf8');
            contextHeader += `\n--- Conteúdo do arquivo (${att.path}) ---\n${content}\n--- Fim do arquivo ---\n\n`;
          }
        } catch (_) {}
      }
      contextHeader += "=== FIM DO CONTEXTO DE ANEXOS ===\n\nPor favor, utilize os caminhos e conteúdos acima para responder à pergunta atual.\n\nPergunta:\n";
      return contextHeader + prompt;
    }
  } catch (err) {
    console.warn("Falhou ao anexar contexto de arquivos para o CLI:", err.message);
  }
  return prompt;
}

helpers.notifyShortcutsChanged = function() {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    try { state.mainWindow.webContents.send("shortcuts-changed"); } catch (_) {}
  }
}

helpers.emitFileMutated = function(payload) {
  try {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("file-mutated", payload);
    }
  } catch (_) {}
}

helpers.stopFramelessDrag = function() {
  if (state._framelessDrag) {
    try { clearInterval(state._framelessDrag.timer); } catch (_) {}
    state._framelessDrag = null;
  }
}
