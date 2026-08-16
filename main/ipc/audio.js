// main/ipc/audio.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  // Mesmo esquecimento do aiResponse.js: os três handlers de TTS abaixo usavam
  // googleTtsService sem importar. O "Testar conexão" das Configurações sempre
  // respondeu {ok:false, error:"googleTtsService is not defined"}.
  googleTtsService,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  BrowserWindow, ipcMain, execPromise, appConfig, Notification
} = require('../globals.js');

module.exports = function registerIpc() {
ipcMain.on('vision-guide-minimize', () => {
  if (state.visionGuideOverlayWindow && !state.visionGuideOverlayWindow.isDestroyed()) {
    try { state.visionGuideOverlayWindow.hide(); } catch (_) {}
    state.visionGuideMinimized = true;
  }
});

ipcMain.on('vision-guide-help', () => {
  if (!visionGuide.isActive || !visionGuide.isActive()) return;
  try { visionGuide.askHelp(); } catch (e) { console.warn('[vision-guide] askHelp falhou:', e.message); }
});

ipcMain.on('vision-guide-toggle-pause', () => {
  if (!visionGuide.isActive || !visionGuide.isActive()) return;
  const willPause = !(visionGuide.isPaused && visionGuide.isPaused());
  // pause()/resume() já avisam o overlay via onPauseChange → não precisa enviar aqui.
  if (willPause) { try { visionGuide.pause(); } catch (_) {} }
  else { try { visionGuide.resume(); } catch (_) {} }
});

ipcMain.on("set-editor-state", (event, state) => {
  state.currentEditorState = state;
});

ipcMain.on("stop-notifications", () => {
  if (state.waitingNotificationInterval) {
    clearInterval(state.waitingNotificationInterval);
    state.waitingNotificationInterval = null;
  }
  console.log("Notifications stopped");
});

ipcMain.on("start-notifications", () => {
  console.log("Notifications restarted");
});

ipcMain.on("renderer-toggle-recording", async () => {
  try { await helpers.toggleRecording(); } catch (e) { console.error("[renderer-toggle-recording]", e.message); }
});

ipcMain.handle("get-audio-input-devices", async () => {
  try {
    if (process.platform !== 'linux') {
      return [];
    }
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

ipcMain.handle("translation-start", async () => {
  const cfg = configService.getConfig();
  if (!cfg.openIaToken) return { error: 'API key não configurada' };
  // Para o assistente em tempo real se estiver ativo (evita conflito de mic)
  if (helpers.anyRealtimeActive()) {
    await helpers.stopAllRealtime();
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
    helpers.createTranslationOverlay();
    helpers.sendToTranslationOverlay('translation-status', 'mic_open');
  }
  if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('translation-status', 'mic_open');
  return { ok: true };
});

ipcMain.handle("translation-stop", async () => {
  await translationAssistant.stop();
  helpers.destroyTranslationOverlay();
  if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('translation-status', 'idle');
  return { ok: true };
});

ipcMain.on('overlay-position', (event, position) => {
  // Resolve a janela que pediu (tradutor, tutor de visão OU assistente em tempo real) pelo sender.
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (sender && state.visionGuideOverlayWindow && sender === state.visionGuideOverlayWindow) {
    helpers.positionTranslationOverlay(position, state.visionGuideOverlayWindow);
  } else if (sender && state.realtimeOverlayWindow && sender === state.realtimeOverlayWindow) {
    helpers.positionTranslationOverlay(position, state.realtimeOverlayWindow);
  } else {
    helpers.positionTranslationOverlay(position, state.translationOverlayWindow);
  }
});

ipcMain.on("request-translation-resize", () => {
  helpers.expandTranslationOverlayIfNeeded();
});

ipcMain.on("request-vision-guide-resize", () => {
  helpers.expandVisionGuideOverlayIfNeeded();
});

ipcMain.on("realtime-overlay-minimize", () => {
  if (state.realtimeOverlayWindow && !state.realtimeOverlayWindow.isDestroyed()) {
    state.realtimeOverlayMinimized = true;
    try { state.realtimeOverlayWindow.hide(); } catch (_) {}
  }
});

ipcMain.handle("get-vision-guide-config", () => {
  return configService.getVisionGuideConfig();
});

ipcMain.handle("ide-autocomplete", async (event, { prefix, suffix, lang }) => {
  const vg = configService.getVisionGuideConfig();
  if (!vg || !vg.enabled) return null; // Só funciona se Tutor estiver ligado
  return await visionGuide.getIdeAutocomplete(prefix, suffix, lang);
});

ipcMain.on("set-vision-guide-config", (event, partial) => {
  configService.setVisionGuideConfig(partial || {});

  if (typeof partial?.enabled === 'boolean') {
    const cfg = configService.getConfig();
    if (partial.enabled) {
      if (!cfg.openIaToken) {
        const msg = '❌ Configure sua API key da OpenAI antes de usar o Assistente Guiado por Visão.';
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('translation-result', { transcript: '', response: msg });
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
            helpers.createVisionGuideOverlay();
            helpers.sendToVisionGuideOverlay('vision-guide-status', 'watching');
          }
        }).catch((e) => {
          console.error('[vision-guide] falha ao iniciar:', e.message);
          configService.setVisionGuideConfig({ enabled: false });
        });
      }
    } else {
      if (visionGuide.isActive()) {
        visionGuide.stop().then(() => {
          helpers.destroyVisionGuideOverlay();
        }).catch(() => {});
      } else {
        helpers.destroyVisionGuideOverlay();
      }
    }
  }
});

ipcMain.on("cancel-recording", () => {
  console.log('Cancel recording requested from OS notification');

  if (helpers.anyRealtimeActive()) {
    helpers.stopAllRealtime();
    state.isRecording = false;
    return;
  }
  
  if (helpers.cancelDictation()) {

    console.log("Recording cancelled by user");
    
    // Close the recording notification
    if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
      state.osNotificationWindow.close();
    }
    
    // Show cancelled notification
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('response', 'Gravação cancelada.');
    } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Gravação cancelada.",
        silent: true,
      }).show();
    }
  }
});

// ── Google Text-to-Speech (TTS) IPC Handlers ─────────────────────────────────
ipcMain.handle("google-tts-test", async (event, keyPathOrKey) => {
  try {
    const keyToUse = keyPathOrKey || configService.getGoogleTtsConfig().keyPathOrKey;
    return await googleTtsService.testConnection(keyToUse);
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle("google-tts-list-voices", async (event, keyPathOrKey) => {
  try {
    const keyToUse = keyPathOrKey || configService.getGoogleTtsConfig().keyPathOrKey;
    return await googleTtsService.listVoices(keyToUse);
  } catch (err) {
    return [];
  }
});

ipcMain.handle("google-tts-synthesize", async (event, text, voiceName) => {
  try {
    const cfg = configService.getGoogleTtsConfig();
    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : null;
    const isNexaOn = !!(nexaCfg && nexaCfg.enabled);
    if (!cfg.enabled && !isNexaOn) return { error: "Modo de voz desativado." };

    const voiceToUse = voiceName || cfg.voiceName || "pt-BR-Neural2-C";
    const speakingRate = cfg.speakingRate !== undefined ? cfg.speakingRate : 1.0;
    const pitch = cfg.pitch !== undefined ? cfg.pitch : 0.0;

    const audioBuf = await googleTtsService.synthesizeText(text, {
      keyOrPath: cfg.keyPathOrKey,
      voiceName: voiceToUse,
      speakingRate,
      pitch
    });
    return { audioBase64: audioBuf.toString("base64") };
  } catch (err) {
    return { error: err.message };
  }
});

};

