/**
 * services/geminiLive/index.js
 * 
 * Controlador central do modo de voz Gemini Multimodal Live.
 * Orquestra microfone nativo (PCM 16kHz via nativeAudio), transmissão bidirecional em tempo real,
 * reprodução nativa de áudio PCM (24kHz) no fone/alto-falante, emissão de chunks
 * para o Raphael Core e acoplamento com Gemini CLI (Antigravity CLI / AGY) e busca web.
 * 
 * NOTA DE ARQUITETURA:
 * O modo Live NÃO UTILIZA TTS. O áudio é gerado nativamente pelo modelo multimodal em streaming.
 */

const EventEmitter = require('events');
const { GeminiLiveSession } = require('./geminiLiveSession');
const configService = require('../configService');
const nativeAudio = require('../platform/nativeAudio');

class GeminiLiveController extends EventEmitter {
  constructor() {
    super();
    this.session = null;
    this.isListening = false;
    this.standbyTimeout = null;
    this._onMicChunk = this._handleMicChunk.bind(this);
  }

  _handleMicChunk(buf) {
    if (this.session && this.session.isConnected && this.isListening) {
      this.session.sendAudioChunk(buf);
    }
  }

  isActive() {
    return !!(this.session && this.session.isConnected && this.isListening);
  }

  _buildDynamicSystemInstruction(assistantName) {
    let userContext = '';
    try {
      const { helpers } = require('../../main/globals');
      if (helpers && typeof helpers.getUserPreferencesContext === 'function') {
        userContext = helpers.getUserPreferencesContext();
      }
    } catch (_) {}

    let projectContext = '';
    try {
      const workspace = require('../workspace');
      const p = workspace.getProjectPath ? workspace.getProjectPath() : '';
      if (p) {
        projectContext = `\nPROJETO / WORKSPACE ATIVO:\n- Caminho raiz: ${p}\n- Diretório: ${require('path').basename(p)}`;
      }
    } catch (_) {}

    let recentChatBlock = '';
    try {
      const historyService = require('../historyService');
      const session = historyService.getCurrentSession ? historyService.getCurrentSession() : null;
      let pastMsgs = [];
      if (session && Array.isArray(session.conversations) && session.conversations.length > 0) {
        pastMsgs = session.conversations.slice(-8);
      } else if (historyService.getLastThreeSessions) {
        const recent = historyService.getLastThreeSessions();
        if (recent && recent.length > 0 && Array.isArray(recent[0].conversations)) {
          pastMsgs = recent[0].conversations.slice(-8);
        }
      }
      if (pastMsgs.length > 0) {
        recentChatBlock = '\n\n═══ HISTÓRICO RECENTE DE CONVERSA DO HELPER NODE (MEMÓRIA ATIVA) ═══\n' +
          pastMsgs.map(m => `[${m.role === 'user' ? 'Juliano' : 'Raphael'}]: ${(m.text || m.content || '').slice(0, 400)}`).join('\n') +
          '\n═══ FIM DO HISTÓRICO RECENTE ═══';
      }
    } catch (_) {}

    let attachmentsBlock = '';
    try {
      const workspace = require('../workspace');
      const list = workspace.list().filter(a => a.type === 'file');
      if (list.length > 0) {
        attachmentsBlock = '\n\n═══ ARQUIVOS E CAPTURAS ANEXADAS NO WORKSPACE ═══\n' +
          list.map(a => `- ${a.path}`).join('\n') + '\n═══ FIM DOS ANEXOS ═══';
      }
    } catch (_) {}

    return `Você é a ${assistantName}, copiloto e assistente de desenvolvimento sênior em inteligência artificial do Helper Node.
Você trabalha em estreita parceria com o desenvolvedor Juliano Soder. Seu núcleo visual integrado é o Raphael Core (plasma cósmico tridimensional).
Sua personalidade é inteligente, descontraída, nerd, empática e ágil.
${userContext ? '\n' + userContext : ''}
${projectContext}
${recentChatBlock}
${attachmentsBlock}

DIRETIVAS OBRIGATÓRIAS DE EXECUÇÃO E VOZ:
1. Responda em áudio em português do Brasil de maneira natural, conversacional, ágil e concisa (1 a 2 frases curtas).
2. AÇÃO DIRETA IMEDIATA VIA FERRAMENTAS:
   Quando Juliano solicitar refatoração, criação ou alteração de código, git, arquivos, testes, comandos no terminal, investigações, busca de tela ou relatórios:
   - INVOQUE IMEDIATAMENTE a ferramenta correspondente ('execute_code_task', 'run_terminal_command', 'read_workspace_file', 'get_screen_context', 'get_recent_chat_history') na mesma resposta.
   - NUNCA termine o turno apenas dizendo que vai abrir o projeto ou fazer algo sem invocar a ferramenta correspondente.
3. Ao receber o retorno da ferramenta, faça um resumo conversacional objetivo de 1 a 2 frases confirmando os resultados práticos obtidos.
4. Para saudações ou conversas casuais rápidas (ex: "Bom dia", "tá por aí?"), responda diretamente em voz com simpatia e agilidade.
5. Você tem acesso à tela e ao histórico recente do Helper Node através das ferramentas disponíveis.`;
  }

