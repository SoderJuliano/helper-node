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
    canvas.width = 360;
    canvas.height = 360;
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

  // 3. Reprodução de Áudio TTS e Sincronização Espectral
  let currentAudio = null;
  let lastAudioBase64 = null;
  let lastAudioPlayTime = 0;

  function stopTtsAudio() {
    if (currentAudio) {
      try {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      } catch (_) {}
      currentAudio = null;
    }
    if (typeof pcmPlayer !== "undefined" && pcmPlayer) {
      pcmPlayer.stop();
    }
    if (raphaelSubtitles) {
      raphaelSubtitles.hide();
    }
    if (raphaelCore) {
      raphaelCore.setState("IDLE");
      canvas.className = "raphael-canvas-glow idle";
    }
  }

  // Player de Áudio Streaming em tempo real para o Gemini Multimodal Live (Web Audio API)
  class PcmStreamPlayer {
    constructor() {
      this.audioCtx = null;
      this.nextStartTime = 0;
      this.activeSources = new Set();
      this.analyser = null;
    }

    _ensureContext() {
      if (!this.audioCtx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioCtx({ sampleRate: 24000 });
      }
      if (this.audioCtx.state === "suspended") {
        this.audioCtx.resume().catch(() => {});
      }
      if (!this.analyser && raphaelCore && raphaelCore.audioVisualizer) {
        raphaelCore.audioVisualizer.initContext();
        this.analyser = raphaelCore.audioVisualizer.analyser;
      }
    }

    playChunk(pcmBase64, sampleRate = 24000) {
      if (!pcmBase64) return;
      this._ensureContext();

      try {
        const binaryStr = atob(pcmBase64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const int16Samples = new Int16Array(bytes.buffer);
        const numSamples = int16Samples.length;
        if (numSamples === 0) return;

        const buffer = this.audioCtx.createBuffer(1, numSamples, sampleRate);
        const channelData = buffer.getChannelData(0);
        for (let i = 0; i < numSamples; i++) {
          channelData[i] = int16Samples[i] / 32768.0;
        }

        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;

        if (this.analyser) {
          source.connect(this.analyser);
          this.analyser.connect(this.audioCtx.destination);
        } else {
          source.connect(this.audioCtx.destination);
        }

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
      stopTtsAudio();
    });
  }

  if (window.electronAPI && window.electronAPI.onGeminiLiveTranscript) {
    window.electronAPI.onGeminiLiveTranscript((data) => {
      const text = data && data.text ? data.text : data;
      if (raphaelSubtitles && text) {
        raphaelSubtitles.show(text, 4000);
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onStopTtsAudio) {
    window.electronAPI.onStopTtsAudio(() => {
      console.log("[NexaRenderer] Parando áudio TTS imediatamente (Barge-in).");
      pcmPlayer.stop();
      stopTtsAudio();
    });
  }

  function playTtsAudio(payload) {
    let base64Data = payload;
    let spokenText = null;

    if (payload && typeof payload === "object") {
      base64Data = payload.audioBase64 || payload.audio;
      spokenText = payload.text || payload.response || payload.displayText || null;
    }

    if (!base64Data) return;

    const now = Date.now();
    if (lastAudioBase64 === base64Data && (now - lastAudioPlayTime < 1000)) {
      return; // Debounce de repetição
    }
    lastAudioBase64 = base64Data;
    lastAudioPlayTime = now;

    stopTtsAudio();

    try {
      const audioUrl = `data:audio/mp3;base64,${base64Data}`;
      currentAudio = new Audio(audioUrl);
      currentAudio.volume = 1.0;

      if (raphaelCore) {
        raphaelCore.connectAudioElement(currentAudio);
        raphaelCore.setState("SPEAKING");
        canvas.className = "raphael-canvas-glow speaking";
      }

      if (raphaelSubtitles && spokenText) {
        raphaelSubtitles.show(spokenText, 6000);
      }

      const handleAudioEnd = () => {
        if (raphaelCore) {
          raphaelCore.setState("IDLE");
          canvas.className = "raphael-canvas-glow idle";
        }
        if (raphaelSubtitles) {
          raphaelSubtitles.hide();
        }
        if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
          window.electronAPI.sendNexaTtsEnded();
        }
      };

      currentAudio.onended = handleAudioEnd;
      currentAudio.onerror = (err) => {
        console.warn("[NexaRenderer] Erro na reprodução de áudio:", err);
        handleAudioEnd();
      };

      currentAudio.play().catch((err) => {
        console.warn("[NexaRenderer] Falha ao iniciar reprodução:", err);
        handleAudioEnd();
      });
    } catch (err) {
      console.error("[NexaRenderer] Exceção ao preparar áudio:", err);
      if (raphaelCore) raphaelCore.setState("IDLE");
      if (window.electronAPI && window.electronAPI.sendNexaTtsEnded) {
        window.electronAPI.sendNexaTtsEnded();
      }
    }
  }

  if (window.electronAPI && window.electronAPI.onPlayTtsAudio) {
    window.electronAPI.onPlayTtsAudio((payload) => {
      playTtsAudio(payload);
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
