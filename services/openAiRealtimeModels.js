// services/openAiRealtimeModels.js
// Regras compartilhadas entre os pipelines de tempo real (assistente offline,
// assistente online, tradutor) sobre qual modelo OpenAI realmente deve ser
// chamado e se ele aceita o parâmetro reasoning_effort.

// Modelo de fallback pro tempo real: sem raciocínio, resposta imediata (sem a
// etapa de "pensar" que os modelos gpt-5.x/o-series sempre pagam, mesmo com
// reasoning_effort "low"). Já era o alvo usado pra nano — agora vale pra
// QUALQUER modelo de raciocínio, porque o overhead vem da arquitetura do
// modelo, não do tamanho/custo dele (Luna paga o mesmo pedágio que Sol).
const REALTIME_FAST_FALLBACK = "gpt-4.1";
const REALTIME_MODEL_OVERRIDE = {
  "gpt-4.1-nano": REALTIME_FAST_FALLBACK, // nano confunde/erra demais pra copiloto em tempo real
};

// Só modelos de raciocínio (família gpt-5.x e o-series) aceitam
// reasoning_effort — mandar esse campo pra gpt-4o/gpt-4.1 dá erro na API.
function supportsReasoningEffort(model) {
  const s = String(model || "").toLowerCase();
  if (!s) return false;
  return /^gpt-5(\.|-|$)/.test(s) || /^o[134](-|$)/.test(s);
}

function applyRealtimeOverride(model) {
  if (REALTIME_MODEL_OVERRIDE[model]) return REALTIME_MODEL_OVERRIDE[model];
  if (supportsReasoningEffort(model)) return REALTIME_FAST_FALLBACK;
  return model;
}

// Modelos de raciocínio (mesma família de supportsReasoningEffort) rejeitam
// "max_tokens" no Chat Completions — exigem "max_completion_tokens" no lugar.
function maxTokensParam(model, n) {
  return supportsReasoningEffort(model) ? { max_completion_tokens: n } : { max_tokens: n };
}

// Tempo real: nunca deixa uma etapa auxiliar (ex: embeddings da Base de
// Conhecimento) seguras a resposta principal além de um prazo curto — se não
// voltar a tempo, segue sem esse contexto extra em vez de travar o usuário.
function raceWithTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
const RAG_TIMEOUT_MS = 350;

module.exports = {
  REALTIME_FAST_FALLBACK,
  REALTIME_MODEL_OVERRIDE,
  applyRealtimeOverride,
  supportsReasoningEffort,
  maxTokensParam,
  raceWithTimeout,
  RAG_TIMEOUT_MS,
};
