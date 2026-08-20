// main/ipc/gitConflict.js
// Handlers IPC para resolução de conflitos Git em 3 vias (3-way merge)

const { ipcMain } = require('../globals.js');
const { GitConflictService } = require('../../services/gitConflictService.js');
const { workspace } = require('../globals.js');

function getCurrentProjectPath() {
  const dir = (workspace.list() || []).find((a) => a.type === 'dir');
  return dir ? dir.path : null;
}

module.exports = function registerGitConflictIpc() {
  // Retorna se o projeto atual tem conflitos e a lista de arquivos
  ipcMain.handle('git-conflict-get-status', async (event, projectPath) => {
    try {
      const pPath = projectPath || getCurrentProjectPath();
      if (!pPath) return { hasConflicts: false, count: 0, conflictFiles: [] };
      const status = await GitConflictService.detectGitConflicts(pPath);
      return { ok: true, data: status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Retorna os dados 3-way de um arquivo específico (Base, Ours, Theirs, Chunks)
  ipcMain.handle('git-conflict-get-file-3way', async (event, { projectPath, relPath } = {}) => {
    try {
      const pPath = projectPath || getCurrentProjectPath();
      if (!pPath || !relPath) return { ok: false, error: 'Parâmetros ausentes' };
      const data = await GitConflictService.getFile3WayData(pPath, relPath);
      return data;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Salva o arquivo resolvido e executa `git add`
  ipcMain.handle('git-conflict-save-resolved', async (event, { projectPath, relPath, content } = {}) => {
    try {
      const pPath = projectPath || getCurrentProjectPath();
      if (!pPath || !relPath) return { ok: false, error: 'Parâmetros ausentes' };
      const res = await GitConflictService.saveResolvedFile(pPath, relPath, content);
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Aborta o merge / rebase
  ipcMain.handle('git-conflict-abort-merge', async (event, projectPath) => {
    try {
      const pPath = projectPath || getCurrentProjectPath();
      if (!pPath) return { ok: false, error: 'Projeto não especificado' };
      const res = await GitConflictService.abortMerge(pPath);
      return res;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
};
