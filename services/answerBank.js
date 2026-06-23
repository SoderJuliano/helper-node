// answerBank.js — Banco de respostas (RAG de conversas).
//
// Guarda pares { pergunta do entrevistador, SUA resposta } que pontuaram bem numa
// avaliação feita em BACKGROUND (nota >= minScore). Quando uma pergunta quase igual
// reaparece, injeta a sua resposta anterior como DICA pro modelo adaptar (na sua voz),
// sem copiar cego. Contorna o "a IA reinventa do zero toda vez".
//
// Design de performance (0-latência no caminho crítico):
//   - retrieve() reusa o embedding da query já calculado pelo knowledgeBase (queryEmbedding)
//     → nenhuma chamada de rede a mais por turno; o match é só cosine local.
//   - record() é fire-and-forget (chamado sem await no fluxo ao vivo): embeda e grava
//     em background, nunca trava a próxima sugestão.
//
// Persistência: <userData>/knowledge/answers.json  (mesmo dir do knowledgeBase).

const fs = require("fs");
const path = require("path");
const knowledgeBase = require("./knowledgeBase");

const MAX_ENTRIES = 200;       // teto: poda mantendo as de maior nota / mais recentes
const MATCH_THRESHOLD = 0.85;  // só injeta se a pergunta nova for QUASE igual a uma salva

function filePath() { return path.join(knowledgeBase.baseDir(), "answers.json"); }

function load() {
  try { return JSON.parse(fs.readFileSync(filePath(), "utf8")); } catch (_) { return { entries: [] }; }
}
function persist(data) {
  try {
    fs.mkdirSync(knowledgeBase.baseDir(), { recursive: true });
    fs.writeFileSync(filePath(), JSON.stringify(data), "utf8");
  } catch (e) { console.warn("[answerBank] falha ao gravar:", e.message); }
}

function count() { return (load().entries || []).length; }

/**
 * Salva um par pergunta→resposta SE a nota for suficiente. Fire-and-forget: chame sem
 * await no fluxo ao vivo. Embeda a pergunta (chave de busca) e poda o banco.
 * @returns {Promise<boolean>} true se salvou
 */
async function record({ question, answer, score, lang, token, minScore = 4 } = {}) {
  try {
    question = (question || "").trim();
    answer = (answer || "").trim();
    if (!question || !answer) return false;
    if (typeof score !== "number" || score < minScore) {
      console.log(`[answerBank] nota ${score} < ${minScore} — não salva`);
      return false;
    }
    const embedding = await knowledgeBase.embed(question, token); // null se sem token
    const data = load();
    data.entries = data.entries || [];
    data.entries.push({ q: question, a: answer, score, lang: lang || "", ts: Date.now(), embedding });
    // Poda: mantém as MAX_ENTRIES de maior nota; empate → mais recente.
    if (data.entries.length > MAX_ENTRIES) {
      data.entries.sort((x, y) => (y.score - x.score) || (y.ts - x.ts));
      data.entries = data.entries.slice(0, MAX_ENTRIES);
    }
    persist(data);
    console.log(`[answerBank] ✓ salvo (nota ${score}): "${question.slice(0, 50)}" — total ${data.entries.length}`);
    return true;
  } catch (e) {
    console.warn("[answerBank] record falhou:", e.message);
    return false;
  }
}

/**
 * Procura uma pergunta salva quase idêntica à atual. Reusa queryEmbedding se vier.
 * @returns {Promise<{q,a,score}|null>} a melhor entrada acima do limiar, ou null
 */
async function retrieve(question, { token, queryEmbedding = null } = {}) {
  try {
    const data = load();
    const entries = (data.entries || []).filter((e) => Array.isArray(e.embedding));
    if (!entries.length || !question) return null;
    const qe = queryEmbedding || (await knowledgeBase.embed(question, token));
    if (!qe) return null; // sem embedding não dá pra comparar com segurança
    let best = null;
    for (const e of entries) {
      const s = knowledgeBase.cosine(qe, e.embedding);
      if (!best || s > best.s) best = { e, s };
    }
    if (best && best.s >= MATCH_THRESHOLD) {
      console.log(`[answerBank] ✓ match (sim ${best.s.toFixed(2)}): "${best.e.q.slice(0, 50)}"`);
      return best.e;
    }
    return null;
  } catch (e) {
    console.warn("[answerBank] retrieve falhou:", e.message);
    return null;
  }
}

// Monta o bloco-dica a ser injetado no prompt (ou '' se nada relevante).
function buildHintBlock(entry) {
  if (!entry) return "";
  return [
    "DICA DE RESPOSTA ANTERIOR — você já respondeu uma pergunta quase igual antes, e foi",
    "uma boa resposta. Use como REFERÊNCIA pra manter consistência e a SUA voz; adapte ao",
    "contexto atual, NÃO copie cego. NUNCA mencione que existe uma resposta anterior.",
    `Pergunta anterior: ${entry.q}`,
    `Sua resposta (boa): ${entry.a}`,
  ].join("\n");
}

/**
 * Atalho: recupera e já devolve o bloco-dica pronto (ou '').
 */
async function augment(question, opts = {}) {
  const entry = await retrieve(question, opts);
  return buildHintBlock(entry);
}

module.exports = { record, retrieve, augment, buildHintBlock, count };
