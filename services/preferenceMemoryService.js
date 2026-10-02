// services/preferenceMemoryService.js
// Serviço de Memória Ativa de Preferências & Human-in-the-Loop Feedback Loop (JSONL).
//
// Permite que modelos locais (Ollama Local e Ollama Backend) aprendam continuamente com
// avaliações e correções do usuário em tempo real (In-Context Preference Learning),
// gravando pares (prompt, rejected, chosen) em formato padrão JSONL (DPO Dataset).

const fs = require("fs");
const path = require("path");

function baseDir() {
  try {
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      return path.join(app.getPath("userData"), "knowledge");
    }
  } catch (_) {}
  return path.join(require("os").homedir(), ".config", "helper-node", "knowledge");
}

function getFilePath() {
  return path.join(baseDir(), "active_memory.jsonl");
}

function ensureDirAndFile() {
  try {
    const fp = module.exports.getFilePath ? module.exports.getFilePath() : getFilePath();
    const dir = path.dirname(fp);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(fp)) {
      fs.writeFileSync(fp, "", "utf8");
    }
  } catch (err) {
    console.warn("[preferenceMemory] Falha ao criar diretório/arquivo:", err.message);
  }
}

/**
 * Lê todas as entradas válidas do arquivo JSONL.
 * @returns {Array<Object>}
 */
function getAllEntries() {
  try {
    const fp = module.exports.getFilePath ? module.exports.getFilePath() : getFilePath();
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, "utf8");
    if (!raw || !raw.trim()) return [];

    const lines = raw.split("\n");
    const entries = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          entries.push(parsed);
        }
      } catch (_) {}
    }
    return entries;
  } catch (err) {
    console.warn("[preferenceMemory] Erro ao ler entradas JSONL:", err.message);
    return [];
  }
}

/**
 * Retorna a contagem de registros salvos na base JSONL.
 * @returns {number}
 */
function getEntryCount() {
  return getAllEntries().length;
}

/**
 * Adiciona uma nova entrada no dataset JSONL.
 * @param {Object} params
 * @param {string} params.prompt Pergunta ou comando original
 * @param {string} [params.rejected] Resposta rejeitada ou alucinação da IA
 * @param {string} params.chosen Resposta esperada, correção ou fato correto
 * @param {'positive'|'correction'|'explicit_memory'} [params.feedback] Tipo de feedback
 * @param {string} [params.model] Modelo utilizado (ex: qwen2.5-coder:7b)
 * @param {Array<string>} [params.tags] Tags de contexto
 * @returns {Object|null}
 */
