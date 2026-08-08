/**
 * main/nexa/index.js
 * Módulo de entrada principal do pacote Nexa no Main Process.
 */

const { nexaState } = require("./nexaState.js");
const { createNexaWindow, closeNexaWindow, toggleNexaWindow, isNexaWindowOpen } = require("./nexaWindow.js");
const { registerNexaIpc } = require("./nexaIpc.js");
const { setupNexaIntegration } = require("./nexaIntegration.js");

function initializeNexa() {
  console.log("🤖 [Nexa Module] Inicializando módulo isolado da Nexa...");
  registerNexaIpc();
  setupNexaIntegration();
}

module.exports = {
  initializeNexa,
  nexaState,
  createNexaWindow,
  closeNexaWindow,
  toggleNexaWindow,
  isNexaWindowOpen
};
