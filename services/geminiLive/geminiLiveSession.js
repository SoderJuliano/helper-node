/**
 * services/geminiLive/geminiLiveSession.js
 * Conexão WebSocket duplex em tempo real com a Gemini Multimodal Live API.
 * Suporta streaming contínuo de áudio PCM bidirecional (Full-Duplex),
 * detecção nativa de interrupção (Barge-In) e orquestração de ferramentas (AGY / Terminal).
 */

const EventEmitter = require('events');
const { DEFAULT_LIVE_TOOLS, executeToolCall } = require('./geminiLiveTools');

const GEMINI_LIVE_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent';
const DEFAULT_MODEL = 'models/gemini-2.0-flash-exp';
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
  }

  /**
   * Conecta ao WebSocket da Live API e envia mensagem inicial de configuração.
   */
  async connect() {
    if (this.isConnected && this.ws) return;
    if (!this.apiKey || !this.apiKey.trim()) {
      throw new Error('Google API Key não configurada para a Live Session.');
    }

    const endpoint = `${GEMINI_LIVE_WS_URL}?key=${encodeURIComponent(this.apiKey.trim())}`;
    
    return new Promise((resolve, reject) => {
      try {
        const WSClass = typeof WebSocket !== 'undefined' ? WebSocket : global.WebSocket;
        this.ws = new WSClass(endpoint);

        this.ws.onopen = () => {
          this.isConnected = true;
          console.log('[GeminiLive] Conexão WebSocket estabelecida. Enviando handshake de setup...');
          this._sendSetupHandshake();
          this.emit('connected');
          this._setState('IDLE');
          resolve();
        };

        this.ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };

        this.ws.onerror = (err) => {
          console.error('[GeminiLive] Erro no WebSocket:', err);
          this.emit('error', err);
        };

        this.ws.onclose = (event) => {
          console.log(`[GeminiLive] Conexão encerrada (código ${event.code}): ${event.reason}`);
          this.isConnected = false;
          this.isSessionConfigured = false;
          this._setState('IDLE');
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
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64Data
          }
        ]
      }
    };

    this._sendJson(message);
    if (!this.isExecutingTool && this.currentState !== 'LISTENING' && this.currentState !== 'SPEAKING') {
      this._setState('LISTENING');
    }
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
      const data = typeof rawData === 'string' ? JSON.parse(rawData) : JSON.parse(rawData.toString());

      // 1. Confirmação do Setup inicial
      if (data.setupComplete) {
        this.isSessionConfigured = true;
        console.log('[GeminiLive] Setup confirmado pelo servidor.');
        return;
      }

      const serverContent = data.serverContent;
      if (serverContent) {
        // 2. Detecção de Barge-In (interrupção do usuário enquanto a IA falava)
        if (serverContent.interrupted) {
          console.log('[GeminiLive] Barge-In disparado pelo servidor: silenciando reprodução.');
          this.emit('barge-in');
          this._setState('LISTENING');
          return;
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
              this.emit('transcript', part.text);
            }
          }
        }

        // 4. Fim do turno de resposta da IA
        if (serverContent.turnComplete) {
          if (!this.isExecutingTool) {
            this._setState('IDLE');
          }
          this.emit('turn-complete');
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
