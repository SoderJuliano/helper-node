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

function _bindLegacySessionEvents(session) {
  if (!session || session._eventsBound) return;
  session._eventsBound = true;

  // Reencaminha eventos da sessão para as janelas e atualiza o estado do Raphael Core
  session.on("status-changed", (payload) => {
    const { state, configService } = require("../../main/globals");
    if (payload && payload.active === false) {
      const nexaCfg = configService && typeof configService.getNexaConfig === "function" ? configService.getNexaConfig() : null;
      if (!nexaCfg || !nexaCfg.enabled) {
        try {
          const { closeNexaWindow } = require("../../main/nexa/nexaWindow.js");
          closeNexaWindow();
        } catch (_) {}
      }
    }
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      try {
        state.mainWindow.webContents.send("nexa-voice:status-changed", payload);
      } catch (_) {}
    }
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      try {
        state.nexaWindow.webContents.send("nexa-voice:status-changed", payload);
      } catch (_) {}
    }
  });

  session.on("state-changed", (payload) => {
    const { state } = require("../../main/globals");
    try {
      const { nexaState } = require("../../main/nexa/nexaState.js");
      if (payload && payload.state) {
        const stateMap = {
          "listening": "LISTENING",
          "transcribing": "THINKING",
          "thinking": "THINKING",
          "speaking": "SPEAKING",
          "working": "WORKING",
          "idle": "IDLE"
        };
        const targetState = stateMap[String(payload.state).toLowerCase()] || "IDLE";
        nexaState.setState(targetState);
      }
    } catch (_) {}

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      try {
        state.mainWindow.webContents.send("nexa-voice:state-changed", payload);
      } catch (_) {}
    }
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      try {
        state.nexaWindow.webContents.send("nexa-voice:state-changed", payload);
      } catch (_) {}
    }
  });

  session.on("speech-preview", (payload) => {
    const { state } = require("../../main/globals");
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      try {
        state.mainWindow.webContents.send("nexa-voice:speech-preview", payload);
      } catch (_) {}
    }
  });

  session.on("animation-trigger", (payload) => {
    const { state } = require("../../main/globals");
    const animName = payload && payload.animation ? payload.animation : payload;
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      try {
        state.nexaWindow.webContents.send("nexa:play-animation", { name: animName });
      } catch (_) {}
    }
  });
}

function getLegacySession() {
  if (!legacySessionInstance) {
    legacySessionInstance = new NexaVoiceSession();
    _bindLegacySessionEvents(legacySessionInstance);
  }
  return legacySessionInstance;
}

function shouldUseGeminiLive() {
  try {
    const { configService } = require("../../main/globals");
    const nexaCfg = configService && typeof configService.getNexaConfig === "function" ? configService.getNexaConfig() : null;
    // Só utiliza Gemini Live se o usuário explicitamente optou por 'geminiLive' nas configurações
    if (!nexaCfg || nexaCfg.voiceBackend !== "geminiLive") {
      return false;
    }
    const apiKey = configService && typeof configService.getGoogleApiKey === "function" ? configService.getGoogleApiKey() : "";
    return !!(apiKey && apiKey.trim());
  } catch (_) {
    return false;
  }
}

function registerIpc() {
  // Assegura binding prévio do legacy
  getLegacySession();

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
    try {
      console.log("[nexaVoiceAssistant] Iniciando modo de voz via Gemini Multimodal Live API.");
      return await geminiLiveController.start({ micDevice });
    } catch (liveErr) {
      console.warn(`[nexaVoiceAssistant] Live API indisponível (${liveErr.message}). Utilizando motor contínuo nativo.`);
    }
  }

  console.log("[nexaVoiceAssistant] Ativando motor contínuo nativo (VAD / Whisper / Raphael Core).");
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
