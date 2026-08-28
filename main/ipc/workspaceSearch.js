// main/ipc/workspaceSearch.js
// Busca de conteúdo textual nos arquivos do projeto.

const { ipcMain } = require('electron');
const path = require('path');
const fs2 = require('fs');
const { workspace, helpers } = require('../globals.js');

const PROJECT_SEARCH_SKIP_DIRS = new Set([
  "node_modules", ".git", ".gradle", "build", "target", ".idea", "dist", "out",
  ".gemini", ".metadata", ".settings", "bin", "obj", ".mvn", ".next", ".nuxt",
  "coverage", ".nyc_output", ".turbo", ".cache", "tmp", "temp", "vendor",
  "__pycache__", ".pytest_cache", ".venv", "venv", "env"
]);

function registerWorkspaceSearchIPC() {
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
            if (occurrences.length < MAX_OCCURRENCES) {
              const lines = text.split(/\r?\n/);
              for (let i = 0; i < lines.length && occurrences.length < MAX_OCCURRENCES; i++) {
                const lineText = lines[i];
                if (lineText.toLowerCase().includes(normalizedQuery)) {
                  occurrences.push({
                    path: absPath,
                    line: i + 1,
                    preview: lineText.trim().slice(0, 160)
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
}

module.exports = registerWorkspaceSearchIPC;
