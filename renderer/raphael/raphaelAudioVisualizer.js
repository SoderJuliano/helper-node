/**
 * renderer/raphael/raphaelAudioVisualizer.js
 * Analisador de espectro de áudio em tempo real para sincronização visual do Raphael Core com a voz TTS.
 * Utiliza Web Audio API (AnalyserNode + FFT) para extrair frequências graves, médias e agudas.
 */

(function(root) {
  class RaphaelAudioVisualizer {
    constructor() {
      this.audioContext = null;
      this.analyser = null;
      this.sourceNode = null;
      this.frequencyData = null;
      this.timeDomainData = null;
      this.connectedElement = null;

      // Métricas suavizadas de áudio
      this.bassEnergy = 0;
      this.midEnergy = 0;
      this.trebleEnergy = 0;
      this.overallAmplitude = 0;

      // Configurações de análise
      this.fftSize = 512;
      this.smoothingTimeConstant = 0.82;
    }

    initContext() {
      if (this.audioContext) return;
      try {
        const AudioCtx = (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) || (root && (root.AudioContext || root.webkitAudioContext));
        if (!AudioCtx) return;
        this.audioContext = new AudioCtx();
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = this.fftSize;
        this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;

        const bufferLength = this.analyser.frequencyBinCount;
        this.frequencyData = new Uint8Array(bufferLength);
        this.timeDomainData = new Uint8Array(bufferLength);
      } catch (e) {
        console.warn("[RaphaelAudioVisualizer] Falha ao criar AudioContext:", e);
      }
    }

    /**
     * Conecta um elemento HTMLAudioElement de saída TTS ao analisador.
     * @param {HTMLAudioElement} audioElement 
     */
    connectAudioElement(audioElement) {
      if (!audioElement) return;
      this.initContext();
      if (!this.audioContext || !this.analyser) return;

      try {
        if (this.audioContext.state === "suspended") {
          this.audioContext.resume().catch(() => {});
        }

        if (this.connectedElement !== audioElement) {
          this.connectedElement = audioElement;
          // Cria nó de origem a partir do elemento
          this.sourceNode = this.audioContext.createMediaElementSource(audioElement);
          this.sourceNode.connect(this.analyser);
          this.analyser.connect(this.audioContext.destination);
        }
      } catch (err) {
        // Em caso de re-conexão do mesmo elemento no DOM, mantém o fluxo sem quebrar
        console.log("[RaphaelAudioVisualizer] Nota na conexão de áudio:", err.message);
      }
    }

    /**
     * Atualiza a leitura espectral a cada frame (60 FPS).
     * @param {number} deltaTime 
     * @param {boolean} isSpeakingState 
     */
    update(deltaTime, isSpeakingState = false) {
      if (!this.analyser || !this.frequencyData) {
        // Decaimento suave se não houver áudio ativo
        this.bassEnergy = Math.max(0, this.bassEnergy - deltaTime * 3.0);
        this.midEnergy = Math.max(0, this.midEnergy - deltaTime * 3.0);
        this.trebleEnergy = Math.max(0, this.trebleEnergy - deltaTime * 3.0);
        this.overallAmplitude = Math.max(0, this.overallAmplitude - deltaTime * 3.0);
        return;
      }

      this.analyser.getByteFrequencyData(this.frequencyData);

      const binCount = this.analyser.frequencyBinCount;
      // Bins correspondentes:
      // Bass: ~20Hz - 250Hz (bins 0 a 8)
      // Mid: ~250Hz - 2500Hz (bins 9 a 60)
      // Treble: ~2500Hz - 8000Hz (bins 61 a 150)

      let bassSum = 0, bassCount = 0;
      let midSum = 0, midCount = 0;
      let trebleSum = 0, trebleCount = 0;

      for (let i = 0; i < binCount; i++) {
        const val = this.frequencyData[i] / 255.0;
        if (i <= 8) {
          bassSum += val;
          bassCount++;
        } else if (i <= 60) {
          midSum += val;
          midCount++;
        } else if (i <= 150) {
          trebleSum += val;
          trebleCount++;
        }
      }

      const rawBass = bassCount > 0 ? (bassSum / bassCount) : 0;
      const rawMid = midCount > 0 ? (midSum / midCount) : 0;
      const rawTreble = trebleCount > 0 ? (trebleSum / trebleCount) : 0;
      const rawOverall = (rawBass * 0.5 + rawMid * 0.35 + rawTreble * 0.15);

      // Interpolação suave de ataque e decaimento
      const attack = 0.45;
      const decay = 0.15;

      this.bassEnergy += (rawBass - this.bassEnergy) * (rawBass > this.bassEnergy ? attack : decay);
      this.midEnergy += (rawMid - this.midEnergy) * (rawMid > this.midEnergy ? attack : decay);
      this.trebleEnergy += (rawTreble - this.trebleEnergy) * (rawTreble > this.trebleEnergy ? attack : decay);
      this.overallAmplitude += (rawOverall - this.overallAmplitude) * (rawOverall > this.overallAmplitude ? attack : decay);

      // Se estiver no estado SPEAKING mas o sinal de áudio estiver muito baixo (ex: pausa de vírgula), aplica um piso mínimo
      if (isSpeakingState && this.overallAmplitude < 0.05) {
        const idleVoicePulse = 0.12 * Math.sin(Date.now() * 0.008);
        this.bassEnergy = Math.max(this.bassEnergy, 0.08 + idleVoicePulse);
        this.midEnergy = Math.max(this.midEnergy, 0.06);
      }
    }

    getMetrics() {
      return {
        bass: this.bassEnergy,
        mid: this.midEnergy,
        treble: this.trebleEnergy,
        amplitude: this.overallAmplitude
      };
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { RaphaelAudioVisualizer };
  }
  if (root) {
    root.RaphaelAudioVisualizer = RaphaelAudioVisualizer;
  }
})(typeof globalThis !== "undefined" ? globalThis : (typeof window !== "undefined" ? window : this));
