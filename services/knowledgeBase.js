// knowledgeBase.js — Base de conhecimento atualizável (mini-RAG).
//
// O usuário cola docs/novidades de tecnologias recentes; guardamos como arquivo
// e injetamos os trechos relevantes nas respostas técnicas, contornando o
// "cutoff" desatualizado dos modelos. Compartilhado pelo Assistente e Tradutor.
//
// Retrieval:
//   - Com token OpenAI → embeddings (text-embedding-3-small) + cosine.
//   - Sem token (offline/Ollama) → keyword/BM25 simples. (Ollama não tem embed
//     nativo confiável aqui.)
//
// Persistência em <userData>/knowledge/: source.md (texto) + index.json (chunks).

const fs = require("fs");
const path = require("path");

const EMBED_MODEL = "text-embedding-3-small";

function baseDir() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "knowledge");
  } catch (_) {
    return path.join(require("os").homedir(), ".config", "helper-node", "knowledge");
  }
}
function srcPath() { return path.join(baseDir(), "source.md"); }
function idxPath() { return path.join(baseDir(), "index.json"); }

function ensureDir() { try { fs.mkdirSync(baseDir(), { recursive: true }); } catch (_) {} }

function getSource() {
  try { return fs.readFileSync(srcPath(), "utf8"); } catch (_) { return ""; }
}

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(idxPath(), "utf8")); } catch (_) { return { chunks: [], updatedAt: 0 }; }
}

function chunkCount() { return (loadIndex().chunks || []).length; }

// Quebra por parágrafo/heading; junta pedaços muito pequenos pra não fragmentar demais.
function chunkText(text) {
  if (!text || !text.trim()) return [];
  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const chunks = [];
  let buf = "";
  for (const b of blocks) {
    if ((buf + "\n\n" + b).length > 800 && buf) { chunks.push(buf); buf = b; }
    else buf = buf ? buf + "\n\n" + b : b;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function embedOpenAI(texts, token) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "embeddings failed");
  return data.data.map((d) => d.embedding);
}

// Reescreve/organiza o texto antes de salvar (default ligado). Retorna SÓ o texto.
//   ChatGPT → gpt-4.1-nano. Ollama/backend → backendResponder(texto, {instruction}).
async function rewriteWithAI(text, { token, backendResponder } = {}) {
  const instruction =
    "Você LIMPA E ORGANIZA notas técnicas de referência. REGRA CRÍTICA: NÃO RESUMA, " +
    "NÃO REMOVA conteúdo, NÃO ENCURTE. Mantenha TODOS os fatos, versões, nomes de libs, " +
    "trechos de código e exemplos — sem exceção. Apenas: melhore a estrutura (títulos/bullets), " +
    "corrija formatação e remova DUPLICAÇÃO LITERAL. O resultado deve ter tamanho SIMILAR ou MAIOR " +
    "que o original. Responda APENAS com o texto reescrito, sem comentários nem explicações.";
  if (token) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        max_tokens: 16000, // grande o suficiente pra não truncar textos longos
        messages: [{ role: "system", content: instruction }, { role: "user", content: text }],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "rewrite failed");
    return (data.choices?.[0]?.message?.content || "").trim() || text;
  }
  if (typeof backendResponder === "function") {
    const r = await backendResponder(text, { instruction });
    return (r || "").trim() || text;
  }
  return text;
}

/**
 * Salva a base. Opcionalmente reescreve com IA antes. Re-chunka e (se token) embeda.
 * @returns {Promise<{chunks:number, text:string, rewritten:boolean}>}
 */
async function save(text, { aiRewrite = true, token, backendResponder } = {}) {
  ensureDir();
  const original = (text || "").trim();
  let finalText = original;
  let rewritten = false;
  let shrunk = false;
  let codeSkipped = false;
  const hasCode = /```|^\s{4,}\S/m.test(original); // blocos ``` ou indentação de código
  if (aiRewrite && original && hasCode) {
    codeSkipped = true;
    console.log("[knowledgeBase] base contém código — pulando reescrita IA (preserva verbatim)");
  } else if (aiRewrite && original) {
    try {
      const out = ((await rewriteWithAI(original, { token, backendResponder })) || "").trim();
      // TRAVA ANTI-PERDA: se a IA encurtou demais (< 60% do original), descarta a
      // reescrita e mantém o ORIGINAL. Modelos pequenos (nano) tendem a resumir.
      if (out && out.length >= original.length * 0.6) {
        finalText = out; rewritten = true;
        console.log(`[knowledgeBase] reescrita aplicada (${original.length} → ${out.length} chars)`);
      } else {
        shrunk = true;
        console.warn(`[knowledgeBase] reescrita ENCURTOU demais (${original.length} → ${out.length} chars) — mantendo o ORIGINAL`);
      }
    } catch (e) { console.warn("[knowledgeBase] reescrita IA falhou, salvando cru:", e.message); }
  }
  fs.writeFileSync(srcPath(), finalText, "utf8");

  const chunks = chunkText(finalText).map((t) => ({ text: t }));
  if (token && chunks.length) {
    try {
      const embs = await embedOpenAI(chunks.map((c) => c.text), token);
      chunks.forEach((c, i) => { c.embedding = embs[i]; });
    } catch (e) { console.warn("[knowledgeBase] embeddings falharam, usando keyword:", e.message); }
  }
  fs.writeFileSync(idxPath(), JSON.stringify({ chunks, updatedAt: Date.now() }), "utf8");
  console.log(`[knowledgeBase] base salva: ${chunks.length} chunk(s), embeddings=${token && chunks[0] && chunks[0].embedding ? "sim" : "não (keyword)"}`);
  return { chunks: chunks.length, text: finalText, rewritten, shrunk, codeSkipped };
}

