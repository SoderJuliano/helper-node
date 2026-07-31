// services/realtimeTranscriptionSession.js
//
// Sessao de TRANSCRICAO EM STREAMING da OpenAI (Realtime GA, WebSocket).
//
// POR QUE EXISTE
// O caminho batch (`/audio/transcriptions`) so comeca a trabalhar DEPOIS que a
// pessoa para de falar: espera silencio (VAD local) + sobe o WAV inteiro +
// transcreve. Sao ~1,9-2,6s antes do primeiro token da resposta.
// Aqui o audio sobe CONTINUAMENTE enquanto a pessoa fala, entao quando ela para
// o texto ja esta pronto. Medido com audio real: fim da fala -> transcript
// completo em 0,47s.
//
// DETALHES DA API QUE CUSTARAM SONDAGEM (nao mude sem re-testar):
// - Endpoint GA: wss://api.openai.com/v1/realtime?intent=transcription
//   NAO mandar o header `OpenAI-Beta: realtime=v1` — isso cai na API Beta, que
//   responde `beta_api_shape_disabled`.
// - Sem `?model=` na query. O modelo de transcricao vai em
//   `audio.input.transcription.model`. Passar um modelo de transcricao na query
//   da `invalid_model` ("is a transcription model and cannot be used as the
//   realtime session model").
// - **Sample rate minimo 24000.** Nosso pipeline de captura e 16k, entao este
//   modulo reamostra 16k->24k (razao exata 2:3). Mandar 16000 da
//   `integer_below_min_value`.
// - `gpt-live-transcribe` NAO aceita turn_detection ("Turn detection is not
//   supported for this transcription model"). Ficamos no `gpt-4o-transcribe`,
//   que aceita `semantic_vad` — e que e o modelo que o dono quis manter.
// - O WebSocket global do Node 24/Electron 36 aceita `{ headers }` no segundo
//   argumento e envia mesmo (auth confirmada). Nao precisa da dependencia `ws`.

const SESSION_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const TARGET_RATE = 24000;   // exigido pela API
const SOURCE_RATE = 16000;   // o que o nosso motor de captura produz
const RECONNECT_DELAYS_MS = [500, 1500, 4000];

class RealtimeTranscriptionSession {
  /**
   * @param {object} opts
   * @param {string}   opts.token          - chave da OpenAI
   * @param {string}   [opts.model]        - modelo de transcricao
   * @param {string}   [opts.prompt]       - glossario tecnico (techGlossary)
   * @param {string}   [opts.eagerness]    - semantic_vad: low|medium|high|auto
   * @param {function} [opts.onDelta]      - (textoAcumulado, deltaCru)
   * @param {function} [opts.onCompleted]  - (textoFinalDoTurno)
   * @param {function} [opts.onSpeechStarted]
   * @param {function} [opts.onSpeechStopped]
   * @param {function} [opts.onFatal]      - (Error) apos esgotar reconexoes
   */
  constructor(opts = {}) {
    this.token = opts.token;
    this.model = opts.model || 'gpt-4o-transcribe';
    this.prompt = opts.prompt || '';
    this.eagerness = opts.eagerness || 'high';
    this.onDelta = opts.onDelta || (() => {});
    this.onCompleted = opts.onCompleted || (() => {});
    this.onSpeechStarted = opts.onSpeechStarted || (() => {});
    this.onSpeechStopped = opts.onSpeechStopped || (() => {});
    this.onFatal = opts.onFatal || (() => {});

    this.ws = null;
    this.ready = false;      // session.updated recebido — pode mandar audio
    this.closing = false;
    this._attempt = 0;
    this._pending = '';      // texto acumulado do turno corrente
    this._phase = 0;         // posicao fracionaria do resampler entre chunks
    this._tail = 0;          // ultima amostra do chunk anterior
    this._reconnectTimer = null;
  }

  isReady() { return this.ready; }

