// services/workspace/contextBuilder.js
// Monta o bloco de contexto pra prepend no primeiro user message.
// Decide entre inline (cat) vs metadata-only baseado em token budget.

const fs = require("fs").promises;
const path = require("path");
const store = require("./store");
const pathCmd = require("./pathCommands");

// Budget aproximado por modelo (em CHARS, 1 token ≈ 4 chars pt-br).
const BUDGETS_CHARS = {
  "gpt-4.1-nano": 32000,
  "gpt-4.1": 80000,
  "gpt-4o-mini": 80000,
  "gpt-5.1": 100000,
  "llama3": 16000,         // backend ollama pequeno
  "qwen25": 48000,
  "llamatiny": 8000,
  "default": 16000,
};

const SMALL_FILE_INLINE_LIMIT = 8 * 1024;  // até 8KB cada arquivo vai inline
const PER_FILE_HARD_LIMIT = 64 * 1024;     // nunca cole >64KB

function budgetFor(modelKey) {
  if (!modelKey) return BUDGETS_CHARS.default;
  const key = String(modelKey).toLowerCase();
  for (const k of Object.keys(BUDGETS_CHARS)) {
    if (key.includes(k)) return BUDGETS_CHARS[k];
  }
  return BUDGETS_CHARS.default;
}

// Heurística simples pra detectar binário
function looksBinary(buffer) {
  const sample = buffer.slice(0, Math.min(512, buffer.length));
  let nullCount = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) nullCount++;
  return nullCount / sample.length > 0.01;
}

async function readSmallFileSafe(absPath) {
  try {
    const buf = await fs.readFile(absPath);
    if (looksBinary(buf)) return null;
    if (buf.length > PER_FILE_HARD_LIMIT) return null;
    return buf.toString("utf8");
  } catch (_) { return null; }
}

/**
 * Constrói o bloco de contexto pra anexar à primeira mensagem da sessão.
 * Retorna null se workspace vazio ou contexto já enviado.
 *
 * @param {object} opts
 * @param {string} opts.modelKey - identificador do modelo (pra budget)
 * @param {boolean} opts.force   - força re-injeção ignorando flag contextSent
 */
async function buildContextBlock(opts = {}) {
  const attachments = store.list();
  if (!attachments.length) return null;
  if (store.isContextSent() && !opts.force) return null;

  const budget = budgetFor(opts.modelKey);
  let used = 0;
  const sections = [];

  for (const att of attachments) {
    if (used > budget * 0.9) {
      sections.push(`\n[Limite de contexto atingido. Demais anexos só por path: ${attachments.slice(attachments.indexOf(att)).map(a => a.path).join(", ")}]`);
      break;
    }

    if (att.type === "dir") {
      const listing = await pathCmd.listDirFormatted(att.path, { maxItems: 80 });
      const block = `📁 ${att.path}\n${listing}\n`;
      used += block.length;
      sections.push(block);
    } else if (att.type === "file") {
      const meta = await pathCmd.fileMeta(att.path);
      let body = "";
      if (!meta.error && meta.size <= SMALL_FILE_INLINE_LIMIT) {
        const content = await readSmallFileSafe(att.path);
        if (content !== null) {
          body = `\n--- conteúdo ---\n${content}\n--- fim ---`;
        }
      }
      const block = `📄 ${att.path} (${meta.size || "?"} bytes)${body}\n`;
      used += block.length;
      sections.push(block);
    }
  }

  const header = [
    "=== CONTEXTO DE WORKSPACE ===",
    "O usuário anexou os seguintes paths como contexto. Você TEM PERMISSÃO de leitura e edição NELES (e só neles).",
    "Use as tools disponíveis (readFile, readFileChunk, listDir, writeFile, appendToFile, deleteFile, patchFile) pra interagir.",
    "Edições/exclusões SEMPRE pedem confirmação visual ao usuário antes de executar.",
    "",
  ].join("\n");

  const footer = [
    "",
    "=== FIM DO CONTEXTO ===",
    "",
  ].join("\n");

  return header + sections.join("\n") + footer;
}

module.exports = { buildContextBlock, budgetFor };