  isMicListening() {
    return !!(this.session && this.session.isConnected && this.isListening);
  }

  async sendTextMessage(text) {
    if (!text || !text.trim()) return;

    if (!this.session || !this.session.isConnected) {
      await this.start({ withoutMic: true });
    }

    if (this.session && this.session.isConnected) {
      try {
        const { createNexaWindow, isNexaWindowOpen } = require('../../main/nexa/nexaWindow.js');
        if (!isNexaWindowOpen()) {
          createNexaWindow();
        }
      } catch (_) {}

      this.session.sendTextMessage(text.trim());
      this._updateNexaState('THINKING');
    }
  }

  async start(options = {}) {
    const micDevice = options.micDevice || (configService.getMicDevice ? configService.getMicDevice() : '');
    const withoutMic = !!(options.withoutMic || options.skipMic);

    // Se já temos uma sessão WebSocket ativa em standby (mic mutado), apenas retoma a escuta do microfone se solicitado
    if (this.session && this.session.isConnected) {
      if (this.standbyTimeout) {
        clearTimeout(this.standbyTimeout);
        this.standbyTimeout = null;
      }
      if (!withoutMic && !this.isListening) {
        await nativeAudio.subscribe('mic', this._onMicChunk, { deviceId: micDevice });
        this.isListening = true;
        this.emit('status-changed', { active: true, state: 'listening' });
        this._broadcastStatus({ active: true, state: 'listening' });
      }
      return this.session;
    }

    const apiKey = options.apiKey || configService.getGoogleApiKey();
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Google API Key não informada. Configure nas Configurações do Helper Node para ativar o modo de voz.');
    }

    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : {};
    const assistantName = (nexaCfg && nexaCfg.name) ? nexaCfg.name.trim() : 'Raphael';
    const model = options.model || (configService.getGeminiLiveModel ? configService.getGeminiLiveModel() : null) || 'models/gemini-3.1-flash-live-preview';
    const voiceName = options.voiceName || (configService.getGeminiLiveVoice ? configService.getGeminiLiveVoice() : null) || 'Kore';

    const systemInstruction = options.systemInstruction || this._buildDynamicSystemInstruction(assistantName);

    // Cria e conecta a sessão Gemini Live com o modelo, voz e contexto dinâmico
    this.session = new GeminiLiveSession({
      apiKey,
      model,
      voiceName,
      systemInstruction,
      ...options
    });

    this._bindSessionEvents(this.session);
    await this.session.connect();

    if (!withoutMic) {
      // Assina o stream do microfone nativo (PCM 16kHz s16le mono)
      await nativeAudio.subscribe('mic', this._onMicChunk, { deviceId: micDevice });
      this.isListening = true;
      this.emit('status-changed', { active: true, state: 'listening' });
      this._broadcastStatus({ active: true, state: 'listening' });
      console.log(`[GeminiLiveController] Sessão Live ativa com microfone em tempo real (Modelo: ${model}, Voz: ${voiceName}, Sem TTS - Áudio Direto).`);
    } else {
      this.isListening = false;
      this.emit('status-changed', { active: true, state: 'standby' });
      this._broadcastStatus({ active: true, state: 'standby' });
      console.log(`[GeminiLiveController] Sessão Live conectada em modo Texto/Standby (Modelo: ${model}, Voz: ${voiceName}, Sem TTS - Áudio Direto).`);
    }

