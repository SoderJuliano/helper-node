// main/helpers/stealth.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, CopilotCliProvider, TesseractService,
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
  BrowserWindow, screen, execPromise
} = require('../globals.js');

helpers.applyStealthProtection = function(win) {
  if (!win || win.isDestroyed()) return;
  const isStealth = configService.getStealthModeStatus();
  if (!isStealth) {
    try { win.setContentProtection(false); } catch (_) {}
    return;
  }
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

helpers.updateAllWindowsStealthProtection = function() {
  try {
    const isStealth = configService.getStealthModeStatus();
    const { BrowserWindow } = require('electron');
    const windows = BrowserWindow.getAllWindows();
    console.log(`[stealth] Atualizando proteção stealth e taskbar para todas as janelas: ${isStealth}`);
    
    const mainAppWindows = [state.mainWindow, state.configWindow, state.preferencesWindow];

    for (const win of windows) {
      if (!win || win.isDestroyed()) continue;
      try {
        win.setContentProtection(isStealth);
      } catch (e) {
        console.log(`[stealth] Erro ao definir setContentProtection em janela:`, e.message);
      }

      const isMainAppWin = mainAppWindows.some(w => w && !w.isDestroyed() && w.id === win.id);
      if (isMainAppWin) {
        try {
          win.setSkipTaskbar(isStealth);
        } catch (e) {
          console.log(`[stealth] Erro ao definir setSkipTaskbar em janela:`, e.message);
        }
      }
    }
  } catch (err) {
    console.error(`[stealth] Erro no updateAllWindowsStealthProtection:`, err);
  }
}

helpers.setupScreenSharingDetection = function() {
  helpers.checkScreenSharing();
  state.sharingCheckInterval = setInterval(() => helpers.checkScreenSharing(), 3000);

  screen.on("display-metrics-changed", () => {
    console.log("Display metrics changed");
    helpers.checkScreenSharing();
    helpers.updateWindowPosition();
  });
}

helpers.checkScreenSharing = async function() {
  try {
    const isSharing = await helpers.detectScreenSharing();
    if (isSharing !== state.sharingActive) {
      console.log("Chrome gravando a tela");
      state.sharingActive = isSharing;
      helpers.handleScreenSharing();
    }
  } catch (error) {
    console.error("Erro na verificação:", error);
  }
}

helpers.detectChromeScreenSharing = async function() {
  if (process.platform === 'win32') return false;
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
    return false;
  }
}

helpers.detectScreenSharing = async function() {
  if (process.platform === 'win32') return false;
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
      ) || helpers.detectChromeScreenSharing()
    );
  } catch (error) {
    return false;
  }
}

helpers.handleScreenSharing = function() {
  try {
    if (state.sharingActive && state.mainWindow && !state.mainWindow.isDestroyed()) {
      console.log("Screen sharing active, updating position");
      helpers.updateWindowPosition();
      helpers.applyStealthProtection(state.mainWindow);
    } else {
      console.log("No screen sharing, showing window");
      state.mainWindow.show();
    }
  } catch (error) {
    console.error("Error handling screen sharing:", error);
  }
}

helpers.withUserContext = function(instruction) {
  try {
    const ctx = configService.getUserContextBlock ? configService.getUserContextBlock() : '';
    if (ctx && ctx.trim()) return `${ctx}\n\n${instruction}`;
  } catch (_) {}
  return instruction;
}

