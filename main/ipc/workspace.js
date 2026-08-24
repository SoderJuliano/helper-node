// main/ipc/workspace.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  ipcMain
} = require('../globals.js');

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
    if (!fs2.existsSync(oldPath)) {
      return { ok: false, error: "Arquivo ou pasta de origem não existe." };
    }
    if (fs2.existsSync(newPath)) {
      return { ok: false, error: "Já existe um arquivo ou pasta com o novo nome." };
    }
    fs2.renameSync(oldPath, newPath);
    return { ok: true };
  } catch (e) {
    console.error("[workspace:rename-item] erro:", e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle("get-project-context", async () => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir) return null;
    const name = path.basename(dir.path);
    let branch = null;
    try {
      const { execFile } = require("child_process");
      branch = await new Promise((resolve) => {
        execFile(
          "git",
          ["-C", dir.path, "rev-parse", "--abbrev-ref", "HEAD"],
          { timeout: 2500 },
          (err, stdout) => resolve(err ? null : (stdout || "").trim() || null)
        );
      });
    } catch (_) { /* sem git: mostra só o projeto */ }
    return { id: dir.id, name, path: dir.path, branch };
  } catch (e) {
    console.warn("[project-context] falhou:", e.message);
    return null;
  }
});

ipcMain.handle("get-project-git-status", async () => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir || !dir.path) {
      return { isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };
    }
    const projectPath = dir.path;
    const { execFile } = require("child_process");
    return await new Promise((resolve) => {
      execFile(
        "git",
        ["-C", projectPath, "status", "--porcelain", "-uall"],
        { timeout: 3500 },
        (err, stdout) => {
          if (err || !stdout) {
            return resolve({ isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} });
          }
          const lines = stdout.split("\n");
          const modifiedFiles = {};
          const modifiedDirs = {};
          let count = 0;

          for (const line of lines) {
            if (!line || line.length < 3) continue;
            const code = line.substring(0, 2);
            let relPath = line.substring(3).trim();
            if (relPath.includes(" -> ")) {
              relPath = relPath.split(" -> ")[1].trim();
            }
            if (relPath.startsWith('"') && relPath.endsWith('"')) {
              relPath = relPath.substring(1, relPath.length - 1);
            }
            relPath = relPath.replace(/\\/g, "/");
            if (!relPath) continue;

            let status = 'M';
            const x = code[0];
            const y = code[1];
            if ((x === 'A' || x === 'M' || x === 'R' || x === 'C') && (y === ' ' || y === '' || y === undefined)) {
              status = 'A'; // Staged (git add já feito) -> Verde
            } else {
              status = 'M'; // Modificado ainda não adicionado / untracked -> Vermelho
            }

            modifiedFiles[relPath] = status;
            count++;

            const parts = relPath.split('/');
            let currentParent = '';
            for (let i = 0; i < parts.length - 1; i++) {
              currentParent = currentParent ? `${currentParent}/${parts[i]}` : parts[i];
              modifiedDirs[currentParent] = true;
            }
          }
          resolve({ isGit: true, changesCount: count, modifiedFiles, modifiedDirs });
        }
      );
    });
  } catch (e) {
    console.warn("[get-project-git-status] falhou:", e.message);
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
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir) return null;
    const root = dir.path;
    const entries = helpers.collectProjectEntries(root);
    return { root, path: root, entries, tree: workspace.tree(root) || "" };
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

ipcMain.handle("search-project-content", async (_event, query) => {
  try {
    const dir = (workspace.list() || []).find((a) => a.type === "dir");
    if (!dir) return { ok: false, error: "nenhum projeto aberto", matches: [], occurrences: [] };
    const normalizedQuery = String(query || "").trim().toLowerCase();
    if (normalizedQuery.length < 4) return { ok: true, query: normalizedQuery, matches: [], occurrences: [] };

    const root = dir.path;
    const matches = [];
    const occurrences = [];
    const MAX_RESULTS = 200;
    const MAX_OCCURRENCES = 300;
    const MAX_FILE_SIZE = 1024 * 1024;

    const walk = (dirPath) => {
      if (matches.length >= MAX_RESULTS) return;
      let dirEntries = [];
      try {
        dirEntries = fs2.readdirSync(dirPath, { withFileTypes: true });
      } catch (_) {
        return;
      }
      dirEntries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      for (const dirent of dirEntries) {
        if (matches.length >= MAX_RESULTS) return;
        if (PROJECT_SEARCH_SKIP_DIRS.has(dirent.name)) continue;
        const absPath = path.join(dirPath, dirent.name);
        if (workspace.isPathAllowed && !workspace.isPathAllowed(absPath)) continue;
        if (dirent.isDirectory()) {
          walk(absPath);
          continue;
        }
        if (!dirent.isFile()) continue;
        let st;
        try {
          st = fs2.statSync(absPath);
        } catch (_) {
          continue;
        }
        if (!st.isFile() || st.size > MAX_FILE_SIZE) continue;
        let buffer;
        try {
          buffer = fs2.readFileSync(absPath);
        } catch (_) {
          continue;
        }
        if (helpers.isLikelyBinaryBuffer(buffer)) continue;
        const text = buffer.toString("utf8");
        const lowerText = text.toLowerCase();
        if (lowerText.includes(normalizedQuery)) {
          matches.push(absPath);
          let relPath = absPath;
          if (absPath.startsWith(root)) {
            relPath = absPath.substring(root.length).replace(/^[/\\]+/, '').replace(/\\/g, '/');
          } else {
            relPath = relPath.replace(/\\/g, '/');
          }
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const lineStr = lines[i];
            if (lineStr.toLowerCase().includes(normalizedQuery)) {
              if (occurrences.length < MAX_OCCURRENCES) {
                occurrences.push({
                  path: absPath,
                  relPath: relPath,
                  line: i + 1,
                  text: lineStr.trim()
                });
              }
            }
          }
        }
      }
    };

    walk(root);
    return { ok: true, query: normalizedQuery, matches, occurrences, limited: matches.length >= MAX_RESULTS };
  } catch (e) {
    console.warn("[search-project-content] falhou:", e.message);
    return { ok: false, error: e.message, matches: [], occurrences: [] };
  }
});

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