    return this.session;
  }

  stop(hardClose = false) {
    if (this.isListening) {
      nativeAudio.unsubscribe('mic', this._onMicChunk);
      this.isListening = false;
    }

    if (hardClose) {
      if (this.standbyTimeout) {
        clearTimeout(this.standbyTimeout);
        this.standbyTimeout = null;
      }
      if (this.session) {
        this.session.disconnect();
        this.session = null;
      }
      console.log('[GeminiLiveController] Sessão Live desconectada completamente.');
    } else {
      // Standby inteligente: mantém o WebSocket e a memória vivos por 10 minutos para não perder o contexto
      if (this.standbyTimeout) clearTimeout(this.standbyTimeout);
      this.standbyTimeout = setTimeout(() => {
        if (!this.isListening && this.session) {
          console.log('[GeminiLiveController] Standby timeout atingido: encerrando WebSocket inativo.');
          this.stop(true);
        }
      }, 10 * 60 * 1000);
      console.log('[GeminiLiveController] Microfone pausado em Standby (memória e contexto preservados).');
    }

    this._updateNexaState('IDLE');
    this.emit('status-changed', { active: false, state: 'idle' });
    this._broadcastStatus({ active: false, state: 'idle' });
  }

  async toggle(forcedState, options = {}) {
    const shouldBeActive = typeof forcedState === 'boolean' ? forcedState : !this.isActive();
    if (shouldBeActive) {
      await this.start(options);
    } else {
      this.stop(false);
    }
    return { active: this.isActive() };
  }

  _bindSessionEvents(session) {
    // Áudio streaming direto do Gemini Live -> fone / Raphael Core
    session.on('audio-chunk', (payload) => {
      this._broadcastToWindows('gemini-live:audio-chunk', payload);
      this._updateNexaState('SPEAKING');
    });

    // Interrupção em tempo real (Barge-In)
    session.on('barge-in', () => {
      this._broadcastToWindows('gemini-live:barge-in');
      this._updateNexaState('LISTENING');
    });

    session.on('transcript', (text) => {
      this._broadcastToWindows('gemini-live:transcript', { text });
    });

    session.on('transcript-delta', (payload) => {
      this._broadcastToWindows('gemini-live:transcript-delta', payload);
    });

    session.on('user-transcript', (data) => {
      this._broadcastToWindows('gemini-live:user-transcript', data);
      this._broadcastToWindows('nexa-voice:speech-preview', { text: data.text });
    });

    session.on('state-changed', ({ state }) => {
      this._updateNexaState(state);
      this._broadcastToWindows('nexa-voice:state-changed', { state: state.toLowerCase() });
    });

    session.on('tool-start', (call) => {
      this._updateNexaState('WORKING');
      this._broadcastToWindows('gemini-live:tool-start', call);
    });

    session.on('tool-end', (data) => {
      this._broadcastToWindows('gemini-live:tool-end', data);
    });

    session.on('turn-complete', (turnData) => {
      if (!session.isExecutingTool) {
        this._updateNexaState('IDLE');
      }
      this._broadcastToWindows('gemini-live:turn-complete', turnData);

      const userQuestion = (turnData && turnData.userText && turnData.userText.trim())
        ? turnData.userText.trim()
        : '';
      const aiReply = (turnData && turnData.modelText) ? turnData.modelText.trim() : '';

      if (aiReply) {
        this._broadcastToWindows('nexa-voice:quick-reply', {
          question: userQuestion || '🎤 Pergunta por voz',
          reply: aiReply
        });
      }
    });

    session.on('disconnected', () => {
      this.stop();
    });
  }

  _updateNexaState(targetState) {
    try {
      const { nexaState } = require('../../main/nexa/nexaState.js');
      if (nexaState && typeof nexaState.setState === 'function') {
        nexaState.setState(targetState);
      }
    } catch (_) {}
  }

  _broadcastStatus(statusPayload) {
    this._broadcastToWindows('nexa-voice:status-changed', statusPayload);
  }

  _broadcastToWindows(channel, data) {
    try {
      const { state } = require('../../main/globals');
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send(channel, data);
      }
      if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
        state.nexaWindow.webContents.send(channel, data);
      }
    } catch (_) {}
  }
}

const controller = new GeminiLiveController();

module.exports = {
  GeminiLiveSession,
  GeminiLiveController,
  controller,
  getLiveSession: () => controller.session,
  isLiveSessionActive: () => controller.isActive(),
  isLiveSessionListening: () => controller.isMicListening(),
  startLiveSession: (options) => controller.start(options),
  stopLiveSession: () => controller.stop(),
  toggleLiveSession: (forced, options) => controller.toggle(forced, options),
  sendTextMessage: (text) => controller.sendTextMessage(text)
};
