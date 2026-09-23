/**
 * services/geminiLive/index.js
 * 
 * Controlador central do modo de voz Gemini Multimodal Live.
 * Orquestra microfone nativo (PCM 16kHz via nativeAudio), transmissão bidirecional,
 * emissão de chunks de áudio para o Raphael Core e acoplamento com Antigravity CLI.
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
    this._onMicChunk = this._handleMicChunk.bind(this);
  }

  _handleMicChunk(buf) {
    if (this.session && this.session.isConnected) {
      this.session.sendAudioChunk(buf);
    }
  }

  isActive() {
    return !!(this.session && this.session.isConnected && this.isListening);
  }

  async start(options = {}) {
    if (this.isActive()) return this.session;

    const apiKey = options.apiKey || configService.getGoogleApiKey();
    if (!apiKey || !apiKey.trim()) {
      throw new Error('Google API Key não informada. Configure nas Configurações do Helper Node para ativar o modo de voz.');
    }

    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : {};
    const assistantName = (nexaCfg && nexaCfg.name) ? nexaCfg.name.trim() : 'Raphael';

    // Cria e conecta a sessão Gemini Live com o modelo e voz configurados
    this.session = new GeminiLiveSession({
      apiKey,
      ...options
    });

    this._bindSessionEvents(this.session);
    await this.session.connect();

    // Assina o stream do microfone nativo (PCM 16kHz s16le mono)
    const micDevice = options.micDevice || (configService.getMicDevice ? configService.getMicDevice() : '');
    await nativeAudio.subscribe('mic', this._onMicChunk, { deviceId: micDevice });
    this.isListening = true;

    this.emit('status-changed', { active: true, state: 'listening' });
    this._broadcastStatus({ active: true, state: 'listening' });

    console.log('[GeminiLiveController] Sessão Live ativa com microfone em tempo real.');
    return this.session;
  }

  stop() {
    if (this.isListening) {
      nativeAudio.unsubscribe('mic', this._onMicChunk);
      this.isListening = false;
    }

    if (this.session) {
      this.session.disconnect();
      this.session = null;
    }

    this._updateNexaState('IDLE');
    this.emit('status-changed', { active: false, state: 'idle' });
    this._broadcastStatus({ active: false, state: 'idle' });
    console.log('[GeminiLiveController] Sessão Live encerrada.');
  }

  async toggle(forcedState, options = {}) {
    const shouldBeActive = typeof forcedState === 'boolean' ? forcedState : !this.isActive();
    if (shouldBeActive) {
      await this.start(options);
    } else {
      this.stop();
    }
    return { active: this.isActive() };
  }

  _bindSessionEvents(session) {
    session.on('audio-chunk', (payload) => {
      this._broadcastToWindows('gemini-live:audio-chunk', payload);
      this._updateNexaState('SPEAKING');
    });

    session.on('barge-in', () => {
      this._broadcastToWindows('gemini-live:barge-in');
      this._updateNexaState('LISTENING');
    });

    session.on('transcript', (text) => {
      this._broadcastToWindows('gemini-live:transcript', { text });
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

    session.on('turn-complete', () => {
      if (!session.isExecutingTool) {
        this._updateNexaState('IDLE');
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
  startLiveSession: (options) => controller.start(options),
  stopLiveSession: () => controller.stop(),
  toggleLiveSession: (forced, options) => controller.toggle(forced, options)
};
