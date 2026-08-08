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

  ipcMain.handle("nexa:read-file", async (event, filePath) => {
    const fs = require("fs");
    const path = require("path");
    try {
      if (!filePath) return { ok: false, error: "Caminho vazio" };
      let resolvedPath = filePath;
      if (!path.isAbsolute(filePath)) {
        // Resolve caminhos relativos em relação à raiz do projeto (helper-node/)
        resolvedPath = path.join(__dirname, "../../", filePath);
      }
      if (!fs.existsSync(resolvedPath)) {
        return { ok: false, error: `Arquivo não encontrado: ${resolvedPath}` };
      }
      const content = fs.readFileSync(resolvedPath, "utf8");
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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

  ipcMain.handle("nexa:resize-window", (event, width, height) => {
    const { state } = require("../globals.js");
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      const [currentX, currentY] = state.nexaWindow.getPosition();
      const [currentW, currentH] = state.nexaWindow.getSize();
      // Centraliza mantendo a posição relativa do avatar
      const newX = Math.round(currentX - (width - currentW) / 2);
      const newY = Math.round(currentY - (height - currentH) / 2);
      state.nexaWindow.setResizable(true);
      state.nexaWindow.setBounds({ x: newX, y: newY, width: Math.round(width), height: Math.round(height) });
      return { ok: true };
    }
    return { ok: false };
  });

  ipcMain.on("nexa:log-to-main", (event, { level, msg }) => {
    console.log(`[Renderer ${level.toUpperCase()}] ${msg}`);
  });
}

module.exports = {
  registerNexaIpc
};
