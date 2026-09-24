/**
 * services/nexaVoiceAssistant/index.js
 * 
 * Fachada principal do assistente de voz da Raphael / Nexa.
 * Alimentado 100% pela Gemini Multimodal Live API (Full-Duplex) e Raphael Core.
 * Transmissão bidirecional de áudio PCM contínuo, barge-in nativo e orquestração AGY.
 * Zero dependência de Whisper local ou processamento em lote (half-duplex).
 */

const { ipcMain } = require("electron");
const { controller: geminiLiveController } = require("../geminiLive");

function registerIpc() {
  ipcMain.handle("nexa-voice:toggle", async (_event, forcedState) => {
    return toggleVoice(forcedState);
  });

  ipcMain.handle("nexa-voice:get-status", () => {
    return {
      active: isVoiceActive(),
      liveConnected: geminiLiveController.isActive(),
      followUpActive: false,
      mode: "geminiLive"
    };
  });

  ipcMain.handle("gemini-live:send-text", async (_event, text) => {
    return await sendTextMessage(text);
  });

  ipcMain.on("nexa-voice:processing-started", () => {});
  ipcMain.on("nexa-voice:processing-finished", () => {});
}

async function sendTextMessage(text) {
  _ensureNexaWindowOpen();
  return await geminiLiveController.sendTextMessage(text);
}

async function startVoice(micDevice) {
  _ensureNexaWindowOpen();
  console.log("[nexaVoiceAssistant] Ativando modo de voz da Raphael via Gemini Multimodal Live API (Full-Duplex).");
  return await geminiLiveController.start({ micDevice });
}

function stopVoice() {
  if (geminiLiveController.isActive()) {
    geminiLiveController.stop();
  }
  _handleNexaWindowCloseIfNecessary();
}

async function toggleVoice(forcedState) {
  const currentActive = isVoiceActive();
  const shouldBeActive = typeof forcedState === "boolean" ? forcedState : !currentActive;

  if (shouldBeActive) {
    const { configService } = require("../../main/globals");
    const micDevice = configService && typeof configService.getMicDevice === "function"
      ? configService.getMicDevice()
      : "";
    await startVoice(micDevice);
  } else {
    stopVoice();
  }

  return { active: isVoiceActive() };
}

function isVoiceActive() {
  return geminiLiveController.isMicListening ? geminiLiveController.isMicListening() : geminiLiveController.isActive();
}

function _ensureNexaWindowOpen() {
  try {
    const { createNexaWindow, isNexaWindowOpen } = require("../../main/nexa/nexaWindow.js");
    if (!isNexaWindowOpen()) {
      createNexaWindow();
    }
  } catch (_) {}
}

function _handleNexaWindowCloseIfNecessary() {
  try {
    const { configService } = require("../../main/globals");
    const nexaCfg = configService && typeof configService.getNexaConfig === "function" ? configService.getNexaConfig() : null;
    if (!nexaCfg || !nexaCfg.enabled) {
      const { closeNexaWindow } = require("../../main/nexa/nexaWindow.js");
      closeNexaWindow();
    }
  } catch (_) {}
}

// Objeto de compatibilidade para código que consulta getSession()
const compatibilitySession = {
  isActive: () => geminiLiveController.isActive(),
  cancelAiExecution: () => {
    if (geminiLiveController.session) {
      geminiLiveController.session.disconnect();
    }
  },
  followUpActive: false,
  isSpeaking: false,
  isSpeakingAudio: false,
  isSpeakingTts: false,
  isQueryExecuting: false
};

module.exports = {
  start: startVoice,
  stop: stopVoice,
  isActive: isVoiceActive,
  toggle: toggleVoice,
  sendTextMessage,
  registerIpc,
  getSession: () => compatibilitySession,
  geminiLiveController
};
