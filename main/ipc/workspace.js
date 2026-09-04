// main/ipc/workspace.js
const { path, fs2, workspace, state, helpers, ipcMain, configService, fileEditService } = require('../globals.js');

module.exports = function registerIpc() {
ipcMain.handle("get-workspace-access-enabled", () => {
  return configService.getWorkspaceAccessEnabled
    ? configService.getWorkspaceAccessEnabled()
    : false;
});

ipcMain.handle("workspace:pick-file", async () => {
  const { dialog } = require("electron");
  const res = await dialog.showOpenDialog(state.mainWindow, {
    title: "Anexar arquivo ao workspace",
    properties: ["openFile", "multiSelections"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const added = [];
  for (const p of res.filePaths) {
    try {
      await workspace.addPath(p, "file");
      const resolved = workspace.resolvePortalPath ? workspace.resolvePortalPath(p) : p;
      added.push(resolved);
    } catch (e) { console.warn("[workspace] add file falhou:", e.message); }
  }
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return { ok: true, added, attachments: workspace.list() };
});

ipcMain.handle("workspace:pick-dir", async () => {
  const { dialog } = require("electron");
  const res = await dialog.showOpenDialog(state.mainWindow, {
    title: "Anexar diretório ao workspace",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const added = [];
  // Modelo IDE: um projeto por vez — openProject substitui a pasta anterior.
  const prevDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
  for (const p of res.filePaths) {
    try {
      await workspace.openProject(p);
      const resolved = workspace.resolvePortalPath ? workspace.resolvePortalPath(p) : p;
      added.push(resolved);
    } catch (e) { console.warn("[workspace] open project falhou:", e.message); }
  }
  helpers.syncTerminalCwd();
  // Gemini CLI: reinicia sessão quando o projeto muda.
  const newDirs = workspace.list().filter(a => a.type === 'dir').map(a => a.path);
  const oldPath = prevDirs[0] || null;
  const newPath = newDirs[0] || null;
  const activeProvider = configService.getAiModel();
  if (oldPath !== newPath) {
    try {
      const symbolIndexer = require('../../services/symbolIndexer.js');
      if (newPath) symbolIndexer.indexWorkspace(newPath);
    } catch (err) {
      console.warn('[symbolIndexer] Falha ao indexar novo projeto:', err.message);
    }
    try {
      const workspaceWatcher = require('../../services/workspaceWatcher.js');
      if (newPath) {
        workspaceWatcher.startWatchingProject(newPath);
      } else {
        workspaceWatcher.stopWatching();
      }
    } catch (err) {
      console.warn('[workspaceWatcher] Falha ao alterar watcher:', err.message);
    }
    if (activeProvider === 'geminiCli') {
      GeminiCliProvider.changeProject(oldPath, newPath).catch(e =>
        console.warn('[workspace] GeminiCliProvider.changeProject falhou:', e.message)
      );
    }
  }
  if (oldPath !== newPath && activeProvider === 'claudeCli') {
    ClaudeCliProvider.changeProject(oldPath, newPath).catch(e =>
      console.warn('[claude-cli] changeProject error:', e.message)
    );
  }
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return { ok: true, added, attachments: workspace.list() };
});

ipcMain.handle("workspace:attach-project", async (_event, explicitPath) => {
  let targetPath = explicitPath;
  if (!targetPath) {
    const { dialog } = require("electron");
    const res = await dialog.showOpenDialog(state.mainWindow, {
      title: "Anexar mais um projeto ao workspace",
      properties: ["openDirectory"],
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    targetPath = res.filePaths[0];
  }
  try {
    const { MultiProjectService } = require("../../services/multiProject");
    const attachments = await MultiProjectService.attachProject(targetPath);
    helpers.syncTerminalCwd();
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
    }
    return { ok: true, path: targetPath, attachments };
  } catch (e) {
    console.warn("[workspace] attach project falhou:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:add-path", async (event, { path, type }) => {
  try {
    await workspace.addPath(path, type || "file");
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
    }
    return { ok: true, attachments: workspace.list() };
  } catch (e) {
    console.warn("[workspace] add path falhou:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:list", () => workspace.list());

ipcMain.handle("workspace:rename-item", async (event, { oldPath, newPath }) => {
  try {
    if (!oldPath || !newPath) {
      return { ok: false, error: "Caminhos inválidos para renomear." };
    }
    if (!fs2.existsSync(oldPath)) {
      return { ok: false, error: "Arquivo ou pasta de origem não existe." };
    }

    const normOld = path.resolve(oldPath);
    const normNew = path.resolve(newPath);

    const isCaseOnlyRename = process.platform === 'win32' && normOld.toLowerCase() === normNew.toLowerCase() && normOld !== normNew;
    if (isCaseOnlyRename) {
      const tempRenamePath = normOld + `.__rename_temp_${Date.now()}`;
      fs2.renameSync(normOld, tempRenamePath);
      fs2.renameSync(tempRenamePath, normNew);
    } else {
      if (normOld !== normNew && fs2.existsSync(normNew)) {
        return { ok: false, error: "Já existe um arquivo ou pasta com o novo nome." };
      }
      fs2.renameSync(normOld, normNew);
    }

    // Notifica mutação de arquivo para todo o sistema (editor, abas, watchers)
    helpers.emitFileMutated({ path: normNew, oldPath: normOld, origin: "user" });

    // Atualiza anexo de workspace se a raiz ou item estiver listado
    try {
      const atts = workspace.list();
      for (const a of atts) {
        if (path.resolve(a.path) === normOld) {
          a.path = normNew;
          a.name = path.basename(normNew);
        }
      }
    } catch (_) {}

    // Atualiza o indexador de símbolos
    try {
      const symbolIndexer = require('../../services/symbolIndexer.js');
      symbolIndexer.indexSingleFile(normNew);
    } catch (_) {}

    return { ok: true, oldPath: normOld, newPath: normNew };
  } catch (e) {
    console.error("[workspace:rename-item] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-project-context", async () => {
  try {
    const { MultiProjectService } = require("../../services/multiProject");
    const projects = await MultiProjectService.listAttachedProjects();
    if (!projects || projects.length === 0) return null;
    const primary = projects[0];
    return {
      id: primary.id,
      name: primary.name,
      path: primary.path,
      branch: primary.branch,
      isBuildTool: primary.isBuildTool,
      buildType: primary.buildType,
      isMulti: projects.length > 1,
      projects,
    };
  } catch (e) {
    console.warn("[project-context] falhou:", e.message);
    return null;
  }
});

let _lastGitStatusCache = { path: '', time: 0, data: null };
let _activeGitStatusPromise = null;
let _activeGitStatusChild = null;

ipcMain.handle("get-project-git-status", async (_event, payload) => {
  try {
    let projectPath = payload && payload.path;
    if (!projectPath) {
      const dir = (workspace.list() || []).find((a) => a.type === "dir");
      projectPath = dir && dir.path;
    }
    if (!projectPath) {
      return { isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };
    }

    const now = Date.now();
    if (!payload?.force && _lastGitStatusCache.path === projectPath && (now - _lastGitStatusCache.time) < 400 && _lastGitStatusCache.data) {
      return _lastGitStatusCache.data;
    }

    if (_activeGitStatusPromise && _activeGitStatusPromise.path === projectPath) {
      return await _activeGitStatusPromise.promise;
    }

    if (_activeGitStatusChild && _activeGitStatusPromise && _activeGitStatusPromise.path !== projectPath) {
      try { _activeGitStatusChild.kill(); } catch (_) {}
      _activeGitStatusChild = null;
    }

    const { execFile } = require("child_process");
    let childRef = null;
    const promise = new Promise((resolve) => {
      childRef = execFile(
        "git",
        ["--no-optional-locks", "-C", projectPath, "-c", "core.quotepath=false", "status", "--porcelain", "-uall"],
        { timeout: 5000, maxBuffer: 1024 * 1024 * 10 },
        (err, stdout) => {
          if (err) {
            if (_lastGitStatusCache.path === projectPath && _lastGitStatusCache.data) {
              return resolve(_lastGitStatusCache.data);
            }
            return resolve({ isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} });
          }
          if (!stdout) {
            const emptyRes = { isGit: true, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };
            _lastGitStatusCache = { path: projectPath, time: Date.now(), data: emptyRes };
            return resolve(emptyRes);
          }
          const lines = stdout.split(/\r?\n/);
          const modifiedFiles = {};
          const modifiedDirs = {};
          let count = 0;

          for (const line of lines) {
            if (!line || line.length < 3) continue;
            const code = line.substring(0, 2);
            let relPath = line.substring(3).trim();
            if (relPath.includes(" -> ")) relPath = relPath.split(" -> ")[1].trim();
            if (relPath.startsWith('"') && relPath.endsWith('"')) relPath = relPath.substring(1, relPath.length - 1);
            relPath = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
            if (!relPath) continue;

            const status = ((code[0] === 'A' || code[0] === 'M' || code[0] === 'R' || code[0] === 'C' || code[0] === 'D') && (!code[1] || code[1] === ' ')) ? 'A' : 'M';

            modifiedFiles[relPath] = status;
            modifiedFiles[relPath.toLowerCase()] = status;
            count++;

            const parts = relPath.split('/');
            let currentParent = '';
            for (let i = 0; i < parts.length - 1; i++) {
              currentParent = currentParent ? `${currentParent}/${parts[i]}` : parts[i];
              modifiedDirs[currentParent] = true;
              modifiedDirs[currentParent.toLowerCase()] = true;
            }
          }
          const result = { isGit: true, changesCount: count, modifiedFiles, modifiedDirs };
          _lastGitStatusCache = { path: projectPath, time: Date.now(), data: result };
          resolve(result);
        }
      );
      _activeGitStatusChild = childRef;
    });

    _activeGitStatusPromise = { path: projectPath, promise };
    const res = await promise;
    if (_activeGitStatusPromise && _activeGitStatusPromise.path === projectPath) {
      _activeGitStatusPromise = null;
      _activeGitStatusChild = null;
    }
    return res;
  } catch (e) {
    console.warn("[get-project-git-status] falhou:", e.message);
    if (_lastGitStatusCache.data) return _lastGitStatusCache.data;
    return { isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };
  }
});

ipcMain.handle("get-file-diff", async (event, payload) => {
  try {
    const filePath = payload && payload.path;
    const backupAt = payload && payload.backupAt;
    if (!filePath) return null;
    let oldText = "";
    if (backupAt && fs2.existsSync(backupAt)) {
      try { oldText = fs2.readFileSync(backupAt, "utf8"); } catch (_) {}
    }
    let newText = "";
    try { if (fs2.existsSync(filePath)) newText = fs2.readFileSync(filePath, "utf8"); } catch (_) {}
    const lines = helpers.computeLineDiff(oldText, newText);
    const adds = lines ? lines.filter((l) => l.t === "add").length : 0;
    const dels = lines ? lines.filter((l) => l.t === "del").length : 0;
    return { path: filePath, lines: lines || [], adds, dels, tooBig: !lines, isNew: !backupAt };
  } catch (e) {
    console.warn("[file-diff] falhou:", e.message);
    return null;
  }
});

ipcMain.handle("get-project-tree", async () => {
  try {
    const { MultiProjectService } = require("../../services/multiProject");
    const multiResult = MultiProjectService.collectMultiProjectEntries(helpers);
    if (!multiResult || !multiResult.entries || multiResult.entries.length === 0) return null;
    const primaryRoot = (multiResult.roots[0] && multiResult.roots[0].path) || '';
    return {
      root: primaryRoot,
      path: primaryRoot,
      isMulti: multiResult.isMulti,
      roots: multiResult.roots,
      entries: multiResult.entries,
      tree: primaryRoot ? (workspace.tree(primaryRoot) || "") : "",
    };
  } catch (e) {
    console.warn("[project-tree] falhou:", e.message);
    return null;
  }
});

ipcMain.handle("get-dir-children", async (_event, dirPath) => {
  try {
    if (!dirPath) return { ok: false, error: "path vazio", entries: [] };
    if (workspace.isPathAllowed && !workspace.isPathAllowed(dirPath)) {
      return { ok: false, error: "pasta fora do projeto/workspace", entries: [] };
    }
    const entries = helpers.collectDirChildren(dirPath);
    return { ok: true, path: dirPath, entries };
  } catch (e) {
    console.warn("[get-dir-children] falhou:", e.message);
    return { ok: false, error: e.message, entries: [] };
  }
});

const registerWorkspaceSearchIPC = require('./workspaceSearch.js');
registerWorkspaceSearchIPC();

const { resolveWorkspaceFilePath } = require('../helpers/pathResolver.js');

ipcMain.handle("read-file-content", async (event, filePath) => {
  try {
    if (!filePath) return { ok: false, error: "path vazio" };
    filePath = resolveWorkspaceFilePath(filePath, workspace);
    if (!filePath) return { ok: false, error: "caminho inválido" };

    // Classe dentro de um jar de dependência (nó "Dependencies" da árvore) —
    // caminho virtual, nunca existe no disco, fica fora do sandbox do
    // workspace de propósito (é leitura, vem do próprio classpath resolvido
    // do projeto, igual "External Libraries" do IntelliJ).
    if (filePath.includes(".jar!") || filePath.includes(".zip!")) {
      const javaImportChecker = require("../../services/javaImportChecker.js");
      const parsed = javaImportChecker.parseVirtualPath(filePath);
      if (!parsed) return { ok: false, error: "caminho de dependência inválido" };
      const res = javaImportChecker.getClassSource(parsed.jarPath, parsed.fqcn);
      if (!res.available) return { ok: false, error: res.reason || "sem código-fonte disponível" };
      return { ok: true, path: filePath, content: res.content, ext: "java", bytes: res.content.length, mtimeMs: 0 };
    }

    if (workspace.isPathAllowed && !workspace.isPathAllowed(filePath)) {
      return { ok: false, error: "arquivo fora do projeto/workspace" };
    }
    if (!fs2.existsSync(filePath)) return { ok: false, error: "arquivo não existe" };
    const st = fs2.statSync(filePath);
    if (!st.isFile()) return { ok: false, error: "não é um arquivo" };
    if (st.size > 20 * 1024 * 1024) return { ok: false, error: "arquivo grande demais (>20MB)" };
    const content = fs2.readFileSync(filePath, "utf8");
    // mtimeMs: o editor guarda esse valor como "baseline" pra detectar conflito
    // (arquivo mudou por fora entre abrir e salvar) — ver fileEditService.writeFile.
    return { ok: true, path: filePath, content, ext: path.extname(filePath).slice(1).toLowerCase(), bytes: st.size, mtimeMs: st.mtimeMs };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("editor-save-file", async (event, payload) => {
  try {
    let { path: filePath, content, expectedMtimeMs } = payload || {};
    if (!filePath) return { ok: false, error: "path vazio" };
    if (filePath.includes(".jar!") || filePath.includes(".zip!")) return { ok: false, error: "arquivo de dependência é somente leitura" };
    if (workspace.resolvePortalPath) {
      filePath = workspace.resolvePortalPath(filePath);
    }
    if (workspace.isPathAllowed && !workspace.isPathAllowed(filePath)) {
      return { ok: false, error: "arquivo fora do projeto/workspace" };
    }
    const res = fileEditService.writeFile(filePath, content || "", { expectedMtimeMs });
    helpers.emitFileMutated({ path: filePath, origin: "user" });
    try {
      const symbolIndexer = require('../../services/symbolIndexer.js');
      symbolIndexer.indexSingleFile(filePath, content);
    } catch (_) {}
    return res;
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("workspace:remove", (event, id) => {
  // Imagem colada vive numa pasta nossa: tirar o chip apaga o arquivo também,
  // senão a pasta acumula print que ninguém mais referencia. Arquivo do
  // usuário (isManagedPath false) nunca é tocado.
  try {
    const imageAttachments = require("../../services/imageAttachments.js");
    const target = workspace.list().find(a => a.id === id);
    if (target && target.origin === 'paste' && imageAttachments.isManagedPath(target.path)) {
      require("fs").unlinkSync(target.path);
    }
  } catch (e) {
    console.warn("[workspace] falha ao apagar imagem colada:", e && e.message);
  }
  workspace.removePath(id);
  helpers.syncTerminalCwd();
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("workspace-changed", { attachments: workspace.list() });
  }
  return workspace.list();
});

ipcMain.handle("workspace:clear", () => {
  workspace.clear();
  helpers.syncTerminalCwd();
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("workspace-changed", { attachments: [] });
  }
  return [];
});

ipcMain.handle("workspace:open-external", async (event, p) => {
  const { shell } = require("electron");
  try {
    // shell.openPath devolve string vazia em sucesso, ou msg de erro
    const err = await shell.openPath(p);
    if (!err) return { ok: true };
    // Fallback xdg-open (COSMIC as vezes recusa shell.openPath em dirs)
    const { spawn } = require("child_process");
    spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, fallback: "xdg-open", shellErr: err };
  } catch (e) {
    try {
      const { spawn } = require("child_process");
      spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
      return { ok: true, fallback: "xdg-open" };
    } catch (e2) {
      return { ok: false, error: e.message };
    }
  }
});

};
