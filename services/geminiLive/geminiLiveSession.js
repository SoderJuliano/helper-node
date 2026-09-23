/**
 * services/geminiLive/geminiLiveSession.js
 * Conexão WebSocket duplex em tempo real com a Gemini Multimodal Live API.
 * Suporta streaming contínuo de áudio PCM bidirecional (Full-Duplex),
 * detecção nativa de interrupção (Barge-In) e orquestração de ferramentas (AGY / Terminal).
 */

const EventEmitter = require('events');
const { DEFAULT_LIVE_TOOLS, executeToolCall } = require('./geminiLiveTools');

const GEMINI_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'models/gemini-3.1-flash-live-preview';
const CANDIDATE_MODELS = [
  'models/gemini-3.1-flash-live-preview',
  'models/gemini-3.5-live-translate-preview'
];
const DEFAULT_VOICE = 'Aoede'; // Voz feminina calorosa, natural e fluída

const DEFAULT_SYSTEM_INSTRUCTION = `Você é a Raphael, copiloto e assistente de desenvolvimento sênior em inteligência artificial do Helper Node.
Você trabalha em parceria com o desenvolvedor Juliano. Seu núcleo visual integrado é o Raphael Core (plasma cósmico tridimensional).
Sua personalidade é inteligente, descontraída, nerd, empática e ágil.
DIRETIVAS OBRIGATÓRIAS DE FLUXO:
1. Responda em áudio em português do Brasil de maneira natural, conversacional e concisa.
2. Quando Juliano solicitar refatoração, criação de código, modificação de arquivos ou execução de testes locais, FALE BREVEMENTE EM VOZ ALTA antes de disparar a ferramenta (ex: "Beleza Juliano! Já estou abrindo o projeto e executando com o AGY...").
3. Enquanto a ferramenta roda em background, mantenha presença.
4. Ao receber o retorno da ferramenta, faça um resumo conversacional objetivo dos resultados (ex: se os testes passaram, status final).
5. Se for apenas conversa ou dúvida teórica/arquitetural, responda diretamente em voz com alta precisão técnica.`;

class GeminiLiveSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey || '';
    this.model = options.model || DEFAULT_MODEL;
    this.voiceName = options.voiceName || DEFAULT_VOICE;
    this.systemInstruction = options.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION;
    this.tools = options.tools !== undefined ? options.tools : DEFAULT_LIVE_TOOLS;
    
    this.ws = null;
    this.isConnected = false;
    this.isSessionConfigured = false;
    this.currentState = 'IDLE'; // IDLE, LISTENING, THINKING, SPEAKING, WORKING
    this.isExecutingTool = false;
    this._triedFallback = false;

    // Acumuladores de conversa do turno atual
    this.currentUserText = '';
    this.currentModelText = '';
    this.lastInterimUserText = '';
  }

  /**
   * Conecta ao WebSocket da Live API e envia mensagem inicial de configuração.
   */
  async connect() {
    if (this.isConnected && this.ws) return;
    if (!this.apiKey || !this.apiKey.trim()) {
      throw new Error('Google API Key não configurada para a Live Session.');
    }

    return this._connectWithModel(this.model);
  }

  _connectWithModel(modelName) {
    const endpoint = `${GEMINI_LIVE_WS_URL}?key=${encodeURIComponent(this.apiKey.trim())}`;
    this.model = modelName;

    return new Promise((resolve, reject) => {
      try {
        const WSClass = typeof WebSocket !== 'undefined' ? WebSocket : global.WebSocket;
        this.ws = new WSClass(endpoint);

        this.ws.onopen = () => {
          this.isConnected = true;
          console.log(`[GeminiLive] Conexão WebSocket estabelecida com modelo ${this.model}. Enviando handshake de setup...`);
          this._sendSetupHandshake();
          this.emit('connected');
          this._setState('IDLE');
          resolve();
        };

        this.ws.onmessage = async (event) => {
          await this._handleMessage(event.data);
        };

        this.ws.onerror = (err) => {
          console.error('[GeminiLive] Erro no WebSocket:', err);
          this.emit('error', err);
        };

        this.ws.onclose = async (event) => {
          console.log(`[GeminiLive] Conexão encerrada (código ${event.code}): ${event.reason}`);
          const wasConfigured = this.isSessionConfigured;
          this.isConnected = false;
          this.isSessionConfigured = false;
          this._setState('IDLE');

          // Se a conexão caiu antes de configurar o setup com erro de modelo não suportado (1008), tenta fallback
          if (!wasConfigured && (event.code === 1008 || (event.reason && (event.reason.includes('not supported') || event.reason.includes('not found'))))) {
            const nextCandidate = CANDIDATE_MODELS.find(m => m !== this.model);
            if (nextCandidate && !this._triedFallback) {
              this._triedFallback = true;
              console.log(`[GeminiLive] Modelo ${this.model} indisponível. Tentando modelo alternativo: ${nextCandidate}`);
              try {
                await this._connectWithModel(nextCandidate);
                return;
              } catch (fallbackErr) {
                console.error('[GeminiLive] Falha ao tentar modelo alternativo:', fallbackErr);
              }
            }
          }

          this.emit('disconnected', { code: event.code, reason: event.reason });
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Envia a mensagem de inicialização (setup) configurando voz, modelo e diretivas.
   */
  _sendSetupHandshake() {
    const setupMessage = {
      setup: {
        model: this.model,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voiceName
              }
            }
          }
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: this.systemInstruction }]
        }
      }
    };

    if (this.tools && this.tools.length > 0) {
      setupMessage.setup.tools = this.tools;
    }

    this._sendJson(setupMessage);
  }

  /**
   * Envia chunk de áudio capturado do microfone do usuário (PCM 16-bit LE, 16kHz).
   * @param {string|Buffer} pcmData - Buffer binário ou Base64 do áudio PCM
   */
  sendAudioChunk(pcmData) {
    if (!this.isConnected || !this.ws || !this.isSessionConfigured) return;

    const base64Data = Buffer.isBuffer(pcmData) ? pcmData.toString('base64') : pcmData;

    const message = {
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: base64Data
        }
      }
    };

    this._sendJson(message);
    if (!this.isExecutingTool && this.currentState !== 'LISTENING' && this.currentState !== 'SPEAKING') {
      this._setState('LISTENING');
    }
  }

  /**
   * Envia frame de imagem ou vídeo comprimido (JPEG base64) para a Gemini Multimodal Live API.
   * @param {string} base64Jpeg - Imagem JPEG em base64
   */
  sendImageChunk(base64Jpeg) {
    if (!this.isConnected || !this.ws || !this.isSessionConfigured || !base64Jpeg) return;

    const message = {
      realtimeInput: {
        video: {
          mimeType: "image/jpeg",
          data: base64Jpeg
        }
      }
    };

    this._sendJson(message);
  }

  /**
   * Envia uma mensagem de texto intercalada na sessão.
   */
  sendTextMessage(text) {
    if (!this.isConnected || !this.ws || !text) return;

    const message = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: String(text) }]
          }
        ],
        turnComplete: true
      }
    };

    this._sendJson(message);
    this._setState('THINKING');
  }

  /**
   * Envia resposta de uma função ou chamada de ferramenta executada (AGY / Bash).
   */
  sendToolResponse(functionResponses) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      toolResponse: {
        functionResponses: functionResponses
      }
    };

    this._sendJson(message);
    this._setState('THINKING');
  }

  /**
   * Processa mensagens recebidas do servidor da Gemini Live API.
   */
  async _handleMessage(rawData) {
    try {
      let textContent = '';
      if (typeof rawData === 'string') {
        textContent = rawData;
      } else if (rawData && typeof rawData.text === 'function') {
        textContent = await rawData.text();
      } else if (Buffer.isBuffer(rawData)) {
        textContent = rawData.toString('utf-8');
      } else if (rawData instanceof ArrayBuffer) {
        textContent = Buffer.from(rawData).toString('utf-8');
      } else {
        textContent = String(rawData);
      }

      const data = JSON.parse(textContent);

      // 1. Confirmação do Setup inicial
      if (data.setupComplete) {
        this.isSessionConfigured = true;
        console.log(`[GeminiLive] Setup confirmado pelo servidor com modelo ${this.model}.`);
        this.emit('setup-complete', { model: this.model });
        return;
      }

      const serverContent = data.serverContent;
      if (serverContent) {
        // 2. Detecção de Barge-In (interrupção do usuário enquanto a IA falava)
        if (serverContent.interrupted) {
          console.log('[GeminiLive] Barge-In disparado pelo servidor: silenciando reprodução.');
          this.emit('barge-in');
          this._setState('LISTENING');
          this.currentModelText = '';
          return;
        }

        // Transcrição da fala do usuário (entrada)
        if (serverContent.inputTranscription && serverContent.inputTranscription.text) {
          const userChunk = serverContent.inputTranscription.text;
          this.currentUserText = (this.currentUserText ? (this.currentUserText + ' ' + userChunk) : userChunk).trim();
          this.lastInterimUserText = this.currentUserText;
          this.emit('user-transcript', {
            delta: userChunk,
            text: this.currentUserText
          });
        }
        if (serverContent.interimInputTranscription && serverContent.interimInputTranscription.text) {
          const interim = serverContent.interimInputTranscription.text;
          this.lastInterimUserText = interim;
          this.emit('user-transcript-interim', {
            text: interim
          });
        }

        // Transcrição da fala do modelo (saída) em tempo real
        if (serverContent.outputTranscription && serverContent.outputTranscription.text) {
          const deltaText = serverContent.outputTranscription.text;
          this.currentModelText += deltaText;
          this.emit('transcript-delta', { delta: deltaText, text: this.currentModelText });
          this.emit('transcript', this.currentModelText);
        }

        // 3. Recebimento de partes de áudio geradas
        const modelTurn = serverContent.modelTurn;
        if (modelTurn && modelTurn.parts) {
          for (const part of modelTurn.parts) {
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.includes('audio/pcm')) {
              if (!this.isExecutingTool) {
                this._setState('SPEAKING');
              }
              this.emit('audio-chunk', {
                pcmBase64: part.inlineData.data,
                mimeType: part.inlineData.mimeType
              });
            }
            if (part.text) {
              this.currentModelText += part.text;
              this.emit('transcript-delta', { delta: part.text, text: this.currentModelText });
              this.emit('transcript', this.currentModelText);
            }
          }
        }

        // 4. Fim do turno de resposta da IA
        if (serverContent.turnComplete) {
          if (!this.isExecutingTool) {
            this._setState('IDLE');
          }
          const turnData = {
            userText: this.currentUserText || this.lastInterimUserText,
            modelText: this.currentModelText
          };
          this.emit('turn-complete', turnData);

          // Limpa acumuladores para o próximo turno
          this.currentUserText = '';
          this.currentModelText = '';
          this.lastInterimUserText = '';
        }
      }

      // 5. Chamada de Ferramenta (Function Call)
      if (data.toolCall && data.toolCall.functionCalls) {
        console.log('[GeminiLive] Chamada de ferramenta recebida:', data.toolCall.functionCalls);
        this.emit('tool-call', data.toolCall.functionCalls);
        await this._processToolCalls(data.toolCall.functionCalls);
      }
    } catch (err) {
      console.warn('[GeminiLive] Erro ao decodificar mensagem recebida:', err);
    }
  }

  async _processToolCalls(functionCalls) {
    this.isExecutingTool = true;
    this._setState('WORKING');

    const responses = [];
    for (const call of functionCalls) {
      this.emit('tool-start', call);
      const res = await executeToolCall(call, { session: this });
      responses.push(res);
      this.emit('tool-end', { call, result: res });
    }

    this.isExecutingTool = false;
    this.sendToolResponse(responses);
  }

  _sendJson(payload) {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  _setState(newState) {
    if (this.currentState === newState) return;
    this.currentState = newState;
    this.emit('state-changed', { state: newState });
  }

  disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.isConnected = false;
    this.isSessionConfigured = false;
    this.isExecutingTool = false;
    this._setState('IDLE');
  }
}

module.exports = { GeminiLiveSession };
