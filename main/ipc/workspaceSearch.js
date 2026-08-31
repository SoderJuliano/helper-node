// main/ipc/workspaceSearch.js
// Busca de conteúdo textual nos arquivos do projeto com alta performance (Ripgrep / Git Grep / Node Scanner paralelo).

const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { workspace } = require('../globals.js');

const PROJECT_SEARCH_SKIP_DIRS = new Set([
  "node_modules", ".git", ".gradle", "build", "target", ".idea", "dist", "out",
  ".gemini", ".metadata", ".settings", "bin", "obj", ".mvn", ".next", ".nuxt",
  "coverage", ".nyc_output", ".turbo", ".cache", "tmp", "temp", "vendor",
  "__pycache__", ".pytest_cache", ".venv", "venv", "env", ".angular", ".svelte-kit",
  ".docusaurus", "bower_components", "jspm_packages", ".parcel-cache", ".pnpm-store",
  "Pods", "DerivedData"
]);

const BINARY_AND_HEAVY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar", ".bz2", ".xz",
  ".exe", ".dll", ".so", ".dylib", ".class", ".jar", ".war", ".ear", ".pyc", ".pyo", ".wasm",
  ".mp3", ".mp4", ".wav", ".ogg", ".avi", ".mov", ".flv", ".mkv",
  ".ttf", ".woff", ".woff2", ".eot", ".otf",
  ".psd", ".ai", ".sketch", ".fig",
  ".lock", ".bin", ".dat", ".db", ".sqlite", ".sqlite3", ".iso", ".dmg",
  ".map", ".min.js", ".min.css", ".bundle.js"
]);

let ripgrepAvailable = null;

function checkRipgrepAvailable() {
  if (ripgrepAvailable !== null) return Promise.resolve(ripgrepAvailable);
  return new Promise((resolve) => {
    execFile("rg", ["--version"], { timeout: 2000 }, (err) => {
      ripgrepAvailable = !err;
      resolve(ripgrepAvailable);
    });
  });
}

function parseGrepOutputLine(line, rootDir) {
  if (!line || !line.trim()) return null;
  let startIdx = 0;
  if (/^[a-zA-Z]:[\\/]/.test(line)) {
    startIdx = 2; // skip drive letter "C:"
  }
  const firstColon = line.indexOf(':', startIdx);
  if (firstColon === -1) return null;
  const secondColon = line.indexOf(':', firstColon + 1);
  if (secondColon === -1) return null;

  const rawPath = line.substring(0, firstColon).trim();
  const lineNumStr = line.substring(firstColon + 1, secondColon).trim();
  const lineNum = parseInt(lineNumStr, 10);
  if (isNaN(lineNum) || lineNum <= 0) return null;

  const text = line.substring(secondColon + 1);
  const cleanPath = rawPath.replace(/^\.[\\/]/, '');
  const absPath = path.isAbsolute(cleanPath) ? path.normalize(cleanPath) : path.normalize(path.resolve(rootDir, cleanPath));
  const relPath = path.relative(rootDir, absPath).replace(/\\/g, '/');

  return {
    path: absPath,
    relPath: relPath,
    line: lineNum,
    text: text.trimEnd(),
    preview: text.trim().slice(0, 180)
  };
}

function searchWithRipgrep(rootDir, query, maxResults = 250, maxOccurrences = 400) {
  return new Promise((resolve, reject) => {
    const args = [
      "--line-number",
      "--color=never",
      "--no-heading",
      "-F",
      "-i",
      "--max-columns", "300",
      "--max-columns-preview",
      "--max-count", "50",
      "--max-filesize", "2M",
      "--glob", "!node_modules/**",
      "--glob", "!.git/**",
      "--glob", "!build/**",
      "--glob", "!target/**",
      "--glob", "!.gradle/**",
      "--glob", "!.next/**",
      "--glob", "!dist/**",
      "--glob", "!coverage/**",
      "--glob", "!*.min.js",
      "--glob", "!*.min.css",
      "--glob", "!*.map",
      "--glob", "!*.lock",
      "-e", query,
      "."
    ];

    execFile("rg", args, { cwd: rootDir, maxBuffer: 15 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
      if (err && err.code !== 1) {
        return reject(err);
      }
      const rawLines = (stdout || "").split(/\r?\n/);
      const matchesSet = new Set();
      const occurrences = [];

      for (const line of rawLines) {
        if (!line) continue;
        const parsed = parseGrepOutputLine(line, rootDir);
        if (!parsed) continue;

        if (workspace.isPathAllowed && !workspace.isPathAllowed(parsed.path)) continue;

        if (!matchesSet.has(parsed.path)) {
          if (matchesSet.size < maxResults) {
            matchesSet.add(parsed.path);
          }
        }

        if (occurrences.length < maxOccurrences) {
          occurrences.push(parsed);
        }

        if (matchesSet.size >= maxResults && occurrences.length >= maxOccurrences) {
          break;
        }
      }

      resolve({
        ok: true,
        query,
        matches: Array.from(matchesSet),
        occurrences,
        limited: matchesSet.size >= maxResults || occurrences.length >= maxOccurrences,
        engine: "ripgrep"
      });
    });
  });
}

