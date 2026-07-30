// main/ipc/codeNav.js
// Handlers IPC para funcionalidade de navegação de código (Go to Definition & Implementações)

const { ipcMain } = require('electron');
const symbolIndexer = require('../../services/symbolIndexer.js');

function ensureIndexed(filePath) {
  if (!symbolIndexer.projectPath) {
    try {
      const { workspace } = require('../globals.js');
      const dir = (workspace.list() || []).find((a) => a.type === "dir");
      if (dir && dir.path) {
        symbolIndexer.indexWorkspace(dir.path);
        return;
      }
    } catch (_) {}
    if (filePath) {
      const path = require('path');
      symbolIndexer.indexWorkspace(path.dirname(filePath));
    }
  }
}

module.exports = function registerCodeNavIPC() {
  ipcMain.handle('code-nav-find-definition', async (event, { filePath, symbol, lineText }) => {
    try {
      ensureIndexed(filePath);
      return symbolIndexer.findDefinition(filePath, symbol, lineText);
    } catch (e) {
      console.error('[codeNav] Erro ao buscar definição:', e);
      return null;
    }
  });

  ipcMain.handle('code-nav-find-usages', async (event, { filePath, symbol }) => {
    try {
      ensureIndexed(filePath);
      return symbolIndexer.findUsages(filePath, symbol);
    } catch (e) {
      console.error('[codeNav] Erro ao buscar usos:', e);
      return [];
    }
  });

  ipcMain.handle('code-nav-get-implementations', async (event, { filePath, lineNum, symbol }) => {
    try {
      ensureIndexed(filePath);
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
