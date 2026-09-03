// main/ipc/appRunner.js
// Handlers IPC para execução local de aplicações e testes (Gradle / Maven / Spring Boot / JUnit / Multi-Project)

const { ipcMain, state } = require('../globals.js');
const { AppRunnerService } = require('../../services/appRunner');
const { multiRunner, MultiRunnerService } = require('../../services/multiProject');

module.exports = function registerAppRunnerIpc() {
  const runner = AppRunnerService.runner;

  // 1. Escuta eventos do runner legado (compatibilidade direta)
  runner.on('data', (chunk) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-stream-chunk', typeof chunk === 'string' ? chunk : chunk);
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

  // 2. Escuta eventos do multiRunner concorrente (Multi-Project)
  multiRunner.on('data', (payload) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-stream-chunk', payload);
      }
    } catch (_) {}
  });

  multiRunner.on('status', (statusData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-status-changed', statusData);
      }
    } catch (_) {}
  });

  multiRunner.on('test-event', (testData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-test-event', testData);
      }
    } catch (_) {}
  });

  multiRunner.on('test-summary', (summaryData) => {
    try {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('app-runner-test-summary', summaryData);
      }
    } catch (_) {}
  });

  multiRunner.on('app-event', (appData) => {
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

  ipcMain.handle('app-runner-run', async (event, { projectDir, target, preferredJdkPath, runId } = {}) => {
    try {
      const res = multiRunner.start(projectDir, target, preferredJdkPath, runId);
      return { ok: true, data: res, runId: res.runId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-stop', async (event, runId) => {
    try {
      const stopped = runId ? multiRunner.stop(runId) : multiRunner.stopAll();
      return { ok: true, stopped };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-stop-all', async () => {
    try {
      const stopped = multiRunner.stopAll();
      return { ok: true, stopped };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-get-status', async (event, runId) => {
    try {
      return { ok: true, data: multiRunner.getStatus(runId) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('app-runner-list-runners', async () => {
    try {
      return { ok: true, data: multiRunner.getAllRunners() };
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

  ipcMain.handle('app-runner-find-test-location', async (event, { projectDir, className, methodName } = {}) => {
    try {
      const loc = AppRunnerService.findTestLocation(projectDir, className, methodName);
      if (loc) {
        return { ok: true, data: loc };
      }
      return { ok: false, error: 'Localização do teste não encontrada' };
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
