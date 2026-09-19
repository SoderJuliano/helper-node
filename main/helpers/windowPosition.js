// main/helpers/windowPosition.js
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
  screen, execPromise
} = require('../globals.js');

helpers.computeTranslationOverlayBounds = function() {
  // getCursorScreenPoint + getDisplayNearestPoint = display onde o usuário
  // está agora (em vez de sempre o primary). Importante em multi-monitor.
  let display;
  try {
    const cursor = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(cursor);
  } catch (_) {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea; // {x, y, width, height} — respeita docks
  const OVERLAY_MIN_WIDTH = 380;
  const winWidth = Math.max(OVERLAY_MIN_WIDTH, Math.round(wa.width * 0.20));
  const winHeight = Math.round(wa.height * 0.80);
  // 10px da borda direita, clampeado para não sair da tela
  const posX = Math.max(wa.x, wa.x + wa.width - winWidth - 10);
  const posY = Math.max(wa.y, wa.y + Math.round((wa.height - winHeight) / 2));
  return { x: posX, y: posY, width: winWidth, height: winHeight, displayId: display.id };
}

helpers.forceTranslationOverlayPosition = function(label) {
  if (!state.translationOverlayWindow || state.translationOverlayWindow.isDestroyed()) return;
  const b = helpers.computeTranslationOverlayBounds();
  try { state.translationOverlayWindow.setBounds(b); } catch (_) {}
  try { state.translationOverlayWindow.setPosition(b.x, b.y); } catch (_) {}
  try {
    const got = state.translationOverlayWindow.getBounds();
    console.log(`[translation-overlay] ${label}: alvo=${b.x},${b.y} ${b.width}x${b.height} | real=${got.x},${got.y} ${got.width}x${got.height}`);
  } catch (_) {}
}

helpers.expandTranslationOverlayIfNeeded = function() {
  if (!state.translationOverlayWindow || state.translationOverlayWindow.isDestroyed()) return;
  // Usa o mesmo display em que a janela está
  const bounds = state.translationOverlayWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const wa = display.workArea;
  const maxW = Math.round(wa.width * 0.40);
  if (bounds.width >= maxW) return;
  const newW = Math.min(bounds.width + 200, maxW);
  const x = wa.x + wa.width - newW - 10;
  try {
    state.translationOverlayWindow.setBounds({ x, y: bounds.y, width: newW, height: bounds.height });
  } catch (_) {}
}

helpers.computeVisionGuideOverlayBounds = function() {
  let display;
  try {
    const cursor = screen.getCursorScreenPoint();
    display = screen.getDisplayNearestPoint(cursor);
  } catch (_) {
    display = screen.getPrimaryDisplay();
  }
  const wa = display.workArea;
  const winWidth = Math.max(400, Math.round(wa.width * 0.22));
  const winHeight = Math.round(wa.height * 0.72);
  const posX = Math.max(wa.x, wa.x + 12);              // encostado à esquerda
  const posY = Math.max(wa.y, wa.y + Math.round((wa.height - winHeight) / 2));
  return { x: posX, y: posY, width: winWidth, height: winHeight };
}

helpers.expandVisionGuideOverlayIfNeeded = function() { /* no-op: tamanho fixo */ }

helpers.restoreVisionGuideOverlay = function() {
  if (!state.visionGuideOverlayWindow || state.visionGuideOverlayWindow.isDestroyed()) return;
  try { state.visionGuideOverlayWindow.setBounds(helpers.computeVisionGuideOverlayBounds()); } catch (_) {}
  try {
    if (typeof state.visionGuideOverlayWindow.showInactive === 'function') state.visionGuideOverlayWindow.showInactive();
    else state.visionGuideOverlayWindow.show();
  } catch (_) {}
  try { state.visionGuideOverlayWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  state.visionGuideMinimized = false;
}

helpers.updateWindowPosition = function() {
  try {
    const displays = screen.getAllDisplays();
    const currentDisplay = screen.getDisplayNearestPoint(
      state.mainWindow.getBounds()
    );

    if (displays.length < 2) {
      console.log("Single display detected, hiding window");
      state.mainWindow.hide();
      return;
    }

    const sharingDisplay = helpers.getSharingDisplay();
    if (sharingDisplay && sharingDisplay.id === currentDisplay.id) {
      const otherDisplay = displays.find((d) => d.id !== currentDisplay.id);
      if (otherDisplay) {
        const otherIndex = displays.findIndex((d) => d.id === otherDisplay.id);
        console.log("Attempting to move to display index:", otherIndex);
        helpers.moveToDisplay(otherIndex);
        // Verify movement
        const newBounds = state.mainWindow.getBounds();
        const newDisplay = screen.getDisplayNearestPoint(newBounds);
        if (newDisplay.id === otherDisplay.id) {
          state.currentDisplayId = otherDisplay.id;
          console.log(
            "Successfully moved to display index:",
            otherIndex,
            "ID:",
            state.currentDisplayId
          );
        } else {
          console.error("Failed to move to display index:", otherIndex);
        }
      }
    } else {
      state.mainWindow.show();
      console.log("Window already on non-shared display");
    }
  } catch (error) {
    console.error("Error updating window position:", error);
  }
}

helpers.getSharingDisplay = function() {
  return screen.getPrimaryDisplay();
}

helpers.clampWindowToDisplay = function(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const displays = screen.getAllDisplays();
    if (!displays || displays.length === 0) return;

    const b = win.getBounds();
    const center = { x: b.x + Math.round(b.width / 2), y: b.y + Math.round(b.height / 2) };

    // Encontra display mais proximo ou cai no display primario
    let display = screen.getDisplayNearestPoint(center);
    if (!display) display = screen.getPrimaryDisplay();
    const wa = display.workArea || display.bounds;

    if (win.isMaximized()) {
      // Se estava maximizada ao trocar de tela, ajusta bounds seguros e reaplica maximize no display ativo
      win.unmaximize();
      const targetW = Math.min(b.width, Math.max(480, wa.width - 20));
      const targetH = Math.min(b.height, Math.max(360, wa.height - 20));
      const targetX = wa.x + Math.max(0, Math.round((wa.width - targetW) / 2));
      const targetY = wa.y + Math.max(0, Math.round((wa.height - targetH) / 2));
      win.setBounds({ x: targetX, y: targetY, width: targetW, height: targetH });
      win.maximize();
      return;
    }

    // Clamping de dimensoes para telas menores (ex: notebook pos-desconexao de monitor externo)
    const maxAllowedWidth = Math.max(320, wa.width - 20);
    const maxAllowedHeight = Math.max(240, wa.height - 20);
    const newWidth = Math.min(b.width, maxAllowedWidth);
    const newHeight = Math.min(b.height, maxAllowedHeight);

    let newX = b.x;
    let newY = b.y;

    if (newX < wa.x) newX = wa.x + 10;
    if (newX + newWidth > wa.x + wa.width) newX = Math.max(wa.x, wa.x + wa.width - newWidth - 10);

    if (newY < wa.y) newY = wa.y + 10;
    if (newY + newHeight > wa.y + wa.height) newY = Math.max(wa.y, wa.y + wa.height - newHeight - 10);

    win.setBounds({
      x: Math.round(newX),
      y: Math.round(newY),
      width: Math.round(newWidth),
      height: Math.round(newHeight)
    });
  } catch (err) {
    console.error("[windowPosition] Erro ao ajustar limites da janela:", err.message);
  }
};

helpers.clampAllActiveWindows = function() {
  const candidates = [
    state.mainWindow,
    state.configWindow,
    state.preferencesWindow,
    state.nexaConfigWindow
  ];

  candidates.forEach(win => {
    if (win && !win.isDestroyed() && win.isVisible()) {
      helpers.clampWindowToDisplay(win);
    }
  });
};

helpers.ensureWindowVisible = function(win) {
  if (!win || win.isDestroyed()) return;
  helpers.clampWindowToDisplay(win);
};

helpers.moveToDisplay = function(targetIndex) {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return;

  // Clamp index
  const idx = Math.max(0, Math.min(targetIndex, displays.length - 1));
  const targetDisplay = displays[idx];
  const bounds = targetDisplay.workArea || targetDisplay.bounds;

  // Position window centered on target display
  const [winW, winH] = state.mainWindow.getSize();
  const x = Math.floor(bounds.x + (bounds.width - winW) / 2);
  const y = Math.floor(bounds.y + (bounds.height - winH) / 2);

  state.mainWindow.setBounds({ x, y, width: winW, height: winH });
  state.mainWindow.focus();
  state.currentDisplayId = targetDisplay.id;
  console.log(`Moved window to display index ${idx} (id=${targetDisplay.id})`);
}

helpers.bringWindowToFocus = async function() {
  console.log(
    "bringWindowToFocus: Tentando trazer a janela para o foco e abrir o input."
  );
  
  // Check if OS integration mode is enabled
  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    // Use OS integration input instead
    helpers.createOsInputWindow();
    return;
  }
  
  if (!state.mainWindow) return;

  if (helpers.isHyprland()) {
    try {
      const pid = process.pid;
      // Obter o workspace ativo atual
      const { stdout: wsStdout } = await execPromise(
        "hyprctl activeworkspace -j"
      );
      const activeWorkspace = JSON.parse(wsStdout);
      const workspaceId = activeWorkspace.id;

      console.log(
        `Hyprland: Movendo janela para o workspace ${workspaceId} e tornando flutuante.`
      );

      // Mover para o workspace atual
      await execPromise(
        `hyprctl dispatch movetoworkspace ${workspaceId},pid:${pid}`
      );
      // Tornar flutuante
      await execPromise(`hyprctl dispatch setprop pid:${pid} floating 1`);
      // Focar a janela
      await execPromise(`hyprctl dispatch focuswindow pid:${pid}`);

      state.mainWindow.show();
      console.log("Hyprland: Janela movida e focada com input manual.");
    } catch (error) {
      console.error("Erro ao mover/focar janela no Hyprland:", error);
    }
  } else {
    // Lógica para ambientes que não são Hyprland
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

    const { x, y } = currentDisplay.workArea;
    const winWidth = state.mainWindow.getBounds().width;
    const winHeight = state.mainWindow.getBounds().height;

    const newX = x + Math.round((currentDisplay.workArea.width - winWidth) / 2);
    const newY =
      y + Math.round((currentDisplay.workArea.height - winHeight) / 2);

    state.mainWindow.setBounds({
      x: newX,
      y: newY,
      width: winWidth,
      height: winHeight,
    });
    state.mainWindow.show();
    state.mainWindow.focus();
    console.log("Janela movida e focada com input manual (ambiente padrão).");
  }

  // Abrir o input manual no renderizador
  state.mainWindow.webContents.send("manual-input");
}

