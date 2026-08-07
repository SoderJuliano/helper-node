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

// O índice das bibliotecas é montado ao trocar de projeto, mas quem abre o app
// com um projeto JÁ aberto (o caso normal) nunca passa por essa troca. Sem esta
// checagem preguiçosa, Ctrl+clique em classe de lib não funcionava até o
// usuário reabrir o projeto na mão.
function ensureLibsIndexed() {
  try {
    const libSources = require('../../services/javaLibs/sourceIndex.js');
    const { workspace } = require('../globals.js');
    const dir = (workspace.list() || []).find((a) => a.type === 'dir');
    if (!dir || !dir.path) return null;
    if (!libSources.estaIndexado(dir.path)) libSources.indexar(dir.path);
    return libSources;
  } catch (e) {
    console.warn('[javaLibs] indexação preguiçosa falhou:', e.message);
    return null;
  }
}

module.exports = function registerCodeNavIPC() {
  ipcMain.handle('code-nav-find-definition', async (event, { filePath, symbol, lineText }) => {
    try {
      ensureIndexed(filePath);
      const achados = symbolIndexer.findDefinition(filePath, symbol, lineText);
      if (Array.isArray(achados) && achados.length > 0) return achados;

      // Não está no projeto: pode ser classe de biblioteca. Antes disto, clicar
      // num símbolo vindo de uma dependência simplesmente não fazia nada.
      const libSources = ensureLibsIndexed();
      if (!libSources) return [];
      const dados = symbolIndexer.fileMap.get(
        require('path').normalize(filePath || '').replace(/\\/g, '/')
      );
      const dicas = dados ? dados.imports.map(i => i.text) : [];
      const daLib = libSources.abrirDefinicao(symbol, dicas);
      return daLib ? [daLib] : [];
    } catch (e) {
      console.error('[codeNav] Erro ao buscar definição:', e);
      return null;
    }
  });

  // Bibliotecas do projeto (pom.xml / build.gradle resolvidos no repositório local)
  ipcMain.handle('libs:list', async () => {
    try {
      const javaLibs = require('../../services/javaLibs');
      const { workspace } = require('../globals.js');
      const dir = (workspace.list() || []).find((a) => a.type === 'dir');
      if (!dir) return { ok: false, libs: [], erro: 'nenhum projeto aberto' };
      return javaLibs.listarBibliotecas(dir.path);
    } catch (e) {
      console.error('[libs] falha ao listar:', e);
      return { ok: false, libs: [], erro: e.message };
    }
  });

  // Abre uma classe de biblioteca extraindo do -sources.jar pro cache.
  ipcMain.handle('libs:open-class', async (event, { className, imports }) => {
    try {
      const libSources = ensureLibsIndexed();
      if (!libSources) return null;
      return libSources.abrirDefinicao(className, imports || []);
    } catch (e) {
      console.error('[libs] falha ao abrir classe:', e);
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
