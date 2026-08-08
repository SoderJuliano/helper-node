// main/helpers/capture.js
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
  app, BrowserWindow, screen, desktopCapturer, execPromise
} = require('../globals.js');

helpers.commandExists = function(cmd) {
  return new Promise((resolve) => {
    exec(`command -v ${cmd}`, (error) => resolve(!error));
  });
}

helpers.captureFullScreenAuto = async function() {
  const osOn = configService.getOsIntegrationStatus();
  const printOn = configService.getPrintModeStatus();
  const taCurrentlyActive = translationAssistant.isActive() &&
    state.translationOverlayWindow && !state.translationOverlayWindow.isDestroyed();

  // Pula se nenhum modo está ativo para tratar o screenshot
  if (!osOn && !printOn && !taCurrentlyActive) { return; }

  const tmpDir = path.join(app.getPath('temp'), `helpernode-shot-${Date.now()}`);
  const tmpPng = path.join(app.getPath('temp'), `helpernode-shot-${Date.now()}.png`);
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
  const isCosmic = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase().includes('COSMIC');
  let success = false;
  let capturedPath = null;

  // Helper: tenta um comando que escreve direto em tmpPng
  async function tryCmd(label, cmd) {
    try {
      await execPromise(cmd);
      const ok = fs2.existsSync(tmpPng);
      if (ok) console.log(`📸 captura via ${label} OK`);
      capturedPath = ok ? tmpPng : null;
      return ok;
    } catch (e) {
      console.warn(`📸 ${label} falhou: ${(e && e.stderr ? e.stderr : e.message || e).toString().trim()}`);
      try { if (fs2.existsSync(tmpPng)) fs2.unlinkSync(tmpPng); } catch (_) {}
      return false;
    }
  }

  try {
    // === ORDEM DE PRIORIDADE — TODAS STEALTH (sem prompt do portal) ===

    // 0) Windows/macOS: desktopCapturer captura SILENCIOSAMENTE (sem diálogo do
    //    portal, que só existe no Linux/Wayland). A janela do helper fica fora
    //    da gravação via setContentProtection — efetivo aqui, diferente do Linux.
    //    Este é o caminho stealth NATIVO dessas plataformas.
    if (process.platform !== 'linux') {
      try {
        capturedPath = await platformScreenCapture.captureFullScreenToFile(tmpPng);
        success = !!capturedPath;
      } catch (e) {
        console.warn('📸 desktopCapturer (win/mac) falhou:', (e && e.message) || e);
      }
    }

    // 1) COSMIC: cosmic-screenshot
    //    Sintaxe correta: --interactive=false --notify=false --save-dir <dir>
    //    A ferramenta gera um arquivo dentro de save-dir; pegamos o mais recente.
    if (isCosmic) {
      if (await helpers.commandExists('cosmic-screenshot')) {
        try {
          await fs.mkdir(tmpDir, { recursive: true });
          await execPromise(
            `cosmic-screenshot --interactive=false --notify=false --save-dir '${tmpDir}'`
          );
          // Encontra o arquivo gerado (PNG mais recente no diretório)
          const files = (await fs.readdir(tmpDir))
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => path.join(tmpDir, f));
          if (files.length > 0) {
            capturedPath = files[0];
            success = true;
            console.log('📸 captura via cosmic-screenshot OK:', capturedPath);
          }
        } catch (e) {
          console.warn('📸 cosmic-screenshot falhou:',
            (e && e.stderr ? e.stderr : e.message || e).toString().trim());
        }
      } else {
        // STEALTH NÃO É POSSÍVEL EM COSMIC SEM ESTA FERRAMENTA.
        // O Electron desktopCapturer abriria o diálogo "Compartilhar tela",
        // que é justamente o que queremos evitar. Falhamos com instrução clara.
        if (osOn) {
          helpers.createOsNotificationWindow('response',
            '<b>cosmic-screenshot</b> não está instalado.<br>' +
            'É necessário para captura silenciosa no COSMIC.<br><br>' +
            'Instale com:<br><code>sudo apt install cosmic-screenshot</code>');
        } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('transcription-error',
            'cosmic-screenshot não está instalado. Instale: sudo apt install cosmic-screenshot');
        }
        return;
      }
    }

    // 2) Wayland NÃO-COSMIC (Sway/Hyprland/Wayfire): grim
    if (!success && isWayland && !isCosmic && await helpers.commandExists('grim')) {
      success = await tryCmd('grim', `grim '${tmpPng}'`);
    }

    // 3) X11: gnome-screenshot (sem prompt, captura full-screen)
    if (!success && !isWayland && await helpers.commandExists('gnome-screenshot')) {
      success = await tryCmd('gnome-screenshot', `gnome-screenshot -f '${tmpPng}'`);
    }

    // 4) X11: spectacle (KDE)
    if (!success && !isWayland && await helpers.commandExists('spectacle')) {
      success = await tryCmd('spectacle', `spectacle -b -n -o '${tmpPng}'`);
    }

    // 5) X11: scrot
    if (!success && !isWayland && await helpers.commandExists('scrot')) {
      success = await tryCmd('scrot', `scrot -o '${tmpPng}'`);
    }

    // 6) X11: ImageMagick import
    if (!success && !isWayland && await helpers.commandExists('import')) {
      success = await tryCmd('import', `import -window root '${tmpPng}'`);
    }

    // ⚠️ NÃO usamos desktopCapturer do Electron como fallback:
    //    em Wayland ele SEMPRE dispara o diálogo "Compartilhar a tela"
    //    do XDG Portal — quebra o stealth e exige clique do usuário.
    //    Melhor falhar com mensagem clara do que vazar a presença do app.

    if (!success) {
      const hint = isCosmic
        ? 'Instale: <code>sudo apt install cosmic-screenshot</code>'
        : isWayland
          ? 'Instale: <code>sudo apt install grim</code>'
          : 'Instale: <code>sudo apt install gnome-screenshot</code>';
      if (osOn) {
        helpers.createOsNotificationWindow('response',
          `Não foi possível capturar a tela silenciosamente.<br>${hint}`);
      } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('transcription-error',
          `Não foi possível capturar a tela. ${hint.replace(/<[^>]+>/g, '')}`);
      }
      return;
    }

    // Loading: a overlay flutuante é EXCLUSIVA do modo integrado (OS Integration).
    // No modo janela (print mode) o indicador de carregamento é o robot da própria
    // janela principal — criar a overlay aqui deixava o gif girando pra sempre,
    // pois nada a fechava fora do fluxo integrado.
    if (osOn) helpers.createOsNotificationWindow('loading', 'Analisando captura...');

    const imgBuffer = await fs.readFile(capturedPath);
    // limpeza
    try { await fs.unlink(capturedPath); } catch (_) {}
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}

    // Comprime ANTES de qualquer processamento. Reduz tráfego pra OpenAI
    // em ~40x sem perda perceptivél de qualidade visual / OCR.
    const compressed = await helpers.compressImageForVision(imgBuffer, 'fullscreen');
    const base64 = compressed.dataUrl;

    // Quando Translation Assistant está ativo, usa análise de entrevista dedicada
    // e injeta o resultado diretamente no overlay — sem OCR, sem processOsQuestion.
    if (taCurrentlyActive) {
      if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
        try { state.osNotificationWindow.close(); } catch (_) {}
        state.osNotificationWindow = null;
      }
      const apiKey = configService.getOpenIaToken();
      if (!apiKey) {
        helpers.sendToTranslationOverlay('translation-result', {
          type: 'image', mode: 'image',
          transcript: '❌ API key não configurada. Configure em Ajustes.',
          response: '',
        });
        return;
      }
      helpers.sendToTranslationOverlay('translation-result', {
        type: 'image', mode: 'image',
        transcript: '📸 Analisando captura de tela...',
        response: '',
      });
      try {
        const analysis = await analyzeInterviewImage(base64, apiKey);
        helpers.sendToTranslationOverlay('translation-result', {
          type: 'image', mode: 'image',
          transcript: '',
          response: analysis,
        });
      } catch (err) {
        console.error('[screenshot-interview] erro:', err.message);
        helpers.sendToTranslationOverlay('translation-result', {
          type: 'image', mode: 'image',
          transcript: `❌ Erro ao analisar imagem: ${err.message}`,
          response: '',
        });
      }
      return;
    }

    // TA ativo em modo janela (sem overlay) → análise de entrevista via visão, resultado no chat
    if (!osOn && translationAssistant.isActive() && state.mainWindow && !state.mainWindow.isDestroyed()) {
      const apiKey = configService.getOpenIaToken();
      if (!apiKey) {
        if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
          try { state.osNotificationWindow.close(); } catch (_) {}
          state.osNotificationWindow = null;
        }
        state.mainWindow.webContents.send('transcription-error', '❌ API key não configurada. Configure em Ajustes.');
        return;
      }
      // Mantém a notificação de loading visível como feedback enquanto analisa
      try {
        const analysis = await analyzeInterviewImage(base64, apiKey);
        if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
          try { state.osNotificationWindow.close(); } catch (_) {}
          state.osNotificationWindow = null;
        }
        state.mainWindow.webContents.send('openai-final-response', { resposta: analysis });
      } catch (err) {
        console.error('[screenshot-interview-window] erro:', err.message);
        if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
          try { state.osNotificationWindow.close(); } catch (_) {}
          state.osNotificationWindow = null;
        }
        state.mainWindow.webContents.send('transcription-error', `❌ Erro ao analisar imagem: ${err.message}`);
      }
      return;
    }

    // Delega TODO o trabalho (OCR + roteamento texto/visão + IA) para
    // processOsQuestion. NÃO montamos prompt aqui — evita duplicação de OCR.
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      await helpers.processOsQuestion('', base64, { forceVision: true });
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      // Modo janela: roda OCR só pra exibir; manda a IMAGEM pro renderer (que
      // decide visão vs texto). `base64` já é um data URL completo — não
      // re-prefixar, e a chave é `base64Image` (o que o handler ocr-result lê).
      let ocrText = '';
      try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
      state.mainWindow.webContents.send('ocr-result', {
        text: ocrText,
        base64Image: base64,
      });
    }
  } catch (e) {
    console.error('captureFullScreenAuto failed:', e);
    // Erro: overlay só no modo integrado; no modo janela avisa a janela principal.
    if (osOn) {
      helpers.createOsNotificationWindow('response', 'Erro ao capturar a tela.');
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('transcription-error', 'Erro ao capturar a tela.');
    }
  }
}

