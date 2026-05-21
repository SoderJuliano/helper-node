// services/workspace/contextBuilder.js
// Monta o bloco de contexto pra prepend no primeiro user message.
// Decide entre inline (cat) vs metadata-only baseado em token budget.

const fs = require("fs").promises;
const path = require("path");
const { execSync } = require("child_process");
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
 * Gera estrutura de diretórios tipo tree usando find (nativo).
 * Retorna string formatada com indentação ou null em erro.
 * Máximo ~100 linhas pra não explodir o prompt.
 * @param {string} rootPath
 */
function generateTreeStructure(rootPath) {
  try {
    const maxLines = 100;
    const cmd = `find "${rootPath}" -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/\\.*' -type f -o -type d 2>/dev/null | sort | head -${maxLines}`;
    const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' }).trim();
    
    if (!output) return '';

    const lines = output.split('\n');
    const formatted = lines.map(line => {
      const depth = (line.match(/\//g) || []).length - (rootPath.match(/\//g) || []).length;
      const indent = '  '.repeat(depth);
      const name = path.basename(line);
      const isDir = !name.includes('.') || name === '.' ? '/' : '';
      return indent + (name || rootPath) + isDir;
    }).join('\n');

    return formatted.length > 5000 ? formatted.slice(0, 5000) + '\n[...truncated]' : formatted;
  } catch (e) {
    console.warn('[tree] falhou gerar estrutura:', e.message);
    return '';
  }
}

/**
 * Detecta arquivos relevantes baseado em keywords da pergunta.
 * Heurística simples: extensões + nomes de arquivo.
 * @param {string} texto - pergunta do usuário
 * @param {array} attachments - lista de paths anexados
 */
function suggestRelevantFiles(texto, attachments) {
  const keywords = {};

  // Keywords → extensões/nomes de arquivo típicos
  if (/endpoint|rota|route|api|rest|controller|server/i.test(texto)) {
    Object.assign(keywords, {
      'backendService': 1,
      'controller': 1,
      'route': 1,
      'api': 1,
      '.ts': 0.5,
      '.js': 0.3,
    });
  }
  if (/config|ambiente|variable|env|secret|token/i.test(texto)) {
    Object.assign(keywords, {
      'config': 1,
      '.json': 0.5,
      '.env': 1,
      '.yml': 0.5,
    });
  }
  if (/banco|database|sql|query|schema|model/i.test(texto)) {
    Object.assign(keywords, {
      'database': 1,
      'model': 1,
      '.sql': 1,
      'schema': 0.5,
    });
  }
  if (/teste|test|unit|integration/i.test(texto)) {
    Object.assign(keywords, {
      'test': 1,
      'spec': 1,
    });
  }
  if (/package|depend|maven|npm|gradle/i.test(texto)) {
    Object.assign(keywords, {
      'package.json': 1,
      'pom.xml': 1,
      'build.gradle': 1,
      '.lock': 0.3,
    });
  }

  // Filtra attachments que matched keywords
  const scored = attachments.map(att => {
    let score = 0;
    const name = path.basename(att.path).toLowerCase();
    for (const [kw, weight] of Object.entries(keywords)) {
      if (name.includes(kw.toLowerCase())) score += weight;
    }
    return { path: att.path, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)  // top 5
    .map(x => `  • ${x.path}`)
    .join('\n');
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

  // Gera tree structure para ajudar IA entender layout do projeto
  let treeStructure = '';
  if (attachments.some(a => a.type === 'dir')) {
    const dirPath = attachments.find(a => a.type === 'dir')?.path;
    if (dirPath) {
      treeStructure = generateTreeStructure(dirPath);
    }
  }

  // Sugere arquivos relevantes baseado na pergunta (se houver no contexto)
  let relevantSuggestion = '';
  if (opts.userText) {
    const suggested = suggestRelevantFiles(opts.userText, attachments);
    if (suggested) {
      relevantSuggestion = `Arquivos sugeridos para análise:\n${suggested}`;
    }
  }

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
    "",
    treeStructure ? `Estrutura de diretórios:\n\`\`\`\n${treeStructure}\n\`\`\`` : '',
    relevantSuggestion ? `\n${relevantSuggestion}` : '',
    "",
    "Use as tools disponíveis (readFile, readFileChunk, listDir, writeFile, appendToFile, deleteFile, patchFile) pra interagir.",
    "Edições/exclusões SEMPRE pedem confirmação visual ao usuário antes de executar.",
    "",
  ].filter(Boolean).join("\n");

  const footer = [
    "",
    "=== FIM DO CONTEXTO ===",
    "",
  ].join("\n");

  return header + sections.join("\n") + footer;
}

module.exports = { buildContextBlock, budgetFor };
