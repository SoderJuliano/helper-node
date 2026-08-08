/**
 * main/nexa/nexaWindow.js
 * Gerenciador da Janela Independente e Transparente da Nexa.
 *
 * O modo "Apenas Nexa" (tela cheia, escondendo o Helper Node) foi removido de
 * propósito — era ele que esticava esta janela para `primaryDisplay.bounds`.
 * A janela flutuante de 360x360 no canto continua sendo a cara da Nexa.
 */

const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { ROOT_DIR, APP_ICON, state, configService } = require("../globals.js");
const { nexaState } = require("./nexaState.js");

const WINDOW_SIZE = 360;

function floatingBounds() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  return {
    x: Math.max(0, width - WINDOW_SIZE - 30),
    y: Math.max(0, height - WINDOW_SIZE - 30),
    width: WINDOW_SIZE,
    height: WINDOW_SIZE
  };
}

function createNexaWindow() {
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
    state.nexaWindow.show();
    state.nexaWindow.focus();
    return state.nexaWindow;
  }

  const isStealth = configService.getStealthModeStatus();
  const { x, y, width, height } = floatingBounds();

  state.nexaWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    thickFrame: false,
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
  requestWebcamCapture
};
