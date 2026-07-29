// main/helpers/stealth.js
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
  BrowserWindow, screen, execPromise, VoskStreamService
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
    console.log(`[stealth] Atualizando proteção stealth para todas as janelas: ${isStealth}`);
    for (const win of windows) {
      if (!win || win.isDestroyed()) continue;
      try {
        win.setContentProtection(isStealth);
      } catch (e) {
        console.log(`[stealth] Erro ao definir setContentProtection em janela:`, e.message);
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

        const decision = helpers.shouldUseVisionFor(extractedText);
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
      const instruction = helpers.withUserContext(configService.getPromptInstruction());
      if (!token) {
        console.log(`🔔 No OpenAI token, closing notification and showing error`);
        // Immediately close any loading notification and wait
        helpers.destroyNotificationWindow();
        await new Promise(resolve => setTimeout(resolve, 200));
        helpers.createOsNotificationWindow('response', 'Token da OpenAI não configurado.');
        return;
      }
      // Modelo dedicado pra visão: nano confunde notação básica em imagens.
      // gpt-4o-mini é barato e muito mais preciso em OCR/visual reasoning.
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
                state.osNotificationWindow.webContents
            );
          } catch (err) {
            resposta = `[Agentic Workflow] Interrompido ou falhou: ${err.message}`;
          }
      } else {
          // helperTools só engaja em modo TEXTO (visão é one-shot stateless)
          const ht = sendImage
            ? { opts: { stateless: !!image } }
            : (() => {
                const _ht = helpers.buildHelperToolsOpenAIOpts(_wsText3, instruction, openAiModel);
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
                  state.osNotificationWindow.webContents
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

    // Se a recording-live (Vosk) est\u00e1 ativa, NAO destroi essa janela \u2014
    // mostra a resposta numa janela secund\u00e1ria pra n\u00e3o engolir a conversa.
    const formattedResponse = helpers.formatToHTML(resposta);
    if (VoskStreamService.isRunning()) {
      console.log('[os-image] Vosk ativo \u2014 abrindo response em janela secund\u00e1ria');
      helpers.showImageResponseInSecondaryWindow(formattedResponse);
    } else {
      // CRITICAL: Ensure the loading notification is completely destroyed before creating response
      helpers.destroyNotificationWindow();
      // Wait a bit longer to ensure the window is fully destroyed
      await new Promise(resolve => setTimeout(resolve, 300));
      helpers.createOsNotificationWindow('response', formattedResponse);
    }
    
  } catch (error) {
    console.error('Error in processOsQuestion:', error);
    
    // Destroy any existing notification before showing error
    helpers.destroyNotificationWindow();
    
    // Wait to ensure previous notification is completely destroyed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    helpers.createOsNotificationWindow('response', 'Erro ao gerar resposta.');
  }
}