function appendEntry({ prompt, rejected = "", chosen, feedback = "correction", model = "", tags = [] } = {}) {
  try {
    const cleanPrompt = String(prompt || "").trim();
    const cleanChosen = String(chosen || "").trim();
    const cleanRejected = String(rejected || "").trim();

    if (!cleanPrompt || !cleanChosen) {
      console.warn("[preferenceMemory] appendEntry: prompt ou chosen vazio — ignorando");
      return null;
    }

    ensureDirAndFile();

    const entry = {
      id: `pref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      prompt: cleanPrompt,
      rejected: cleanRejected,
      chosen: cleanChosen,
      feedback: feedback || "correction",
      model: model || "",
      tags: Array.isArray(tags) ? tags : [],
    };

    const fp = module.exports.getFilePath ? module.exports.getFilePath() : getFilePath();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(fp, line, "utf8");
    console.log(`[preferenceMemory] ✓ Linha salva no JSONL (${entry.feedback}): "${cleanPrompt.slice(0, 45)}..."`);
    return entry;
  } catch (err) {
    console.warn("[preferenceMemory] Falha ao anexar entrada no JSONL:", err.message);
    return null;
  }
}

/**
 * Extrai termos significativos para ranqueamento por palavras-chave.
 * @param {string} text
 * @returns {Array<string>}
 */
function extractTerms(text) {
  if (!text) return [];
  const matches = String(text)
    .toLowerCase()
    .match(/[\wáéíóúâêôãõàç.+#-]{3,}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Recupera as correções e preferências mais relevantes para a query atual.
 * @param {string} query Pergunta do usuário
 * @param {Object} [options]
 * @param {number} [options.topK=3] Número máximo de exemplos a retornar
 * @param {number} [options.threshold=0.15] Pontuação mínima de relevância
 * @returns {Array<Object>}
 */
function retrieve(query, { topK = 3, threshold = 0.15 } = {}) {
  try {
    const entries = getAllEntries();
    if (!entries.length || !query || !query.trim()) return [];

    const queryTerms = extractTerms(query);
    if (!queryTerms.length) return [];

    const scored = entries.map((entry) => {
      const promptTerms = extractTerms(entry.prompt);
      const chosenTerms = extractTerms(entry.chosen);
      const rejectedTerms = extractTerms(entry.rejected);

      let score = 0;
      for (const term of queryTerms) {
        // Correspondência no prompt original tem peso maior (3.0)
        if (promptTerms.includes(term)) {
          score += 3.0;
        } else if (entry.prompt.toLowerCase().includes(term)) {
          score += 1.5;
        }

        // Correspondência no chosen/fato esperado tem peso intermediário (1.5)
        if (chosenTerms.includes(term)) {
          score += 1.5;
        }

        // Correspondência na resposta rejeitada tem peso baixo (0.5)
        if (rejectedTerms.includes(term)) {
          score += 0.5;
        }
      }

      // Normaliza pelo tamanho dos termos da query para evitar viés em perguntas longas
      const normalizedScore = score / (queryTerms.length * 3.0);
      return { entry, score: normalizedScore };
    });

    return scored
      .filter((item) => item.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((item) => item.entry);
  } catch (err) {
    console.warn("[preferenceMemory] retrieve falhou:", err.message);
    return [];
  }
}

/**
 * Monta o bloco de contexto para injeção no prompt do Ollama.
 * @param {Array<Object>} entries
 * @returns {string}
 */
function buildPromptBlock(entries) {
  if (!entries || !entries.length) return "";

  const examples = entries
    .map((e, idx) => {
      let block = `--- Registro de Preferência ${idx + 1} ---\n`;
      block += `Contexto/Pergunta: "${e.prompt}"\n`;
      if (e.rejected && e.rejected.trim()) {
        block += `Resposta Incorreta Anterior (NÃO REPETIR): "${e.rejected.trim()}"\n`;
      }
      block += `Fato / Resposta Correta do Usuário (PRIORIDADE MÁXIMA): "${e.chosen.trim()}"`;
      return block;
    })
    .join("\n\n");

  return [
    "=================================================================",
    "[MEMÓRIA ATIVA DE PREFERÊNCIAS & CORREÇÕES DO USUÁRIO (JSONL)]",
    "O usuário já corrigiu ou cadastrou preferências explícitas para perguntas e tópicos semelhantes:",
    "",
    examples,
    "",
    "DIRETIVA MANDATÓRIA DE COMPORTAMENTO:",
    "1. Adote SEMPRE os fatos e correções aprovados acima como verdade absoluta para o projeto/contexto.",
    "2. NUNCA repita os erros ou respostas rejeitadas listadas acima.",
    "3. Se responder baseado nestas correções, confirme que utilizou a sua base de preferências local.",
    "=================================================================",
  ].join("\n");
}

/**
 * Detecta se o usuário digitou um comando explícito de memorização.
 * Exemplos:
 *   "salve na sua memória que Java 27 é a versão padrão"
 *   "lembre-se que o banco de homologação é postgres:5433"
 *   "anote na memória: usamos Spring Boot 3.4"
 * @param {string} text
 * @returns {{ isExplicit: boolean, fact: string }|null}
 */
function detectExplicitMemoryCommand(text) {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();

  const patterns = [
    /^(?:salve|salva|grave|grava|guarde|guarda|anote|anota|adicione|adiciona)(?:\s+isso)?\s+(?:na|em sua|na sua|no|ao|à)\s+mem[oó]ria(?:\s+local|\s+ativa)?(?:\s+que|\s+de que)?\s*[:,-]?\s*(.+)$/i,
    /^(?:lembre-se|lembra-se|lembre|lembra)\s+(?:que|de que)\s*(.+)$/i,
    /^(?:registre|registra|fixe|fixar)\s+(?:na|em sua|na sua|no)\s+mem[oó]ria(?:\s+local)?(?:\s+que|\s+de que)?\s*[:,-]?\s*(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match && match[1] && match[1].trim()) {
      let fact = match[1].trim();
      fact = fact.replace(/^(?:que|de que)\s+/i, "").trim();
      return {
        isExplicit: true,
        fact,
      };
    }
  }

  return null;
}

module.exports = {
  getFilePath,
  getAllEntries,
  getEntryCount,
  appendEntry,
  retrieve,
  buildPromptBlock,
  detectExplicitMemoryCommand,
};
