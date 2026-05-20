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

function load() {
  try {
    if (!fs.existsSync(STORE_PATH)) return;
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    state = { ...state, ...parsed };
    // contextSent NUNCA persiste: cada restart/sessao re-injeta contexto 1x.
    state.contextSent = false;
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
};
