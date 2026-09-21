// realtimeOpenAiService.js — Assistente em tempo real 100% ONLINE (OpenAI).
//
// Usado quando o provider selecionado é ChatGPT (aiModel === 'openIa') ou na
// edição Lite (onde só existe OpenAI). NÃO usa Whisper local: tanto a
// transcrição quanto a resposta vão para a OpenAI.
//
// DOIS CAMINHOS, por fonte de áudio:
//
// 'sys' (interlocutor — é dele que sai a sugestão) → STREAMING:
//   realtimeAudioCapture entrega PCM cru e contínuo → `realtimeTranscriptionSession`
//   (WebSocket) transcreve ENQUANTO a pessoa fala e o `semantic_vad` do servidor
//   decide o fim do turno. Quando ela para, o texto já está pronto: medido em
//   ~0,5s da última sílaba até o transcript completo, contra ~1,9-2,6s do batch.
//   Se a sessão não subir (rede/API), `_streaming` fica false e o 'sys' cai
//   sozinho no caminho batch abaixo — nunca fica sem transcrição.
//
// 'mic' (você) → BATCH, como antes: o VAD local fecha o segmento e manda o WAV
//   pro /audio/transcriptions. Sua fala não gera sugestão (só alimenta o banco
//   de respostas), então não vale o custo de uma segunda sessão de streaming.
//
// Disparo especulativo: com o transcript parcial em mãos, uma heurística LOCAL
// (sem round-trip) detecta pergunta fechada e já responde antes do fim do turno.
//
// Eventos emitidos (compatíveis com index.html):
//   state | segment_start | segment_whisper_correction | segment_response |
//   segment_error | fatal_error

