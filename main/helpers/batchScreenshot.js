// main/helpers/batchScreenshot.js
// Gerenciamento da fila de capturas (Multi-Screenshot Batch Collector).
// Permite agregar múltiplas imagens sequenciais com Ctrl+Shift+S e enviá-las juntas com Alt+S.

const {
  ROOT_DIR,
  path,
  state,
  helpers,
  configService,
  OpenAIService,
  GeminiCliProvider,
  ClaudeCliProvider,
  CopilotCliProvider,
  TesseractService,
  workspace,
  BrowserWindow,
  screen
} = require('../globals.js');

const imageAttachments = require('../../services/imageAttachments.js');

helpers.computeBatchOverlayBounds = function() {
  let display;
  try {
    const cursor = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(cursor);
  } catch (_) {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea;
  const width = 480;
  const height = 156;
  // Canto inferior direito (16px de margem)
  const x = Math.max(wa.x, wa.x + wa.width - width - 16);
  const y = Math.max(wa.y, wa.y + wa.height - height - 16);
  return { x, y, width, height };
};

helpers.createBatchScreenshotOverlay = function() {
  if (state.batchScreenshotWindow && !state.batchScreenshotWindow.isDestroyed()) {
    return state.batchScreenshotWindow;
  }

  const b = helpers.computeBatchOverlayBounds();

  state.batchScreenshotWindow = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    backgroundColor: '#00000000',
    frame: false,
    transparent: true,
    thickFrame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    hasShadow: false,
    show: false,
    title: 'helper-node-batch-screenshot',
    webPreferences: {
      preload: path.join(ROOT_DIR, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  state.batchScreenshotWindow.setAlwaysOnTop(true, 'screen-saver');
  try {
    state.batchScreenshotWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (_) {}

  helpers.applyStealthProtection(state.batchScreenshotWindow);

  state.batchScreenshotWindow.loadFile(
    path.join(ROOT_DIR, 'os-integration', 'notifications', 'multi-screenshot-overlay.html')
  );

  state.batchScreenshotWindow.on('closed', () => {
    state.batchScreenshotWindow = null;
  });

  return state.batchScreenshotWindow;
};

helpers.showBatchScreenshotOverlay = function() {
  const win = helpers.createBatchScreenshotOverlay();
  if (!win || win.isDestroyed()) return;

  const b = helpers.computeBatchOverlayBounds();
  try {
    win.setBounds(b);
  } catch (_) {}

  helpers.applyStealthProtection(win);

  try {
    if (typeof win.showInactive === 'function') {
      win.showInactive();
    } else {
      win.show();
    }
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
  } catch (_) {}

  // Sincroniza estado atual com a janela
  if (Array.isArray(state.batchScreenshots) && state.batchScreenshots.length > 0) {
    state.batchScreenshots.forEach(item => {
      try {
        win.webContents.send('batch-add-image', {
          id: item.id,
          base64Image: item.base64,
          timestamp: item.timestamp,
        });
      } catch (_) {}
    });
  }
};

helpers.hideBatchScreenshotOverlay = function() {
  if (state.batchScreenshotWindow && !state.batchScreenshotWindow.isDestroyed()) {
    try {
      state.batchScreenshotWindow.hide();
    } catch (_) {}
  }
};

helpers.isBatchScreenshotModeActive = function() {
  return !!(
    state.batchScreenshotWindow &&
    !state.batchScreenshotWindow.isDestroyed() &&
    state.batchScreenshotWindow.isVisible()
  );
};

helpers.toggleBatchScreenshot = function() {
  if (helpers.isBatchScreenshotModeActive()) {
    if (Array.isArray(state.batchScreenshots) && state.batchScreenshots.length > 0) {
      helpers.processBatchScreenshots();
    } else {
      helpers.hideBatchScreenshotOverlay();
    }
  } else {
    helpers.showBatchScreenshotOverlay();
  }
};

helpers.addScreenshotToBatch = async function(base64Image, rawBuffer = null) {
  if (!base64Image) return;
  if (!Array.isArray(state.batchScreenshots)) {
    state.batchScreenshots = [];
  }

  const id = `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const item = {
    id,
    base64: base64Image,
    buffer: rawBuffer,
    timestamp: Date.now(),
  };

  state.batchScreenshots.push(item);
  console.log(`📸 [batch-screenshot] Print adicionado à fila (${state.batchScreenshots.length} no total)`);

  // Se a janela estiver aberta, notifica o renderer
  if (state.batchScreenshotWindow && !state.batchScreenshotWindow.isDestroyed()) {
    try {
      if (!state.batchScreenshotWindow.isVisible()) {
        helpers.showBatchScreenshotOverlay();
      }
      state.batchScreenshotWindow.webContents.send('batch-add-image', {
        id: item.id,
        base64Image: item.base64,
        timestamp: item.timestamp,
        count: state.batchScreenshots.length,
      });
      state.batchScreenshotWindow.setAlwaysOnTop(true, 'screen-saver');
      state.batchScreenshotWindow.moveTop();
    } catch (e) {
      console.warn('[batch-screenshot] falha ao enviar evento para overlay:', e.message);
    }
  }
};

helpers.removeScreenshotFromBatch = function(id) {
  if (!Array.isArray(state.batchScreenshots)) return;
  state.batchScreenshots = state.batchScreenshots.filter(s => s.id !== id);
  console.log(`📸 [batch-screenshot] Item ${id} removido. Restantes: ${state.batchScreenshots.length}`);

  if (state.batchScreenshotWindow && !state.batchScreenshotWindow.isDestroyed()) {
    try {
      state.batchScreenshotWindow.webContents.send('batch-remove-image', id);
    } catch (_) {}
  }
};

helpers.clearBatchScreenshots = function() {
  state.batchScreenshots = [];
  console.log('📸 [batch-screenshot] Fila de capturas limpa');

  if (state.batchScreenshotWindow && !state.batchScreenshotWindow.isDestroyed()) {
    try {
      state.batchScreenshotWindow.webContents.send('batch-clear');
    } catch (_) {}
  }
};

helpers.processBatchScreenshots = async function() {
  if (!Array.isArray(state.batchScreenshots) || state.batchScreenshots.length === 0) {
    helpers.hideBatchScreenshotOverlay();
    return;
  }

  const screenshots = [...state.batchScreenshots];
  helpers.clearBatchScreenshots();
  helpers.hideBatchScreenshotOverlay();

  console.log(`🚀 [batch-screenshot] Processando lote de ${screenshots.length} imagens...`);
  await helpers.processBatchOsQuestion(screenshots);
};

helpers.processBatchOsQuestion = async function(screenshots) {
  if (!screenshots || screenshots.length === 0) return;

  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    helpers.createOsNotificationWindow('loading', `Analisando ${screenshots.length} imagens em sequência...`);
  }

  try {
    const aiModel = helpers.getEffectiveAiModel();
    let resposta;

    if (aiModel === 'openIa' || aiModel === 'openIaCodex') {
      const token = configService.getOpenIaToken();
      if (!token) {
        helpers.destroyNotificationWindow();
        helpers.createOsNotificationWindow('response', 'Token da OpenAI não configurado.');
        return;
      }

      const instruction = helpers.withUserContext(configService.getPromptInstruction());
      const openAiModel = configService.getOpenAiVisionModel() || configService.getOpenAiModel() || 'gpt-4o';
      const prompt = `Analise com atenção a sequência cronológica de ${screenshots.length} imagens capturadas em contexto unificado. Responda conforme as regras do sistema.`;
      const images = screenshots.map(s => s.base64);

      console.log(`🤖 OpenAI Vision Batch (${images.length} imagens) -> modelo: ${openAiModel}`);

      resposta = await OpenAIService.makeOpenAIRequest(
        prompt,
        token,
        instruction,
        openAiModel,
        images,
        { stateless: true }
      );

    } else {
      console.log(`🤖 Provider CLI Batch (${aiModel}) -> salvando ${screenshots.length} imagens no cache local`);

      const savedPaths = [];
      for (let i = 0; i < screenshots.length; i++) {
        try {
          const saved = imageAttachments.saveBase64(screenshots[i].base64, `batch-${i + 1}`);
          savedPaths.push(saved.path);
        } catch (saveErr) {
          console.warn(`[batch-screenshot] Erro ao salvar imagem ${i + 1} em cache:`, saveErr.message);
        }
      }

      const ocrs = await Promise.all(
        screenshots.map(async (s) => {
          try {
            return await TesseractService.getTextFromImage(s.base64);
          } catch (_) {
            return '';
          }
        })
      );

      let unifiedPrompt = `O usuário anexou uma sequência de ${screenshots.length} capturas de tela para análise contextual unificada:\n\n`;
      savedPaths.forEach((filePath, idx) => {
        unifiedPrompt += `--- [Captura #${idx + 1}] ---\n`;
        unifiedPrompt += `Arquivo em cache: ${filePath}\n`;
        if (ocrs[idx] && ocrs[idx].trim()) {
          unifiedPrompt += `Texto extraído por OCR:\n"""\n${ocrs[idx].trim()}\n"""\n`;
        }
        unifiedPrompt += `\n`;
      });
      unifiedPrompt += `Analise todo o conjunto de imagens acima em sequência e responda conforme as instruções do sistema.`;

      const projectPath = workspace.getProjectPath();
      const instruction = helpers.withUserContext(configService.getPromptInstruction());
      const fullPrompt = `${instruction}\n\n${unifiedPrompt}`;

      const mockSender = state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()
        ? state.osNotificationWindow.webContents
        : { send: () => {} };

      if (aiModel === 'geminiCli') {
        GeminiCliProvider.setModel(configService.getGeminiCliModel());
        const res = await GeminiCliProvider.send(fullPrompt, projectPath, mockSender);
        resposta = typeof res === 'object' ? (res.text || res.response || '') : String(res);
      } else if (aiModel === 'claudeCli') {
        ClaudeCliProvider.setModel(configService.getClaudeCliModel());
        const res = await ClaudeCliProvider.send(fullPrompt, projectPath, mockSender);
        resposta = typeof res === 'object' ? (res.text || res.response || '') : String(res);
      } else if (aiModel === 'copilotCli') {
        CopilotCliProvider.setModel(configService.getCopilotCliModel());
        const res = await CopilotCliProvider.send(fullPrompt, projectPath, mockSender, {
          attachments: savedPaths,
        });
        resposta = typeof res === 'object' ? (res.text || res.response || '') : String(res);
      } else {
        resposta = `[Batch Processado] Imagens registradas:\n${savedPaths.join('\n')}`;
      }
    }

    if (isOsIntegration) {
      if (typeof resposta === 'string' && (resposta.trim().startsWith('{') || resposta.includes('"response"'))) {
        try {
          const { parseNexaResponse } = require('../nexa/nexaResponseHelper.js');
          const parsed = parseNexaResponse(resposta);
          if (parsed && parsed.response) {
            resposta = parsed.response;
          }
        } catch (_) {}
      }
      const formattedResponse = helpers.formatToHTML ? helpers.formatToHTML(resposta) : resposta;
      helpers.destroyNotificationWindow();
      await new Promise(resolve => setTimeout(resolve, 300));
      helpers.createOsNotificationWindow('response', formattedResponse);
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('openai-final-response', { resposta });
    }

    if (helpers.triggerTtsPlaybackIfEnabled) {
      helpers.triggerTtsPlaybackIfEnabled(resposta);
    }

  } catch (error) {
    console.error('Erro no processBatchOsQuestion:', error);
    if (isOsIntegration) {
      helpers.destroyNotificationWindow();
      await new Promise(resolve => setTimeout(resolve, 300));
      helpers.createOsNotificationWindow('response', `Erro ao analisar sequência de imagens: ${error.message}`);
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('transcription-error', `Erro ao analisar imagens: ${error.message}`);
    }
  }
};
