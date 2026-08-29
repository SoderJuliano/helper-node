// main/helpers/screenshot.js
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
  app, execPromise
} = require('../globals.js');

helpers.captureScreen = async function() {
  // Check if OS integration mode is active
  const isOsIntegration = configService.getOsIntegrationStatus();
  
  if (isOsIntegration) {
    // Em COSMIC/Wayland o portal pode ser inconsistente com tools externas.
    // Tentamos primeiro a captura nativa via Electron desktopCapturer; se
    // o usuário pediu Ctrl+Shift+X explicitamente, ainda deixamos o fluxo
    // legacy abaixo rodar como fallback.
    const isCosmic = process.env.XDG_CURRENT_DESKTOP === "COSMIC";
    if (isCosmic) {
      console.log('📸 COSMIC detectado: usando captura nativa por seleção');
      try { await helpers.captureRegionNative(); return; } catch (e) {
        console.error('Captura nativa falhou, caindo no fluxo legacy:', e);
      }
    }
    
    // OS Integration Mode - show notification and process through AI
    console.log('📸 Captura iniciada no modo de integração com SO');
    
    // Show capture window while screenshot tool is running
    helpers.createCaptureWindow();
    
    const tmpPng = path.join(app.getPath("temp"), `helpernode-shot-${Date.now()}.png`);
    const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
    
    try {
      let screenshotSuccess = false;
      
      // Priority 1: Wayland - use external script for better compatibility
      if (isWayland && await helpers.commandExists("grim") && await helpers.commandExists("slurp")) {
        helpers.destroyCaptureWindow();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        try {
          const scriptPath = path.join(ROOT_DIR, 'capture-screenshot.sh');
          await execPromise(`bash "${scriptPath}" "${tmpPng}"`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } catch (err) {
          console.error('Erro ao capturar:', err.message);
          helpers.destroyCaptureWindow();
          helpers.createOsNotificationWindow('response', 'Captura cancelada ou falhou.');
          return;
        }
      } 
      // Priority 2: Hyprland specific (if not caught above)
      else if (helpers.isHyprland() && await helpers.commandExists("grim") && await helpers.commandExists("slurp")) {
        const { stdout: region } = await execPromise("slurp -f '%x %y %w %h'");
        const [x, y, w, h] = region.trim().split(/\s+/);
        await execPromise(`grim -g '${x},${y} ${w}x${h}' '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      }
      // Priority 3: gnome-screenshot (works better on X11)
      else if (await helpers.commandExists("gnome-screenshot")) {
        await execPromise(`gnome-screenshot -a -f '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // Priority 4: Wayland with just grim (full screen)
      else if (isWayland && await helpers.commandExists("grim")) {
        await execPromise(`grim '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // Priority 5: ImageMagick import (X11 fallback)
      else if (await helpers.commandExists("import")) {
        await execPromise(`import -window root '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // No tool found
      else {
        helpers.destroyCaptureWindow();
        helpers.createOsNotificationWindow('response', 'Nenhuma ferramenta de captura encontrada.');
        return;
      }
      
      if (screenshotSuccess) {
        // Destroy capture window and show loading
        helpers.destroyCaptureWindow();
        helpers.createOsNotificationWindow('loading', 'Processando imagem...');
        
        try {
          await fs.access(tmpPng);
          
          // Validar se o arquivo tem um tamanho mínimo
          const stats = await fs.stat(tmpPng);
          if (stats.size < 100) {
            throw new Error('Screenshot file too small, probably corrupted');
          }
          
          // Read and convert to base64
          const imgBuffer = await fs.readFile(tmpPng);
          const base64Image = `data:image/png;base64,${imgBuffer.toString('base64')}`;
          
          if (helpers.isBatchScreenshotModeActive && helpers.isBatchScreenshotModeActive()) {
            helpers.destroyNotificationWindow();
            await helpers.addScreenshotToBatch(base64Image, imgBuffer);
            return;
          }

          if (edition.isLite()) {
            // Lite (100% online): sem OCR local — manda a imagem direto pro
            // gpt-4o (visão), que lê o texto e responde no mesmo fluxo.
            console.log('🔍 Lite: captura → visão gpt-4o (sem OCR local)');
            helpers.createOsNotificationWindow('loading', 'Enviando para IA...');
            await helpers.processOsQuestion('', base64Image, { forceVision: true });
          } else {
            // Extract text with OCR
            console.log('🔍 Extraindo texto da captura...');
            const ocrText = await TesseractService.getTextFromImage(base64Image);

            if (!ocrText || ocrText.trim().length === 0) {
              console.warn('⚠️ Nenhum texto encontrado na captura');
              helpers.destroyNotificationWindow();
              await new Promise(resolve => setTimeout(resolve, 200));
              helpers.createOsNotificationWindow('response', 'Nenhum texto encontrado na imagem.');
              return;
            }

            console.log('📝 Texto extraído da captura:', ocrText);

            // Send to AI
            helpers.createOsNotificationWindow('loading', 'Enviando para IA...');
            await helpers.processOsQuestion(ocrText);
          }
          
        } catch (e) {
          console.error("Erro ao processar captura:", e);
          helpers.destroyNotificationWindow();
          await new Promise(resolve => setTimeout(resolve, 200));
          helpers.createOsNotificationWindow('response', 'Erro ao processar a captura.');
        } finally {
          // Clean up temp file
          try {
            await fs.unlink(tmpPng);
          } catch (unlinkError) {
            console.error('Erro ao deletar arquivo temporário:', unlinkError);
          }
        }
      } else {
        helpers.destroyCaptureWindow();
        helpers.createOsNotificationWindow('response', 'Falha ao capturar a tela.');
      }
    } catch (err) {
      console.error("Capture failed:", err);
      helpers.destroyCaptureWindow();
      helpers.createOsNotificationWindow('response', 'Erro na captura da tela.');
    }
    
  } else {
    // Normal Mode - send to main window
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("screen-capturing", true);

      const tmpPng = path.join(app.getPath("temp"), `helpernode-shot-${Date.now()}.png`);
      const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
      try {
        let screenshotSuccess = false;
        if (await helpers.commandExists("gnome-screenshot")) {
          await execPromise(`gnome-screenshot -a -f '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (helpers.isHyprland() && await helpers.commandExists("grim") && await helpers.commandExists("slurp")) {
          const { stdout: region } = await execPromise("slurp -f '%x %y %w %h'");
          const [x, y, w, h] = region.trim().split(/\s+/);
          await execPromise(`grim -g '${x},${y} ${w}x${h}' '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (isWayland && await helpers.commandExists("grim")) {
          await execPromise(`grim '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (await helpers.commandExists("import")) {
          await execPromise(`import -window root '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else {
          // Sem ferramenta de sistema: tenta método interno
          try {
            const data = await TesseractService.captureAndProcessScreenshot(state.mainWindow);
            console.log("OCR Data (internal):", data);
            if (data) return;
            throw new Error("Internal capture returned empty data");
          } catch (error) {
            console.error("Internal capture failed:", error);
            throw new Error("No screenshot tools available");
          }
        }

        // After successful capture and before sending result, read file as base64
        if (screenshotSuccess) {
          const imgBuffer = await fs.readFile(tmpPng);
          const base64Image = `data:image/png;base64,${imgBuffer.toString('base64')}`;

          if (helpers.isBatchScreenshotModeActive && helpers.isBatchScreenshotModeActive()) {
            await helpers.addScreenshotToBatch(base64Image, imgBuffer);
            return;
          }

          // Proceed with OCR only if file exists
          try {
            await fs.access(tmpPng);
            
            // Validar se o arquivo tem um tamanho mínimo
            const stats = await fs.stat(tmpPng);
            if (stats.size < 100) {
              throw new Error('Screenshot file too small, probably corrupted');
            }
            
            const ocrText = await TesseractService.getTextFromImage(base64Image);
            state.mainWindow.webContents.send("ocr-result", { 
              text: ocrText || '', 
              screenshotPath: tmpPng, 
              base64Image 
            });
          } catch (e) {
            console.error("Screenshot file not accessible for OCR:", e);
            
            // Enviar resultado com erro em vez de texto vazio
            state.mainWindow.webContents.send("ocr-result", { 
              text: "", 
              screenshotPath: tmpPng, 
              base64Image,
              error: "Não foi possível processar a imagem" 
            });
          }
        } else {
          state.mainWindow.webContents.send("screen-capturing", false);
        }
      } catch (err) {
        console.error("Capture failed:", err);
      } finally {
        state.mainWindow.webContents.send("screen-capturing", false);
      }
    }
  }
}

helpers.resolveScreenshotDir = function() {
  // Retorna TODAS as pastas existentes pra monitorar em paralelo
  return SCREENSHOT_DIRS.filter(dir => {
    try { return fs2.existsSync(dir) && fs2.statSync(dir).isDirectory(); } catch (_) { return false; }
  });
}

helpers.startScreenshotFolderMonitoring = function() {
  if (helpers.isTranslationOnlyMode()) {
    console.log('[mutex] screenshotFolderMonitoring suprimido — Translation Assistant ativo');
    return;
  }
  if (state.screenshotFolderWatcher) return; // já ativo

  const watchDirs = helpers.resolveScreenshotDir();
  if (!watchDirs.length) {
    // nenhuma pasta existe ainda — tenta criar ~/Imagens e monitorar
    const fallback = path.join(os.homedir(), 'Imagens');
    try { fs2.mkdirSync(fallback, { recursive: true }); } catch (_) {}
    watchDirs.push(fallback);
  }

  console.log(`[screenshot-watch] Monitorando ${watchDirs.length} pasta(s): ${watchDirs.join(', ')}`);

  // Baseline global: ignora arquivos já existentes em todas as pastas
  const knownFiles = new Set();
  for (const dir of watchDirs) {
    try {
      fs2.readdirSync(dir)
        .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .forEach(f => knownFiles.add(path.join(dir, f)));
    } catch (_) {}
  }
  console.log(`[screenshot-watch] Baseline: ${knownFiles.size} arquivo(s) ignorado(s)`);

  const watchers = [];

  const handleNewFile = async (dir, filename) => {
    if (!filename) return;
    if (!/\.(png|jpg|jpeg|webp)$/i.test(filename)) return;
    const filePath = path.join(dir, filename);
    if (knownFiles.has(filePath)) return;

    // Aguarda até 2s para o arquivo ser escrito completamente
    let attempts = 0;
    while (attempts < 20) {
      await new Promise(r => setTimeout(r, 100));
      try {
        const stat = fs2.statSync(filePath);
        if (stat.size > 0) break;
      } catch (_) { return; }
      attempts++;
    }
    if (!fs2.existsSync(filePath)) return;

    knownFiles.add(filePath);

    const isPrintModeEnabled = configService.getPrintModeStatus();
    if (!isPrintModeEnabled) return;

    try {
      const buf = fs2.readFileSync(filePath);
      const base64Image = `data:image/png;base64,${buf.toString('base64')}`;
      const hash = helpers.calculateImageHash(buf);
      const now = Date.now();

      if (state.lastProcessedImageHash === hash && state.lastProcessedTimestamp && (now - state.lastProcessedTimestamp) < IMAGE_COOLDOWN_MS) {
        console.log('[screenshot-watch] 🚫 imagem já processada, ignorando');
        return;
      }
      if (state.isProcessingImage) {
        console.log('[screenshot-watch] 🔒 já processando outra imagem, ignorando');
        return;
      }

      state.lastProcessedImageHash = hash;
      state.lastProcessedTimestamp = now;
      state.lastClipboardImageHash = hash;

      console.log(`[screenshot-watch] 📸 novo screenshot: ${filePath}`);
      await helpers.processNewClipboardImage(base64Image);
    } catch (e) {
      console.error('[screenshot-watch] erro ao processar arquivo:', e.message);
    }
  };

  for (const dir of watchDirs) {
    try {
      const w = fs2.watch(dir, (eventType, filename) => {
        if (eventType === 'rename') handleNewFile(dir, filename);
      });
      w.on('error', (e) => console.error(`[screenshot-watch] erro em ${dir}:`, e.message));
      watchers.push(w);
    } catch (e) {
      console.error(`[screenshot-watch] falha ao observar ${dir}:`, e.message);
    }
  }

  // Guarda array de watchers como objeto com close()
  state.screenshotFolderWatcher = {
    close: () => watchers.forEach(w => { try { w.close(); } catch (_) {} })
  };
  state.screenshotFolderWatcherPath = watchDirs.join(', ');
}

helpers.stopScreenshotFolderMonitoring = function() {
  if (state.screenshotFolderWatcher) {
    try { state.screenshotFolderWatcher.close(); } catch (_) {}
    state.screenshotFolderWatcher = null;
    console.log('[screenshot-watch] 🛑 Monitoramento de pasta de screenshots parado');
  }
}
