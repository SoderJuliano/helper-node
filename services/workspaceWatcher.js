// services/workspaceWatcher.js
// Watcher leve do sistema de arquivos do projeto em tempo real (OS File System Watcher).
// Notifica o editor quando arquivos do workspace são alterados no disco (ex.: git pull, terminal, script externo).

const fs = require('fs');
const path = require('path');

const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', 'target', 'build', '.idea', '.vscode', '.gradle', '.mvn',
  'out', 'bin', '.settings', 'dist', 'coverage', 'tmp', '.cache'
]);

let currentWatcher = null;
let currentWatchedPath = null;
const debounceTimers = new Map();

function shouldIgnorePath(relOrAbsPath) {
  if (!relOrAbsPath) return true;
  const parts = String(relOrAbsPath).replace(/\\/g, '/').split('/');
  return parts.some(part => IGNORED_DIR_NAMES.has(part) || part.endsWith('.tmp') || part.endsWith('~'));
}

function stopWatching() {
  if (currentWatcher) {
    try { currentWatcher.close(); } catch (_) {}
    currentWatcher = null;
  }
  currentWatchedPath = null;
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
}

function startWatchingProject(projectDir) {
  if (!projectDir || !fs.existsSync(projectDir)) {
    stopWatching();
    return;
  }
  const normProjectDir = path.normalize(projectDir);
  if (currentWatchedPath === normProjectDir && currentWatcher) {
    return;
  }

  stopWatching();
  currentWatchedPath = normProjectDir;

  try {
    currentWatcher = fs.watch(normProjectDir, { recursive: true }, (eventType, filename) => {
      if (!filename || shouldIgnorePath(filename)) return;

      const fullPath = path.join(normProjectDir, filename);

      if (debounceTimers.has(fullPath)) {
        clearTimeout(debounceTimers.get(fullPath));
      }

      debounceTimers.set(fullPath, setTimeout(() => {
        debounceTimers.delete(fullPath);

        try {
          if (fs.existsSync(fullPath)) {
            const st = fs.statSync(fullPath);
            if (st.isFile()) {
              const { helpers } = require('../main/globals.js');
              if (helpers && helpers.emitFileMutated) {
                helpers.emitFileMutated({ path: fullPath, origin: 'disk', mtimeMs: st.mtimeMs });
              }
            }
          }
        } catch (_) {}
      }, 120));
    });
    console.log(`[workspaceWatcher] Iniciado watcher em tempo real em: ${normProjectDir}`);
  } catch (err) {
    console.warn('[workspaceWatcher] Falha ao iniciar watcher no diretório:', err.message);
  }
}

module.exports = {
  startWatchingProject,
  stopWatching
};
