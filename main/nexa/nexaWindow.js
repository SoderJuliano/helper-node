/**
 * main/nexa/nexaWindow.js
 * Gerenciador da Janela Independente e Transparente da Nexa.
 */

const { BrowserWindow, screen } = require("electron");
const path = require("path");
const { ROOT_DIR, APP_ICON, state, configService } = require("../globals.js");
const { nexaState } = require("./nexaState.js");

function createNexaWindow() {
  return null;
}

function applyNexaOnlyMode(nexaCfg) {
  const { state: globalState } = require("../globals.js");
  if (globalState.mainWindow && !globalState.mainWindow.isDestroyed()) {
    globalState.mainWindow.show();
  }
}

function requestWebcamCapture() {
  return Promise.resolve(null);
}

function closeNexaWindow() {
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
    state.nexaWindow.close();
  }
  state.nexaWindow = null;
  nexaState.reset();
}

function toggleNexaWindow() {
  return false;
}

function isNexaWindowOpen() {
  return false;
}

function sendStateToNexaWindow(stateName) {
  // No-op (janela exclusiva da Nexa desativada)
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
