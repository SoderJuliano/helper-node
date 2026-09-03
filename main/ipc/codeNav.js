// main/ipc/codeNav.js
// Handlers IPC para funcionalidade de navegação de código (Go to Definition & Implementações)

const { ipcMain } = require('electron');
const symbolIndexer = require('../../services/symbolIndexer.js');
const javaImportChecker = require('../../services/javaImportChecker.js');

function ensureIndexed(filePath) {
  try {
    const { workspace } = require('../globals.js');
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    const targetProject = dir && dir.path ? dir.path : (filePath && !filePath.includes('.jar!') ? require('path').dirname(filePath) : null);
    if (targetProject) {
      const { normalizePath } = require('../../services/symbolIndexer/symbolConstants.js');
      const normTarget = normalizePath(targetProject);
      if (!symbolIndexer.projectPath || symbolIndexer.projectPath !== normTarget) {
        symbolIndexer.indexWorkspace(targetProject);
        return;
      }
    }
  } catch (_) {}
  if (!symbolIndexer.projectPath && filePath && !filePath.includes('.jar!')) {
    const path = require('path');
    symbolIndexer.indexWorkspace(path.dirname(filePath));
  }
}

module.exports = function registerCodeNavIPC() {
  ipcMain.handle('code-nav-find-definition', async (event, { filePath, symbol, lineText, content }) => {
    try {
      ensureIndexed(filePath);
      const matches = symbolIndexer.findDefinition(filePath, symbol, lineText);
      if (Array.isArray(matches) && matches.length > 0) return matches;

      // Se não achou diretamente no índice do workspace, tenta a resolução avançada do Java
      if (filePath && filePath.toLowerCase().endsWith('.java')) {
        const dep = javaImportChecker.resolveSymbolToJar(filePath, symbol, lineText, content || '');
        if (dep) {
          // 1. Arquivo de código fonte do próprio projeto
          if (dep.isSource || (dep.filePath && !dep.filePath.includes('.jar!'))) {
            return [{
              filePath: dep.filePath,
              line: dep.targetLine || 1,
              symbol,
              kind: dep.isMethod ? 'method' : 'class',
              className: dep.className || symbol,
              isDependency: false,
            }];
          }

          // 2. Dependência externa em biblioteca JAR / JDK
          if (dep.jarPath) {
            const fqcn = dep.fqcn || dep.fqn;
            return [{
              filePath: javaImportChecker.encodeVirtualPath(dep.jarPath, fqcn),
              line: dep.targetLine || 1,
              symbol,
              kind: dep.isMethod ? 'method' : 'class',
              className: dep.className || (fqcn ? fqcn.split('.').pop() : symbol),
              isDependency: true,
            }];
          }
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
      ensureIndexed(filePath);
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
