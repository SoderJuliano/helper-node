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
    this._isAudioPlaying = false;
    this._isMicSuppressed = false;
    this._micMuteTimeout = null;
    this._onMicChunk = this._handleMicChunk.bind(this);
  }

  _handleMicChunk(buf) {
    if (this.session && this.session.isConnected && this.isListening) {
      if (this._isMicSuppressed || (this.session && this.session.currentState === 'SPEAKING')) {
        return; // Mudo durante a fala da Nexa para evitar auto-interrupção e cortes por som externo
      }
      this.session.sendAudioChunk(buf);
    }
  }

  setPlaybackState(payload) {
    const isPlaying = (typeof payload === 'boolean') ? payload : !!(payload && payload.playing);
    this._isAudioPlaying = isPlaying;
    if (isPlaying) {
      if (this._micMuteTimeout) {
        clearTimeout(this._micMuteTimeout);
        this._micMuteTimeout = null;
      }
      this._isMicSuppressed = true;
    } else {
      if (this._micMuteTimeout) clearTimeout(this._micMuteTimeout);
      this._micMuteTimeout = setTimeout(() => {
        this._isMicSuppressed = false;
        this._micMuteTimeout = null;
      }, 400);
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
          pastMsgs.map(m => `[${m.role === 'user' ? 'Usuário' : assistantName}]: ${(m.text || m.content || '').slice(0, 400)}`).join('\n') +
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

    return `Você é a ${assistantName}, copiloto e assistente de desenvolvimento sênior do Helper Node.
Seu núcleo visual integrado é o Raphael Core (plasma cósmico tridimensional).
Sua personalidade é inteligente, descontraída, nerd, ágil e focada em resolver os problemas do desenvolvedor.
${userContext ? '\n' + userContext : ''}
${projectContext}
${recentChatBlock}
${attachmentsBlock}

COMO VOCÊ OPERA:
1. Responda em áudio em português do Brasil de maneira natural, conversacional, ágil e concisa (1 a 2 frases curtas).
2. EXECUÇÃO DE TAREFAS:
   - Você possui ferramentas reais conectadas ao workspace. Quando o usuário pedir para criar, alterar, refatorar código, rodar testes ou executar comandos no terminal, acione diretamente a ferramenta correspondente ('execute_code_task' ou 'run_terminal_command').
   - NUNCA dê respostas vazias prometendo que vai fazer ("vou fazer", "já vou alterar") sem acionar a ferramenta, pois falar não altera arquivos. Acione a ferramenta para que a alteração seja feita de verdade.
   - Assim que a ferramenta concluir, você receberá o resultado e fará um resumo curto em voz confirmando o que foi feito.
3. CONVERSAÇÃO E DÚVIDAS:
   - Para conversas normais, saudações, dúvidas teóricas, explicações ou quando o usuário estiver apenas conversando com você, responda diretamente por voz com simpatia e clareza, sem acionar ferramentas desnecessárias.`;
  }

  isMicListening() {
    return !!(this.session && this.session.isConnected && this.isListening);
  }

  async speakText(text) {
    if (!text || !text.trim()) return;
    const clean = String(text)
      .replace(/<voice_summary>([\s\S]*?)<\/voice_summary>/gi, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[`*_~#]/g, '')
      .trim();
    if (!clean) return;

    // Emite o resumo visual de texto para a janela da Nexa e para o chat imediatamente
    this._broadcastToWindows('nexa-voice:quick-reply', {
      question: '',
      reply: clean.slice(0, 300),
      isLiveTurn: false
    });

    try {
      const { createNexaWindow, isNexaWindowOpen } = require('../../main/nexa/nexaWindow.js');
      if (!isNexaWindowOpen()) {
        createNexaWindow();
      }
    } catch (_) {}

    if (!this.session || !this.session.isConnected) {
      await this.start({ withoutMic: true });
    }

    if (this.session && this.session.isConnected) {
      const promptToRead = `[INSTRUÇÃO DE FALA]: Fale em voz alta e de forma natural exatamente esta mensagem curta:\n"${clean.slice(0, 300)}"`;
      this.session.sendTextMessage(promptToRead);
      this._updateNexaState('SPEAKING');
    }
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
    const assistantName = options.assistantName || (nexaCfg && nexaCfg.name) || 'Nexa';
    let model = options.model || (configService.getGeminiLiveModel ? configService.getGeminiLiveModel() : null) || 'models/gemini-3.8-live';
    if (!model || model.includes('2.0') || model === 'models/gemini-3.8-flash' || model === 'models/gemini-3.7-flash') {
      model = 'models/gemini-3.8-live';
    }
    const voiceName = options.voiceName || (configService.getGeminiLiveVoice ? configService.getGeminiLiveVoice() : null) || 'Aoede';

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
      this._isMicSuppressed = true;
      this._broadcastToWindows('gemini-live:audio-chunk', payload);
      this._updateNexaState('SPEAKING');
    });

    // Interrupção em tempo real (Barge-In)
    session.on('barge-in', () => {
      this._isMicSuppressed = false;
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

      // Reabertura de segurança do microfone se o renderer demorar a reportar fim do playback
      setTimeout(() => {
        if (!this._isAudioPlaying) {
          this._isMicSuppressed = false;
        }
      }, 3500);

      const userQuestion = (turnData && turnData.userText && turnData.userText.trim())
        ? turnData.userText.trim()
        : '';
      const aiReply = (turnData && turnData.modelText) ? turnData.modelText.trim() : '';

      if (aiReply) {
        this._broadcastToWindows('nexa-voice:quick-reply', {
          question: userQuestion || '',
          reply: aiReply,
          isLiveTurn: true
        });
      }
    });

    session.on('error', (err) => {
      this._broadcastToWindows('nexa-voice:error', {
        message: err && err.message ? err.message : 'Erro na conexão Gemini Live'
      });
    });

    session.on('disconnected', (info) => {
      this.stop(true);
      const reasonLower = (info && info.reason) ? info.reason.toLowerCase() : '';
      const isTrueQuota = reasonLower.includes('quota') || reasonLower.includes('resource_exhausted');
      if (isTrueQuota) {
        this._broadcastToWindows('nexa-voice:error', {
          code: info.code,
          message: 'Limite de cota excedido na Gemini Live API. Verifique seu plano no Google AI Studio.'
        });
      } else if (info && (info.code > 1000 || info.reason)) {
        this._broadcastToWindows('nexa-voice:error', {
          code: info.code,
          message: info.reason || `Conexão Gemini Live encerrada (${info.code})`
        });
      }
    });

    session.on('resumed', () => {
      console.log('[GeminiLiveController] Sessão Live reconectada e retomada com sucesso.');
      if (this.isListening) {
        this.emit('status-changed', { active: true, state: 'listening' });
        this._broadcastStatus({ active: true, state: 'listening' });
      }
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

try {
  const { ipcMain } = require('electron');
  if (ipcMain) {
    ipcMain.on('gemini-live:playback-state', (_e, state) => {
      controller.setPlaybackState(state);
    });
  }
} catch (_) {}

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
  sendTextMessage: (text) => controller.sendTextMessage(text),
  speakText: (text) => controller.speakText(text)
};
