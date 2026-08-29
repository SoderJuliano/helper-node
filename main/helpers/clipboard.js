// main/helpers/clipboard.js
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
  clipboard, execPromise, appConfig, Notification
} = require('../globals.js');

helpers.calculateImageHash = function(imageBuffer) {
  return crypto.createHash('md5').update(imageBuffer).digest('hex');
}

helpers.initializeClipboardBaseline = async function() {
  try {
    console.log('📋 Tentando inicializar baseline do clipboard...');
    let hasImage = false;
    let imageData = null;

    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        const nativeImg = clipboard.readImage();
        if (!nativeImg.isEmpty()) {
          const pngBuf = nativeImg.toPNG();
          if (pngBuf && pngBuf.length > 0) {
            hasImage = true;
            imageData = 'data:image/png;base64,' + pngBuf.toString('base64');
          }
        }
      } catch (e) {
        console.log('📋 Clipboard nativo erro:', e.message);
      }
    } else {
      const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
      if (isWayland) {
        try {
          const wlResult = await execPromise('timeout 2 wl-paste --list-types 2>/dev/null || echo ""');
          const types = (wlResult && wlResult.stdout || '').toLowerCase();
          const mime = helpers.pickImageMime(types);
          if (mime) {
            const imageResult = await execPromise(`timeout 3 wl-paste --type ${mime} | base64 -w 0 2>/dev/null || echo ""`);
            if (imageResult && imageResult.stdout.trim()) {
              hasImage = true;
              imageData = `data:${mime};base64,` + imageResult.stdout.trim();
            }
          } else if (types.trim()) {
            console.log('📋 [baseline] clipboard tipos disponíveis (sem imagem):', types.split('\n').filter(Boolean).join(', '));
          }
        } catch (e) {
          console.log('📋 Wayland clipboard não disponível, tentando X11...');
        }
      }
      
      if (!hasImage) {
        try {
          const xclipResult = await execPromise('timeout 2 xclip -selection clipboard -t TARGETS -o 2>/dev/null || echo ""');
          const types = (xclipResult && xclipResult.stdout || '').toLowerCase();
          const mime = helpers.pickImageMime(types);
          if (mime) {
            const imageResult = await execPromise(`timeout 3 xclip -selection clipboard -t ${mime} -o | base64 -w 0 2>/dev/null || echo ""`);
            if (imageResult && imageResult.stdout.trim()) {
              hasImage = true;
              imageData = `data:${mime};base64,` + imageResult.stdout.trim();
            }
          } else if (types.trim()) {
            console.log('📋 [baseline] X11 clipboard tipos (sem imagem):', types.split('\n').filter(Boolean).join(', '));
          }
        } catch (e) {
          console.log('📋 X11 clipboard não disponível');
        }
      }
    }
    
    if (hasImage && imageData) {
      const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
      const currentHash = helpers.calculateImageHash(Buffer.from(base64Data, 'base64'));
      state.lastClipboardImageHash = currentHash;
      // CRITICAL: marca a imagem que ja estava no clipboard como "recem-processada"
      // pra evitar que ela dispare auto-envio quando o monitor (re)inicia ao trocar
      // de modo (Normal <-> OS Integration). Sem isso, abrir Ctrl+I em OS mode com
      // uma imagem antiga no clipboard dispara OCR+IA dessa imagem velha.
      state.lastProcessedImageHash = currentHash;
      state.lastProcessedTimestamp = Date.now();
      console.log('📋 Clipboard baseline inicializado:', currentHash.substring(0, 8));
    } else {
      console.log('📋 Nenhuma imagem no clipboard para baseline');
    }
  } catch (error) {
    console.log('📋 Baseline falhou, mas não é crítico:', error.message);
    // Não é crítico, sistema funciona sem baseline
  }
}

helpers.startWaylandClipboardWatch = function(triggerCheck) {
  if (state.clipboardWatchProc) { try { state.clipboardWatchProc.kill('SIGTERM'); } catch (_) {} state.clipboardWatchProc = null; }
  if (process.platform !== 'linux' || process.env.XDG_SESSION_TYPE !== 'wayland') return;
  try {
    // 'true' como comando: só queremos a notificação de mudança, não o conteúdo
    state.clipboardWatchProc = spawn('wl-paste', ['--watch', 'true'], { stdio: ['ignore', 'pipe', 'pipe'] });
    state.clipboardWatchProc.stdout.on('data', () => triggerCheck && triggerCheck());
    state.clipboardWatchProc.on('error', (e) => console.log('📋 wl-paste --watch indisponível:', e.message));
    state.clipboardWatchProc.on('exit', (code) => {
      console.log('📋 wl-paste --watch encerrou (code=' + code + ')');
      state.clipboardWatchProc = null;
    });
    console.log('📋 wl-paste --watch ativo (event-driven, não precisa de foco da app)');
  } catch (e) {
    console.log('📋 falha ao iniciar wl-paste --watch:', e.message);
  }
}

