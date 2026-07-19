// services/workspace/store.js
// Estado em memória dos anexos da sessão (paths que a IA pode acessar).
// Persistido em ~/.config/helper-node/workspace.json pra sobreviver restart.

const fs = require("fs");
const path = require("path");
const os = require("os");

const STORE_DIR = path.join(os.homedir(), ".config", "helper-node");
const STORE_PATH = path.join(STORE_DIR, "workspace.json");

let state = {
  attachments: [],      // [{id, type:'file'|'dir', path, addedAt, sizeBytes, fileCount, ok}]
  contextSent: false,   // injetou listagem na primeira pergunta?
  summaries: [],        // ["resumo de msgs 1-5", "resumo de msgs 6-10", ...]
  msgCountAtLastSummary: 0,
};

function resolvePortalPath(filePath) {
  if (typeof filePath !== 'string') return filePath;
  if (process.platform !== 'linux') return filePath;
  
  if (!/^\/run\/user\/\d+\/doc\//.test(filePath)) {
    return filePath;
  }

  const { execSync } = require('child_process');
  const path = require('path');

  let current = path.resolve(filePath);
  let subPath = "";

  while (/^\/run\/user\/\d+\/doc\/.+/.test(current)) {
    try {
      const stdout = execSync(`getfattr -d -m "user.document-portal.host-path" "${current.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const match = stdout.match(/user\.document-portal\.host-path="([^"]+)"/);
      if (match && match[1]) {
        const resolved = match[1].trim();
        if (resolved) {
          const finalPath = subPath ? path.join(resolved, subPath) : resolved;
          console.log(`[workspace] resolved portal path: ${filePath} -> ${finalPath}`);
          return finalPath;
        }
      }
    } catch (e) {
      // Ignore
    }

    try {
      const stdout = execSync(`gio info -a "xattr::user.document-portal.host-path" "${current.replace(/"/g, '\\"')}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
      const match = stdout.match(/xattr::user\.document-portal\.host-path:\s*(.+)/);
      if (match && match[1]) {
        const resolved = match[1].trim();
        if (resolved) {
          const finalPath = subPath ? path.join(resolved, subPath) : resolved;
          console.log(`[workspace] resolved portal path: ${filePath} -> ${finalPath}`);
          return finalPath;
        }
      }
    } catch (e) {
      // Ignore
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    subPath = subPath ? path.join(path.basename(current), subPath) : path.basename(current);
    current = parent;
  }

  return filePath;
}

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    state = { ...state, ...parsed };
    // contextSent NUNCA persiste: cada restart/sessao re-injeta contexto 1x.
    state.contextSent = false;

    // Resolve any virtual portal paths loaded from persistence
    if (state.attachments && state.attachments.length > 0) {
      let changed = false;
      state.attachments = state.attachments.map(a => {
        const resolved = resolvePortalPath(a.path);
        if (resolved !== a.path) {
          changed = true;
          return { ...a, path: resolved };
        }
        return a;
      });
      if (changed) {
        save();
      }
    }
  } catch (e) {
    console.warn("[workspace] load falhou:", e.message);
  }
}

function save() {
  try {
    if (!fs.existsSync(STORE_DIR)) fs.mkdirSync(STORE_DIR, { recursive: true });
    // Salva tudo MENOS contextSent (e' efemero por sessao).
    const { contextSent, ...persisted } = state;
    fs.writeFileSync(STORE_PATH, JSON.stringify(persisted, null, 2), "utf8");
  } catch (e) {
    console.warn("[workspace] save falhou:", e.message);
  }
}

function add(attachment) {
  // dedup por path
  state.attachments = state.attachments.filter(a => a.path !== attachment.path);
  state.attachments.push({
    id: "att_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
    addedAt: new Date().toISOString(),
    ...attachment,
  });
  state.contextSent = false; // re-injeta contexto na próxima pergunta
  save();
}

function remove(id) {
  state.attachments = state.attachments.filter(a => a.id !== id);
  state.contextSent = false;
  save();
}

function clear() {
  state.attachments = [];
  state.contextSent = false;
  state.summaries = [];
  state.msgCountAtLastSummary = 0;
  save();
}

function list() { return state.attachments.slice(); }
function markContextSent() { state.contextSent = true; /* nao persiste */ }
function isContextSent() { return state.contextSent; }
function resetContextSent() { state.contextSent = false; }
function getSummaries() { return state.summaries.slice(); }
function appendSummary(text) {
  state.summaries.push(text);
  save();
}
function setMsgCountAtLastSummary(n) {
  state.msgCountAtLastSummary = n;
  save();
}
function getMsgCountAtLastSummary() { return state.msgCountAtLastSummary; }

function isPathAllowed(absPath) {
  if (!absPath) return false;
  for (const a of state.attachments) {
    if (absPath === a.path) return true;
    if (a.type === "dir" && absPath.startsWith(a.path + path.sep)) return true;
  }
  return false;
}

load();

module.exports = {
  add, remove, clear, list,
  markContextSent, isContextSent, resetContextSent,
  getSummaries, appendSummary,
  getMsgCountAtLastSummary, setMsgCountAtLastSummary,
  isPathAllowed,
  STORE_PATH,
  resolvePortalPath,
};
