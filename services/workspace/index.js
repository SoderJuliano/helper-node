// services/workspace/index.js
// Fachada do módulo workspace. Importado pelo main.js e backendService.

const fs = require("fs");
const path = require("path");
const store = require("./store");
const pathCmd = require("./pathCommands");
const { buildContextBlock, budgetFor, generateTreeStructure } = require("./contextBuilder");
const summarizer = require("./conversationSummarizer");

async function addPath(absPath, type) {
  if (!absPath) throw new Error("path vazio");
  if (!fs.existsSync(absPath)) throw new Error("path não existe: " + absPath);
  const st = fs.statSync(absPath);
  const resolvedType = type || (st.isDirectory() ? "dir" : "file");
  if (resolvedType === "dir" && !st.isDirectory()) throw new Error("não é diretório");
  if (resolvedType === "file" && !st.isFile()) throw new Error("não é arquivo");

  let sizeBytes = 0, fileCount = 0;
  if (resolvedType === "file") {
    sizeBytes = st.size;
  } else {
    fileCount = await pathCmd.dirFileCount(absPath);
  }
  store.add({
    type: resolvedType,
    path: absPath,
    sizeBytes,
    fileCount,
    ok: true,
  });
  return store.list();
}

function removePath(id) {
  store.remove(id);
  return store.list();
}

function list() { return store.list(); }
function clear() { store.clear(); }
function isPathAllowed(p) { return store.isPathAllowed(p); }

// Árvore (blueprint) de um diretório — mesma usada no contexto da IA.
function tree(absPath) { return generateTreeStructure(absPath); }

// Modelo IDE: um projeto (pasta) por vez. Remove qualquer pasta já anexada
// antes de abrir a nova; arquivos avulsos são preservados.
async function openProject(absPath) {
  for (const a of store.list()) {
    if (a.type === "dir") store.remove(a.id);
  }
  await addPath(absPath, "dir");
  return store.list();
}

async function buildContextIfNeeded(modelKey, opts = {}) {
  return await buildContextBlock({ modelKey, ...opts });
}

function markContextSent() { store.markContextSent(); }
function resetContextSent() { store.resetContextSent(); }

async function compactHistoryIfNeeded(messages, opts) {
  return await summarizer.compactIfNeeded(messages, opts);
}

module.exports = {
  addPath, removePath, list, clear, isPathAllowed, tree, openProject,
  buildContextIfNeeded, markContextSent, resetContextSent,
  compactHistoryIfNeeded,
  budgetFor,
};