const { startCapture, stopCapture } = require('./realtimeAudioCapture');
const answerBank = require('./answerBank');
const { evaluateUserResponse } = require('./translationAssistant/openaiClient');
const { buildTranscriptionPrompt } = require('./techGlossary');
const RealtimeTranscriptionSession = require('./realtimeTranscriptionSession');
const RealtimeRag = require('./realtimeRag');
const { handleBatchSegment, TRANSCRIBE_MODEL } = require('./realtimeBatchFallback');
const { cleanTranscription, mergeContinuationText, isAcousticEcho } = require('./audioTranscriptionCleaner');
const { buildRealtimeCopilotPrompt } = require('./realtimeCopilotPrompt');
const { applyRealtimeOverride, supportsReasoningEffort, maxTokensParam } = require('./openAiRealtimeModels');

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
    // 3 turnos (não 10): menos prompt = menos TTFT, e mantém o prefixo do system
    // prompt estável pro prompt caching da OpenAI.
    this.maxIterationsInContext = 3;
    // Última pergunta do interlocutor (sys) — pareada com a SUA resposta (mic) p/ o banco.
    this._lastInterviewerQuestion = '';
    // Fusao de fala fragmentada por pausa — rastreado por fonte (mic/sys nao se misturam).
    this.lastClosedBySource = { mic: null, sys: null };
    // Sessão de transcrição em STREAMING (só p/ 'sys' — é dela que sai a
    // sugestão). null quando não subiu: aí o 'sys' cai no caminho batch.
    this._stt = null;
    this._streaming = false;
    // RAG pré-buscado fora do caminho crítico (Fase 1).
    this._rag = new RealtimeRag(configService);
  }

  isActive() { return this.active; }

  // Vocabulário técnico injetado na transcrição. Cacheado no techGlossary — não
  // custa rede nem entra no caminho crítico da resposta.
  _glossaryPrompt() {
    try {
      const ta = this.configService.getTranslationAssistantConfig
        ? this.configService.getTranslationAssistantConfig() : {};
      const recent = this.contextMessages.slice(-4).map(m => m.content).join(' ');
      const bgCombined = [ta.userBackground, ta.userTechExperiences].filter(Boolean).join(' ');
      return buildTranscriptionPrompt({ background: bgCombined, context: recent });
    } catch (_) {
      return buildTranscriptionPrompt({});
    }
  }

  async start() {
    if (this.active) return true;
    this.active = true;
    this.iterationCount = 0;
    this.contextMessages = [];
    this.currentSessionId = null;
    this._lastInterviewerQuestion = '';
    this.lastClosedBySource = { mic: null, sys: null };
    this._rag.reset();

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

    // Conexão quente: paga o handshake TLS AGORA, não no meio da primeira
    // pergunta. Fire-and-forget — se falhar, não muda nada.
    this._warmUp();

    // Fase 2: sessão de transcrição em streaming para o 'sys' (interlocutor).
    // Se não subir, `this._streaming` fica false e o 'sys' segue no caminho
    // batch — a entrevista nunca fica sem transcrição por causa disso.
    this._startStreamingStt();

    await startCapture({
      onSpeechEnd: (audioPath, source) => handleBatchSegment(this, audioPath, source),
      onPcm: (chunk, source) => { if (source === 'sys' && this._stt) this._stt.sendPcm16k(chunk); },
      sysTarget,
      micTarget,
    });
    return true;
  }

  _warmUp() {
    const token = this.configService.getOpenIaToken();
    if (!token) return;
    fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + token } })
      .then(() => console.log('[realtime-openai] conexão aquecida'))
      .catch(() => {});
  }

  _startStreamingStt() {
    const token = this.configService.getOpenIaToken();
    if (!token) return;
    const cfg = this.configService.getConfig ? this.configService.getConfig() : {};
    if (cfg.realtimeStreamingStt === false) {
      console.log('[realtime-openai] STT em streaming desligado por config — usando batch.');
      return;
    }
    // No modo 'mic' quem gera sugestão é o microfone, não o sys — não vale
    // manter uma sessão (e um custo) de streaming aberta pro sys.
    if ((cfg.realtimeAudioMode || 'both') === 'mic') return;

    this._stt = new RealtimeTranscriptionSession({
      token,
      model: TRANSCRIBE_MODEL,
      prompt: this._glossaryPrompt(),
      eagerness: cfg.realtimeVadEagerness || 'high',
      onSpeechStarted: () => { this._tSpeech = Date.now(); },
      onSpeechStopped: () => { this._tSpeechStopped = Date.now(); },
      onDelta: (accumulated) => this._onStreamDelta(accumulated),
      onCompleted: (finalText) => this._onStreamTurn(finalText),
      onFatal: (err) => {
        console.error('[realtime-openai] streaming STT caiu, voltando pro batch:', err.message);
        this._streaming = false;
        this._stt = null;
        this.emitUpdate({ type: 'error', message: 'Transcrição em streaming indisponível — usando o modo padrão.', timestamp: new Date().toISOString() });
      },
    });
    this._streaming = true;
    this._stt.connect();
    console.log('[realtime-openai] STT em streaming ativo (semantic_vad)');
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    if (this._stt) { this._stt.close(); this._stt = null; }
    this._streaming = false;
    await stopCapture();
    this.emitUpdate({ type: 'state', state: 'stopped', message: 'Assistente em tempo real parado.', timestamp: new Date().toISOString() });
  }

  // ---------- Fase 2: turno vindo do STT em streaming ----------
  // Chamado quando o semantic_vad do servidor decide que o interlocutor fechou o
  // turno. O transcript JA chegou junto com a fala, entao aqui nao ha espera de
  // upload nem de transcricao — vai direto pra resposta.
  async _onStreamTurn(finalText) {
    if (!this.active) return;
    const token = this.configService.getOpenIaToken();
    if (!token) return;

    const text = cleanTranscription(finalText, this._glossaryPrompt());
    if (!text || text.length < 3) return;

    const tStop = this._tSpeechStopped || Date.now();
    console.log(`[realtime-openai] turno (stream) +${((Date.now() - tStop) / 1000).toFixed(2)}s apos fim da fala: "${text.slice(0, 70)}"`);

    // Eco acústico: se o mic acabou de fechar o mesmo texto nos últimos 5s, descarta duplicata.
    const otherClosed = this.lastClosedBySource.mic;
    if (isAcousticEcho(text, otherClosed)) {
      console.log(`[realtime-openai] Eco acústico detectado em sys duplicando mic: "${text}" - descartando`);
      return;
    }

    this._lastInterviewerQuestion = text;

    // Continuação de fala: se o último turno do sistema fechou há pouco tempo,
    // mescla com o trecho anterior e atualiza a MESMA bolha sem criar duplicatas.
    const prevClosed = this.lastClosedBySource.sys;
    const continuationWindowMs = 5000;
    const isContinuation = !!(prevClosed && (Date.now() - prevClosed.closedAt) <= continuationWindowMs);

    if (isContinuation && prevClosed) {
      const askText = mergeContinuationText(prevClosed.text, text);
      if (askText === prevClosed.text) {
        console.log(`[realtime-openai] Texto idêntico já processado no Trecho #${prevClosed.iteration}, ignorando duplicata`);
        return;
      }
      console.log(`[realtime-openai] Continuação de fala detectada: "${prevClosed.text}" + "${text}" -> "${askText}" (atualizando Trecho #${prevClosed.iteration})`);
      this.lastClosedBySource.sys = { id: prevClosed.id, iteration: prevClosed.iteration, text: askText, closedAt: Date.now() };

      this.emitUpdate({
        type: 'segment_whisper_correction',
        id: prevClosed.id,
        iteration: prevClosed.iteration,
        text: askText,
        audioSource: 'sys',
        source: 'openai',
        timestamp: new Date().toISOString(),
      });

      try {
        const response = await this._askAI(askText, token, (partial) => {
          this.emitUpdate({ type: 'segment_response', id: prevClosed.id, iteration: prevClosed.iteration, response: partial, audioSource: 'sys', source: 'openai', timestamp: new Date().toISOString() });
        });
        this.emitUpdate({ type: 'segment_response', id: prevClosed.id, iteration: prevClosed.iteration, response, audioSource: 'sys', source: 'openai', timestamp: new Date().toISOString() });
        await this._writeHistory(askText, response);
      } catch (err) {
        this._handleError(err, prevClosed.id, prevClosed.iteration);
      }
      return;
    }

    // Novo turno / Primeira fala
    const id = 'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    this.iterationCount += 1;
    const iteration = this.iterationCount;
    const askText = text;
    this.lastClosedBySource.sys = { id, iteration, text: askText, closedAt: Date.now() };

    this.emitUpdate({ type: 'segment_start', id, iteration, audioSource: 'sys', timestamp: new Date().toISOString() });
    this.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: askText, audioSource: 'sys', source: 'openai', timestamp: new Date().toISOString() });

    try {
      const response = await this._askAI(askText, token, (partial) => {
        this.emitUpdate({ type: 'segment_response', id, iteration, response: partial, audioSource: 'sys', source: 'openai', timestamp: new Date().toISOString() });
      });
      this.emitUpdate({ type: 'segment_response', id, iteration, response, audioSource: 'sys', source: 'openai', timestamp: new Date().toISOString() });
      await this._writeHistory(askText, response);
    } catch (err) {
      this._handleError(err, id, iteration);
    }
  }

  // ---------- Fase 3: RAG pré-buscado sobre o transcript PARCIAL ----------
  // Roda a cada delta. Aproveita que o áudio está sendo transcrito ao vivo para
  // buscar o contexto no RAG silenciosamente em background sem emitir nada para a UI.
  _onStreamDelta(accumulated) {
    if (!this.active) return;
    try {
      const text = cleanTranscription(accumulated, this._glossaryPrompt());
      if (text && text.length >= 10) {
        this._rag.prefetch(text, this.configService.getOpenIaToken());
      }
    } catch (e) {
      console.error('[realtime-openai] erro em _onStreamDelta:', e.message);
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
        {
          userName: ta.userName,
          userBackground: ta.userBackground,
          userTechExperiences: ta.userTechExperiences,
          userBehavioral: ta.userBehavioral,
        },
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
    const model = applyRealtimeOverride(chosen);

    const ragBlock = await this._rag.blockFor(transcript, token);
    const userContext = this.configService.getUserContextBlock ? this.configService.getUserContextBlock() : '';

    const userPrompt =
      (userContext ? userContext + '\n\n---\n\n' : '') +
      (ragBlock ? ragBlock + '\n\n---\n\n' : '') +
      `TRANSCRIÇÃO do áudio captado:\n"${transcript}"\n\n` +
      `Responda de forma prática e direta focada em mercado, com termos essenciais em **negrito** e com sugestão de resposta fluida e pronta para falar em 1 linha (sem siglas soltas ou decoreba acadêmica), conforme o system prompt. Se for estritamente ruído/saudação sem nenhuma pergunta ou intenção técnica, responda '(trecho sem conteúdo relevante)'. Se contiver distorções fonéticas de termos técnicos (ex: 'animais onívoros' -> 'N+1 queries'), deduza o conceito real de computação e responda a ele.`;

    const stream = typeof onDelta === 'function';
    const payload = {
      model,
      ...maxTokensParam(model, CHAT_MAX_TOKENS),
      stream,
      messages: [
        { role: 'system', content: buildRealtimeCopilotPrompt(this._lang()) },
        ...this.contextMessages.slice(-(this.maxIterationsInContext * 2)),
        { role: 'user', content: userPrompt },
      ],
    };
    // Tempo real: velocidade é inegociável, então sempre usa o esforço de
    // raciocínio mais baixo aqui, independente da preferência global do usuário.
    if (supportsReasoningEffort(model)) payload.reasoning_effort = 'low';

    let res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 400 && payload.reasoning_effort && (data.error?.param === 'reasoning_effort' || String(data.error?.message).toLowerCase().includes('reasoning_effort'))) {
        delete payload.reasoning_effort;
        res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const finalData = data.error ? data : await res.json().catch(() => ({}));
        const e = new Error(finalData.error?.message || 'OpenAI chat failed');
        e.response = { status: res.status, data: finalData };
        throw e;
      }
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

  _lang() {
    return (this.configService.getLanguage && this.configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
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
    if (w && !w.isDestroyed()) {
      w.webContents.send('realtime-assistant-update', payload);
    }
    try {
      const isStopped = payload && payload.type === 'state' && payload.state === 'stopped';
      const isEnabled = this.configService && typeof this.configService.getRealtimeAssistantStatus === 'function' ? this.configService.getRealtimeAssistantStatus() : false;
      const isOs = this.configService && typeof this.configService.getOsIntegrationStatus === 'function' ? this.configService.getOsIntegrationStatus() : false;

      if (isOs && isEnabled && !isStopped && this.active) {
        const { helpers } = require('../main/globals');
        if (helpers) {
          if (helpers.createRealtimeAssistantOverlay) {
            helpers.createRealtimeAssistantOverlay();
          }
          if (helpers.sendToRealtimeAssistantOverlay) {
            helpers.sendToRealtimeAssistantOverlay('realtime-assistant-update', payload);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = RealtimeOpenAiService;
