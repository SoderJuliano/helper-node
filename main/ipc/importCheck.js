// main/ipc/importCheck.js
// Handlers IPC para o checador de imports do modo IDE (JS/TS via TypeScript
// Compiler API + Java via classpath do Maven/Gradle). Despacha pro checker
// certo pela extensão do arquivo — cada um vive isolado no seu próprio módulo.

const { ipcMain } = require('electron');
const path = require('path');
const importChecker = require('../../services/importChecker.js');
const javaImportChecker = require('../../services/javaImportChecker.js');

function checkerFor(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.java') return javaImportChecker;
  if (importChecker.isSupported(filePath)) return importChecker;
  return null;
}

module.exports = function registerImportCheckIPC() {
  ipcMain.handle('import-check-get-diagnostics', async (event, { filePath, content }) => {
    try {
      const checker = checkerFor(filePath);
      if (!checker) return [];
      return checker.getDiagnostics(filePath, content);
    } catch (e) {
      console.error('[importCheck] Erro ao obter diagnósticos:', e);
      return [];
    }
  });

  ipcMain.handle('import-check-get-quickfixes', async (event, { filePath, content, start, length, errorCodes }) => {
    try {
      if (!importChecker.isSupported(filePath)) return [];
      return importChecker.getQuickFixes(filePath, content, start, length, errorCodes);
    } catch (e) {
      console.error('[importCheck] Erro ao obter quick fixes:', e);
      return [];
    }
  });

  ipcMain.handle('import-check-get-java-status', async (event, { filePath }) => {
    try {
      return javaImportChecker.getStatus(filePath);
    } catch (e) {
      console.error('[importCheck] Erro ao obter status Java:', e);
      return { recognized: false };
    }
  });
};
