// realtimeOpenAiService.js — Assistente em tempo real 100% ONLINE (OpenAI).
//
// Usado quando o provider selecionado é ChatGPT (aiModel === 'openIa') ou na
// edição Lite (onde só existe OpenAI). NÃO usa Vosk nem Whisper local: tanto a
// transcrição quanto a resposta vão para a OpenAI.
//
// Pipeline por segmento de fala:
//   1. realtimeAudioCapture (parec + RMS) captura mic + monitor do sistema e detecta
//      fim de fala → entrega um WAV.
//   2. Transcrição via /audio/transcriptions (gpt-4o-transcribe).
//   3. Resposta via /chat/completions com o system prompt de copiloto.
//   4. Emite eventos `realtime-assistant-update` (mesmo contrato da UI).
//
// Eventos emitidos (compatíveis com index.html):
//   state | segment_start | segment_whisper_correction | segment_response |
//   segment_error | fatal_error
// (sem Vosk não há preview/partial nem etapa intermediária de correção.)

const fs = require('fs');
const path = require('path');
const { startCapture, stopCapture } = require('./realtimeAudioCapture');
const knowledgeBase = require('./knowledgeBase');

// Transcrição própria (NÃO importa nada do Assistente de Tradução — totalmente
// independente). Envia o WAV pro endpoint de transcrição da OpenAI.
async function transcribeAudio(audioPath, apiKey, model) {
  const fileBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  form.append('file', blob, path.basename(audioPath));
  form.append('model', model || 'gpt-4o-transcribe');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error?.message || 'Transcription failed');
    e.response = { status: res.status, data };
    throw e;
  }
  return data.text;
}

const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
// nano é fraco demais pra copiloto em tempo real (respostas simplistas). Quando
// o usuário deixa o default, sobe pra gpt-4.1 só aqui no realtime.
const REALTIME_MODEL_FLOOR = { 'gpt-4.1-nano': 'gpt-4.1' };
const CHAT_MAX_TOKENS = 700;

class RealtimeOpenAiService {
  constructor({ configService, getMainWindow, onFatalStop, historyService }) {
    this.configService = configService;
    this.getMainWindow = getMainWindow;
    this.onFatalStop = onFatalStop || null;
    this.historyService = historyService || null;

    this.active = false;
    this.iterationCount = 0;
    this.currentSessionId = null;
    this.contextMessages = [];
    this.maxIterationsInContext = 10;
  }

  isActive() { return this.active; }

