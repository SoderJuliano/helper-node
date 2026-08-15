// main/ipc/workspaceActions.js
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
  ipcMain, screen, nativeImage
} = require('../globals.js');

module.exports = function registerIpc() {
ipcMain.on("process-pasted-image", (event, base64Image) => {
  // Dedup compartilhado com clipboard monitor: evita processar 2x
  // (cenario: monitor pegou o screenshot, user da Ctrl+V em seguida)
  try {
    const stripped = (base64Image || '').replace(/^data:image\/[a-z]+;base64,/, '');
    if (stripped) {
      const currentHash = helpers.calculateImageHash(Buffer.from(stripped, 'base64'));
      const now = Date.now();
      if (state.lastProcessedImageHash === currentHash &&
          state.lastProcessedTimestamp && (now - state.lastProcessedTimestamp) < IMAGE_COOLDOWN_MS) {
        console.log('🚫 [paste] imagem ja processada pelo clipboard monitor, ignorando Ctrl+V duplicado');
        return;
      }
      // Marca como processada pra o monitor nao re-disparar
      state.lastProcessedImageHash = currentHash;
      state.lastProcessedTimestamp = now;
      state.lastClipboardImageHash = currentHash;
    }
  } catch (e) {
    console.warn('[paste] falha ao calcular hash de dedup:', e && e.message);
  }

  console.log("Main process received pasted image.");

  // Modo IDE (projeto aberto): a imagem vira ARQUIVO anexado ao contexto em vez
  // de virar texto no input. Print de console/erro de métrica precisa ser visto,
  // não transcrito. Fora do modo IDE nada muda — segue o OCR de sempre.
  if (helpers.isIdeProjectMode()) {
    helpers.attachImageToWorkspace(base64Image, { prefix: 'paste', sender: event.sender })
      .then((att) => {
        if (att) return;
        // Não deu pra anexar (disco cheio, permissão): cai no fluxo antigo em
        // vez de engolir a imagem do usuário.
        console.warn('[paste] anexo falhou, caindo no OCR tradicional.');
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          TesseractService.processPastedImage(base64Image, state.mainWindow).catch(() => {});
        }
      })
      .catch((e) => console.error('[paste] erro no anexo de imagem:', e && e.message));
    return;
  }

  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    // Feedback visual (idempotente — se JS paste handler ja disparou, vira no-op rapido)
    state.mainWindow.webContents.send('screen-capturing', true);
    TesseractService.processPastedImage(base64Image, state.mainWindow).catch(
      (error) => {
        console.error("Error processing pasted image in main process:", error);
        
        // Enviar resultado com erro em vez de falhar silenciosamente
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('ocr-result', {
            text: '',
            screenshotPath: '',
            base64Image: base64Image,
            error: 'Erro ao processar imagem colada'
          });
        }
      }
    );
  }
});

ipcMain.handle("is-ide-project-mode", () => helpers.isIdeProjectMode());

// Ctrl+V na tela hero: nada está focado, então o evento `paste` do Chromium não
// dispara e o renderer não tem como ler o clipboard. Aqui ele pede pro main.
ipcMain.handle("read-clipboard-image", () => {
  try {
    const { clipboard } = require('electron');
    const img = clipboard.readImage();
    if (!img || img.isEmpty()) return null;
    return img.toDataURL();
  } catch (e) {
    console.warn('[clipboard] leitura de imagem falhou:', e && e.message);
    return null;
  }
});

ipcMain.on("set-workspace-access-enabled", (event, enabled) => {
  if (!configService.setWorkspaceAccessEnabled) return;
  configService.setWorkspaceAccessEnabled(!!enabled);
  console.log(`📂 WorkspaceAccess: → ${enabled ? "ON" : "OFF"}`);
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("workspace-changed", { enabled: !!enabled, attachments: workspace.list() });
  }
});