helpers.positionTranslationOverlay = function(position, targetWin) {
  const win = targetWin || state.translationOverlayWindow;
  if (!win || win.isDestroyed()) return;

  const currentBounds = win.getBounds();
  const currentCenter = {
    x: currentBounds.x + Math.round(currentBounds.width / 2),
    y: currentBounds.y + Math.round(currentBounds.height / 2),
  };

  let display;
  if (position === 'next-monitor') {
    const all = screen.getAllDisplays();
    const current = screen.getDisplayNearestPoint(currentCenter);
    const idx = all.findIndex(d => d.id === current.id);
    display = all[(idx + 1) % all.length];
  } else {
    display = screen.getDisplayNearestPoint(currentCenter);
  }

  const { x: dX, y: dY, width: dW, height: dH } = display.workArea;
  const [winW, winH] = win.getSize();

  const newY = dY + Math.round((dH - winH) / 2);
  let newX;
  if (position === 'left') {
    newX = dX + 10;
  } else if (position === 'center') {
    newX = dX + Math.round((dW - winW) / 2);
  } else {
    newX = dX + dW - winW - 10; // right / next-monitor / default
  }

  console.log(`[overlay-position] ${position} → display ${display.id} x=${newX} y=${newY}`);
  try { win.setBounds({ x: newX, y: newY, width: winW, height: winH }); } catch (_) {}
  try { win.setPosition(newX, newY); } catch (_) {}
  // Reafirma flutuar acima de tudo: o compositor pode ter rebaixado/encaixado
  // a janela ao movê-la entre monitores/áreas de trabalho.
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.moveTop();
  } catch (_) {}
  // Confere o resultado real (útil pra diagnosticar Wayland ignorando posição).
  try {
    const got = win.getBounds();
    console.log(`[overlay-position] real=${got.x},${got.y} ${got.width}x${got.height}`);
  } catch (_) {}
}
