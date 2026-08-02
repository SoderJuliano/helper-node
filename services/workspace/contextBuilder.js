// services/workspace/contextBuilder.js
// Monta o bloco de contexto pra prepend no primeiro user message.
// Decide entre inline (cat) vs metadata-only baseado em token budget.

const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const store = require("./store");
const pathCmd = require("./pathCommands");

// Budget aproximado por modelo (em CHARS, 1 token ≈ 4 chars pt-br).
const BUDGETS_CHARS = {
  "gpt-4.1-nano": 32000,
  "gpt-4.1": 80000,
  "gpt-4o-mini": 80000,
  "gpt-5.1": 100000,
  "gpt-5.4-mini": 100000,  // antes de "gpt-5.4" (budgetFor casa por substring)
  "gpt-5.4": 128000,
  "gpt-5.5": 128000,
  "gpt-5.6-luna": 100000,
  "gpt-5.6-terra": 128000,
  "gpt-5.6-sol": 128000,
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

// Diretórios de build/cache que nunca entram na árvore nem nos candidatos.
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build', '.idea', '__pycache__', '.venv', 'dist',
]);

// Arquivo morto não é candidato a nada. Um ".bak" chegou a ser SUGERIDO pro
// agente ("configService.js.bak"), e sugestão é a primeira coisa que ele
// persegue: cada arquivo irrelevante na lista custa uma rodada inteira.
const SUFIXOS_MORTOS = /\.(bak|old|orig|tmp|swp|log|min\.js|min\.css|map)$|~$/i;

function ehArquivoMorto(nome) {
  return SUFIXOS_MORTOS.test(nome);
}

/**
 * Percorre o diretório em Node puro.
 *
 * Antes isto era `find ... | grep -v | sort | head` via execSync. No Windows não
 * existe `find` do Unix nem `grep`, então o comando falhava INTEIRO e a função
 * devolvia '' — a árvore do projeto ia VAZIA no prompt ("estrutura gerada: 1
 * linhas, 0 chars") e o modelo não enxergava nada do projeto anexado, mesmo com
 * o usuário tendo anexado a pasta. Em Node funciona nos três sistemas.
 *
 * @returns {Array<{path: string, isDir: boolean}>} ordenado, no máximo maxItems
 */
function walkPaths(rootPath, { maxItems, filesOnly = false }) {
  const out = [];
  const stack = [rootPath];
  while (stack.length && out.length < maxItems) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue; // sem permissão / sumiu no meio: ignora e segue
    }
    for (const entry of entries) {
      if (out.length >= maxItems) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (!filesOnly) out.push({ path: full, isDir: true });
        stack.push(full);
      } else if (entry.isFile()) {
        if (ehArquivoMorto(entry.name)) continue;
        out.push({ path: full, isDir: false });
      }
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Gera estrutura de diretórios tipo tree.
 * Retorna string formatada com indentação, ou '' se não der pra ler.
 * Máximo ~100 linhas pra não explodir o prompt.
 * @param {string} rootPath
 */
function generateTreeStructure(rootPath) {
  try {
    const entries = walkPaths(rootPath, { maxItems: 100 });
    if (!entries.length) return '';

    const formatted = entries.map(({ path: full, isDir }) => {
      const rel = path.relative(rootPath, full);
      // Profundidade pelo separador do SISTEMA (antes contava só '/', que no
      // Windows nunca aparece e deixava tudo no mesmo nível).
      const depth = rel ? rel.split(/[\\/]/).length - 1 : 0;
      return '  '.repeat(depth) + path.basename(full) + (isDir ? '/' : '');
    }).join('\n');

    return formatted.length > 5000 ? formatted.slice(0, 5000) + '\n[...truncated]' : formatted;
  } catch (e) {
    console.warn('[tree] falhou gerar estrutura:', e.message);
    return '';
  }
}

