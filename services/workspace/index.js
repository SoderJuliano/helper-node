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

const os = require("os");

function getProjectPath() {
  const items = store.list();
  // 1. Procura primeiro um item de diretório que exista no disco
  const dirItem = items.find(a => a.type === "dir" && a.path && fs.existsSync(a.path));
  if (dirItem) return dirItem.path;

  // 2. Se houver apenas arquivos anexados, pega a pasta pai do primeiro arquivo que exista
  const fileItem = items.find(a => a.path && fs.existsSync(a.path));
  if (fileItem) {
    const parent = path.dirname(fileItem.path);
    if (parent && parent !== "/" && fs.existsSync(parent)) return parent;
  }

  // 3. Fallback seguro: se process.cwd() for válido e NÃO for a raiz "/", usa process.cwd(), senão home do usuário
  const cwd = process.cwd();
  if (cwd && cwd !== "/" && fs.existsSync(cwd)) return cwd;
  return os.homedir();
}

module.exports = {
  addPath, removePath, list, clear, isPathAllowed, tree, openProject,
  buildContextIfNeeded, markContextSent, resetContextSent,
  compactHistoryIfNeeded, getProjectPath,
  budgetFor,
};

