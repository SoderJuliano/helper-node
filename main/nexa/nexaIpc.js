/**
 * main/nexa/nexaIpc.js
 * Registro de canais IPC exclusivos para a janela e estado da Nexa.
 */

const { ipcMain } = require("electron");
const { nexaState } = require("./nexaState.js");
const { toggleNexaWindow, createNexaWindow, closeNexaWindow, isNexaWindowOpen } = require("./nexaWindow.js");

function registerNexaIpc() {
  ipcMain.handle("nexa:toggle", () => {
    return toggleNexaWindow();
  });

  ipcMain.handle("nexa:open", () => {
    createNexaWindow();
    return true;
  });

  ipcMain.handle("nexa:close", () => {
    closeNexaWindow();
    return true;
  });

  ipcMain.handle("nexa:get-state", () => {
    return nexaState.getState();
  });

  ipcMain.handle("nexa:is-open", () => {
    return isNexaWindowOpen();
  });

  ipcMain.handle("nexa:get-config", () => {
    const { configService } = require("../globals.js");
    return configService.getNexaConfig();
  });

  ipcMain.handle("nexa:get-animations", () => {
    const { NEXA_ANIMATIONS } = require("./nexaAnimations.js");
    return NEXA_ANIMATIONS;
  });

  ipcMain.on("nexa:save-config", (event, cfg) => {
    const { configService } = require("../globals.js");
    const oldCfg = configService.getNexaConfig();
    configService.setNexaConfig(cfg);
    console.log("[NexaIPC] Configuração da Nexa salva:", cfg);
    if (cfg && cfg.enabled && !oldCfg.enabled) {
      createNexaWindow();
    } else if (cfg && cfg.enabled === false && oldCfg.enabled) {
      closeNexaWindow();
    } else {
      const { applyNexaOnlyMode } = require("./nexaWindow.js");
      applyNexaOnlyMode(cfg);
    }
  });

  ipcMain.on("nexa:tts-ended", () => {
    console.log("[NexaIPC] Recebido término de reprodução de TTS -> transicionando para IDLE");
    if (nexaState.getState() === "SPEAKING") {
      nexaState.setState("IDLE");
    }
  });

  ipcMain.on("nexa:log-to-main", (event, { level, msg }) => {
    console.log(`[Renderer ${level.toUpperCase()}] ${msg}`);
  });
}

module.exports = {
  registerNexaIpc
};
