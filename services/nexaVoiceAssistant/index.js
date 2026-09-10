/**
 * services/nexaVoiceAssistant/index.js
 * 
 * Fachada principal do pacote Nexa Voice Assistant (Modo de Voz Contínuo).
 * Registra IPCs dedicados e gerencia o ciclo de vida do assistente.
 */

const { ipcMain } = require("electron");
const NexaVoiceSession = require("./nexaVoiceSession");

let sessionInstance = null;

function getSession() {
  if (!sessionInstance) {
    sessionInstance = new NexaVoiceSession();
  }
  return sessionInstance;
}

function registerIpc() {
  const session = getSession();

  ipcMain.handle("nexa-voice:toggle", async (_event, forcedState) => {
    const shouldBeActive = typeof forcedState === "boolean" ? forcedState : !session.isActive();
    if (shouldBeActive) {
      const { configService } = require("../../main/globals");
      try {
        const { createNexaWindow, isNexaWindowOpen } = require("../../main/nexa/nexaWindow.js");
        if (!isNexaWindowOpen()) {
          createNexaWindow();
        }
      } catch (_) {}
      const micDevice = configService && typeof configService.getMicDevice === "function"
        ? configService.getMicDevice()
        : "";
      await session.start(micDevice);
    } else {
      session.stop();
    }
    return { active: session.isActive() };
  });

  ipcMain.handle("nexa-voice:get-status", () => {
    return {
      active: session.isActive(),
      followUpActive: session.followUpActive
    };
  });

  // Reencaminha eventos da sessão para a janela principal do Electron
  session.on("status-changed", (payload) => {
    const { state } = require("../../main/globals");
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      try {
        state.mainWindow.webContents.send("nexa-voice:status-changed", payload);
      } catch (_) {}
    }
  });

  session.on("state-changed", (payload) => {
    const { state } = require("../../main/globals");
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      try {
        state.mainWindow.webContents.send("nexa-voice:state-changed", payload);
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
    const animName = payload.animation;
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      try {
        state.nexaWindow.webContents.send("nexa:play-animation", { name: animName });
      } catch (_) {}
    }
  });

  // Quando o áudio da Nexa termina de ser reproduzido, aciona a janela de follow-up de 8s
  ipcMain.on("nexa:tts-ended", () => {
    if (session.isActive()) {
      session.handleTtsEnded();
    }
  });
}

module.exports = {
  start: (micDevice) => getSession().start(micDevice),
  stop: () => getSession().stop(),
  isActive: () => getSession().isActive(),
  toggle: () => getSession().isActive() ? getSession().stop() : getSession().start(),
  registerIpc,
  getSession
};
