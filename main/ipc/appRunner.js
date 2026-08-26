// main/ipc/appRunner.js
// Handlers IPC para execução local de aplicações e testes (Gradle / Maven / Spring Boot / JUnit)

const { ipcMain, state } = require('../globals.js');
const { AppRunnerService } = require('../../services/appRunner');

module.exports = function registerAppRunnerIpc() {
  const runner = AppRunnerService.runner;

  // Encaminha eventos do processo para o renderer (mainWindow)
  runner.on('data', (chunk) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-stream-chunk', chunk);
      }
    } catch (_) {}
  });

  runner.on('status', (statusData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-status-changed', statusData);
      }
    } catch (_) {}
  });

  runner.on('test-event', (testData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-test-event', testData);
      }
    } catch (_) {}
  });

  runner.on('test-summary', (summaryData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-test-summary', summaryData);
      }
    } catch (_) {}
  });

  runner.on('app-event', (appData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-app-event', appData);
      }
    } catch (_) {}
  });

  ipcMain.handle('app-runner-detect-jdks', async (event, preferredPath) => {
    try {
      return { ok: true, data: AppRunnerService.detectJdks(preferredPath) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-detect-project', async (event, projectDir) => {
    try {
      return { ok: true, data: AppRunnerService.detectProject(projectDir) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-parse-java', async (event, { source, filePath } = {}) => {
    try {
      return { ok: true, data: AppRunnerService.parseJavaFile(source, filePath) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-run', async (event, { projectDir, target, preferredJdkPath } = {}) => {
    try {
      const res = AppRunnerService.runTarget(projectDir, target, preferredJdkPath);
      return { ok: true, data: res };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-stop', async () => {
    try {
      const stopped = AppRunnerService.stopCurrent();
      return { ok: true, stopped };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-get-status', async () => {
    try {
      return { ok: true, data: AppRunnerService.getStatus() };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-get-config', async (event, projectDir) => {
    try {
      const config = AppRunnerService.getProjectConfig(projectDir);
      const buildInfo = AppRunnerService.detectProject(projectDir);
      return { ok: true, config, buildInfo, data: config };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-save-config', async (event, arg1, arg2) => {
    try {
      let projectDir = '';
      let config = {};
      if (typeof arg1 === 'string') {
        projectDir = arg1;
        config = arg2 || {};
      } else if (arg1 && typeof arg1 === 'object') {
        projectDir = arg1.projectDir || '';
        config = arg1.config !== undefined ? arg1.config : arg1;
      }
      const saved = AppRunnerService.saveProjectConfig(projectDir, config);
      return { ok: true, config: saved, data: saved };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-reimport-intellij', async (event, projectDir) => {
    try {
      const reimported = AppRunnerService.reimportIntelliJConfig(projectDir);
      return { ok: true, config: reimported, data: reimported };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.on('open-app-runner-config', (event, projectDir) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.show();
        state.mainWindow.focus();
        state.mainWindow.webContents.send('open-app-runner-config-modal', projectDir);
      }
    } catch (_) {}
  });
};