ipcMain.handle("workspace:move-item", async (event, { srcPath, destPath }) => {
  try {
    if (!fs2.existsSync(srcPath)) {
      return { ok: false, error: "Item de origem não existe." };
    }
    if (!fs2.existsSync(destPath)) {
      return { ok: false, error: "Diretório de destino não existe." };
    }
    const stat = fs2.statSync(destPath);
    if (!stat.isDirectory()) {
      return { ok: false, error: "Destino precisa ser uma pasta." };
    }
    const filename = path.basename(srcPath);
    const targetPath = path.join(destPath, filename);
    if (fs2.existsSync(targetPath)) {
      return { ok: false, error: `Já existe um item chamado "${filename}" na pasta de destino.` };
    }
    fs2.renameSync(srcPath, targetPath);
    return { ok: true };
  } catch (e) {
    console.error("[workspace:move-item] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:create-file", async (event, { filePath }) => {
  try {
    if (fs2.existsSync(filePath)) {
      return { ok: false, error: "Arquivo já existe." };
    }
    const dir = path.dirname(filePath);
    if (!fs2.existsSync(dir)) {
      fs2.mkdirSync(dir, { recursive: true });
    }
    fs2.writeFileSync(filePath, "", "utf8");
    return { ok: true };
  } catch (e) {
    console.error("[workspace:create-file] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:create-dir", async (event, { dirPath }) => {
  try {
    if (fs2.existsSync(dirPath)) {
      return { ok: false, error: "Diretório já existe." };
    }
    fs2.mkdirSync(dirPath, { recursive: true });
    return { ok: true };
  } catch (e) {
    console.error("[workspace:create-dir] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:delete-items", async (event, { paths }) => {
  try {
    for (const p of paths) {
      if (fs2.existsSync(p)) {
        fs2.rmSync(p, { recursive: true, force: true });
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("[workspace:delete-items] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:pick-parent-dir", async () => {
  const { dialog } = require("electron");
  const res = await dialog.showOpenDialog(state.mainWindow, {
    title: "Selecionar pasta onde criar o projeto",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("workspace:create-and-open-project", async (event, { parentPath, folderName }) => {
  try {
    const newProjectPath = path.join(parentPath, folderName);
    if (fs2.existsSync(newProjectPath)) {
      return { ok: false, error: "Uma pasta com esse nome já existe neste local." };
    }
    fs2.mkdirSync(newProjectPath, { recursive: true });
    
    // Agora abre o projeto!
    const prevDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
    await workspace.openProject(newProjectPath);
    helpers.syncTerminalCwd();
    
    // Reinicia sessões da IA se mudou
    const newDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
    const oldPath = prevDirs[0] || null;
    const newPath = newDirs[0] || null;
    const activeProvider = configService.getAiModel();
    if (oldPath !== newPath && activeProvider === 'geminiCli') {
      GeminiCliProvider.changeProject(oldPath, newPath).catch(e =>
        console.warn('[gemini-cli] changeProject error:', e.message)
      );
    }
    if (oldPath !== newPath && activeProvider === 'claudeCli') {
      ClaudeCliProvider.changeProject(oldPath, newPath).catch(e =>
        console.warn('[claude-cli] changeProject error:', e.message)
      );
    }
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
    }
    return { ok: true, attachments: workspace.list() };
  } catch (e) {
    console.error("[workspace:create-and-open-project] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.on('region-cancelled', () => {
  if (state.regionSelectWindow && !state.regionSelectWindow.isDestroyed()) state.regionSelectWindow.close();
  state.regionCaptureBuffer = null;
});

ipcMain.on('region-selected', async (event, rect) => {
  // rect: { x, y, width, height } em px CSS do overlay
  try {
    if (state.regionSelectWindow && !state.regionSelectWindow.isDestroyed()) state.regionSelectWindow.close();
    if (!state.regionCaptureBuffer) return;
    if (!rect || rect.width < 5 || rect.height < 5) {
      state.regionCaptureBuffer = null;
      return;
    }

    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;

    // Reconstrói NativeImage a partir do PNG já capturado
    const fullImg = nativeImage.createFromBuffer(state.regionCaptureBuffer);
    state.regionCaptureBuffer = null;

    const cropRect = {
      x: Math.max(0, Math.round(rect.x * sf)),
      y: Math.max(0, Math.round(rect.y * sf)),
      width: Math.max(1, Math.round(rect.width * sf)),
      height: Math.max(1, Math.round(rect.height * sf)),
    };
    const cropped = fullImg.crop(cropRect);
    const pngBuf = cropped.toPNG();
    const compressed = await helpers.compressImageForVision(pngBuf, 'region');
    const base64 = compressed.dataUrl;

    // Mostra loading discreto se integrado
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('loading', 'Analisando captura...');
    } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('screen-capturing', true);
    }

    // Delega tudo a helpers.processOsQuestion(faz OCR + roteamento internamente)
    try {
      if (isOsIntegration) {
        await helpers.processOsQuestion('', base64, { forceVision: true });
      } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        let ocrText = '';
        try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
        // `base64` já é data URL completo; chave `base64Image` (lida pelo renderer).
        state.mainWindow.webContents.send('ocr-result', { text: ocrText, base64Image: base64 });
      }
    } catch (e) {
      console.error('Erro OCR/IA na captura nativa:', e);
      if (isOsIntegration) {
        helpers.createOsNotificationWindow('response', 'Erro ao processar a captura.');
      } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('screen-capturing', false);
        state.mainWindow.webContents.send('transcription-error', 'Erro ao processar a captura.');
      }
    }
  } catch (e) {
    console.error('region-selected handler error:', e);
  }
});

};
