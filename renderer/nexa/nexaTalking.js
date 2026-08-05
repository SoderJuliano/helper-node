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
    this.dataArray = null;
    this.sourceNode = null;

    this.currentAmplitude = 0;
    this.targetAmplitude = 0;

    this.mouthScaleY = 1.0;
    this.mouthScaleX = 1.0;
    this.mouthOffsetY = 0;
    this.mouthState = MOUTH_STATES.CLOSED;

    // Arquitetura pronta para futuramente mapear visemas/PNGs de boca adicionais
    this.visemeMap = {
      [MOUTH_STATES.CLOSED]: { scaleY: 1.0, scaleX: 1.0 },
      [MOUTH_STATES.SMALL]: { scaleY: 1.4, scaleX: 1.05 },
      [MOUTH_STATES.MEDIUM]: { scaleY: 2.1, scaleX: 1.12 },
      [MOUTH_STATES.OPEN]: { scaleY: 2.8, scaleX: 1.18 }
    };
  }

  /**
   * Conecta um elemento HTMLAudioElement ao AnalyserNode da Web Audio API.
   */
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
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.6; // Suavização nativa do AnalyserNode

      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);

      if (this.sourceNode) {
        try { this.sourceNode.disconnect(); } catch (_) {}
      }

      this.sourceNode = this.audioCtx.createMediaElementSource(audioElement);
      this.sourceNode.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);

      console.log("[NexaTalking] Conectado ao AnalyserNode com sucesso.");
    } catch (err) {
      console.warn("[NexaTalking] Aviso na conexão do AudioContext (modo fallback ativo):", err.message);
    }
  }

  update(deltaTime, isSpeaking = false) {
    if (!isSpeaking) {
      // Suaviza o fechamento da boca ao parar de falar
      this.mouthScaleY += (1.0 - this.mouthScaleY) * Math.min(1.0, deltaTime * 12.0);
      this.mouthScaleX += (1.0 - this.mouthScaleX) * Math.min(1.0, deltaTime * 12.0);
      this.mouthOffsetY += (0 - this.mouthOffsetY) * Math.min(1.0, deltaTime * 12.0);
      this.mouthState = MOUTH_STATES.CLOSED;
      return {
        mouthScaleY: this.mouthScaleY,
        mouthScaleX: this.mouthScaleX,
        mouthOffsetY: this.mouthOffsetY,
        mouthState: this.mouthState
      };
    }

    // Processa energia/amplitude do áudio do AnalyserNode
    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      let sum = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        sum += this.dataArray[i];
      }
      const average = sum / this.dataArray.length;
      this.targetAmplitude = Math.min(1.0, average / 110.0);
    } else {
      // Fallback sutil de modulação caso AudioContext falhe
      this.targetAmplitude = 0.3 + Math.sin(Date.now() * 0.015) * 0.35;
    }

    // Aplica lerp constante para evitar tremulação abruta da boca
    this.currentAmplitude += (this.targetAmplitude - this.currentAmplitude) * Math.min(1.0, deltaTime * 16.0);

    // Classifica o estado discreto da boca com base na energia
    if (this.currentAmplitude < 0.12) {
      this.mouthState = MOUTH_STATES.CLOSED;
    } else if (this.currentAmplitude < 0.35) {
      this.mouthState = MOUTH_STATES.SMALL;
    } else if (this.currentAmplitude < 0.65) {
      this.mouthState = MOUTH_STATES.MEDIUM;
    } else {
      this.mouthState = MOUTH_STATES.OPEN;
    }

    const viseme = this.visemeMap[this.mouthState];

    // Variação micro-orgânica para não parecer mecânico
    const microVar = Math.sin(Date.now() * 0.02) * 0.1;
    const targetScaleY = viseme.scaleY + microVar * this.currentAmplitude;
    const targetScaleX = viseme.scaleX;

    this.mouthScaleY += (targetScaleY - this.mouthScaleY) * Math.min(1.0, deltaTime * 14.0);
    this.mouthScaleX += (targetScaleX - this.mouthScaleX) * Math.min(1.0, deltaTime * 14.0);

    // Micro ajuste vertical do pivô para manter alinhamento anatômico perfeito
    this.mouthOffsetY = (this.mouthScaleY - 1.0) * 0.5;

    return {
      mouthScaleY: this.mouthScaleY,
      mouthScaleX: this.mouthScaleX,
      mouthOffsetY: this.mouthOffsetY,
      mouthState: this.mouthState
    };
  }

  stop() {
    this.targetAmplitude = 0;
    this.currentAmplitude = 0;
    this.mouthState = MOUTH_STATES.CLOSED;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaTalking, MOUTH_STATES };
}
