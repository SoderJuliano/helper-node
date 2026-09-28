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
  const { configService } = require("../globals.js");
  const nexaCfg = configService.getNexaConfig();
  if (nexaCfg && nexaCfg.enabled) {
    console.log("🤖 [Nexa Module] Nexa está HABILITADA nas configurações. Criando janela da Nexa...");
    createNexaWindow();
    try {
      const nexaVoiceAssistant = require("../../services/nexaVoiceAssistant");
      nexaVoiceAssistant.geminiLiveController.start({ withoutMic: true }).catch(err => {
        console.warn("🤖 [Nexa Module] Erro ao iniciar Gemini Live em standby:", err.message);
      });
    } catch (_) {}
  } else {
    console.log("🤖 [Nexa Module] Nexa está DESABILITADA (OFF). Nenhuma janela criada.");
  }
}

module.exports = {
  initializeNexa,
  nexaState,
  createNexaWindow,
  closeNexaWindow,
  toggleNexaWindow,
  isNexaWindowOpen
};
