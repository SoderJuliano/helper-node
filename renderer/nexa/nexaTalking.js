/**
 * renderer/nexa/nexaTalking.js
 * Controlador de Animação de Fala baseado em tempo real na energia do áudio do Google TTS.
 * Utiliza Web Audio API (AudioContext + AnalyserNode) para medir a amplitude e controlar
 * a abertura da boca com suavização (lerp) e preservação do alinhamento do rosto.
 */

const MOUTH_STATES = {
  CLOSED: 0,
  SMALL: 1,
  MEDIUM: 2,
  OPEN: 3
};

class NexaTalking {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.timeDataArray = null;
    this.freqDataArray = null;
    this.sourceNode = null;

    this.currentAmplitude = 0;
    this.targetAmplitude = 0;
    this.vowelDrive = 0;
    this.sibilantDrive = 0;

    this.mouthScaleY = 1.0;
    this.mouthScaleX = 1.0;
    this.mouthOffsetY = 0;
    this.mouthState = MOUTH_STATES.CLOSED;

    this.visemeMap = {
      [MOUTH_STATES.CLOSED]: { scaleY: 1.0, scaleX: 1.0 },
      [MOUTH_STATES.SMALL]: { scaleY: 1.35, scaleX: 1.04 },
      [MOUTH_STATES.MEDIUM]: { scaleY: 1.95, scaleX: 1.08 },
      [MOUTH_STATES.OPEN]: { scaleY: 2.5, scaleX: 1.12 }
    };
  }

  connectAudioElement(audioElement) {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContextClass();
      }

      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume();
      }

      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256; // 128 bins de frequência (~172 Hz por bin)
      this.analyser.smoothingTimeConstant = 0.5;

      const binCount = this.analyser.frequencyBinCount;
      this.timeDataArray = new Uint8Array(binCount);
      this.freqDataArray = new Uint8Array(binCount);

      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (_) {}
      }

      this.sourceNode = this.audioCtx.createMediaElementSource(audioElement);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      console.log("[NexaTalking] Conectado ao AnalyserNode de espectro de áudio com sucesso.");
    } catch (err) {
      console.warn("[NexaTalking] Aviso na conexão do AudioContext (modo fallback ativo):", err.message);
    }
  }

  update(deltaTime, isSpeaking = false) {
    if (!isSpeaking) {
      // Retorno suave para o estado fechado quando não está falando
      const releaseSpeed = Math.min(1.0, deltaTime * 14.0);
      this.mouthScaleY += (1.0 - this.mouthScaleY) * releaseSpeed;
      this.mouthScaleX += (1.0 - this.mouthScaleX) * releaseSpeed;
      this.mouthOffsetY += (0 - this.mouthOffsetY) * releaseSpeed;
      this.currentAmplitude += (0 - this.currentAmplitude) * releaseSpeed;
      this.mouthState = MOUTH_STATES.CLOSED;
      return {
        mouthScaleY: this.mouthScaleY,
        mouthScaleX: this.mouthScaleX,
        mouthOffsetY: this.mouthOffsetY,
        mouthState: this.mouthState
      };
    }

    if (this.analyser && this.timeDataArray && this.freqDataArray) {
      this.analyser.getByteTimeDomainData(this.timeDataArray);
      this.analyser.getByteFrequencyData(this.freqDataArray);

      // 1. RMS do domínio do tempo (volume global da forma de onda)
      let sumSq = 0;
      for (let i = 0; i < this.timeDataArray.length; i++) {
        const norm = (this.timeDataArray[i] - 128) / 128.0;
        sumSq += norm * norm;
      }
      const rms = Math.sqrt(sumSq / this.timeDataArray.length);

      // 2. Análise de bandas do espectro de frequência
      // Formantes vocais (Vogais: 300Hz - 2400Hz -> bins 2 a 14)
      let vowelSum = 0;
      for (let i = 2; i <= 14; i++) {
        vowelSum += this.freqDataArray[i];
      }
      const rawVowel = vowelSum / (13 * 255.0);

      // Fricativas / Sibilantes (Consoantes S, Z, T, CH: 3400Hz - 8600Hz -> bins 20 a 50)
      let sibSum = 0;
      for (let i = 20; i <= 50; i++) {
        sibSum += this.freqDataArray[i];
      }
      const rawSibilant = sibSum / (31 * 255.0);

      // Noise gate para silêncio e pausas entre palavras
      if (rms < 0.012) {
        this.targetAmplitude = 0;
        this.vowelDrive = 0;
        this.sibilantDrive = 0;
      } else {
        this.targetAmplitude = Math.min(1.0, (rms - 0.012) / 0.18);
        // Nas consoantes sibilantes (S, T), a boca não deve abrir muito verticalmente
        this.vowelDrive = Math.max(0, rawVowel - rawSibilant * 0.4);
        this.sibilantDrive = rawSibilant;
      }
    } else {
      // Fallback sutil de modulação caso AnalyserNode não esteja conectado em ambiente sem Web Audio API
      if (this.targetAmplitude === 0) {
        this.vowelDrive = 0;
        this.sibilantDrive = 0;
      } else {
        if (!this.targetAmplitude) {
          this.targetAmplitude = 0.4 + Math.sin(Date.now() * 0.015) * 0.3;
        }
        this.vowelDrive = this.targetAmplitude;
        this.sibilantDrive = 0.1;
      }
    }

    // Seguidor de envelope assimétrico: Ataque rápido (32.0) / Relaxamento suave (14.0)
    const attackReleaseSpeed = this.targetAmplitude > this.currentAmplitude ? 32.0 : 14.0;
    this.currentAmplitude += (this.targetAmplitude - this.currentAmplitude) * Math.min(1.0, deltaTime * attackReleaseSpeed);

    // Classificação discreta da boca
    if (this.currentAmplitude < 0.08) {
      this.mouthState = MOUTH_STATES.CLOSED;
    } else if (this.currentAmplitude < 0.32) {
      this.mouthState = MOUTH_STATES.SMALL;
    } else if (this.currentAmplitude < 0.62) {
      this.mouthState = MOUTH_STATES.MEDIUM;
    } else {
      this.mouthState = MOUTH_STATES.OPEN;
    }

    // Variação micro-orgânica das sílabas durante o fluxo da fala
    const microSyllable = Math.sin(Date.now() * 0.028) * 0.07 * this.vowelDrive;

    // Abertura vertical (scaleY): impulsionada pelas vogais
    const targetScaleY = 1.0 + (this.currentAmplitude * 1.3) + (this.vowelDrive * 0.4) + microSyllable;

    // Abertura horizontal (scaleX): impulsionada pelas fricativas/sibilantes
    const targetScaleX = 1.0 + (this.currentAmplitude * 0.08) + (this.sibilantDrive * 0.06);

    this.mouthScaleY += (targetScaleY - this.mouthScaleY) * Math.min(1.0, deltaTime * 20.0);
    this.mouthScaleX += (targetScaleX - this.mouthScaleX) * Math.min(1.0, deltaTime * 20.0);

    // Ajuste de compensação vertical do queixo
    this.mouthOffsetY = (this.mouthScaleY - 1.0) * 1.3;

    return {
      mouthScaleY: this.mouthScaleY,
      mouthScaleX: this.mouthScaleX,
      mouthOffsetY: this.mouthOffsetY,
      mouthState: this.mouthState
    };
  }

  stop() {
    this.targetAmplitude = 0;
    this.vowelDrive = 0;
    this.sibilantDrive = 0;
    this.currentAmplitude = 0;
    this.mouthState = MOUTH_STATES.CLOSED;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaTalking, MOUTH_STATES };
}
