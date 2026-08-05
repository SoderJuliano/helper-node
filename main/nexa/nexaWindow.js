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
    }
  });

  state.nexaWindow.on("closed", () => {
    state.nexaWindow = null;
    nexaState.reset();
  });

  return state.nexaWindow;
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
  sendStateToNexaWindow
};
