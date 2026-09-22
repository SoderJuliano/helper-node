// main/helpers/globalShortcuts.js
const {
  globalShortcut,
  state,
  helpers,
  configService,
  visionGuide,
} = require('../globals.js');

const isLinux = process.platform === 'linux';

async function registerGlobalShortcuts() {
  if (!state.mainWindow) return;

  globalShortcut.unregisterAll();

  const rawShortcuts = isLinux
    ? [
        { combo: "Ctrl+D", action: "toggle-recording" },
        { combo: "Ctrl+I", action: "manual-input" },
        { combo: "Ctrl+Shift+C", action: "open-config" },
        { combo: "Ctrl+Shift+X", action: "capture-screen" },
        { combo: "Ctrl+Shift+S", action: "capture-region-native" },
        { combo: "Alt+S", action: "toggle-batch-screenshot" },
        { combo: "Ctrl+Shift+1", action: "move-to-display-0" },
        { combo: "Ctrl+Shift+2", action: "move-to-display-1" },
      ]
    : [
        { combo: "CommandOrControl+D", action: "toggle-recording" },
        { combo: "CommandOrControl+I", action: "manual-input" },
        { combo: "CommandOrControl+Shift+C", action: "open-config" },
        { combo: "CommandOrControl+Shift+X", action: "capture-screen" },
        { combo: "CommandOrControl+Shift+S", action: "capture-region-native" },
        { combo: "Alt+S", action: "toggle-batch-screenshot" },
        { combo: "CommandOrControl+Shift+1", action: "move-to-display-0" },
        { combo: "CommandOrControl+Shift+2", action: "move-to-display-1" },
      ];

  const seenCombos = new Set();
  const allShortcuts = [];
  for (const item of rawShortcuts) {
    if (!seenCombos.has(item.combo)) {
      seenCombos.add(item.combo);
      allShortcuts.push(item);
    }
  }

  allShortcuts.forEach(({ combo, action }) => {
    const registered = globalShortcut.register(combo, async () => {
      if (helpers.isTranslationOnlyMode() && action !== "open-config" && action !== "capture-region-native") {
        console.log(`[mutex] atalho ${combo} (${action}) ignorado — TA + OS Integration ativos`);
        return;
      }

      if (action === "open-config") {
        helpers.createConfigWindow();
        return;
      }

      if (action === "manual-input") {
        await helpers.bringWindowToFocus();
        return;
      }

      if (action === "toggle-recording") {
        await helpers.toggleRecording();
        return;
      }

      if (action === "capture-screen") {
        await helpers.captureScreen();
        return;
      }

      if (action === "toggle-batch-screenshot") {
        if (helpers.toggleBatchScreenshot) {
          helpers.toggleBatchScreenshot();
        }
        return;
      }

      if (action === "capture-region-native") {
        if (configService.getOsIntegrationStatus() && visionGuide.isActive()) {
          try { visionGuide.analyzeNow(); } catch (e) { console.warn('[vision-guide] analyzeNow falhou:', e.message); }
          return;
        }
        try { await helpers.captureFullScreenAuto(); } catch (e) { console.error('captureFullScreenAuto failed:', e); }
        return;
      }

      if (action === "move-to-display-0") {
        helpers.moveToDisplay(0);
        return;
      }
      if (action === "move-to-display-1") {
        helpers.moveToDisplay(1);
        return;
      }

      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send(action);
        if (action === "focus-window" && state.mainWindow.isMinimized()) {
          state.mainWindow.restore();
        }
      }
    });
    console.log(
      registered
        ? `Shortcut registered: ${combo}`
        : `Failed to register shortcut: ${combo}`
    );
  });

  ["Ctrl+I", "CommandOrControl+I", "Ctrl+Shift+X", "CommandOrControl+Shift+X", "Ctrl+Shift+1", "CommandOrControl+Shift+1", "Ctrl+Shift+2", "CommandOrControl+Shift+2"].forEach(
    (accel) => {
      try {
        const ok = globalShortcut.isRegistered(accel);
        console.log(`isRegistered(${accel}): ${ok}`);
      } catch (e) {}
    }
  );
}

module.exports = {
  registerGlobalShortcuts,
};
