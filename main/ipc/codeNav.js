// main/ipc/codeNav.js
// Handlers IPC para funcionalidade de navegação de código (Go to Definition & Implementações)

const { ipcMain } = require('electron');
const symbolIndexer = require('../../services/symbolIndexer.js');

module.exports = function registerCodeNavIPC() {
  ipcMain.handle('code-nav-find-definition', async (event, { filePath, symbol, lineText }) => {
    try {
      return symbolIndexer.findDefinition(filePath, symbol, lineText);
    } catch (e) {
      console.error('[codeNav] Erro ao buscar definição:', e);
      return null;
    }
  });

  ipcMain.handle('code-nav-get-implementations', async (event, { filePath, lineNum, symbol }) => {
    try {
      return symbolIndexer.findImplementations(filePath, lineNum, symbol);
    } catch (e) {
      console.error('[codeNav] Erro ao buscar implementações:', e);
      return [];
    }
  });

  ipcMain.handle('code-nav-get-gutter-info', async (event, { filePath }) => {
    try {
      return symbolIndexer.getGutterInfo(filePath);
    } catch (e) {
      console.error('[codeNav] Erro ao buscar informações de gutter:', e);
      return [];
    }
  });

  ipcMain.handle('code-nav-reindex', async (event, { projectPath }) => {
    try {
      await symbolIndexer.indexWorkspace(projectPath);
      return { success: true };
    } catch (e) {
      console.error('[codeNav] Erro ao re-indexar workspace:', e);
      return { success: false, error: e.message };
    }
  });
};
