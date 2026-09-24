/**
 * renderer/nexa/nexaRenderer.js
 * Renderizador exclusivo do Raphael Core (núcleo cósmico giroscópico 3D de plasma),
 * legendas dinâmicas e integração de áudio / IPCs da janela Nexa.
 */

document.addEventListener("DOMContentLoaded", async () => {
  const canvas = document.getElementById("nexaCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  let lastTime = performance.now();

  // Dimensões do Canvas da janela flutuante da Nexa
  function resizeCanvas() {
    canvas.width = window.innerWidth || 420;
    canvas.height = window.innerHeight || 420;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Inicializa o Raphael Core e legendas
  const raphaelCore = (typeof RaphaelCore !== "undefined")
    ? new RaphaelCore()
    : ((typeof window !== "undefined" && window.RaphaelCore) ? new window.RaphaelCore() : null);

  const raphaelSubtitles = (typeof RaphaelSubtitles !== "undefined")
    ? new RaphaelSubtitles()
    : ((typeof window !== "undefined" && window.RaphaelSubtitles) ? new window.RaphaelSubtitles() : null);

  canvas.className = "raphael-canvas-glow idle";
  console.log(`[NexaRenderer] RaphaelCore ativo e pronto: ${!!raphaelCore}`);

  // Controle de inatividade e sono (10 minutos em IDLE)
  let sleepingTime = 0;
  const SLEEP_TIMEOUT = 10 * 60; // 600 segundos
  let isSleeping = false;

  // 1. Escuta de Mudança de Estado (IDLE, LISTENING, THINKING, SPEAKING, WORKING, SEARCHING)
  if (window.electronAPI && window.electronAPI.onNexaStateChange) {
    window.electronAPI.onNexaStateChange(({ state: newState }) => {
      if (!newState) newState = "IDLE";
      console.log("[NexaRenderer] Novo estado recebido:", newState);

      if (newState !== "IDLE") {
        isSleeping = false;
        sleepingTime = 0;
      }

      if (raphaelCore) {
        raphaelCore.setState(newState);
      }
      canvas.className = `raphael-canvas-glow ${newState.toLowerCase()}`;
    });
  }

  // 2. Reações e pulsos visuais do Raphael Core
  if (window.electronAPI && window.electronAPI.onPlayAnimation) {
    window.electronAPI.onPlayAnimation(({ name }) => {
      console.log("[NexaRenderer] Pulso visual disparado:", name);
      if (!raphaelCore) return;

      if (name === "dance" || name === "celebration") {
        raphaelCore.setState("SPEAKING");
        raphaelCore.triggerShockwave(1.4);
        setTimeout(() => raphaelCore.triggerShockwave(1.1), 300);
        setTimeout(() => raphaelCore.triggerShockwave(0.9), 600);
      } else if (name === "working" || name === "writing_code" || name === "typing" || name === "tesseract_code") {
        raphaelCore.setState("WORKING");
        raphaelCore.triggerShockwave(0.9);
      } else if (name === "searching" || name === "globe_search") {
        raphaelCore.setState("SEARCHING");
        raphaelCore.triggerShockwave(0.9);
      } else if (name === "thinking") {
        raphaelCore.setState("THINKING");
        raphaelCore.triggerShockwave(0.8);
      } else if (name === "sleeping") {
        raphaelCore.setState("SLEEPING");
      } else {
        raphaelCore.triggerShockwave(1.0);
      }
    });
  }

  // 3. Player de Áudio Streaming em tempo real para o Gemini Multimodal Live (Web Audio API)
  class PcmStreamPlayer {
    constructor() {
      this.audioCtx = null;
      this.nextStartTime = 0;
      this.activeSources = new Set();
      this.analyser = null;
      this.gainNode = null;
    }

    _ensureContext() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx({ sampleRate: 24000 });
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume().catch(() => {});
      }
      if (!this.analyser) {
        this.analyser = this.audioCtx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.82;

        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = 1.0;

        // Conecta cadeia de saída: gainNode -> analyser -> audioCtx.destination (hardware de áudio/fone)
        this.gainNode.connect(this.analyser);
        this.analyser.connect(this.audioCtx.destination);
      }
      if (raphaelCore && raphaelCore.audioVisualizer) {
        raphaelCore.audioVisualizer.analyser = this.analyser;
        raphaelCore.audioVisualizer.audioContext = this.audioCtx;
        const binCount = this.analyser.frequencyBinCount;
        if (!raphaelCore.audioVisualizer.frequencyData || raphaelCore.audioVisualizer.frequencyData.length !== binCount) {
          raphaelCore.audioVisualizer.frequencyData = new Uint8Array(binCount);
          raphaelCore.audioVisualizer.timeDomainData = new Uint8Array(binCount);
        }
      }
    }

    playChunk(pcmBase64, sampleRate = 24000) {
      if (!pcmBase64) return;
      this._ensureContext();

      try {
        const binaryStr = atob(pcmBase64);
        const len = binaryStr.length;
        const alignedLen = len - (len % 2);
        if (alignedLen === 0) return;

        const bytes = new Uint8Array(alignedLen);
        for (let i = 0; i < alignedLen; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const int16Samples = new Int16Array(bytes.buffer, 0, alignedLen / 2);
        const numSamples = int16Samples.length;
        if (numSamples === 0) return;

        const buffer = this.audioCtx.createBuffer(1, numSamples, sampleRate);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < numSamples; i++) {
          channelData[i] = int16Samples[i] / 32768.0;
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.gainNode || this.analyser);

        const now = this.audioCtx.currentTime;
        const startTime = Math.max(now, this.nextStartTime);
        source.start(startTime);
        this.nextStartTime = startTime + buffer.duration;

        this.activeSources.add(source);
        if (raphaelCore) {
          raphaelCore.setState("SPEAKING");
          canvas.className = "raphael-canvas-glow speaking";
        }

        source.onended = () => {
          this.activeSources.delete(source);
          if (this.activeSources.size === 0 && this.audioCtx.currentTime >= this.nextStartTime - 0.05) {
            if (raphaelCore && raphaelCore.getState() === "SPEAKING") {
              raphaelCore.setState("IDLE");
              canvas.className = "raphael-canvas-glow idle";
            }
          }
        };
      } catch (err) {
        console.warn("[PcmStreamPlayer] Erro ao reproduzir chunk PCM:", err);
      }
    }

    stop() {
      for (const src of this.activeSources) {
        try {
          src.stop();
          src.disconnect();
        } catch (_) {}
      }
      this.activeSources.clear();
      this.nextStartTime = 0;
      if (raphaelCore && raphaelCore.getState() === "SPEAKING") {
        raphaelCore.setState("IDLE");
        canvas.className = "raphael-canvas-glow idle";
      }
    }
  }

  const pcmPlayer = new PcmStreamPlayer();

  if (window.electronAPI && window.electronAPI.onGeminiLiveAudioChunk) {
    window.electronAPI.onGeminiLiveAudioChunk((data) => {
      const pcmBase64 = data.pcmBase64 || data;
      const sampleRate = (data.mimeType && data.mimeType.includes("rate=16000")) ? 16000 : 24000;
      pcmPlayer.playChunk(pcmBase64, sampleRate);
    });
  }

  if (window.electronAPI && window.electronAPI.onGeminiLiveBargeIn) {
    window.electronAPI.onGeminiLiveBargeIn(() => {
      console.log("[NexaRenderer] Barge-In disparado pelo Gemini Live: silenciando voz imediatamente.");
      pcmPlayer.stop();
      if (raphaelSubtitles) {
        raphaelSubtitles.clear();
      }
      if (raphaelCore) {
        raphaelCore.setState("IDLE");
        canvas.className = "raphael-canvas-glow idle";
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onGeminiLiveTranscript) {
    window.electronAPI.onGeminiLiveTranscript((data) => {
      const text = data && data.text ? data.text : data;
      if (raphaelSubtitles && text) {
        raphaelSubtitles.updateStreaming(text);
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onGeminiLiveTurnComplete) {
    window.electronAPI.onGeminiLiveTurnComplete(() => {
      if (raphaelSubtitles) {
        raphaelSubtitles.finishStreaming(7000);
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onGeminiLiveToolProgress) {
    window.electronAPI.onGeminiLiveToolProgress(({ message }) => {
      if (raphaelSubtitles && message) {
        raphaelSubtitles.show(message, 4000);
      }
      if (raphaelCore && raphaelCore.getState() !== "SPEAKING") {
        raphaelCore.setState("WORKING");
        canvas.className = "raphael-canvas-glow working";
      }
    });
  }

  // 4. Arraste Suave da Janela
  let isDraggingWindow = false;

  canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
      isDraggingWindow = true;
      canvas.style.cursor = "grabbing";
      if (window.electronAPI && window.electronAPI.startWindowDrag) {
        window.electronAPI.startWindowDrag();
      }
    }
  });

  const targetWindow = typeof window !== "undefined" ? window : canvas;
  targetWindow.addEventListener("mouseup", () => {
    if (isDraggingWindow) {
      isDraggingWindow = false;
      canvas.style.cursor = "grab";
      if (window.electronAPI && window.electronAPI.endWindowDrag) {
        window.electronAPI.endWindowDrag();
      }
    }
  });

  // 5. Webcam (Olhos da Nexa) se disponível
  if (typeof initNexaWebcam === "function") {
    try {
      initNexaWebcam();
    } catch (_) {}
  }

  // 6. Sincroniza estado inicial com o processo Main
  if (window.electronAPI && window.electronAPI.getNexaState) {
    window.electronAPI.getNexaState().then((initialState) => {
      if (initialState && raphaelCore) {
        raphaelCore.setState(initialState);
        canvas.className = `raphael-canvas-glow ${initialState.toLowerCase()}`;
      }
    }).catch(() => {});
  }

  // 7. Loop de Renderização 60FPS
  function renderLoop(currentTime) {
    const deltaTime = Math.min(0.1, (currentTime - lastTime) / 1000.0);
    lastTime = currentTime;

    if (raphaelCore) {
      const currentState = raphaelCore.getCurrentState();

      // Gerenciador de AFK
      if (currentState === "IDLE") {
        sleepingTime += deltaTime;
        if (sleepingTime >= SLEEP_TIMEOUT) {
          if (!isSleeping) {
            isSleeping = true;
            raphaelCore.setState("SLEEPING");
            canvas.className = "raphael-canvas-glow sleeping";
          }
        }
      } else {
        if (isSleeping) isSleeping = false;
        sleepingTime = 0;
      }

      raphaelCore.update(deltaTime);
      raphaelCore.render(ctx, canvas.width, canvas.height);
    }

    requestAnimationFrame(renderLoop);
  }

  requestAnimationFrame(renderLoop);
});