helpers.captureRegionNative = async function() {
  // Evita reentrância
  if (state.regionSelectWindow && !state.regionSelectWindow.isDestroyed()) {
    state.regionSelectWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.size;
  const sf = display.scaleFactor || 1;

  // 1) Captura a tela inteira via desktopCapturer (funciona em X11/Wayland via portal)
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(dw * sf), height: Math.round(dh * sf) },
    });
  } catch (e) {
    console.error('desktopCapturer falhou:', e);
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('response', 'Não foi possível acessar a captura de tela.');
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('transcription-error', 'Não foi possível acessar a captura de tela.');
    }
    return;
  }
  if (!sources || sources.length === 0) {
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('response', 'Nenhuma fonte de tela disponível.');
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('transcription-error', 'Nenhuma fonte de tela disponível.');
    }
    return;
  }
  // Pega a primária (Linux geralmente devolve a principal primeiro)
  const screenSource = sources[0];
  const fullImage = screenSource.thumbnail;
  state.regionCaptureBuffer = fullImage.toPNG();

  // 2) Abre overlay transparente fullscreen para seleção
  state.regionSelectWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: dw,
    height: dh,
    backgroundColor: '#00000000',
    frame: false,
    transparent: true,
    thickFrame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreen: true,
    focusable: true, // precisa receber clique/drag
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(ROOT_DIR, 'preload.js'),
    },
  });
  // Stealth no screen-share
  helpers.applyStealthProtection(state.regionSelectWindow);
  state.regionSelectWindow.setAlwaysOnTop(true, 'screen-saver');

  await state.regionSelectWindow.loadFile(path.join(ROOT_DIR, 'os-integration', 'notifications', 'regionSelect.html'));

  state.regionSelectWindow.on('closed', () => {
    state.regionSelectWindow = null;
  });
}
