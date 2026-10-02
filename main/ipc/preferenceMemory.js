// main/ipc/preferenceMemory.js
const { ipcMain } = require("electron");
const { configService, state, helpers } = require("../globals.js");
const preferenceMemoryService = require("../../services/preferenceMemoryService.js");

module.exports = function registerPreferenceMemoryIpc() {
  ipcMain.handle("preference-memory-get", () => {
    const cfg = configService.getPreferenceMemoryConfig();
    return {
      enabled: cfg.enabled !== false,
      filePath: preferenceMemoryService.getFilePath(),
      count: preferenceMemoryService.getEntryCount(),
    };
  });

  ipcMain.handle("preference-memory-set", (event, partial) => {
    configService.setPreferenceMemoryConfig(partial);
    return configService.getPreferenceMemoryConfig();
  });

  ipcMain.handle("preference-memory-save", (event, payload) => {
    const { prompt, rejected, chosen, feedback, model, tags } = payload || {};
    const entry = preferenceMemoryService.appendEntry({
      prompt,
      rejected,
      chosen,
      feedback: feedback || "correction",
      model: model || (helpers && helpers.getEffectiveAiModel ? helpers.getEffectiveAiModel() : ""),
      tags,
    });
    return { ok: !!entry, entry, count: preferenceMemoryService.getEntryCount() };
  });

  ipcMain.handle("preference-memory-list", () => {
    return preferenceMemoryService.getAllEntries();
  });

  ipcMain.on("preference-memory-open-file", () => {
    try {
      const p = preferenceMemoryService.getFilePath();
      const fs = require("fs");
      const path = require("path");
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(p)) fs.writeFileSync(p, "", "utf8");

      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.show();
        state.mainWindow.focus();
        state.mainWindow.webContents.send("open-file-in-viewer", p);
      }
    } catch (_) {}
  });
};