  connect() {
    if (this.closing) return;
    let ws;
    try {
      ws = new WebSocket(SESSION_URL, { headers: { Authorization: 'Bearer ' + this.token } });
    } catch (e) {
      return this._scheduleReconnect(e);
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this._attempt = 0;
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: TARGET_RATE },
              transcription: this.prompt
                ? { model: this.model, prompt: this.prompt }
                : { model: this.model },
              turn_detection: { type: 'semantic_vad', eagerness: this.eagerness },
            },
          },
        },
      }));
    });

    ws.addEventListener('message', (m) => this._onMessage(m));
    ws.addEventListener('error', () => { /* o close cuida da reconexao */ });
    ws.addEventListener('close', (e) => {
      this.ready = false;
      if (this.closing) return;
      this._scheduleReconnect(new Error(`websocket fechou (${e.code} ${e.reason || ''})`.trim()));
    });
  }

  _onMessage(m) {
    let d;
    try { d = JSON.parse(m.data); } catch { return; }
    const t = d.type || '';

    if (t === 'session.updated') { this.ready = true; return; }

    if (t === 'error') {
      // Erro de configuracao (nao adianta reconectar com a mesma config).
      console.error('[rt-stt] erro da API:', JSON.stringify(d.error));
      const msg = d.error?.message || 'erro na sessao de transcricao';
      this.closing = true;
      try { this.ws.close(); } catch (_) {}
      this.onFatal(new Error(msg));
      return;
    }

    if (t === 'input_audio_buffer.speech_started') {
      this._pending = '';
      this.onSpeechStarted();
      return;
    }
    if (t === 'input_audio_buffer.speech_stopped') { this.onSpeechStopped(); return; }

    if (t.endsWith('input_audio_transcription.delta')) {
      const delta = d.delta || '';
      if (!delta) return;
      this._pending += delta;
      this.onDelta(this._pending, delta);
      return;
    }
    if (t.endsWith('input_audio_transcription.completed')) {
      const final = (d.transcript || this._pending || '').trim();
      this._pending = '';
      if (final) this.onCompleted(final);
      return;
    }
  }

  /**
   * Envia um chunk de PCM s16le mono 16 kHz (o formato do nosso motor de
   * captura). Reamostra pra 24 kHz e manda. No-op enquanto a sessao nao esta
   * pronta — o audio desse intervalo e' descartado de proposito: melhor perder
   * 300ms de silencio inicial do que bufferizar e mandar um bolo atrasado.
   */
  sendPcm16k(chunk) {
    if (!this.ready || !this.ws || this.ws.readyState !== 1) return;
    const up = this._resample16to24(chunk);
    if (!up.length) return;
    try {
      this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: up.toString('base64') }));
    } catch (_) { /* close/reconnect cuida */ }
  }

  /**
   * Reamostra s16le mono 16 kHz -> 24 kHz (razao exata 2:3) por interpolacao
   * linear. Guarda a ultima amostra e a fase entre chunks pra nao criar
   * descontinuidade na juncao — um "clique" a cada 100ms degradaria o WER.
   */
  _resample16to24(buf) {
    const inLen = buf.length >> 1;
    if (inLen < 2) return Buffer.alloc(0);
    const step = SOURCE_RATE / TARGET_RATE; // 2/3
    const values = [];
    let pos = this._phase;
    while (true) {
      const i = Math.floor(pos);
      if (i + 1 >= inLen) break;               // precisa da proxima amostra: espera o chunk seguinte
      const a = i < 0 ? this._tail : buf.readInt16LE(i * 2);
      const b = buf.readInt16LE((i + 1) * 2);
      values.push(a + (b - a) * (pos - i));
      pos += step;
    }
    this._phase = pos - inLen;                 // pode ficar negativo: cai no _tail no proximo chunk
    this._tail = buf.readInt16LE((inLen - 1) * 2);

    const out = Buffer.alloc(values.length * 2);
    for (let k = 0; k < values.length; k++) {
      const v = Math.max(-32768, Math.min(32767, Math.round(values[k])));
      out.writeInt16LE(v, k * 2);
    }
    return out;
  }

  _scheduleReconnect(err) {
    if (this.closing) return;
    const delay = RECONNECT_DELAYS_MS[this._attempt];
    if (delay === undefined) {
      console.error('[rt-stt] reconexoes esgotadas:', err.message);
      this.onFatal(err);
      return;
    }
    this._attempt++;
    console.warn(`[rt-stt] ${err.message} — reconectando em ${delay}ms (tentativa ${this._attempt})`);
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  close() {
    this.closing = true;
    this.ready = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    try { if (this.ws) this.ws.close(); } catch (_) {}
    this.ws = null;
  }
}

module.exports = RealtimeTranscriptionSession;
