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
    "Você organiza NOTAS TÉCNICAS de referência. Reescreva o texto a seguir de forma " +
    "limpa e organizada (títulos curtos, bullets, sem duplicação), MANTENDO TODA a " +
    "informação técnica, versões, nomes de libs e exemplos. Responda APENAS com o texto " +
    "reescrito, sem comentários, sem explicações, sem preâmbulo.";
  if (token) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1-nano",
        max_tokens: 2000,
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
  let finalText = (text || "").trim();
  let rewritten = false;
  if (aiRewrite && finalText) {
    try { finalText = await rewriteWithAI(finalText, { token, backendResponder }); rewritten = true; }
    catch (e) { console.warn("[knowledgeBase] reescrita IA falhou, salvando cru:", e.message); }
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
  return { chunks: chunks.length, text: finalText, rewritten };
}

// Recupera os top-K trechos relevantes pra query. Embeddings se houver; senão keyword.
async function retrieve(query, { token, topK = 3 } = {}) {
  const idx = loadIndex();
  const chunks = idx.chunks || [];
  if (!chunks.length || !query) return [];

  if (token && chunks[0].embedding) {
    try {
      const [qe] = await embedOpenAI([query], token);
      return chunks
        .map((c) => ({ t: c.text, s: cosine(qe, c.embedding) }))
        .sort((a, b) => b.s - a.s)
        .filter((x) => x.s > 0.25)
        .slice(0, topK)
        .map((x) => x.t);
    } catch (e) { console.warn("[knowledgeBase] retrieve embeddings falhou, keyword:", e.message); }
  }

  // Keyword/BM25 simplificado
  const terms = query.toLowerCase().match(/[\wáéíóúâêôãõàç.+#-]{3,}/g) || [];
  if (!terms.length) return [];
  return chunks
    .map((c) => {
      const lc = c.text.toLowerCase();
      let score = 0;
      for (const t of terms) if (lc.includes(t)) score += 1;
      return { t: c.text, s: score };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topK)
    .map((x) => x.t);
}

// Monta o bloco a ser injetado no contexto, com rótulo anti-alucinação (importante
// pra modelos pequenos não "inventarem tarefa").
function buildContextBlock(chunks) {
  if (!chunks || !chunks.length) return "";
  return [
    "BASE DE CONHECIMENTO ATUALIZADA (notas recentes fornecidas pelo usuário sobre",
    "tecnologias/versões atuais). Use SOMENTE se for relevante à pergunta. Se NÃO for",
    "relevante, IGNORE totalmente e responda normalmente. NÃO comente sobre esta base.",
    "",
    ...chunks.map((t, i) => `[${i + 1}] ${t}`),
  ].join("\n");
}

/**
 * Atalho: recupera e já devolve o bloco pronto (ou '' se nada relevante).
 */
async function augment(query, opts = {}) {
  try {
    const hits = await retrieve(query, opts);
    return buildContextBlock(hits);
  } catch (e) {
    console.warn("[knowledgeBase] augment falhou:", e.message);
    return "";
  }
}

module.exports = {
  getSource, save, retrieve, augment, buildContextBlock, chunkCount, chunkText,
};