helpers.processOsQuestion = async function(text, image = null, opts = {}) {
  // opts.forceVision = true  →  pula o roteador, manda imagem sempre.
  //   Use isto quando a imagem é a FONTE da pergunta (capturas de tela,
  //   paste image). O OCR de tela cheia tipicamente captura a UI do navegador
  //   e barra de tarefas, ignorando o conteúdo real (que pode ser texto
  //   renderizado em canvas/SVG, números em quiz, etc).
  console.log(`🤖 processOsQuestion called - FORCEFULLY closing any notifications`);

  try {
    const aiModel = helpers.getEffectiveAiModel();
    let resposta;

    // === ROTEAMENTO INTELIGENTE: TEXTO vs VISÃO ===
    let extractedText = '';
    let useVision = false;
    let visionReason = '';

    if (image) {
      // Sempre tenta OCR se a imagem estiver presente (essencial para modelos baseados em texto / CLI)
      try {
        extractedText = await TesseractService.getTextFromImage(image);
        console.log(`✅ OCR: ${extractedText.substring(0, 100).replace(/\n/g, ' ')}...`);
      } catch (ocrError) {
        console.warn('OCR falhou:', ocrError.message || ocrError);
        extractedText = '';
      }

      if (opts.forceVision) {
        useVision = true;
        visionReason = 'forceVision (captura direta de tela/imagem)';
        console.log(`🧭 Roteamento: VISÃO — ${visionReason}`);
      } else {
        const decision = helpers.shouldUseVisionFor(extractedText);
        useVision = decision.useVision;
        visionReason = decision.reason;
        console.log(`🧭 Roteamento: ${useVision ? 'VISÃO' : 'TEXTO'} — ${visionReason}`);
      }
    }

    const sendImage = Boolean(useVision && image);

    if (image) {
      if (useVision && (aiModel === 'openIa' || aiModel === 'openIaCodex')) {
        // PROMPT LIMPO no modo visão OpenAI: a imagem vai pelo canal de visão da API
        text = (text && text.trim() ? `${text}\n\n` : '')
          + 'Analise a IMAGEM com atenção. Responda conforme as regras do sistema.\n\n'
          + 'IMPORTANTE: na imagem, "x" entre dois números significa MULTIPLICAÇÃO '
          + '(ex.: "11x2" = 11 × 2 = 22, NÃO é 11 ao quadrado). '
          + 'Notação de potência seria "11²" ou "11^2".';
      } else {
        // Modelos baseados em texto / CLI ou sem canal de visão nativo: usa OCR
        const ocrContent = extractedText && extractedText.trim()
          ? extractedText
          : (text && text.trim() ? '' : 'Nenhum texto legível detectado na imagem por OCR.');
        if (ocrContent) {
          text = (text && text.trim() ? `${text}\n\n` : '')
            + `Conteúdo extraído da captura de tela / imagem:\n\n${ocrContent}\n\nResponda conforme as regras do sistema.`;
        }
      }
    }

    if (aiModel === 'openIa' || aiModel === 'openIaCodex') {
      const token = configService.getOpenIaToken();
      const instruction = helpers.withUserContext(configService.getPromptInstruction());
      if (!token) {
        console.log(`🔔 No OpenAI token, closing notification and showing error`);
        helpers.destroyNotificationWindow();
        await new Promise(resolve => setTimeout(resolve, 200));
        helpers.createOsNotificationWindow('response', 'Token da OpenAI não configurado.');
        return;
      }
      const openAiModel = sendImage
        ? configService.getOpenAiVisionModel()
        : configService.getOpenAiModel();
      console.log(`🤖 OpenAI ${openAiModel}${sendImage ? ' [VISÃO high]' : ' [TEXTO]'}...`);
      const _wsText3 = sendImage ? text : await helpers.prependWorkspaceContextIfNeeded(text, openAiModel);

      const useAgentic = !sendImage && helpers.shouldUseAgentic(text);

      if (useAgentic) {
          console.log('🤖 OCR: Iniciando AGENTIC WORKFLOW (multi-fase)...');
          try {
            resposta = await agenticWorkflow.run(
                _wsText3, 
                { token, model: openAiModel, baseInstruction: instruction },
                state.osNotificationWindow && !state.osNotificationWindow.isDestroyed() ? state.osNotificationWindow.webContents : null
            );
          } catch (err) {
            resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
          }
      } else {
          const ht = sendImage
            ? { opts: { stateless: !!image } }
            : (() => {
                const _ht = helpers.buildHelperToolsOpenAIOpts(_wsText3, instruction, openAiModel);
                _ht.opts = { ..._ht.opts, stateless: !!image };
                return _ht;
              })();
          try {
            resposta = await OpenAIService.makeOpenAIRequest(
              _wsText3,
              token,
              ht.instruction || instruction,
              ht.model || openAiModel,
              sendImage ? image : null,
              ht.opts
            );
          } catch (reqErr) {
            if (sendImage && extractedText && extractedText.trim()) {
              console.warn(`⚠️ Requisição OpenAI Vision falhou (${reqErr.message}). Tentando fallback com texto do OCR...`);
              const textModel = configService.getOpenAiModel() || 'gpt-4.1-nano';
              const textPrompt = `Conteúdo extraído da captura de tela / imagem:\n\n${extractedText}\n\nResponda conforme as regras do sistema.`;
              resposta = await OpenAIService.makeOpenAIRequest(
                textPrompt,
                token,
                instruction,
                textModel,
                null,
                { stateless: true }
              );
            } else {
              throw reqErr;
            }
          }
      }
      console.log(`🤖 Got OpenAI response: ${typeof resposta === 'string' ? resposta.substring(0, 50) : ''}...`);
    } else if (aiModel === 'geminiCli') {
        const projectPath = workspace.getProjectPath();
        const geminiModel = configService.getGeminiCliModel();
        GeminiCliProvider.setModel(geminiModel);
        const instruction = helpers.withUserContext(configService.getPromptInstruction());
        let finalPrompt = text;
        if (!sendImage) {
          finalPrompt = await helpers.prependWorkspaceContextIfNeeded(text, 'geminiCli');
        }
        finalPrompt = `${instruction}\n\n${finalPrompt}`;
        const mockSender = state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()
          ? state.osNotificationWindow.webContents
          : { send: () => {} };
        try {
          const res = await GeminiCliProvider.send(finalPrompt, projectPath, mockSender);
          resposta = typeof res === 'object' ? (res.text || res.response || '') : String(res);
        } catch (gErr) {
          console.error('[gemini-cli processOsQuestion] erro:', gErr.message);
          throw gErr;
        }
    } else if (aiModel === 'claudeCli') {
        const projectPath = workspace.getProjectPath();
        const claudeModel = configService.getClaudeCliModel();
        ClaudeCliProvider.setModel(claudeModel);
        const instruction = helpers.withUserContext(configService.getPromptInstruction());
        let finalPrompt = text;
        if (!sendImage) {
          finalPrompt = await helpers.prependWorkspaceContextIfNeeded(text, 'claudeCli');
        }
        finalPrompt = `${instruction}\n\n${finalPrompt}`;
        const mockSender = state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()
          ? state.osNotificationWindow.webContents
          : { send: () => {} };
        try {
          const res = await ClaudeCliProvider.send(finalPrompt, projectPath, mockSender);
          resposta = typeof res === 'object' ? (res.text || res.response || '') : String(res);
        } catch (cErr) {
          console.error('[claude-cli processOsQuestion] erro:', cErr.message);
          throw cErr;
        }
    } else if (aiModel === 'copilotCli') {
        const projectPath = workspace.getProjectPath();
        const copilotModel = configService.getCopilotCliModel();
        CopilotCliProvider.setModel(copilotModel);
        const instruction = helpers.withUserContext(configService.getPromptInstruction());
        let finalPrompt = text;
        if (!sendImage) {
          finalPrompt = await helpers.prependWorkspaceContextIfNeeded(text, 'copilotCli');
        }
        finalPrompt = `${instruction}\n\n${finalPrompt}`;
        const mockSender = state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()
          ? state.osNotificationWindow.webContents
          : { send: () => {} };
        try {
          const res = await CopilotCliProvider.send(finalPrompt, projectPath, mockSender, {
            attachments: helpers.getAttachableFilePaths(),
          });
          resposta = typeof res === 'object' ? (res.text || res.response || '') : String(res);
        } catch (cpErr) {
          console.error('[copilot-cli processOsQuestion] erro:', cpErr.message);
          throw cpErr;
        }
    } else if (aiModel === 'ollamaLocal') {
      try {
        const OllamaLocalService = require('../../services/ollamaLocalService');
        const instructionO3 = helpers.withUserContext(configService.getPromptInstruction());
        const _wsTxtO3 = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');

        const htEnabled = configService.getHelperToolsEnabled && configService.getHelperToolsEnabled();
        if (htEnabled) {
          const _htO3 = helpers.buildHelperToolsOpenAIOpts(_wsTxtO3, instructionO3, configService.getOpenAiModel());
          resposta = await OllamaLocalService.responder(_wsTxtO3, { ..._htO3.opts, imageBase64: sendImage ? image : null });
        } else {
          resposta = await OllamaLocalService.responder(_wsTxtO3, { imageBase64: sendImage ? image : null });
        }
      } catch (ollamaErr) {
        console.error("Local Ollama falhou:", ollamaErr && ollamaErr.message);
        resposta = `Ollama Local falhou: ${ollamaErr.message}`;
      }
    } else {
      // Backends sem visão (Ollama): só TEXTO. Mas com tool calling agora.
      try {
        const instructionO3 = helpers.withUserContext(configService.getPromptInstruction());
        const useAgentic = helpers.shouldUseAgentic(text);
        if (useAgentic) { try { workspace.resetContextSent(); } catch (_) {} }
        const _wsTxtO3 = await helpers.prependWorkspaceContextIfNeeded(text, 'ollama');

        if (useAgentic) {
            console.log('🤖 OCR: Iniciando AGENTIC WORKFLOW OLLAMA (multi-fase)...');
            BackendService.clearSessions();
            try {
              resposta = await ollamaAgenticWorkflow.run(
                  _wsTxtO3, 
                  { baseInstruction: instructionO3 },
                  state.osNotificationWindow && !state.osNotificationWindow.isDestroyed() ? state.osNotificationWindow.webContents : null
              );
            } catch (err) {
              if (err && (err.message === 'Request cancelled' || err.message === 'Cancelado.')) return;
              resposta = `[Ollama Agentic] Interrompido ou falhou: ${err.message}`;
            }
        } else {
            const _htO3 = helpers.buildHelperToolsOpenAIOpts(_wsTxtO3, instructionO3, configService.getOpenAiModel());
            resposta = await BackendService.responder(_wsTxtO3, { ..._htO3.opts, imageBase64: sendImage ? image : null });
        }
        state.backendIsOnline = true;
      } catch (backendError) {
        console.error("Backend Ollama falhou:", backendError && backendError.message);
        state.backendIsOnline = false;
        throw new Error(
          "Backend Ollama indisponivel. Verifique se o servico esta rodando ou troque pra OpenAI em Configuracoes."
        );
      }
    }

    console.log(`🔔 Destroying loading notification and showing response`);

    // Modo integrado (Stealth): NUNCA aciona Nexa. Se a resposta vier em JSON (por resíduo de modelo), extrai apenas o texto puro
    if (typeof resposta === 'string' && (resposta.trim().startsWith('{') || resposta.includes('"response"'))) {
      try {
        const { parseNexaResponse } = require('../nexa/nexaResponseHelper.js');
        const parsed = parseNexaResponse(resposta);
        if (parsed && parsed.response) {
          resposta = parsed.response;
        }
      } catch (_) {}
    }

    const formattedResponse = helpers.formatToHTML(resposta);
    // CRITICAL: Ensure the loading notification is completely destroyed before creating response
    helpers.destroyNotificationWindow();
    // Wait a bit longer to ensure the window is fully destroyed
    await new Promise(resolve => setTimeout(resolve, 300));
    helpers.createOsNotificationWindow('response', formattedResponse);

  } catch (error) {
    console.error('Error in processOsQuestion:', error);
    
    // Destroy any existing notification before showing error
    helpers.destroyNotificationWindow();
    
    // Wait to ensure previous notification is completely destroyed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    helpers.createOsNotificationWindow('response', error && error.message ? error.message : 'Erro ao gerar resposta.');
  }
};