  async start() {
    if (this.active) return true;
    this.active = true;
    this.iterationCount = 0;
    this.contextMessages = [];
    this.currentSessionId = null;

    if (this.historyService) {
      try {
        const now = new Date();
        const title = `Live Assistant (online) — ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const session = await this.historyService.createNewSession(title);
        this.currentSessionId = session.id;
      } catch (e) { console.warn('[realtime-openai] history session failed:', e.message); }
    }

    this.emitUpdate({ type: 'state', state: 'started', message: 'Assistente em tempo real (online) iniciado.', timestamp: new Date().toISOString() });

    // Motor de captura PRÓPRIO (não compartilha com a tradução). Garante estado
    // limpo antes de iniciar — senão startCapture faz early-return.
    await stopCapture().catch(() => {});

    // Overrides manuais opcionais (config.json) caso o auto-detect de áudio erre:
    //   "systemAudioSink": "<nome do sink>"  → captura <sink>.monitor
    //   "micSource": "<nome do source>"
    const cfg = this.configService.getConfig ? this.configService.getConfig() : {};
    const sysTarget = cfg.systemAudioSink ? (cfg.systemAudioSink.endsWith('.monitor') ? cfg.systemAudioSink : cfg.systemAudioSink + '.monitor') : undefined;
    const micTarget = cfg.micSource || undefined;

    await startCapture({
      onSpeechEnd: (audioPath, source) => this._handleSegment(audioPath, source),
      sysTarget,
      micTarget,
    });
    return true;
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    await stopCapture();
    this.emitUpdate({ type: 'state', state: 'stopped', message: 'Assistente em tempo real parado.', timestamp: new Date().toISOString() });
  }

  // ---------- Pipeline por segmento ----------
  async _handleSegment(audioPath, source) {
    if (!this.active) {
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
      return;
    }

    // O motor de captura abre DOIS streams: 'mic' (você) e 'sys' (áudio do sistema —
    // interlocutor/vídeo/reunião). Com parec separando as fontes corretamente,
    // são conteúdos DIFERENTES (sem duplicação), então por padrão ouvimos OS
    // DOIS — o copiloto responde tanto ao que o outro fala quanto ao que você
    // fala. Override opcional via config.json "realtimeAudioMode":
    //   'both' (default) → ambos | 'system' → só sistema | 'mic' → só você.
    const cfg = this.configService.getConfig ? this.configService.getConfig() : {};
    const mode = cfg.realtimeAudioMode || 'both';
    const wanted = mode === 'mic' ? 'mic' : (mode === 'system' ? 'sys' : null);
    if (wanted && source !== wanted) {
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
      return;
    }

    const token = this.configService.getOpenIaToken();
    const id = 'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    this.iterationCount += 1;
    const iteration = this.iterationCount;
    this.emitUpdate({ type: 'segment_start', id, iteration, timestamp: new Date().toISOString() });

    try {
      if (!token) throw new Error('Token da OpenAI não configurado.');

      const transcript = (await transcribeAudio(audioPath, token, TRANSCRIBE_MODEL) || '').trim();
      if (!transcript || transcript.length < 3) {
        // Ruído/silêncio: descarta a bolha sem incomodar.
        this.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: transcript || '(sem fala)', source: 'openai', timestamp: new Date().toISOString() });
        this.emitUpdate({ type: 'segment_response', id, iteration, response: '(trecho sem conteúdo relevante)', source: 'openai', timestamp: new Date().toISOString() });
        return;
      }

      // Texto definitivo (UI mostra "transcrito" + "pensando…").
      this.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: transcript, source: 'openai', timestamp: new Date().toISOString() });

      const response = await this._askAI(transcript, token);
      this.emitUpdate({ type: 'segment_response', id, iteration, response, source: 'openai', timestamp: new Date().toISOString() });
      await this._writeHistory(transcript, response);
    } catch (err) {
      this._handleError(err, id, iteration);
    } finally {
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
    }
  }

  // ---------- OpenAI chat ----------
  async _askAI(transcript, token) {
    const chosen = this.configService.getOpenAiModel();
    const model = REALTIME_MODEL_FLOOR[chosen] || chosen;

    // Base de conhecimento atualizável (RAG): ChatGPT recupera direto (embeddings).
    let kbBlock = '';
    try {
      const kbOn = this.configService.getKnowledgeBaseConfig
        ? this.configService.getKnowledgeBaseConfig().enabled : false;
      if (kbOn) kbBlock = await knowledgeBase.augment(transcript, { token, topK: 5 });
    } catch (_) {}

    const userPrompt =
      (kbBlock ? kbBlock + '\n\n---\n\n' : '') +
      `TRANSCRIÇÃO do áudio captado (transcrita pela OpenAI, alta qualidade):\n\n` +
      `"${transcript}"\n\n` +
      `Aja segundo as regras do system prompt. Se for incompreensível ou sem ` +
      `conteúdo útil, responda APENAS '(trecho sem conteúdo relevante)'.`;

    const payload = {
      model,
      max_tokens: CHAT_MAX_TOKENS,
      messages: [
        { role: 'system', content: this._systemInstruction() },
        ...this.contextMessages.slice(-(this.maxIterationsInContext * 2)),
        { role: 'user', content: userPrompt },
      ],
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      const e = new Error(data.error?.message || 'OpenAI chat failed');
      e.response = { status: res.status, data };
      throw e;
    }
    return (data.choices?.[0]?.message?.content || '').trim() || '(sem resposta)';
  }

  _systemInstruction() {
    const lang = (this.configService.getLanguage && this.configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
    return [
      'Você é um COPILOTO DISCRETO em tempo real durante ENTREVISTAS, reuniões e ligações.',
      'Você ouve o microfone do usuário E o áudio do sistema (interlocutor). O texto recebido é uma TRANSCRIÇÃO do que está sendo falado.',
      'OBJETIVO: dar ao usuário o que ele precisa pra responder COM AS PRÓPRIAS PALAVRAS — não escrever um discurso pronto pra ele decorar.',
      '',
      'LINGUAGEM (muito importante):',
      '- Português brasileiro FALADO, simples e natural — como um colega dev de SP/SC falaria. Frases curtas e diretas.',
      '- PROIBIDO formalês e clichê de RH: nada de "Claro, obrigado pela oportunidade", "soluções escaláveis/robustas", "agregar valor", "sinergia", "promovendo integrações", "colaborando com times multidisciplinares", "boas práticas" solto. Fale como gente.',
      '',
      'DECIDA O FORMATO PELO TIPO DE PERGUNTA:',
      '',
      'A) PERGUNTA ABERTA / COMPORTAMENTAL / DE EXPERIÊNCIA (ex: "me fala sua trajetória", "quais os desafios da migração", "como foi X"):',
      '   → NÃO escreva resposta pronta. Dê SÓ os PONTOS-CHAVE que o recrutador técnico quer ouvir, pra ele montar a própria fala.',
      '   → 3 a 5 bullets curtos. Em CADA bullet destaque o termo-chave em **negrito** + 2-5 palavras de contexto. Ex: "- **idempotência** nas filas Kafka", "- **Javax → Jakarta** na migração", "- **fila única** pra resolver concorrência".',
      '',
      'B) PERGUNTA TÉCNICA DE PROFUNDIDADE (ex: "como você implementa Spring Security", "explica como funciona X", "diferença entre A e B"):',
      '   → AÍ SIM responda completo e correto, com os termos-chave em **negrito**. Pode ser mais longo.',
      '   → **Exemplo de código é bem-vindo SÓ aqui** (bloco curto ```linguagem```), quando realmente ajudar.',
      '',
      'C) PERGUNTA OBJETIVA (número, sim/não, cálculo, 1 definição): responda direto e curto, termo-chave em **negrito**.',
      '',
      'D) RUÍDO / SAUDAÇÃO / "mm-hmm" / CONVERSA FIADA / SEM PERGUNTA: responda APENAS "(trecho sem conteúdo relevante)". Nunca force ajuda.',
      '',
      'SEMPRE destaque em **negrito** os termos/tecnologias/conceitos-chave — é o que o usuário bate o olho pra montar a resposta (ex: **Kafka**, **Spring Security**, **JWT**, **idempotência**, **índice**, **transação**, **Jakarta**).',
      '',
      'CONHECIMENTO: Java/Spring, JS/TS/React/Angular/Node, Python, SQL/NoSQL, Kafka/RabbitMQ, Docker/K8s/OpenShift, AWS/GCP, SOLID/DDD/TDD/CI-CD, REST/GraphQL, segurança (OAuth2/JWT), além de leis BR e produtos financeiros.',
      '',
      'FORMATO:',
      '- Sem preâmbulo ("a fala menciona...", "o interlocutor diz..."). Vá direto.',
      '- Não repita a pergunta.',
      '- CURTO por padrão (tipos A/C). Só alongue em pergunta técnica de profundidade (tipo B).',
      lang === 'en' ? '- Responda em inglês quando a conversa estiver em inglês.' : '- Responda em português (registro falado BR, SP/SC).',
    ].join('\n');
  }

  // ---------- History ----------
  async _writeHistory(userText, assistantText) {
    this.contextMessages.push({ role: 'user', content: userText });
    this.contextMessages.push({ role: 'assistant', content: assistantText });
    const max = this.maxIterationsInContext * 2;
    if (this.contextMessages.length > max) this.contextMessages = this.contextMessages.slice(-max);

    if (!this.historyService || !this.currentSessionId) return;
    try {
      const sid1 = await this.historyService.addMessage(this.currentSessionId, 'user', userText);
      const sid2 = await this.historyService.addMessage(sid1, 'assistant', assistantText);
      this.currentSessionId = sid2;
    } catch (e) { console.warn('[realtime-openai] history write failed:', e.message); }
  }

  // ---------- Errors ----------
  _handleError(error, id, iteration) {
    if (this._isQuotaError(error)) {
      this.active = false;
      stopCapture().catch(() => {});
      this.emitUpdate({ type: 'fatal_error', message: '⚠️ Limite de créditos da API atingido.', timestamp: new Date().toISOString() });
      if (this.onFatalStop) try { this.onFatalStop(); } catch (_) {}
      return;
    }
    console.error('[realtime-openai] erro:', error.message);
    this.emitUpdate({ type: 'segment_error', id, iteration, message: 'Erro IA: ' + error.message, timestamp: new Date().toISOString() });
  }

  _isQuotaError(error) {
    const status = error?.response?.status;
    const msg = (error?.response?.data?.error?.message || error?.message || '').toLowerCase();
    return status === 429 || status === 402 || msg.includes('insufficient_quota') || msg.includes('exceeded your current quota') || msg.includes('billing');
  }

  emitUpdate(payload) {
    const w = this.getMainWindow();
    if (!w || w.isDestroyed()) return;
    w.webContents.send('realtime-assistant-update', payload);
  }
}

module.exports = RealtimeOpenAiService;