function collectCandidatePaths(attachments, maxItems = 220) {
  const out = [];
  for (const att of attachments) {
    if (att.type === 'file') {
      out.push(att.path);
      continue;
    }
    if (att.type !== 'dir') continue;
    try {
      out.push(...walkPaths(att.path, { maxItems, filesOnly: true }).map((e) => e.path));
    } catch (_) {
      // best effort: em caso de falha, segue com os anexos já conhecidos
    }
  }
  return Array.from(new Set(out));
}

/**
 * Detecta arquivos relevantes baseado em keywords da pergunta.
 * Heurística simples: extensões + nomes de arquivo.
 * @param {string} texto - pergunta do usuário
 * @param {array} attachments - lista de paths anexados
 */
function suggestRelevantFiles(texto, attachments, candidates = []) {
  const keywords = {};
  let hasKeyword = false;

  // Keywords → extensões/nomes de arquivo típicos
  if (/endpoint|rota|route|api|rest|controller|server|servi[cç]o|backend/i.test(texto)) {
    Object.assign(keywords, {
      'backendService': 1,
      'controller': 1,
      'route': 1,
      'api': 1,
      'service': 0.7,
      '.ts': 0.5,
      '.js': 0.3,
    });
    hasKeyword = true;
  }
  if (/config|configur|ambiente|variable|env|secret|token|propriedade/i.test(texto)) {
    Object.assign(keywords, {
      'config': 1,
      'properties': 1,
      '.json': 0.5,
      '.env': 1,
      '.yml': 0.5,
      '.yaml': 0.5,
    });
    hasKeyword = true;
  }
  if (/banco|database|sql|query|schema|model|entity/i.test(texto)) {
    Object.assign(keywords, {
      'database': 1,
      'model': 1,
      'entity': 1,
      '.sql': 1,
      'schema': 0.5,
    });
    hasKeyword = true;
  }
  if (/teste|test|unit|integration|spec/i.test(texto)) {
    Object.assign(keywords, {
      'test': 1,
      'spec': 1,
      'Test': 1,
    });
    hasKeyword = true;
  }
  if (/package|depend|maven|npm|gradle|yarn|pnpm|composer|pip|gem/i.test(texto)) {
    Object.assign(keywords, {
      'package.json': 1,
      'pom.xml': 1,
      'build.gradle': 1,
      '.lock': 0.3,
    });
    hasKeyword = true;
  }

  // Fallback: se nenhum keyword específico, sugere arquivos que definem "qual projeto é"
  // (pom.xml, package.json, README, src/main, etc)
  const searchBase = (Array.isArray(candidates) && candidates.length ? candidates : attachments.map(a => a.path)).map(p => String(p).toLowerCase());

  if (!hasKeyword) {
    // Detecta tipo de projeto pela estrutura
    const allPaths = searchBase;
    if (allPaths.some(p => p.includes('pom.xml'))) {
      // Maven/Java
      Object.assign(keywords, {
        'pom.xml': 2,
        'src': 1,
        'main': 0.8,
        'application': 0.7,
        '.properties': 0.5,
      });
    } else if (allPaths.some(p => p.includes('package.json'))) {
      // Node.js/JavaScript
      Object.assign(keywords, {
        'package.json': 2,
        'src': 1,
        'index': 0.8,
        'server': 0.7,
        '.js': 0.3,
        '.ts': 0.5,
      });
    } else if (allPaths.some(p => p.includes('build.gradle'))) {
      // Gradle/Kotlin
      Object.assign(keywords, {
        'build.gradle': 2,
        'src': 1,
        'app': 0.8,
      });
    } else if (allPaths.some(p => p.includes('requirements.txt') || p.includes('setup.py'))) {
      // Python
      Object.assign(keywords, {
        'setup.py': 1.5,
        'requirements.txt': 1.5,
        'main.py': 1,
        'src': 0.8,
      });
    } else {
      // Fallback genérico: README, arquivos em root, src/main
      Object.assign(keywords, {
        'README': 1.5,
        'pom.xml': 1.5,
        'package.json': 1.5,
        'build.gradle': 1.5,
        'Dockerfile': 0.8,
        'src': 1,
      });
    }
  }

  // Filtra candidatos que bateram com keywords
  const scored = (Array.isArray(candidates) && candidates.length ? candidates : attachments.map(a => a.path)).map(candidatePath => {
    let score = 0;
    const candidate = String(candidatePath);
    const lower = candidate.toLowerCase();
    const name = path.basename(lower);
    for (const [kw, weight] of Object.entries(keywords)) {
      const k = kw.toLowerCase();
      if (name.includes(k)) score += weight;
      if (lower.includes(k)) score += weight * 0.6;
    }
    // Penaliza caminho de teste em perguntas não relacionadas a teste
    if (!/\b(teste|test|spec|unit|integration)\b/i.test(texto) && /\b(test|spec)\b/i.test(lower)) {
      score -= 0.6;
    }
    return { path: candidate, score };
  });

  return scored
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)  // top 5
    .map(x => x.path);
}

