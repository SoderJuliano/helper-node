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
};