helpers.startClipboardMonitoring = function() {
  if (helpers.isTranslationOnlyMode()) {
    console.log('[mutex] clipboardMonitoring suprimido — Translation Assistant ativo');
    return;
  }
  if (state.clipboardMonitoringInterval) {
    clearInterval(state.clipboardMonitoringInterval);
  }

  console.log('🎯 Iniciando monitoramento NATIVO de clipboard para novas imagens...');
  
  // Initialize with current clipboard content to avoid processing existing images
  helpers.initializeClipboardBaseline();

  // Função de checagem extraída pra ser chamada tanto pelo polling quanto
  // pelo wl-paste --watch (Wayland event-driven).
  const checkClipboardNow = async () => {
    try {
      const isPrintModeEnabled = configService.getPrintModeStatus();
      if (!isPrintModeEnabled) return;
      
      let hasImage = false;
      let imageData = null;
      let currentHash = null;
      
      if (process.platform === 'win32' || process.platform === 'darwin') {
        try {
          const nativeImg = clipboard.readImage();
          if (!nativeImg.isEmpty()) {
            const pngBuf = nativeImg.toPNG();
            if (pngBuf && pngBuf.length > 0) {
              hasImage = true;
              imageData = 'data:image/png;base64,' + pngBuf.toString('base64');
              currentHash = helpers.calculateImageHash(pngBuf);
            }
          }
        } catch (e) {
          // Native clipboard read failed
        }
      } else {
        const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
        if (isWayland) {
          // Try Wayland first
          try {
            const wlResult = await execPromise('wl-paste --list-types 2>/dev/null').catch(() => null);
            const types = (wlResult && wlResult.stdout || '').toLowerCase();
            const mime = helpers.pickImageMime(types);
            if (mime) {
              try {
                const imageResult = await execPromise(`wl-paste --type ${mime} | base64 -w 0`);
                if (imageResult && imageResult.stdout && imageResult.stdout.trim()) {
                  hasImage = true;
                  imageData = `data:${mime};base64,` + imageResult.stdout.trim();
                  const base64Data = imageResult.stdout.trim();
                  currentHash = helpers.calculateImageHash(Buffer.from(base64Data, 'base64'));
                }
              } catch (extractError) {
                // Silent error handling for Wayland
              }
            }
          } catch (e) {
            // Silent error handling
            // Fallback to X11 if Wayland fails
          }
        }
        
        // Try X11 if not Wayland or if Wayland failed
        if (!hasImage) {
          try {
            const xclipResult = await execPromise('xclip -selection clipboard -t TARGETS -o 2>/dev/null').catch(() => null);
            const types = (xclipResult && xclipResult.stdout || '').toLowerCase();
            const mime = helpers.pickImageMime(types);
            if (mime) {
              const imageResult = await execPromise(`xclip -selection clipboard -t ${mime} -o | base64 -w 0`).catch(() => null);
              if (imageResult && imageResult.stdout) {
                hasImage = true;
                imageData = `data:${mime};base64,` + imageResult.stdout.trim();
                const base64Data = imageResult.stdout.trim();
                currentHash = helpers.calculateImageHash(Buffer.from(base64Data, 'base64'));
              }
            }
          } catch (e) {
            // Silent error handling
          }
        }
      }
      
      if (hasImage && imageData && currentHash) {
        // Check if this is the same image as before
        if (currentHash === state.lastClipboardImageHash) {
          // Same image still in clipboard, no need to log repeatedly
          return;
        }
        
        // Check if this image was recently processed (cooldown check)
        const now = Date.now();
        const isRecentlyProcessed = state.lastProcessedImageHash === currentHash && 
                                   state.lastProcessedTimestamp && 
                                   (now - state.lastProcessedTimestamp) < IMAGE_COOLDOWN_MS;
        
        if (isRecentlyProcessed) {
          console.log('🚫 Image recently processed, waiting for cooldown period...');
          state.lastClipboardImageHash = currentHash; // Update clipboard hash but don't process
          return;
        }
        
        // This is a new image or cooldown period has passed
        if (currentHash !== state.lastClipboardImageHash) {
          // Check if already processing an image
          if (state.isProcessingImage) {
            console.log('🔒 Já processando uma imagem, aguardando...');
            state.lastClipboardImageHash = currentHash; // Update hash but don't process
            return;
          }
          
          console.log('📸 NOVA IMAGEM DETECTADA no clipboard! Processando automaticamente...');
          
          // Sinaliza loading no renderer (robot.gif) ate IA responder
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            state.mainWindow.webContents.send('screen-capturing', true);
          }
          
          // Set processing lock
          state.isProcessingImage = true;
          
          // Check if OS integration mode is enabled
          const isOsIntegration = configService.getOsIntegrationStatus();
          if (isOsIntegration) {
            helpers.createOsNotificationWindow('loading', 'Nova imagem detectada! Processando...');
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({
              title: 'Helper-Node',
              body: 'Nova imagem detectada! Processando...',
              silent: true,
            }).show();
          }
          
          // Mark as processed with timestamp
          state.lastProcessedImageHash = currentHash;
          state.lastProcessedTimestamp = now;
          
          await helpers.processNewClipboardImage(imageData);
        }
        
        state.lastClipboardImageHash = currentHash;
      } else {
        // No image found, reset clipboard hash
        if (state.lastClipboardImageHash !== null) {
          console.log('🔄 No image in clipboard anymore');
          state.lastClipboardImageHash = null;
        }
      }
    } catch (error) {
      console.error('❌ Erro no monitoramento de clipboard:', error);
    }
  }; // fim checkClipboardNow

  // Polling: 2s em X11, 5s em Wayland (Wayland confia no --watch pra notificação rápida).
  const pollMs = process.env.XDG_SESSION_TYPE === 'wayland' ? 5000 : 2000;
  state.clipboardMonitoringInterval = setInterval(checkClipboardNow, pollMs);

  // Wayland: instala watcher event-driven (dispara checkClipboardNow imediatamente em qualquer mudança).
  helpers.startWaylandClipboardWatch(() => {
    console.log('📋 wl-paste --watch: clipboard mudou → verificando...');
    checkClipboardNow();
  });
}

