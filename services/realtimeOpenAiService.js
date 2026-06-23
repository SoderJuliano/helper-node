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
const answerBank = require('./answerBank');
const { evaluateUserResponse } = require('./translationAssistant/openaiClient');

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
    // Última pergunta do interlocutor (sys) — pareada com a SUA resposta (mic) p/ o banco.
    this._lastInterviewerQuestion = '';
  }

  isActive() { return this.active; }

  async start() {
    if (this.active) return true;
    this.active = true;
    this.iterationCount = 0;
    this.contextMessages = [];
    this.currentSessionId = null;
    this._lastInterviewerQuestion = '';

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

    // No modo 'both', a SUA fala (mic) serve só pra transcrição + banco de respostas —
    // NÃO gera sugestão. Senão, quando você LÊ a sugestão em voz alta, o mic re-dispara
    // a IA e ela repete a mesma coisa (loop). A sugestão é pro que o OUTRO (sys) fala.
    // No modo 'mic' (você é a fonte do conteúdo), aí sim respondemos ao mic.
    const respondToSegment = (source === 'sys') || (mode === 'mic');

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

      // Texto definitivo (UI mostra "transcrito" + "pensando…"). noSuggestion=true
      // quando é a sua fala em modo both → a UI esconde a bolha do assistente.
      this.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: transcript, source: 'openai', noSuggestion: !respondToSegment, timestamp: new Date().toISOString() });

      // Banco de respostas: rastreia a pergunta do interlocutor (sys) e, quando VOCÊ
      // (mic) responde, avalia/guarda o par em background (não trava o pipeline).
      if (source === 'mic') {
        if (this._lastInterviewerQuestion) {
          this._scoreAndStore(this._lastInterviewerQuestion, transcript, token);
          this._lastInterviewerQuestion = '';
        }
      } else {
        this._lastInterviewerQuestion = transcript;
      }

      // Sua fala em modo both: já transcreveu e alimentou o banco — não gera sugestão.
      if (!respondToSegment) return;

      // Streaming: emite segment_response parcial com o MESMO id; a UI atualiza a
      // bolha no lugar (rtSegments.get(payload.id)). Throttle já é feito no _askAI.
      const response = await this._askAI(transcript, token, (partial) => {
        this.emitUpdate({ type: 'segment_response', id, iteration, response: partial, source: 'openai', timestamp: new Date().toISOString() });
      });
      // Emite o texto final completo (garante o conteúdo inteiro mesmo se o último delta foi throttled).
      this.emitUpdate({ type: 'segment_response', id, iteration, response, source: 'openai', timestamp: new Date().toISOString() });
      await this._writeHistory(transcript, response);
    } catch (err) {
      this._handleError(err, id, iteration);
    } finally {
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
    }
  }

  // Avalia a SUA resposta (mic) contra a última pergunta do interlocutor, em BACKGROUND,
  // e guarda no banco de respostas se a nota for boa. Silencioso — nada vai pra UI.
  async _scoreAndStore(question, answer, token) {
    try {
      const abCfg = this.configService.getAnswerBankConfig ? this.configService.getAnswerBankConfig() : null;
      if (!abCfg || !abCfg.enabled || !question || !answer || !token) return;
      const ta = this.configService.getTranslationAssistantConfig ? this.configService.getTranslationAssistantConfig() : {};
      const evalText = await evaluateUserResponse(
        question, answer,
        { userName: ta.userName, userBackground: ta.userBackground },
        token
      );
      const m = String(evalText).match(/(\d)\s*\/\s*5/) || String(evalText).match(/⭐\s*(\d)/);
      const score = m ? parseInt(m[1], 10) : 0;
      await answerBank.record({ question, answer, score, lang: ta.targetLanguage, token, minScore: abCfg.minScore });
    } catch (e) {
      console.warn('[realtime-openai] score/store (banco) falhou:', e.message);
    }
  }

  // ---------- OpenAI chat ----------
  // onDelta(textoAcumulado): se passado, streama a resposta (sensação "bate pronto").
  async _askAI(transcript, token, onDelta) {
    const chosen = this.configService.getOpenAiModel();
    const model = REALTIME_MODEL_FLOOR[chosen] || chosen;

    // RAG: base de conhecimento (fatos atuais) + banco de respostas (suas respostas boas).
    // Embeda a query UMA vez e compartilha entre os dois → 0 chamada de rede a mais.
    let kbBlock = '', bankHint = '';
    try {
      const kbOn = this.configService.getKnowledgeBaseConfig
        ? this.configService.getKnowledgeBaseConfig().enabled : false;
      const abOn = this.configService.getAnswerBankConfig
        ? this.configService.getAnswerBankConfig().enabled : false;
      if (kbOn || abOn) {
        const qEmb = await knowledgeBase.embed(transcript, token);
        if (kbOn) kbBlock = await knowledgeBase.augment(transcript, { token, topK: 5, queryEmbedding: qEmb });
        if (abOn) bankHint = await answerBank.augment(transcript, { token, queryEmbedding: qEmb });
      }
    } catch (_) {}
    const ragBlock = [bankHint, kbBlock].filter(Boolean).join('\n\n');

    const userPrompt =
      (ragBlock ? ragBlock + '\n\n---\n\n' : '') +
      `TRANSCRIÇÃO do áudio captado (transcrita pela OpenAI, alta qualidade):\n\n` +
      `"${transcript}"\n\n` +
      `Aja segundo as regras do system prompt. Se for incompreensível ou sem ` +
      `conteúdo útil, responda APENAS '(trecho sem conteúdo relevante)'.`;

    const stream = typeof onDelta === 'function';
    const payload = {
      model,
      max_tokens: CHAT_MAX_TOKENS,
      stream,
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
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const e = new Error(data.error?.message || 'OpenAI chat failed');
      e.response = { status: res.status, data };
      throw e;
    }

    // Modo não-streaming (compat).
    if (!stream) {
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || '').trim() || '(sem resposta)';
    }

    // Modo streaming (SSE): acumula tokens e emite o texto parcial (throttle ~60ms).
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', content = '', lastEmit = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const p = line.slice(5).trim();
        if (p === '[DONE]') continue;
        try {
          const delta = JSON.parse(p).choices?.[0]?.delta?.content || '';
          if (delta) {
            content += delta;
            const now = Date.now();
            if (now - lastEmit > 60) { lastEmit = now; onDelta(content.trim()); }
          }
        } catch (_) {}
      }
    }
    return content.trim() || '(sem resposta)';
  }

  _systemInstruction() {
    const lang = (this.configService.getLanguage && this.configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
    return [
      'Você é um COPILOTO DISCRETO em tempo real durante ENTREVISTAS, reuniões e ligações.',
      'Você ouve o microfone do usuário E o áudio do sistema (interlocutor). O texto recebido é uma TRANSCRIÇÃO do que está sendo falado.',
      'OBJETIVO: dar ao usuário o que ele precisa pra responder COM AS PRÓPRIAS PALAVRAS — não escrever um discurso pronto pra ele decorar.',
      'MULTIFUNÇÃO: serve pra entrevistas em PT-BR, mas TAMBÉM pra acompanhar reuniões, bate-papos e vídeos (YouTube etc.). Nem todo trecho é uma pergunta. Quando for só conversa/exposição (não uma pergunta a responder), mostre os TERMOS/TÓPICOS-CHAVE do que está sendo falado — NÃO force uma sugestão de resposta.',
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
      'D) RUÍDO / SAUDAÇÃO / "mm-hmm" / backchannel SEM conteúdo: responda APENAS "(trecho sem conteúdo relevante)". (Atenção: conversa ou exposição COM conteúdo NÃO se enquadra aqui — nesse caso siga a regra de MULTIFUNÇÃO e dê os termos-chave do que foi dito.)',
      '',
      'SEMPRE destaque em **negrito** os termos/tecnologias/conceitos-chave — é o que o usuário bate o olho pra montar a resposta (ex: **Kafka**, **Spring Security**, **JWT**, **idempotência**, **índice**, **transação**, **Jakarta**, **IPO**).',
      '',
      'SIGLAS E JARGÃO (negócios/finanças/tech): quando aparecer uma sigla ou termo que valha explicar (ex: IPO, M&A, ARR, SLA, churn, valuation, EBITDA), acrescente uma EXPLICAÇÃO CURTA do que significa NAQUELE contexto. Formato DISCRETO: linha separada em itálico começando com "ℹ️", SEM negrito — ex: "*ℹ️ IPO = abertura de capital, quando a empresa passa a vender ações na bolsa*". Só quando ajuda; no máximo 1-2 por trecho.',
      '',
      'HIERARQUIA (destaque x apoio): as PALAVRAS-CHAVE em **negrito** são o FOCO — é o que o usuário lê pra responder. As notas de sigla (ℹ️ itálico) e a sugestão de resposta são APOIO SECUNDÁRIO, discretas — nunca roubam o destaque das palavras-chave nem confundem o que importa. Em tempo real, palavras-chave primeiro; resposta sugerida só quando faz sentido (entrevista), e nunca como foco principal.',
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
