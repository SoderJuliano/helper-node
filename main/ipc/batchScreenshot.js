// main/ipc/batchScreenshot.js
const { ipcMain, state, helpers } = require('../globals.js');

module.exports = function registerIpc() {
  ipcMain.on("batch-send", () => {
    if (helpers.processBatchScreenshots) {
      helpers.processBatchScreenshots();
    }
  });

  ipcMain.on("batch-clear", () => {
    if (helpers.clearBatchScreenshots) {
      helpers.clearBatchScreenshots();
    }
  });

  ipcMain.on("batch-close", () => {
    if (helpers.hideBatchScreenshotOverlay) {
      helpers.hideBatchScreenshotOverlay();
    }
  });

  ipcMain.on("batch-remove-item", (_event, id) => {
    if (helpers.removeScreenshotFromBatch) {
      helpers.removeScreenshotFromBatch(id);
    }
  });

  ipcMain.handle("get-batch-screenshots", () => {
    return state.batchScreenshots || [];
  });

  ipcMain.on("batch-add-pasted-image", async (_event, base64Data) => {
    if (!base64Data && helpers.readSystemClipboardImage) {
      base64Data = await helpers.readSystemClipboardImage();
    }
    if (base64Data && helpers.addScreenshotToBatch) {
      await helpers.addScreenshotToBatch(base64Data);
    }
  });

  ipcMain.handle("batch-paste-from-clipboard", async () => {
    try {
      let dataUrl = null;
      if (helpers.readSystemClipboardImage) {
        dataUrl = await helpers.readSystemClipboardImage();
      }
      if (dataUrl && helpers.addScreenshotToBatch) {
        await helpers.addScreenshotToBatch(dataUrl);
        return { success: true };
      }
      return { success: false, reason: "Nenhuma imagem no clipboard" };
    } catch (e) {
      console.warn("[batch-screenshot] falha ao colar do clipboard:", e.message);
      return { success: false, error: e.message };
    }
  });
};