helpers.stopClipboardMonitoring = function() {
  if (state.clipboardMonitoringInterval) {
    clearInterval(state.clipboardMonitoringInterval);
    state.clipboardMonitoringInterval = null;
    state.lastClipboardImageHash = null;
    console.log('🛑 Monitoramento de clipboard parado');
  }
  if (state.clipboardWatchProc) {
    try { state.clipboardWatchProc.kill('SIGTERM'); } catch (_) {}
    state.clipboardWatchProc = null;
  }
  
  // Parar também o monitoramento de captura
  helpers.stopCaptureToolMonitoring();
  helpers.stopScreenshotFolderMonitoring();
}

helpers.processNewClipboardImage = async function(base64Image) {
  try {
    console.log('🎯 Processando nova imagem do clipboard...');

    // Se a fila de capturas estiver aberta, anexa a imagem à fila
    if (helpers.isBatchScreenshotModeActive && helpers.isBatchScreenshotModeActive()) {
      if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
        try { state.osNotificationWindow.close(); } catch (_) {}
        state.osNotificationWindow = null;
      }
      await helpers.addScreenshotToBatch(base64Image);
      return;
    }
    
    // Check if OS integration mode is enabled
    const isOsIntegration = configService.getOsIntegrationStatus();
    
    // A primeira notificação já foi exibida no clipboard monitoring
    // Não precisamos de segunda notificação de loading
    
    // Usar o TesseractService existente
    const text = await TesseractService.getTextFromImage(base64Image);
    
    if (!text || text.trim().length === 0) {
      console.warn('⚠️ OCR vazio — mandando direto pra visão da IA');

      if (isOsIntegration) {
        helpers.createOsNotificationWindow('loading', 'Analisando imagem (visão)...');
        try {
          await helpers.processOsQuestion('', base64Image, { forceVision: true });
        } catch (error) {
          console.error('Error in helpers.processOsQuestion(vision fallback):', error);
          if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
            state.osNotificationWindow.close();
            state.osNotificationWindow = null;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
          helpers.createOsNotificationWindow('response', 'Erro ao analisar imagem.');
        }
      } else {
        // Fora do OS mode: tambem manda visao se o renderer principal estiver disponivel
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('process-image-vision', base64Image);
        }
      }
      return;
    }
    
    console.log('📝 Texto extraído:', text);
    
    // Notificação de envio para IA
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('loading', 'Enviando para IA...');
      // Process using OS integration mode
      // CRITICAL: passa a IMAGEM também (não só OCR). Capturas de UI/canvas/quiz
      // geram OCR vazio ou ruim — o auto-router em processOsQuestion decide
      // se manda só texto ou visão. Sem isso, OS mode silenciosamente "perde"
      // capturas onde o OCR não pega o conteúdo.
      try {
        await helpers.processOsQuestion(text, base64Image);
      } catch (error) {
        console.error('Error in processOsQuestion for clipboard image:', error);
        // Explicitly close any existing notification before showing error
        if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
          state.osNotificationWindow.close();
          state.osNotificationWindow = null;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        helpers.createOsNotificationWindow('response', 'Erro ao processar imagem.');
      }
    } else {
      if (appConfig.notificationsEnabled && Notification.isSupported()) {
        new Notification({
          title: 'Helper-Node',
          body: 'Enviando para IA...',
          silent: true,
        }).show();
      }
      // Usar o método existente getIaResponse
      await helpers.getIaResponse(text);
    }
    
  } catch (error) {
    console.error('❌ Erro ao processar imagem do clipboard:', error);
    
    // Check if OS integration mode is enabled for error notification
    const isOsIntegration = configService.getOsIntegrationStatus();
    
    // Notificação de erro
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('response', 'Erro ao processar imagem');
    } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Erro ao processar imagem',
        silent: true,
      }).show();
    }
    
    // Enviar erro para o frontend se a janela estiver disponível
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('transcription-error', 'Erro ao processar imagem do clipboard');
    }
  } finally {
    // Always release the processing lock
    state.isProcessingImage = false;
    console.log('🔓 Lock de processamento liberado');
  }
}
