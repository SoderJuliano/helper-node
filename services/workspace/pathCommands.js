// services/workspace/pathCommands.js
// Listagem cross-platform com fallback. Linux/macOS usam `ls -la` (com
// --time-style se GNU coreutils, senão simples). Windows futuro = `dir`.

const { exec } = require("child_process");
const util = require("util");
const fs = require("fs");
const path = require("path");
const os = require("os");
const execp = util.promisify(exec);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache",
  "__pycache__", "target", ".idea", ".vscode", "venv", ".venv", "env",
]);

// Lista um diretório usando `ls -la` (ou fallback puro Node se falhar).
// Retorna string formatada pronta pra incluir no prompt.
async function listDirFormatted(absPath, opts = {}) {
  const maxItems = opts.maxItems || 60;
  // Tenta GNU ls com --time-style
  try {
    const { stdout } = await execp(
      `ls -la --time-style=long-iso "${absPath}"`,
      { timeout: 4000, maxBuffer: 1024 * 1024 }
    );
    return truncateListing(stdout, maxItems);
  } catch (_) {}
  // Fallback: ls -la cru (macOS BSD)
  try {
    const { stdout } = await execp(`ls -la "${absPath}"`, { timeout: 4000, maxBuffer: 1024 * 1024 });
    return truncateListing(stdout, maxItems);
  } catch (_) {}
  // Último recurso: Node fs
  try {
    const entries = await fs.promises.readdir(absPath, { withFileTypes: true });
    const lines = [];
    for (const e of entries.slice(0, maxItems)) {
      const full = path.join(absPath, e.name);
      let size = "?";
      try { const st = await fs.promises.stat(full); size = String(st.size); } catch (_) {}
      lines.push(`${e.isDirectory() ? "d" : "-"} ${size.padStart(10)} ${e.name}${e.isDirectory() ? "/" : ""}`);
    }
    if (entries.length > maxItems) lines.push(`... +${entries.length - maxItems} itens`);
    return lines.join("\n");
  } catch (e) {
    return `(erro listando: ${e.message})`;
  }
}

function truncateListing(stdout, maxItems) {
  const lines = stdout.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= maxItems + 1) return lines.join("\n");
  const header = lines[0]; // "total N"
  const rest = lines.slice(1, maxItems + 1);
  const trailing = lines.length - maxItems - 1;
  return [header, ...rest, `... +${trailing} itens (use readDir/listDir pra ver mais)`].join("\n");
}

// Stat resumido pra um arquivo único
async function fileMeta(absPath) {
  try {
    const st = await fs.promises.stat(absPath);
    return {
      size: st.size,
      mtime: st.mtime.toISOString(),
      isDir: st.isDirectory(),
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Estima quantos arquivos um diretório tem (top-level apenas, rápido).
async function dirFileCount(absPath) {
  try {
    const entries = await fs.promises.readdir(absPath);
    return entries.length;
  } catch (_) { return 0; }
}

module.exports = { listDirFormatted, fileMeta, dirFileCount, IGNORE_DIRS };
