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

  ipcMain.on("nexa:tts-ended", () => {
    console.log("[NexaIPC] Recebido término de reprodução de TTS -> transicionando para IDLE");
    if (nexaState.getState() === "SPEAKING") {
      nexaState.setState("IDLE");
    }
  });
}

module.exports = {
  registerNexaIpc
};
