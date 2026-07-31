// services/realtimeRag.js
//
// RAG (base de conhecimento + banco de respostas) FORA do caminho critico.
//
// A sacada: com o STT em streaming a gente ja tem o texto parcial ENQUANTO a
// pessoa fala. Da' pra buscar os embeddings adiantado, e quando o turno fecha o
// bloco ja esta pronto no cache — custo ZERO no caminho critico da resposta.
// Sem isso, essa busca somava ate' RAG_TIMEOUT_MS antes de abrir o chat.

const knowledgeBase = require('./knowledgeBase');
const answerBank = require('./answerBank');
const { raceWithTimeout, RAG_TIMEOUT_MS } = require('./openAiRealtimeModels');

class RealtimeRag {
  constructor(configService) {
    this.cfg = configService;
    this.cache = { key: '', block: '' };
    this.inFlight = null;
  }

  reset() { this.cache = { key: '', block: '' }; this.inFlight = null; }

  // Com o STT em streaming a gente ja tem o texto parcial ENQUANTO a pessoa fala,
  // entao da pra buscar os embeddings adiantado. Quando o turno fecha, o bloco ja
  // esta pronto no cache e o custo no caminho critico e ZERO.
  enabled() {
    const kbOn = this.cfg.getKnowledgeBaseConfig
      ? this.cfg.getKnowledgeBaseConfig().enabled : false;
    const abOn = this.cfg.getAnswerBankConfig
      ? this.cfg.getAnswerBankConfig().enabled : false;
    return { kbOn, abOn, any: kbOn || abOn };
  }

  async build(text, token) {
    const { kbOn, abOn } = this.enabled();
    const qEmb = await knowledgeBase.embed(text, token);
    const kb = kbOn ? await knowledgeBase.augment(text, { token, topK: 5, queryEmbedding: qEmb }) : '';
    const bank = abOn ? await answerBank.augment(text, { token, queryEmbedding: qEmb }) : '';
    return [bank, kb].filter(Boolean).join('\n\n');
  }

  // Dispara a busca em background sobre o transcript PARCIAL. Fire-and-forget:
  // nunca lanca e nunca bloqueia quem chamou.
  prefetch(text, token) {
    if (!token || !this.enabled().any) return;
    if (!text || text.length < 12) return;
    if (this._ragCache.key === text || this._ragInFlight === text) return;
    this._ragInFlight = text;
    this.build(text, token)
      .then((block) => { this._ragCache = { key: text, block }; })
      .catch(() => {})
      .finally(() => { if (this._ragInFlight === text) this._ragInFlight = null; });
  }

  // Usa o cache quando ele foi construido sobre um prefixo da pergunta atual (o
  // caso normal com streaming). Senao busca na hora, ainda com o teto de tempo.
  async blockFor(transcript, token) {
    if (!this.enabled().any) return '';
    const cached = this._ragCache;
    if (cached.key && transcript.startsWith(cached.key)) return cached.block;
    try {
      const block = await raceWithTimeout(this.build(transcript, token), RAG_TIMEOUT_MS, null);
      return block || '';
    } catch (_) { return ''; }
  }



}

module.exports = RealtimeRag;
