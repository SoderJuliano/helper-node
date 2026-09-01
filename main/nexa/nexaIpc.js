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
    configService.setNexaConfig(cfg);
    console.log("[NexaIPC] Configuração da Nexa salva:", cfg);
    // Idempotente de propósito: antes isso só reagia à TRANSIÇÃO OFF->ON, então
    // salvar com a Nexa já marcada como ligada (config antiga) não abria nada e
    // ela ficava invisível para sempre. createNexaWindow() já reusa a janela viva.
    if (cfg && cfg.enabled) {
      createNexaWindow();
    } else {
      closeNexaWindow();
    }
  });

  ipcMain.on("nexa:tts-ended", () => {
    console.log("[NexaIPC] Recebido término de reprodução de TTS -> transicionando para IDLE");
    if (nexaState.getState() === "SPEAKING") {
      nexaState.setState("IDLE");
    }
  });

  ipcMain.handle("nexa:resize-window", () => {
    // A janela da Nexa possui tamanho fixo de 360x360 e nunca deve aumentar.
    return { ok: false, error: "Tamanho fixo de 360x360" };
  });

  ipcMain.on("nexa:log-to-main", (event, { level, msg }) => {
    console.log(`[Renderer ${level.toUpperCase()}] ${msg}`);
  });
}

module.exports = {
  registerNexaIpc
};
