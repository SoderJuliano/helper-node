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
    this.speechThresholdRms = options.speechThresholdRms || 220; // Limiar de RMS calibrado para evitar falsos positivos de fritura/ruído
    this.silenceThresholdMs = options.silenceThresholdMs || 950;  // Duração de silêncio contínuo para fechar o turno
    this.minSpeechMs = options.minSpeechMs || 420;               // Duração mínima de fala real para considerar válida
    this.maxTurnDurationMs = options.maxTurnDurationMs || 30000; // Limite máximo de segurança para um turno (30s)
    this.preRollMs = options.preRollMs || 320;                   // Buffer circular de pre-roll (320ms)

    this.active = false;
    this.isSpeaking = false;
    this.speechChunks = [];
    this.speechBytes = 0;
    this.silenceAccumMs = 0;
    this.speechDurationMs = 0;

    // Buffer circular de pre-roll (guarda os últimos 320ms de áudio antes de a fala começar)
    this.preRollChunks = [];
    this.preRollBytes = 0;
    this.maxPreRollBytes = Math.round(this.preRollMs * BYTES_PER_MS);

    this._onPcmChunk = this._handlePcmChunk.bind(this);
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
    this.preRollChunks = [];
    this.preRollBytes = 0;
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

    this.emit("level", { rms, isSpeaking: this.isSpeaking });

    const hasVoiceEnergy = rms >= this.speechThresholdRms;

    if (!this.isSpeaking) {
      // Estamos aguardando o início de uma fala
      if (hasVoiceEnergy) {
        // Início de fala detectado! Promove o pre-roll buffer para o início da fala
        this.isSpeaking = true;
        this.speechChunks = [...this.preRollChunks, buf];
        this.speechBytes = this.preRollBytes + buf.length;
        this.speechDurationMs = Math.round(this.speechBytes / BYTES_PER_MS);
        this.silenceAccumMs = 0;
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

      if (hasVoiceEnergy) {
        this.silenceAccumMs = 0; // Zera o silêncio acumulado
      } else {
        this.silenceAccumMs += chunkMs; // Acumula tempo de silêncio após a fala
      }

      // Condição 1: Silêncio contínuo após a fala atingiu o limiar
      // Condição 2: Duração máxima de segurança atingida
      const isSilenceTimeout = this.silenceAccumMs >= this.silenceThresholdMs;
      const isMaxDurationReached = this.speechDurationMs >= this.maxTurnDurationMs;

      if (isSilenceTimeout || isMaxDurationReached) {
        const totalPcm = Buffer.concat(this.speechChunks, this.speechBytes);
        const effectiveSpeechMs = this.speechDurationMs - (isSilenceTimeout ? this.silenceAccumMs : 0);

        this.resetTurn();

        // Só emite o turno se tiver acumulado fala real suficiente (evita estalos ou ruídos rápidos)
        if (effectiveSpeechMs >= this.minSpeechMs) {
          this.emit("turn-complete", {
            pcmBuffer: totalPcm,
            durationMs: effectiveSpeechMs,
            sampleRate: SAMPLE_RATE,
            channels: 1,
            bitDepth: 16
          });
        } else {
          this.emit("turn-discarded", { reason: "Duração muito curta: " + effectiveSpeechMs + "ms" });
        }
      }
    }
  }
}

module.exports = NexaTurnDetector;