function searchWithGitGrep(rootDir, query, maxResults = 250, maxOccurrences = 400) {
  return new Promise((resolve) => {
    const isGit = fs.existsSync(path.join(rootDir, ".git"));
    if (!isGit) return resolve(null);

    const args = ["grep", "-n", "-I", "-i", "-F", "--max-depth=25", query];
    execFile("git", args, { cwd: rootDir, maxBuffer: 15 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
      if (err && err.code !== 1) return resolve(null);

      const rawLines = (stdout || "").split(/\r?\n/);
      const matchesSet = new Set();
      const occurrences = [];

      for (const line of rawLines) {
        if (!line) continue;
        const parsed = parseGrepOutputLine(line, rootDir);
        if (!parsed) continue;

        if (workspace.isPathAllowed && !workspace.isPathAllowed(parsed.path)) continue;

        if (!matchesSet.has(parsed.path)) {
          if (matchesSet.size < maxResults) {
            matchesSet.add(parsed.path);
          }
        }

        if (occurrences.length < maxOccurrences) {
          occurrences.push(parsed);
        }

        if (matchesSet.size >= maxResults && occurrences.length >= maxOccurrences) {
          break;
        }
      }

      resolve({
        ok: true,
        query,
        matches: Array.from(matchesSet),
        occurrences,
        limited: matchesSet.size >= maxResults || occurrences.length >= maxOccurrences,
        engine: "git-grep"
      });
    });
  });
}

async function searchWithNodeScanner(rootDir, query, maxResults = 250, maxOccurrences = 400) {
  const normalized = query.toLowerCase();
  const matchesSet = new Set();
  const occurrences = [];
  const queue = [rootDir];
  let filesChecked = 0;
  const MAX_FILES_CHECKED = 4000;
  const MAX_FILE_SIZE = 1.5 * 1024 * 1024;

  while (queue.length > 0 && filesChecked < MAX_FILES_CHECKED && matchesSet.size < maxResults) {
    const currentDir = queue.shift();
    let entries = [];
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (!PROJECT_SEARCH_SKIP_DIRS.has(ent.name)) {
          queue.push(path.join(currentDir, ent.name));
        }
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (BINARY_AND_HEAVY_EXTENSIONS.has(ext)) continue;

        const absPath = path.join(currentDir, ent.name);
        if (workspace.isPathAllowed && !workspace.isPathAllowed(absPath)) continue;

        filesChecked++;
        try {
          const st = await fs.promises.stat(absPath);
          if (st.size > MAX_FILE_SIZE) continue;

          const content = await fs.promises.readFile(absPath, "utf8");
          const lowerContent = content.toLowerCase();
          if (lowerContent.includes(normalized)) {
            matchesSet.add(absPath);
            const lines = content.split(/\r?\n/);
            const relPath = path.relative(rootDir, absPath).replace(/\\/g, "/");

            for (let i = 0; i < lines.length && occurrences.length < maxOccurrences; i++) {
              const lineText = lines[i];
              if (lineText.toLowerCase().includes(normalized)) {
                occurrences.push({
                  path: absPath,
                  relPath: relPath,
                  line: i + 1,
                  text: lineText.trimEnd().slice(0, 300),
                  preview: lineText.trim().slice(0, 180)
                });
              }
            }
          }
        } catch (_) {}

        if (filesChecked % 40 === 0) {
          await new Promise((r) => setImmediate(r));
        }
      }
    }
  }

  return {
    ok: true,
    query,
    matches: Array.from(matchesSet),
    occurrences,
    limited: matchesSet.size >= maxResults || occurrences.length >= maxOccurrences || filesChecked >= MAX_FILES_CHECKED,
    engine: "node-scanner"
  };
}

function registerWorkspaceSearchIPC() {
  ipcMain.handle("search-project-content", async (_event, query) => {
    try {
      const dir = (workspace.list() || []).find((a) => a.type === "dir");
      if (!dir) return { ok: false, error: "nenhum projeto aberto", matches: [], occurrences: [] };
      const normalizedQuery = String(query || "").trim();
      if (normalizedQuery.length < 3) return { ok: true, query: normalizedQuery, matches: [], occurrences: [] };

      const root = dir.path;
      const MAX_RESULTS = 250;
      const MAX_OCCURRENCES = 400;

      // 1. Tenta ripgrep (rg) — exatamente igual ao VS Code (< 50ms)
      const hasRg = await checkRipgrepAvailable();
      if (hasRg) {
        try {
          return await searchWithRipgrep(root, normalizedQuery, MAX_RESULTS, MAX_OCCURRENCES);
        } catch (e) {
          console.warn("[search-project-content] ripgrep falhou, tentando fallback:", e.message);
        }
      }

      // 2. Tenta git grep se for um repositório git (< 150ms)
      try {
        const gitResult = await searchWithGitGrep(root, normalizedQuery, MAX_RESULTS, MAX_OCCURRENCES);
        if (gitResult) return gitResult;
      } catch (e) {
        console.warn("[search-project-content] git-grep falhou, tentando fallback:", e.message);
      }

      // 3. Fallback: scanner Node assíncrono paralelo e não-bloqueante
      return await searchWithNodeScanner(root, normalizedQuery, MAX_RESULTS, MAX_OCCURRENCES);
    } catch (e) {
      console.warn("[search-project-content] falhou:", e.message);
      return { ok: false, error: e.message, matches: [], occurrences: [] };
    }
  });
}

module.exports = registerWorkspaceSearchIPC;