// Ranking por palavra-chave: devolve os índices dos chunks que casam, do melhor p/ pior.
function keywordRank(query, chunks) {
  const terms = query.toLowerCase().match(/[\wáéíóúâêôãõàç.+#-]{3,}/g) || [];
  if (!terms.length) return [];
  return chunks
    .map((c, i) => {
      const lc = c.text.toLowerCase();
      let s = 0;
      for (const t of terms) if (lc.includes(t)) s += 1;
      return { i, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i);
}

// Recupera os top-K trechos relevantes pra query.
//   Com embeddings → HÍBRIDO: intercala ranking semântico + keyword (dedupe).
//   Isso resgata trechos que a busca semântica perde por terminologia (ex.: a query
//   diz "java" mas o trecho diz "JDK 26") — onde o keyword acerta.
//   Sem embeddings → só keyword.
async function retrieve(query, { token, topK = 5, queryEmbedding = null } = {}) {
  const idx = loadIndex();
  const chunks = idx.chunks || [];
  if (!chunks.length || !query) return [];

  const kwRank = keywordRank(query, chunks);

  let embRank = [];
  if (chunks[0].embedding && (queryEmbedding || token)) {
    try {
      // Reusa o embedding já calculado (queryEmbedding) quando disponível — evita
      // uma chamada de rede a mais quando KB e banco de respostas buscam a mesma query.
      const qe = queryEmbedding || (await embedOpenAI([query], token))[0];
      embRank = chunks
        .map((c, i) => ({ i, s: cosine(qe, c.embedding) }))
        .filter((x) => x.s > 0.25)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.i);
    } catch (e) { console.warn("[knowledgeBase] retrieve embeddings falhou, só keyword:", e.message); }
  }

  // Sem sinal semântico → keyword puro.
  if (!embRank.length) return kwRank.slice(0, topK).map((i) => chunks[i].text);

  // Intercala os dois rankings (semântico tem leve prioridade por vir primeiro), dedupe.
  const order = [];
  const seen = new Set();
  const maxLen = Math.max(embRank.length, kwRank.length);
  for (let r = 0; r < maxLen && order.length < topK; r++) {
    for (const list of [embRank, kwRank]) {
      const id = list[r];
      if (id != null && !seen.has(id)) { seen.add(id); order.push(id); }
    }
  }
  return order.slice(0, topK).map((i) => chunks[i].text);
}

// Monta o bloco a ser injetado no contexto, com rótulo anti-alucinação (importante
// pra modelos pequenos não "inventarem tarefa").
function buildContextBlock(chunks) {
  if (!chunks || !chunks.length) return "";
  const hoje = new Date().toISOString().slice(0, 10);
  return [
    `BASE DE CONHECIMENTO ATUALIZADA — notas recentes fornecidas pelo usuário sobre`,
    `tecnologias/versões atuais. DATA DE HOJE: ${hoje}.`,
    "",
    "COMO USAR (crítico):",
    "- Esta base é MAIS RECENTE que o seu conhecimento de treino. Em QUALQUER conflito",
    "  (versões, datas, o que já foi lançado), a BASE é a verdade — ignore o que você",
    "  'lembra' do treino e NÃO corrija a base com seu conhecimento antigo.",
    "- Lançamentos com data IGUAL ou ANTERIOR a hoje JÁ ACONTECERAM: fale no passado/presente",
    "  ('foi lançado', 'a versão atual é'), NUNCA no futuro ('será lançado').",
    "- A 'última/atual versão' é a MAIOR/MAIS NOVA que aparecer na base, não a do seu treino.",
    "- Use SOMENTE se for relevante à pergunta. Se NÃO for relevante, IGNORE e responda",
    "  normalmente.",
    "- Responda como se VOCÊ soubesse o fato. É PROIBIDO mencionar esta base ou de onde",
    "  veio a informação: nada de 'com base na sua base de conhecimento', 'segundo a base',",
    "  'conforme os dados fornecidos', 'de acordo com as notas' ou equivalentes. Apenas",
    "  afirme o fato direto (ex.: 'A versão mais recente do Java é o JDK 26...').",
    "",
    ...chunks.map((t, i) => `[${i + 1}] ${t}`),
  ].join("\n");
}

// Embeda uma query (texto único). Devolve o vetor ou null em falha. Exposto pra que
// o caller embede UMA vez e compartilhe entre KB e banco de respostas (0-latência).
async function embed(query, token) {
  if (!query || !token) return null;
  try {
    const [e] = await embedOpenAI([query], token);
    return e || null;
  } catch (e) {
    console.warn("[knowledgeBase] embed falhou:", e.message);
    return null;
  }
}

/**
 * Atalho: recupera e já devolve o bloco pronto (ou '' se nada relevante).
 */
async function augment(query, opts = {}) {
  try {
    const hits = await retrieve(query, opts);
    if (hits.length) {
      console.log(`[knowledgeBase] ✓ injetando ${hits.length} trecho(s) na resposta — query: "${String(query).slice(0, 60)}"`);
    } else {
      console.log(`[knowledgeBase] nenhum trecho relevante p/: "${String(query).slice(0, 60)}"`);
    }
    return buildContextBlock(hits);
  } catch (e) {
    console.warn("[knowledgeBase] augment falhou:", e.message);
    return "";
  }
}

module.exports = {
  getSource, save, retrieve, augment, buildContextBlock, chunkCount, chunkText,
  embed, cosine, baseDir,
};
