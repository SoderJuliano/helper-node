/**
 * services/nexaVoiceAssistant/index.js
 * 
 * Fachada principal do pacote Nexa Voice Assistant (Modo de Voz Contínuo).
 * Registra IPCs dedicados e gerencia o ciclo de vida do assistente.
 * Integra nativamente a Gemini Multimodal Live API (Full-Duplex) e o Raphael Core.
 */

const { ipcMain } = require("electron");
const { controller: geminiLiveController } = require("../geminiLive");
const NexaVoiceSession = require("./nexaVoiceSession");

let legacySessionInstance = null;

function getLegacySession() {
  if (!legacySessionInstance) {
    legacySessionInstance = new NexaVoiceSession();
  }
  return legacySessionInstance;
}

function shouldUseGeminiLive() {
  try {
    const { configService } = require("../../main/globals");
    const apiKey = configService && typeof configService.getGoogleApiKey === "function" ? configService.getGoogleApiKey() : "";
    return !!(apiKey && apiKey.trim());
  } catch (_) {
    return false;
  }
}

function registerIpc() {
  ipcMain.handle("nexa-voice:toggle", async (_event, forcedState) => {
    return toggleVoice(forcedState);
  });

  ipcMain.handle("nexa-voice:get-status", () => {
    if (geminiLiveController.isActive()) {
      return {
        active: true,
        followUpActive: false,
        mode: "geminiLive"
      };
    }
    const legacy = getLegacySession();
    return {
      active: legacy.isActive(),
      followUpActive: legacy.followUpActive,
      mode: "legacy"
    };
  });

  // Quando o áudio começa a ser reproduzido
  ipcMain.on("play-tts-audio", () => {
    const legacy = getLegacySession();
    if (legacy.isActive()) {
      legacy.handleTtsStarted();
    }
  });

  // Quando o processamento da IA começa no chat
  ipcMain.on("nexa-voice:processing-started", () => {
    const legacy = getLegacySession();
    if (legacy.isActive()) {
      legacy.isQueryExecuting = true;
    }
  });

  // Quando o processamento da IA termina no chat sem áudio TTS
  ipcMain.on("nexa-voice:processing-finished", () => {
    const legacy = getLegacySession();
    if (legacy.isActive() && !legacy.isSpeakingTts) {
      legacy.handleAiProcessingFinished();
    }
  });

  // Quando o áudio da Nexa termina de ser reproduzido
  ipcMain.on("nexa:tts-ended", () => {
    const legacy = getLegacySession();
    if (legacy.isActive()) {
      legacy.handleTtsEnded();
    }
  });
}

async function startVoice(micDevice) {
  _ensureNexaWindowOpen();

  if (shouldUseGeminiLive()) {
    console.log("[nexaVoiceAssistant] Iniciando modo de voz via Gemini Multimodal Live API.");
    return geminiLiveController.start({ micDevice });
  }

  console.log("[nexaVoiceAssistant] Google API Key não detectada. Utilizando motor fallback local.");
  const legacy = getLegacySession();
  return legacy.start(micDevice);
}

function stopVoice() {
  if (geminiLiveController.isActive()) {
    geminiLiveController.stop();
  }
  const legacy = getLegacySession();
  if (legacy.isActive()) {
    legacy.stop();
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
  return geminiLiveController.isActive() || getLegacySession().isActive();
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

module.exports = {
  start: startVoice,
  stop: stopVoice,
  isActive: isVoiceActive,
  toggle: toggleVoice,
  registerIpc,
  getSession: () => getLegacySession(),
  geminiLiveController
};
