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
    this.speechThresholdRms = options.speechThresholdRms || 80;  // Limiar calibrado para captação de voz intencional sem ruído ambiente (80 RMS)
    this.silenceThresholdMs = options.silenceThresholdMs || 1400; // Duração de silêncio para fechar o turno (1400ms: ritmo de fala natural com pausas)
    this.minSpeechMs = options.minSpeechMs || 300;               // Duração mínima de fala real para considerar válida (300ms)
    this.maxTurnDurationMs = options.maxTurnDurationMs || 120000; // Limite amplo de segurança para turnos longos de fala (120s / 2 min)
    this.preRollMs = options.preRollMs || 400;                   // Buffer circular de pre-roll (400ms)
    this.bargeInThresholdRms = options.bargeInThresholdRms || 135; // Limiar elevado para interrupção de fala durante reprodução TTS

    this.active = false;
    this.ttsActive = false;
    this.isSpeaking = false;
    this.speechChunks = [];
    this.speechBytes = 0;
    this.silenceAccumMs = 0;
    this.speechDurationMs = 0;
    this.activeSpeechChunksCount = 0;
    this.totalChunksInTurn = 0;

    // Rastreamento de onset sustentado de fala (filtra cliques de digitação isolados de 1 chunk)
    this.onsetCandidateChunks = [];
    this.onsetCandidateBytes = 0;
    this.onsetCandidateMs = 0;

    // Rastreamento de consecutividade de voz (distingue voz contínua de toques espaçados de teclado)
    this.currentConsecutiveSpeech = 0;
    this.maxConsecutiveSpeechChunks = 0;
    this.sustainedSpeechSegments = 0;

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
    this.onsetCandidateChunks = [];
    this.onsetCandidateBytes = 0;
    this.onsetCandidateMs = 0;
    this.currentConsecutiveSpeech = 0;
    this.maxConsecutiveSpeechChunks = 0;
    this.sustainedSpeechSegments = 0;
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
   * Calcula a taxa de cruzamento por zero (Zero Crossing Rate) do PCM s16le.
   * Voz humana sonante (vogais) possui ZCR moderado (0.03 a 0.25).
   * Ruídos de fricção, arraste de móveis e chiados possuem ZCR muito elevado (> 0.38).
   */
  static computeZcr(buf) {
    if (!buf || buf.length < 4) return 0;
    let crossings = 0;
    const samples = Math.floor(buf.length / 2);
    let prev = buf.readInt16LE(0);
    for (let i = 1; i < samples; i++) {
      const cur = buf.readInt16LE(i * 2);
      if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) {
        crossings++;
      }
      prev = cur;
    }
    return samples > 1 ? crossings / (samples - 1) : 0;
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
      const bargeInThreshold = Math.max(this.bargeInThresholdRms, this.speechThresholdRms * 1.8, this.noiseFloorRms * 2.2 + 35);
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

    // Atualiza suavemente o piso de ruído quando não estiver falando (com teto em 60)
    if (!this.isSpeaking) {
      this.noiseFloorRms = Math.min(60, this.noiseFloorRms * 0.90 + rms * 0.10);
    }

    // Limiar dinâmico: garante que fala real se sobreponha claramente ao piso de ruído ambiente
    const dynamicThreshold = Math.max(this.speechThresholdRms, this.noiseFloorRms * 1.5 + 25);
    const hasVoiceEnergy = rms >= dynamicThreshold;

    if (!this.isSpeaking) {
      // Estamos aguardando o início de uma fala
      if (hasVoiceEnergy) {
        this.onsetCandidateChunks.push(buf);
        this.onsetCandidateBytes += buf.length;
        this.onsetCandidateMs += chunkMs;

        // Fala humana real sustenta energia por >= 100ms ou >= 2 chunks consecutivos de áudio.
        // Ruídos mecânicos transitórios (clique isolado de mouse/tecla) geram apenas 1 chunk curto (<40ms).
        const hasSustainedOnset = this.onsetCandidateMs >= 100 || this.onsetCandidateChunks.length >= 2;

        if (hasSustainedOnset) {
          // Início de fala real confirmado!
          this.isSpeaking = true;
          this.peakTurnRms = Math.max(rms, ...this.onsetCandidateChunks.map(c => NexaTurnDetector.computeRms(c)));
          this.rmsHistory = [rms];
          this.isDecaying = false;
          this.speechChunks = [...this.preRollChunks, ...this.onsetCandidateChunks];
          this.speechBytes = this.preRollBytes + this.onsetCandidateBytes;
          this.speechDurationMs = Math.round(this.speechBytes / BYTES_PER_MS);
          this.silenceAccumMs = 0;
          this.activeSpeechChunksCount = this.onsetCandidateChunks.length;
          this.totalChunksInTurn = this.onsetCandidateChunks.length;
          this.currentConsecutiveSpeech = this.onsetCandidateChunks.length;
          this.maxConsecutiveSpeechChunks = this.onsetCandidateChunks.length;
          this.sustainedSpeechSegments = 1;
          this.preRollChunks = [];
          this.preRollBytes = 0;
          this.onsetCandidateChunks = [];
          this.onsetCandidateBytes = 0;
          this.onsetCandidateMs = 0;
          this.emit("speech-start");
        }
      } else {
        // Se tínhamos um candidato isolado (ex: 1 clique de tecla), descarta e joga pro pre-roll
        if (this.onsetCandidateChunks.length > 0) {
          for (const c of this.onsetCandidateChunks) {
            this.preRollChunks.push(c);
            this.preRollBytes += c.length;
          }
          this.onsetCandidateChunks = [];
          this.onsetCandidateBytes = 0;
          this.onsetCandidateMs = 0;
        }

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
        this.currentConsecutiveSpeech++;
        if (this.currentConsecutiveSpeech > this.maxConsecutiveSpeechChunks) {
          this.maxConsecutiveSpeechChunks = this.currentConsecutiveSpeech;
        }
        if (this.currentConsecutiveSpeech === 2) {
          this.sustainedSpeechSegments++;
        }
        // Se a energia voltar forte, desmarca decaimento (o usuário retomou a fala)
        if (rms >= dynamicThreshold * 1.3 && avgRecentRms >= this.peakTurnRms * 0.6) {
          this.isDecaying = false;
        }
        this.silenceAccumMs = 0; // Zera o silêncio acumulado
        this.activeSpeechChunksCount++;
      } else {
        this.currentConsecutiveSpeech = 0;
        // Acumula tempo de silêncio após a fala
        this.silenceAccumMs += chunkMs;
      }

      // Verifica decaimento de energia (Voice Energy Decay)
      // Se a fala já dura mais de 300ms e a energia recente caiu substancialmente em relação ao pico do turno
      if (this.speechDurationMs >= 300 && this.activeSpeechChunksCount >= 4 && this.peakTurnRms > 0) {
        if ((!hasVoiceEnergy || avgRecentRms < this.peakTurnRms * 0.35) && !this.isDecaying) {
          this.isDecaying = true;
          this.emit("voice-decay", {
            rms,
            peakTurnRms: this.peakTurnRms,
            avgRecentRms,
            silenceAccumMs: this.silenceAccumMs
          });
        }
      }

      // Condição 1: Silêncio contínuo após a fala atingiu o limiar (1400ms)
      // Condição 1b: Se a energia da voz já decaiu claramente (fim de frase), fecha com 1100ms de silêncio
      // Condição 2: Duração máxima de segurança atingida
      const isDecayingSilence = this.isDecaying && this.silenceAccumMs >= 1100;
      const isSilenceTimeout = (this.silenceAccumMs >= this.silenceThresholdMs) || isDecayingSilence;
      const isMaxDurationReached = this.speechDurationMs >= this.maxTurnDurationMs;

      if (isSilenceTimeout || isMaxDurationReached) {
        const totalPcm = Buffer.concat(this.speechChunks, this.speechBytes);
        const effectiveSpeechMs = this.speechDurationMs - (isSilenceTimeout ? this.silenceAccumMs : 0);
        const activeRatio = this.totalChunksInTurn > 0 ? (this.activeSpeechChunksCount / this.totalChunksInTurn) : 0;
        const avgTurnRms = NexaTurnDetector.computeRms(totalPcm);
        const peakRms = this.peakTurnRms;
        const activeChunks = this.activeSpeechChunksCount;
        const sustainedSegments = this.sustainedSpeechSegments;
        const maxConsecutive = this.maxConsecutiveSpeechChunks;

        this.resetTurn();

        // 1. Rejeita ruído mecânico de digitação de teclado / cliques isolados e sopros:
        const isMechanicalImpulse = (maxConsecutive < 2 && sustainedSegments === 0);
        const isSparseTypingNoise = (effectiveSpeechMs >= 500 && sustainedSegments < 2 && activeRatio < 0.22);
        const isBreathingPuff = (effectiveSpeechMs < 350 && maxConsecutive < 2 && peakRms < 75);
        if (isMechanicalImpulse || isSparseTypingNoise || isBreathingPuff) {
          this.emit("turn-discarded", {
            reason: `Ruído de digitação/sopro descartado (consecutive: ${maxConsecutive}, sustained: ${sustainedSegments}, ratio: ${(activeRatio * 100).toFixed(0)}%)`
          });
          return;
        }

        // 2. Rejeita arraste mecânico de cadeira, atrito de móveis ou chiado contínuo via ZCR
        const avgZcr = NexaTurnDetector.computeZcr(totalPcm);
        const isFrictionScrape = (effectiveSpeechMs < 900 && (avgZcr > 0.38 || avgZcr < 0.015));
        const isTransientBump = (effectiveSpeechMs < 450 && maxConsecutive < 3 && peakRms < 90);
        if (isFrictionScrape || isTransientBump) {
          this.emit("turn-discarded", {
            reason: `Ruído mecânico/fricção descartado (ZCR: ${avgZcr.toFixed(3)}, consecutive: ${maxConsecutive}, peak: ${Math.round(peakRms)})`
          });
          return;
        }

        // 3. Aceita se tiver duração suficiente de fala, densidade mínima e energia de voz real
        const hasEnoughSpeech = effectiveSpeechMs >= this.minSpeechMs && activeChunks >= 1;
        const hasRealEnergy = avgTurnRms >= 35 || peakRms >= 60;
        const hasGoodDensity = (activeRatio >= 0.18 || effectiveSpeechMs >= 500);
        if (hasEnoughSpeech && hasRealEnergy && hasGoodDensity) {
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
            reason: `Duração/energia insuficiente: ${effectiveSpeechMs}ms (ratio: ${(activeRatio * 100).toFixed(0)}%, RMS: ${Math.round(avgTurnRms)}, peak: ${Math.round(peakRms)})`
          });
        }
      }
    }
  }
}

module.exports = NexaTurnDetector;
