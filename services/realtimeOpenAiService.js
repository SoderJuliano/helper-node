// realtimeOpenAiService.js — Assistente em tempo real 100% ONLINE (OpenAI).
//
// Usado quando o provider selecionado é ChatGPT (aiModel === 'openIa') ou na
// edição Lite (onde só existe OpenAI). NÃO usa Vosk nem Whisper local: tanto a
// transcrição quanto a resposta vão para a OpenAI.
//
// Pipeline por segmento de fala:
//   1. vadEngine (pw-record + RMS) captura mic + monitor do sistema e detecta
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
const { startVAD, stopVAD } = require('./translationAssistant/vadEngine');
const { transcribeAudio } = require('./translationAssistant/openaiClient');

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

    // vadEngine é singleton (compartilhado com o Assistente de Tradução). Garante
    // estado limpo antes de iniciar — senão startVAD faz early-return e nosso
    // onSpeechEnd nunca é religado.
    await stopVAD().catch(() => {});
    await startVAD({
      onSpeechEnd: (audioPath, source) => this._handleSegment(audioPath, source),
    });
    return true;
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    await stopVAD();
    this.emitUpdate({ type: 'state', state: 'stopped', message: 'Assistente em tempo real parado.', timestamp: new Date().toISOString() });
  }

  // ---------- Pipeline por segmento ----------
  async _handleSegment(audioPath, source) {
    if (!this.active) {
      try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
      return;
    }

    // O vadEngine abre DOIS streams (mic + monitor do sistema). Se processarmos
    // ambos, o mesmo som — que toca no alto-falante e vaza pro microfone — é
    // transcrito e respondido 2x. Por padrão processamos só o áudio do SISTEMA
    // ('monitor'/'sys'): é o do interlocutor/vídeo/reunião, que é o que o
    // copiloto precisa responder. audioCaptureMode permite trocar:
    //   'monitor' (default) → só 'sys' | 'mic' → só microfone | 'both' → ambos.
    const mode = this.configService.getAudioCaptureMode
      ? this.configService.getAudioCaptureMode()
      : 'monitor';
    const wanted = mode === 'mic' ? 'mic' : (mode === 'both' ? null : 'sys');
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

    const userPrompt =
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
      'Você é um COPILOTO DISCRETO em tempo real para o usuário durante reuniões, ligações, entrevistas, vídeos e estudos.',
      'Você ouve simultaneamente o microfone do usuário E o áudio do sistema (interlocutores, vídeos, podcasts).',
      'O texto recebido é uma TRANSCRIÇÃO automática do que está sendo falado.',
      '',
      'OBJETIVO PRINCIPAL: AJUDAR O USUÁRIO A RESPONDER, ENTENDER OU AGIR. Você NÃO é um resumidor — é um copiloto.',
      '',
      'REGRAS DE COMPORTAMENTO (escolha o modo apropriado por trecho):',
      '',
      '1) PERGUNTA TÉCNICA / QUALQUER PERGUNTA: responda DIRETAMENTE com a solução correta — cálculo, código, definição, passo-a-passo. Esse é o cenário mais importante.',
      '',
      '2) PERGUNTA FEITA AO USUÁRIO (entrevista/reunião): SUGIRA uma resposta pronta, completa e específica para ele falar, no tom apropriado. Prefixe com "Sugestão:". NÃO seja genérico nem raso — cubra a complexidade da pergunta (cite tecnologias, trade-offs, exemplos concretos quando couber).',
      '',
      '3) DISCUSSÃO TÉCNICA / DECISÃO / TRADE-OFF: dê insight valioso — aponte trade-off, risco, alternativa melhor, confirme ou refute. Seja opinativo e útil.',
      '',
      '4) TERMO/CONCEITO OBSCURO (sigla, framework, lei, produto): defina em 1 linha + por que importa no contexto.',
      '',
      '5) NÚMEROS / DADOS / VALORES: confirme, calcule ou contextualize.',
      '',
      '6) CONVERSA CASUAL / SAUDAÇÃO / RUÍDO / PIADA SEM PERGUNTA: responda APENAS "(trecho sem conteúdo relevante)". Não force ajuda onde não há demanda.',
      '',
      'CONHECIMENTO ESPERADO: programação ampla (JS/TS/Python/Java/Go/Rust/C++/SQL, React/Vue/Node/Spring/FastAPI/Django, Docker/K8s/AWS/GCP, SOLID/DDD/TDD/CI-CD, REST/GraphQL/gRPC/Kafka/RabbitMQ), termos de TI em inglês, matemática, física básica, leis BR (LGPD, CLT, CDC, Marco Civil), produtos financeiros, inglês fluente.',
      '',
      'FORMATO:',
      '- Seja DIRETO e COMPLETO. Para sugestões de resposta de entrevista, 2 a 5 frases bem construídas; para perguntas técnicas, o que for necessário (pode usar bloco de código).',
      '- PROIBIDO preâmbulos como "A fala menciona...", "O interlocutor diz...", "No áudio é dito...". Vá direto ao valor.',
      '- NÃO repita o que foi falado. ENTREGUE A RESPOSTA.',
      '- Se for sugestão de resposta, prefixe "Sugestão:".',
      lang === 'en' ? '- Responda em inglês quando a conversa estiver em inglês (ex.: entrevista internacional).' : '- Responda em português, salvo se a conversa estiver claramente em outro idioma.',
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
      stopVAD().catch(() => {});
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
