/**
 * services/nexaVoiceAssistant/nexaTurnDetector.js
 * 
 * Detector de turnos de fala e VAD (Voice Activity Detection) contínuo e não-bloqueante.
 * Escuta os buffers PCM s16le / 16kHz / mono do microfone via `services/platform/nativeAudio`.
 * 
 * Principais garantias:
 * - Pre-roll buffer circular (300ms) para não cortar a primeira sílaba ("Ne-xa").
 * - Detecção de fim de fala por silêncio após fala ativa (ex: 900ms a 1100ms).
 * - Descarte de ruídos curtos abaixo do limiar de fala (< 400ms de fala ou RMS baixo).
 * - Totalmente assíncrono e não-bloqueante, permitindo mover e usar a janela normalmente.
 */

const nativeAudio = require("../platform/nativeAudio");
const EventEmitter = require("events");

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // 16-bit
const BYTES_PER_MS = (SAMPLE_RATE * BYTES_PER_SAMPLE) / 1000; // 32 bytes/ms

class NexaTurnDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.speechThresholdRms = options.speechThresholdRms || 55;  // Limiar calibrado para captação de voz natural no Windows/Mac
    this.silenceThresholdMs = options.silenceThresholdMs || 1100; // Duração de silêncio para fechar o turno (1100ms: ritmo conversacional natural)
    this.minSpeechMs = options.minSpeechMs || 300;               // Duração mínima de fala real para considerar válida (300ms)
    this.maxTurnDurationMs = options.maxTurnDurationMs || 120000; // Limite amplo de segurança para turnos longos de fala (120s / 2 min)
    this.preRollMs = options.preRollMs || 350;                   // Buffer circular de pre-roll (350ms)
    this.bargeInThresholdRms = options.bargeInThresholdRms || 115; // Limiar elevado para interrupção de fala durante reprodução TTS

    this.active = false;
    this.ttsActive = false;
    this.isSpeaking = false;
    this.speechChunks = [];
    this.speechBytes = 0;
    this.silenceAccumMs = 0;
    this.speechDurationMs = 0;
    this.activeSpeechChunksCount = 0;
    this.totalChunksInTurn = 0;

    // Rastreamento de decaimento de voz (Voice Energy Decay)
    this.peakTurnRms = 0;
    this.rmsHistory = [];
    this.isDecaying = false;
    this.decaySilenceBoost = 1.0;

    // Estimativa adaptativa do piso de ruído (noise floor)
    this.noiseFloorRms = 20;

    // Buffer circular de pre-roll (guarda os últimos 350ms de áudio antes de a fala começar)
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.maxPreRollBytes = Math.round(this.preRollMs * BYTES_PER_MS);

    this._onPcmChunk = this._handlePcmChunk.bind(this);
    this._onDeviceLost = () => {
      if (this.active) {
        this.resetTurn();
      }
    };
    if (nativeAudio && nativeAudio.on) {
      nativeAudio.on("device-lost", this._onDeviceLost);
    }
  }

  /**
   * Notifica o detector se a Nexa está falando via TTS.
   * Evita captura do áudio do próprio alto-falante (loop de áudio).
   * @param {boolean} active
   */
  setTtsActive(active) {
    this.ttsActive = !!active;
    if (active) {
      this.resetTurn();
    }
  }

  /**
   * Inicia o monitoramento contínuo do microfone.
   * @param {string} [deviceId='']
   */
  async start(deviceId = "") {
    if (this.active) return;
    this.active = true;
    this.resetTurn();
    await nativeAudio.subscribe("mic", this._onPcmChunk, { deviceId });
    this.emit("started");
  }

  /**
   * Para o monitoramento do microfone.
   */
  stop() {
    if (!this.active) return;
    this.active = false;
    try {
      nativeAudio.unsubscribe("mic", this._onPcmChunk);
    } catch (_) {}
    this.resetTurn();
    this.emit("stopped");
  }

  /**
   * Reinicia o estado do turno atual.
   */
  resetTurn() {
    this.isSpeaking = false;
    this.speechChunks = [];
    this.speechBytes = 0;
    this.silenceAccumMs = 0;
    this.speechDurationMs = 0;
    this.activeSpeechChunksCount = 0;
    this.totalChunksInTurn = 0;
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.peakTurnRms = 0;
    this.rmsHistory = [];
    this.isDecaying = false;
  }

  /**
   * Calcula a energia RMS do buffer PCM s16le.
   */
  static computeRms(buf) {
    if (!buf || buf.length < 2) return 0;
    let sum = 0;
    const samples = Math.floor(buf.length / 2);
    for (let i = 0; i < samples; i++) {
      const s = buf.readInt16LE(i * 2);
      sum += s * s;
    }
    return samples > 0 ? Math.sqrt(sum / samples) : 0;
  }

  /**
   * Processa cada chunk de PCM recebido do stream nativo.
   */
  _handlePcmChunk(buf) {
    if (!this.active || !buf || buf.length === 0) return;

    const chunkMs = Math.round(buf.length / BYTES_PER_MS);
    const rms = NexaTurnDetector.computeRms(buf);

    this.emit("level", { rms, isSpeaking: this.isSpeaking, noiseFloor: Math.round(this.noiseFloorRms), ttsActive: this.ttsActive });

    // Se a Nexa estiver falando via alto-falantes (TTS ativo):
    if (this.ttsActive) {
      const bargeInThreshold = Math.max(this.bargeInThresholdRms, this.speechThresholdRms * 2.0, this.noiseFloorRms * 2.2 + 35);
      if (rms >= bargeInThreshold) {
        // O usuário falou alto para interromper a Nexa!
        this.ttsActive = false;
        this.isSpeaking = true;
        this.peakTurnRms = rms;
        this.rmsHistory = [rms];
        this.isDecaying = false;
        this.speechChunks = [buf];
        this.speechBytes = buf.length;
        this.speechDurationMs = chunkMs;
        this.silenceAccumMs = 0;
        this.activeSpeechChunksCount = 1;
        this.totalChunksInTurn = 1;
        this.preRollChunks = [];
        this.preRollBytes = 0;
        this.emit("barge-in", { rms });
        this.emit("speech-start");
      }
      // Se não atingiu o limiar de barge-in, descarta o buffer (eco do próprio alto-falante)
      return;
    }

    // Atualiza suavemente o piso de ruído quando não estiver falando (com teto em 50)
    if (!this.isSpeaking) {
      this.noiseFloorRms = Math.min(50, this.noiseFloorRms * 0.90 + rms * 0.10);
    }

    // Limiar dinâmico: garante que fala seja detectada com facilidade sem ser bloqueada por ruído moderado
    const dynamicThreshold = Math.max(this.speechThresholdRms, this.noiseFloorRms * 1.25 + 15);
    const hasVoiceEnergy = rms >= dynamicThreshold;

    if (!this.isSpeaking) {
      // Estamos aguardando o início de uma fala
      if (hasVoiceEnergy) {
        // Início de fala detectado! Promove o pre-roll buffer para o início da fala
        this.isSpeaking = true;
        this.peakTurnRms = rms;
        this.rmsHistory = [rms];
        this.isDecaying = false;
        this.speechChunks = [...this.preRollChunks, buf];
        this.speechBytes = this.preRollBytes + buf.length;
        this.speechDurationMs = Math.round(this.speechBytes / BYTES_PER_MS);
        this.silenceAccumMs = 0;
        this.activeSpeechChunksCount = 1;
        this.totalChunksInTurn = 1;
        this.preRollChunks = [];
        this.preRollBytes = 0;
        this.emit("speech-start");
      } else {
        // Mantém o pre-roll buffer circular atualizado
        this.preRollChunks.push(buf);
        this.preRollBytes += buf.length;
        while (this.preRollBytes > this.maxPreRollBytes && this.preRollChunks.length > 1) {
          const removed = this.preRollChunks.shift();
          this.preRollBytes -= removed.length;
        }
      }
    } else {
      // Estamos gravando uma fala em andamento
      this.speechChunks.push(buf);
      this.speechBytes += buf.length;
      this.speechDurationMs += chunkMs;
      this.totalChunksInTurn++;

      // Atualiza histórico recente de RMS (janela deslizante de 5 chunks)
      this.rmsHistory.push(rms);
      if (this.rmsHistory.length > 5) this.rmsHistory.shift();

      const avgRecentRms = this.rmsHistory.reduce((a, b) => a + b, 0) / this.rmsHistory.length;

      if (hasVoiceEnergy) {
        if (rms > this.peakTurnRms) {
          this.peakTurnRms = rms;
        }
        // Se a energia voltar forte, desmarca decaimento (o usuário retomou a fala)
        if (rms >= dynamicThreshold * 1.3 && avgRecentRms >= this.peakTurnRms * 0.6) {
          this.isDecaying = false;
        }
        this.silenceAccumMs = 0; // Zera o silêncio acumulado
        this.activeSpeechChunksCount++;
      } else {
        // Acumula tempo de silêncio após a fala
        this.silenceAccumMs += chunkMs;
      }

      // Verifica decaimento de energia (Voice Energy Decay)
      // Se a fala já dura mais de 200ms e a energia recente caiu substancialmente em relação ao pico do turno
      if (this.speechDurationMs >= 200 && this.activeSpeechChunksCount >= 4 && this.peakTurnRms > 0) {
        if ((!hasVoiceEnergy || avgRecentRms < this.peakTurnRms * 0.40) && !this.isDecaying) {
          this.isDecaying = true;
          this.emit("voice-decay", {
            rms,
            peakTurnRms: this.peakTurnRms,
            avgRecentRms,
            silenceAccumMs: this.silenceAccumMs
          });
        }
      }

      // Condição 1: Silêncio contínuo após a fala atingiu o limiar
      // Condição 2: Duração máxima de segurança atingida
      const isSilenceTimeout = this.silenceAccumMs >= this.silenceThresholdMs;
      const isMaxDurationReached = this.speechDurationMs >= this.maxTurnDurationMs;

      if (isSilenceTimeout || isMaxDurationReached) {
        const totalPcm = Buffer.concat(this.speechChunks, this.speechBytes);
        const effectiveSpeechMs = this.speechDurationMs - (isSilenceTimeout ? this.silenceAccumMs : 0);
        const activeRatio = this.totalChunksInTurn > 0 ? (this.activeSpeechChunksCount / this.totalChunksInTurn) : 0;
        const avgTurnRms = NexaTurnDetector.computeRms(totalPcm);

        this.resetTurn();

        // Aceita se tiver duração suficiente de fala, densidade mínima e energia de fala real
        if (effectiveSpeechMs >= this.minSpeechMs && (activeRatio >= 0.15 || effectiveSpeechMs >= 600) && avgTurnRms >= 40) {
          this.emit("turn-complete", {
            pcmBuffer: totalPcm,
            durationMs: effectiveSpeechMs,
            avgRms: avgTurnRms,
            sampleRate: SAMPLE_RATE,
            channels: 1,
            bitDepth: 16
          });
        } else {
          this.emit("turn-discarded", {
            reason: `Duração/energia insuficiente: ${effectiveSpeechMs}ms (ratio: ${(activeRatio * 100).toFixed(0)}%, RMS: ${Math.round(avgTurnRms)})`
          });
        }
      }
    }
  }
}

module.exports = NexaTurnDetector;
