// main/ipc/codeNav.js
// Handlers IPC para funcionalidade de navegação de código (Go to Definition & Implementações)

const { ipcMain } = require('electron');
const symbolIndexer = require('../../services/symbolIndexer.js');
const javaImportChecker = require('../../services/javaImportChecker.js');

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
  ipcMain.handle('code-nav-find-definition', async (event, { filePath, symbol, lineText, content }) => {
    try {
      ensureIndexed(filePath);
      const matches = symbolIndexer.findDefinition(filePath, symbol, lineText);
      if (Array.isArray(matches) && matches.length > 0) return matches;

      // Não achou no código do próprio projeto — se for Java, tenta resolver
      // como uma classe vinda de um jar do classpath ("ir para dentro da
      // dependência", igual IntelliJ faz com External Libraries).
      if (filePath && filePath.toLowerCase().endsWith('.java')) {
        const dep = javaImportChecker.resolveSymbolToJar(filePath, symbol, lineText, content || '');
        if (dep) {
          return [{
            filePath: javaImportChecker.encodeVirtualPath(dep.jarPath, dep.fqcn),
            line: dep.targetLine || 1,
            symbol,
            kind: dep.isMethod ? 'method' : 'class',
            className: dep.className || dep.fqcn.split('.').pop(),
            isDependency: true,
          }];
        }
      }
      return matches;
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
