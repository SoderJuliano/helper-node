// main/ipc/shortcuts.js
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
  ipcMain, appConfig, Notification
} = require('../globals.js');

module.exports = function registerIpc() {
ipcMain.handle("is-hyprland", () => {
  return helpers.isHyprland();
});

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

ipcMain.handle("get-app-version", () => {
  try {
    const pkg = require('../../package.json');
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

ipcMain.on("save-backend-api-key", (event, key) => {
  configService.setBackendApiKey(key);
});

ipcMain.handle("get-debug-mode-status", () => {
  return configService.getDebugModeStatus();
});

ipcMain.handle("get-stealth-mode-status", () => {
  return configService.getStealthModeStatus();
});

ipcMain.on("save-stealth-mode-status", (event, status) => {
  configService.setStealthModeStatus(status);
  helpers.updateAllWindowsStealthProtection();
});

ipcMain.on("save-debug-mode-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    helpers.stopAllRealtime();
  }

  configService.setDebugModeStatus(status);
  // Notifica a janela principal e a de configuração sobre a mudança
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("debug-status-changed", status);
  }
  if (state.configWindow && !state.configWindow.isDestroyed()) {
    state.configWindow.webContents.send("debug-status-changed", status);
  }
});

ipcMain.handle("get-print-mode-status", () => {
  return configService.getPrintModeStatus();
});

ipcMain.on("save-print-mode-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    helpers.stopAllRealtime();
  }

  configService.setPrintModeStatus(status);
  console.log('Print mode status changed to:', status);
  helpers.notifyShortcutsChanged();
  
  if (status) {
    // Notificação de ativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Modo automático ativado! Tire prints e aguarde as respostas...',
        silent: true,
      }).show();
    }
    
    helpers.startClipboardMonitoring();
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
    
    helpers.stopClipboardMonitoring();
  }
});

ipcMain.handle("get-os-integration-status", () => {
  return configService.getOsIntegrationStatus();
});

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
    helpers.stopAllRealtime();
  }

  configService.setOsIntegrationStatus(status);
  console.log('OS Integration status changed to:', status);
  helpers.notifyShortcutsChanged();
  
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
    
    helpers.startClipboardMonitoring();
    helpers.startCaptureToolMonitoring(); // Monitoramento de ferramentas de captura apenas no OS integration
    // Switch to OS integration mode
    helpers.switchToOsIntegrationMode();
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
    helpers.switchToNormalMode();
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

    helpers.stopClipboardMonitoring();
    helpers.stopCaptureToolMonitoring();
    helpers.switchToNormalMode();

    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Assistente em tempo real habilitado. Inicie/parar com Ctrl+D.',
        silent: true,
      }).show();
    }
  } else {
    await helpers.stopAllRealtime();
    state.isRecording = false;

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("toggle-recording", {
        isRecording: state.isRecording,
        audioFilePath,
      });
    }
  }
});

ipcMain.handle("get-language", () => {
  return configService.getLanguage();
});

ipcMain.on("set-language", (event, language) => {
  configService.setLanguage(language);
});

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

ipcMain.handle("kb-append", async (event, payload) => {
  const { text = "", aiRewrite = true, enabled = true } = payload || {};
  configService.setKnowledgeBaseConfig({ aiRewrite: !!aiRewrite, enabled: !!enabled });
  if (!(text || "").trim()) {
    return { ok: true, appended: false, chunks: knowledgeBase.chunkCount() };
  }
  // ChatGPT/Lite → token (embeddings + reescrita nano). Ollama/Full → backend (keyword + reescrita Ollama).
  const useOpenAI = helpers.getEffectiveAiModel() === "openIa";
  const token = useOpenAI ? configService.getOpenIaToken() : "";
  const backendResponder = useOpenAI ? null : (t, opts) => BackendService.responder(t, opts);
  try {
    const res = await knowledgeBase.appendSource(text, { aiRewrite: !!aiRewrite, token, backendResponder });
    return { ok: true, chunks: res.chunks, rewritten: res.rewritten, shrunk: res.shrunk, codeSkipped: res.codeSkipped, appended: res.appended };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.on("kb-open-source-file", () => {
  try {
    const p = knowledgeBase.getSourcePath();
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.show();
      state.mainWindow.focus();
      state.mainWindow.webContents.send("open-file-in-viewer", p);
    }
  } catch (_) {}
});

ipcMain.handle("kb-rewrite", async (event, payload) => {
  const { text = "" } = payload || {};
  const useOpenAI = helpers.getEffectiveAiModel() === "openIa";
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

ipcMain.on("set-translation-assistant-config", (event, partial) => {
  configService.setTranslationAssistantConfig(partial || {});

  // Auto-inicia ou para o assistente ao vivo conforme o toggle de habilitação
  if (typeof partial.enabled === 'boolean') {
    const cfg = configService.getConfig();
    if (partial.enabled) {
      if (!cfg.openIaToken) {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('translation-result', {
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
            try { helpers.stopClipboardMonitoring(); } catch (_) {}
            try { helpers.stopCaptureToolMonitoring(); } catch (_) {}
            try { helpers.stopScreenshotFolderMonitoring(); } catch (_) {}
            console.log('[mutex] TA ativo + OS Integration: monitorings de print/captura/screenshot parados');
            // Sobe o overlay dedicado do tradutor
            helpers.createTranslationOverlay();
            helpers.sendToTranslationOverlay('translation-status', 'mic_open');
          }
          if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('translation-status', 'mic_open');
        }).catch((e) => console.error('[TranslationAssistant] falha ao iniciar:', e.message));
      }
    } else {
      if (translationAssistant.isActive()) {
        translationAssistant.stop().then(() => {
          // Ao desligar o TA, se OS Integration ainda estiver ativo, restaura
          // os monitorings normais (print mode + ferramentas de captura).
          if (cfg.osIntegration) {
            if (configService.getPrintModeStatus()) {
              try { helpers.startClipboardMonitoring(); } catch (_) {}
              try { helpers.startScreenshotFolderMonitoring(); } catch (_) {}
            }
            try { helpers.startCaptureToolMonitoring(); } catch (_) {}
            console.log('[mutex] TA desligado: monitorings restaurados');
          }
          helpers.destroyTranslationOverlay();
          if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('translation-status', 'idle');
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
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('translation-result', {
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
        if (text) helpers.createOsNotificationWindow('response', text);
      } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('translation-result', data);
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

};