// Quanto do arquivo mais provável entra JÁ LIDO no contexto inicial.
const INLINE_ALVO_CHARS = Number(process.env.HELPER_INLINE_ALVO_CHARS || 30000);

/**
 * Lê o arquivo com maior chance de ser o alvo e devolve o bloco pronto.
 *
 * Por que isto existe: medindo o agente contra o backend real, ele gastava de 3
 * a 5 RODADAS (300-500s) só pra ter o código em mãos — readFile, searchInFiles,
 * readFileChunk, readFileChunk — antes da primeira edição. Entregar caminho não
 * resolve: "arquivo sugerido" ainda custa uma rodada de leitura cada.
 * Entregando o CONTEÚDO, a primeira rodada já pode editar.
 */
async function inlineArquivoAlvo(candidatoTop) {
  if (!candidatoTop) return '';
  try {
    const st = fsSync.statSync(candidatoTop);
    if (!st.isFile() || st.size > 5 * 1024 * 1024) return '';
  } catch (_) {
    return '';
  }
  const conteudo = await readSmallFileSafe(candidatoTop);
  if (conteudo === null) return ''; // binário ou ilegível

  const truncou = conteudo.length > INLINE_ALVO_CHARS;
  const corpo = truncou ? conteudo.slice(0, INLINE_ALVO_CHARS) : conteudo;
  const linhas = corpo.split('\n').length;

  return [
    '',
    `═══ CONTEÚDO DE ${candidatoTop} ═══`,
    `(este é o arquivo com maior chance de ser o alvo, JÁ LIDO pra você —`,
    ` NÃO gaste uma rodada com readFile nele; edite direto com patchFile)`,
    truncou
      ? `(mostrando as primeiras ${linhas} linhas de ${conteudo.length} chars; use readFileChunk se precisar do resto)`
      : `(arquivo completo, ${linhas} linhas)`,
    '```',
    corpo,
    '```',
    '',
  ].join('\n');
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
      const lineCount = treeStructure.split('\n').length;
      console.log(`[tree] estrutura gerada: ${lineCount} linhas, ${treeStructure.length} chars`);
    }
  }

  // Sugere arquivos relevantes baseado na pergunta (se houver no contexto)
  let relevantSuggestion = '';
  let alvoInline = '';
  if (opts.userText) {
    const candidates = collectCandidatePaths(attachments);
    const suggested = suggestRelevantFiles(opts.userText, attachments, candidates);
    if (suggested.length) {
      relevantSuggestion = `Arquivos sugeridos para análise:\n${suggested.map(p => `  • ${p}`).join('\n')}`;
      console.log(`[tree] sugestão gerada: ${suggested.length} arquivos`);
      // O primeiro colocado entra JÁ LIDO — economiza as rodadas de leitura.
      alvoInline = await inlineArquivoAlvo(suggested[0]);
      if (alvoInline) {
        console.log(`[tree] alvo inline: ${suggested[0]} (${alvoInline.length} chars no contexto)`);
      }
    } else {
      console.log(`[tree] nenhum arquivo sugerido para: "${opts.userText.slice(0, 60)}"`);
    }
  } else {
    console.log('[tree] opts.userText não foi passado');
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
    alvoInline || '',
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

module.exports = { buildContextBlock, budgetFor, generateTreeStructure };
