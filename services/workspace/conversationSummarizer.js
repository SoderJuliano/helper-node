// services/workspace/conversationSummarizer.js
// Compactação automática do histórico:
//   - mantém SEMPRE as 5 mensagens mais recentes intactas
//   - quando o histórico passa de 10 mensagens, compacta as 5 mais antigas
//     em 1 única mensagem-resumo (chamada em paralelo, fire-and-forget)
//   - resumos acumulam (cada um substitui 5 originais)
//
// Funciona com OpenAI (cheap model) e Ollama (qwen via backend).

const axios = require("axios");
const store = require("./store");
const { maxTokensParam } = require("../openAiRealtimeModels");

const RECENT_KEEP = 5;       // sempre preservar as 5 mais recentes
const COMPACT_THRESHOLD = 10; // a partir daqui começa a compactar
const COMPACT_BATCH = 5;     // tamanho do lote a compactar

let _compactInProgress = false;

/**
 * Decide se precisa compactar e retorna o array de messages "achatado"
 * (com resumos no início + recentes no fim). Não modifica originals.
 *
 * @param {Array<{role,content}>} messages - histórico raw
 * @param {object} opts
 * @param {string} opts.cheapModel - modelo cheap pra rodar o resumo (ex: 'gpt-4.1-nano')
 * @param {string} opts.token - token OpenAI (se cheapModel for openai)
 * @param {string} opts.backendUrl - URL ollama (se cheapModel for ollama/qwen/llama)
 */
async function compactIfNeeded(messages, opts = {}) {
  if (!Array.isArray(messages) || messages.length <= COMPACT_THRESHOLD) {
    return messages;
  }
  // Separa system messages (preserva no topo) das normais
  const systemMsgs = messages.filter(m => m.role === "system");
  const convo = messages.filter(m => m.role !== "system");

  if (convo.length <= COMPACT_THRESHOLD) return messages;

  const recent = convo.slice(-RECENT_KEEP);
  const older = convo.slice(0, convo.length - RECENT_KEEP);

  // Pega o LOTE mais antigo (primeiros COMPACT_BATCH) pra compactar agora
  const batch = older.slice(0, COMPACT_BATCH);
  const remainingOlder = older.slice(COMPACT_BATCH);

  if (batch.length < COMPACT_BATCH) {
    // Nada a compactar ainda, só monta com resumos pré-existentes
    return buildWithSummaries(systemMsgs, [], remainingOlder.concat(recent));
  }

  // Dispara compactação em background (fire-and-forget) e enquanto isso
  // já retorna messages com summary placeholder se tivermos cache.
  triggerBackgroundSummary(batch, opts).catch(e =>
    console.warn("[workspace] background summary falhou:", e.message)
  );

  // Pega resumos já existentes do store
  const existingSummaries = store.getSummaries();

  return buildWithSummaries(systemMsgs, existingSummaries, remainingOlder.concat(recent));
}

function buildWithSummaries(systemMsgs, summaries, rest) {
  const out = [...systemMsgs];
  if (summaries.length) {
    out.push({
      role: "system",
      content:
        "[RESUMO DAS MENSAGENS ANTERIORES COMPACTADAS]\n" +
        summaries.map((s, i) => `(parte ${i + 1}) ${s}`).join("\n\n"),
    });
  }
  out.push(...rest);
  return out;
}

async function triggerBackgroundSummary(batch, opts) {
  if (_compactInProgress) return;
  _compactInProgress = true;
  try {
    const summary = await summarizeBatch(batch, opts);
    if (summary && summary.length > 10) {
      store.appendSummary(summary);
      console.log(`[workspace] resumo adicionado (${summary.length} chars, total ${store.getSummaries().length} resumos)`);
    }
  } finally {
    _compactInProgress = false;
  }
}

async function summarizeBatch(batch, opts) {
  const conversationText = batch.map(m => {
    const content = typeof m.content === "string" ? m.content :
                    Array.isArray(m.content) ? m.content.map(c => c.text || "").join(" ") : "";
    return `${m.role.toUpperCase()}: ${content.slice(0, 1500)}`;
  }).join("\n\n");

  const prompt = [
    "Resuma a seguinte conversa em 4-5 linhas focando em:",
    "1) tarefa principal que o usuário está fazendo",
    "2) arquivos lidos/editados/discutidos",
    "3) decisões importantes tomadas",
    "4) estado atual / próximo passo pendente",
    "",
    "Seja MUITO conciso. Sem floreios. Português direto.",
    "",
    "--- CONVERSA ---",
    conversationText,
    "--- FIM ---",
  ].join("\n");

  // OpenAI path
  if (opts.token && opts.cheapModel && /^gpt-/i.test(opts.cheapModel)) {
    try {
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: opts.cheapModel,
          ...maxTokensParam(opts.cheapModel, 200),
          messages: [
            { role: "system", content: "Você é um compactador de contexto. Responda APENAS o resumo, sem preâmbulo." },
            { role: "user", content: prompt },
          ],
        },
        {
          headers: { Authorization: "Bearer " + opts.token, "Content-Type": "application/json" },
          timeout: 30000,
        }
      );
      return (resp.data?.choices?.[0]?.message?.content || "").trim();
    } catch (e) {
      console.warn("[workspace] summary openai falhou:", e.message);
      return null;
    }
  }

  // Ollama backend path (qwen preferido)
  if (opts.backendUrl) {
    try {
      const url = opts.backendUrl.replace(/\/$/, "") + "/qwen25";
      const resp = await axios.post(url, { prompt, language: "PORTUGUESE" }, { timeout: 30000 });
      const text = typeof resp.data === "string" ? resp.data : (resp.data?.response || resp.data?.text || "");
      return String(text).trim();
    } catch (e) {
      console.warn("[workspace] summary ollama falhou:", e.message);
      return null;
    }
  }

  return null;
}

module.exports = { compactIfNeeded, COMPACT_THRESHOLD, RECENT_KEEP };
