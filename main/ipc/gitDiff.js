// main/ipc/gitDiff.js
// Handlers IPC para visualização de Diff Git das alterações locais (unpushed + uncommitted + untracked).

const path = require('path');
const { ipcMain, fs2, workspace } = require('../globals.js');
const { GitDiffService } = require('../../services/gitDiff/gitDiffService.js');

function getCurrentProjectPath() {
  const list = workspace && workspace.list ? workspace.list() : [];
  const dir = (list || []).find((a) => a.type === 'dir');
  if (dir && dir.path) return dir.path;
  const anyItem = (list || [])[0];
  if (anyItem && anyItem.path) {
    try {
      return fs2.statSync(anyItem.path).isDirectory() ? anyItem.path : path.dirname(anyItem.path);
    } catch (_) {}
  }
  return null;
}

module.exports = function registerGitDiffIpc() {
  // Retorna resumo de arquivos alterados no projeto
  ipcMain.handle('git-diff:get-summary', async (event, projectPath) => {
    try {
      const pPath = projectPath || getCurrentProjectPath();
      if (!pPath) return { ok: false, error: 'Nenhum projeto ativo selecionado.' };
      const summary = await GitDiffService.getDiffSummary(pPath);
      return summary;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Retorna o diff detalhado lado a lado de um arquivo
  ipcMain.handle('git-diff:get-file', async (event, { projectPath, relPath, baseRef } = {}) => {
    try {
      const pPath = projectPath || getCurrentProjectPath();
      if (!pPath || !relPath) return { ok: false, error: 'Parâmetros ausentes para diff de arquivo.' };
      const diffData = await GitDiffService.getFileDiff(pPath, relPath, baseRef);
      return diffData;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Retorna o status de linha (m / A) de um arquivo aberto no editor
  ipcMain.handle('git-diff:get-file-line-status', async (event, { filePath } = {}) => {
    try {
      if (!filePath) return { ok: true, lines: {} };
      const res = await GitDiffService.getGitFileLineStatus(filePath);
      return res;
    } catch (e) {
      return { ok: false, error: e.message, lines: {} };
    }
  });
};
