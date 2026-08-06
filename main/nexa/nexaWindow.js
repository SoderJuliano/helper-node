/**
 * main/nexa/nexaWindow.js
 * Gerenciador da Janela Independente e Transparente da Nexa.
 */

const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { ROOT_DIR, APP_ICON, state, configService } = require("../globals.js");
const { nexaState } = require("./nexaState.js");

function createNexaWindow() {
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
    state.nexaWindow.show();
    state.nexaWindow.focus();
    return state.nexaWindow;
  }

  const isStealth = configService.getStealthModeStatus();
  const windowSize = 360;

  // Posiciona no canto inferior direito da tela principal
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const posX = Math.max(0, width - windowSize - 30);
  const posY = Math.max(0, height - windowSize - 30);

  state.nexaWindow = new BrowserWindow({
    width: windowSize,
    height: windowSize,
    x: posX,
    y: posY,
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: isStealth,
    resizable: false,
    hasShadow: false,
    focusable: true,
    show: false,
    icon: APP_ICON,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(ROOT_DIR, "preload.js"),
      backgroundThrottling: false,
    },
  });

  state.nexaWindow.setAlwaysOnTop(true, "screen-saver");
  state.nexaWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const nexaHtmlPath = path.join(ROOT_DIR, "renderer", "nexa", "nexa.html");

  state.nexaWindow.loadFile(nexaHtmlPath).catch((err) => {
    console.error("[NexaWindow] Erro ao carregar html da Nexa:", err);
  });

  state.nexaWindow.once("ready-to-show", () => {
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      state.nexaWindow.show();
      // Notifica o estado atual após carregamento
      sendStateToNexaWindow(nexaState.getState());

      // Se onlyNexa estiver ativo, aplica!
      const nexaCfg = configService.getNexaConfig();
      if (nexaCfg && nexaCfg.onlyNexa) {
        applyNexaOnlyMode(nexaCfg);
      }
    }
  });

  state.nexaWindow.on("closed", () => {
    state.nexaWindow = null;
    nexaState.reset();

    // Garante que o mainWindow apareça se a Nexa for fechada
    const { state: globalState } = require("../globals.js");
    if (globalState.mainWindow && !globalState.mainWindow.isDestroyed()) {
      globalState.mainWindow.show();
    }

    // E garante que o real-time assistant seja parado
    const { helpers } = require("../globals.js");
    const service = helpers.pickRealtimeService();
    if (service && service.isActive()) {
      service.stop().catch(() => {});
      globalState.isRecording = false;
    }
  });

  return state.nexaWindow;
}

function applyNexaOnlyMode(nexaCfg) {
  const { state: globalState, helpers } = require("../globals.js");
  const onlyNexa = !!(nexaCfg && nexaCfg.onlyNexa && nexaCfg.enabled);

  if (onlyNexa) {
    console.log("[NexaWindow] Ativando modo Apenas Nexa...");
    // 1. Oculta a janela principal
    if (globalState.mainWindow && !globalState.mainWindow.isDestroyed()) {
      globalState.mainWindow.hide();
    }

    // 2. Ajusta tamanho da Nexa para preencher a tela inteira (tela cheia transparente)
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width, height } = primaryDisplay.bounds;
      
      state.nexaWindow.setResizable(true);
      state.nexaWindow.setBounds({ x, y, width, height });
      state.nexaWindow.setResizable(false);

      // Envia notificação de modo imersivo
      state.nexaWindow.webContents.send("nexa:only-mode", true);
    }

    // 3. Ativa o assistente em tempo real se não estiver ativo
    setTimeout(async () => {
      const service = helpers.pickRealtimeService();
      if (service && !service.isActive()) {
        console.log("[NexaWindow] Iniciando escuta em tempo real para o modo Apenas Nexa...");
        await service.start().catch((err) => console.error("[NexaWindow] Falha ao iniciar escuta:", err));
        globalState.isRecording = true;
      }
    }, 500);
  } else {
    console.log("[NexaWindow] Desativando modo Apenas Nexa...");
    // 1. Restaura a janela principal
    if (globalState.mainWindow && !globalState.mainWindow.isDestroyed()) {
      globalState.mainWindow.show();
    }

    // 2. Restaura o tamanho e posição da janela Nexa
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      state.nexaWindow.setResizable(true);

      const windowSize = 360;
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width, height } = primaryDisplay.workAreaSize;
      const posX = Math.max(0, width - windowSize - 30);
      const posY = Math.max(0, height - windowSize - 30);

      state.nexaWindow.setBounds({ x: posX, y: posY, width: windowSize, height: windowSize });
      state.nexaWindow.setResizable(false);

      state.nexaWindow.webContents.send("nexa:only-mode", false);
    }

    // 3. Desativa o assistente em tempo real
    const service = helpers.pickRealtimeService();
    if (service && service.isActive()) {
      console.log("[NexaWindow] Desativando escuta em tempo real...");
      service.stop().catch(() => {});
      globalState.isRecording = false;
    }
  }
}

function requestWebcamCapture() {
  const { state: globalState } = require("../globals.js");
  if (!globalState.nexaWindow || globalState.nexaWindow.isDestroyed()) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const requestId = Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    const channel = "nexa:webcam-reply-" + requestId;
    const { ipcMain } = require("electron");

    const timeout = setTimeout(() => {
      ipcMain.removeListener(channel, onReply);
      resolve(null);
    }, 4000); // 4 segundos timeout

    function onReply(event, base64) {
      clearTimeout(timeout);
      resolve(base64);
    }

    ipcMain.once(channel, onReply);

    try {
      globalState.nexaWindow.webContents.send("nexa:request-webcam", { requestId });
    } catch (err) {
      clearTimeout(timeout);
      ipcMain.removeListener(channel, onReply);
      resolve(null);
    }
  });
}

function closeNexaWindow() {
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
    state.nexaWindow.close();
  }
  state.nexaWindow = null;
  nexaState.reset();
}

function toggleNexaWindow() {
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
    if (state.nexaWindow.isVisible()) {
      state.nexaWindow.hide();
    } else {
      state.nexaWindow.show();
      state.nexaWindow.focus();
    }
    return state.nexaWindow.isVisible();
  } else {
    createNexaWindow();
    return true;
  }
}

function isNexaWindowOpen() {
  return !!(state.nexaWindow && !state.nexaWindow.isDestroyed() && state.nexaWindow.isVisible());
}

function sendStateToNexaWindow(stateName) {
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
    state.nexaWindow.webContents.send("nexa:state-change", {
      state: stateName,
      timestamp: Date.now()
    });
  }
}

module.exports = {
  createNexaWindow,
  closeNexaWindow,
  toggleNexaWindow,
  isNexaWindowOpen,
  sendStateToNexaWindow,
  applyNexaOnlyMode,
  requestWebcamCapture
};
