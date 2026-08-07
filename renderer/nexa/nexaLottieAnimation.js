/**
 * renderer/nexa/nexaLottieAnimation.js
 * Reprodutor de Animação Lottie em memória.
 * Renderiza no Canvas 2D da Nexa utilizando lottie-web (canvas renderer) e container DOM oculto.
 * Suporta taxas de reprodução (velocidade) e recortes de início/fim (trimming).
 */

class NexaLottieAnimation {
  constructor(options = {}) {
    this.animationPath = options.animationPath;
    this.loop = options.loop !== undefined ? !!options.loop : false;
    this.playbackRate = options.playbackRate !== undefined ? options.playbackRate : 1.0;
    this.trimStartMs = options.trimStartMs !== undefined ? options.trimStartMs : 0;
    this.introTrimEndMs = options.introTrimEndMs !== undefined ? options.introTrimEndMs : 0;

    this.isPlaying = false;
    this.finished = false;
    this.isLoading = false;
    this.canvas = null;
    this.anim = null;
  }

  init() {
    if (this.isLoading) return;
    this.isLoading = true;

    // Carrega o arquivo JSON da animação via IPC seguro
    if (window.electronAPI && window.electronAPI.nexaReadFile) {
      window.electronAPI.nexaReadFile(this.animationPath).then((res) => {
        if (res && res.ok) {
          try {
            const animationData = JSON.parse(res.content);

            const container = document.getElementById("lottieContainer");
            if (!container) {
              console.error("[NexaLottieAnimation] Elemento #lottieContainer não encontrado no DOM.");
              this.finished = true;
              this.isPlaying = false;
              return;
            }

            // Limpa qualquer canvas anterior do container para evitar vazamento
            container.innerHTML = "";

            // Extrai a pasta de assets (diretório pai do arquivo JSON de animação)
            // Ex: /path/to/lottie/idle_lottie/animations/main.json -> /path/to/lottie/idle_lottie/images/
            let assetsPath = "";
            const parts = this.animationPath.split("/");
            if (parts.length > 2) {
              assetsPath = parts.slice(0, -2).join("/") + "/images/";
            }
            if (!assetsPath.startsWith("file://")) {
              assetsPath = "file://" + assetsPath;
            }

            console.log("[NexaLottieAnimation] Inicializando lottie-web com assetsPath:", assetsPath);

            this.anim = lottie.loadAnimation({
              container: container,
              renderer: "canvas",
              loop: this.loop,
              autoplay: false, // Controlado manualmente via playSegmentOrFull
              animationData: animationData,
              assetsPath: assetsPath
            });

            // Lottie cria o canvas internamente dentro do container
            this.canvas = container.querySelector("canvas");

            this.anim.addEventListener("complete", () => {
              this.finished = true;
              this.isPlaying = false;
              console.log("[NexaLottieAnimation] Animação concluída.");
            });

            this.anim.addEventListener("DOMLoaded", () => {
              console.log("[NexaLottieAnimation] Metadados/assets carregados.");
              if (this.isPlaying) {
                this.playSegmentOrFull();
              }
            });

            // Se já foi iniciado o play antes do fim do carregamento síncrono, garante o início imediato
            if (this.isPlaying) {
              this.playSegmentOrFull();
            }

          } catch (err) {
            console.error("[NexaLottieAnimation] Falha ao analisar ou carregar Lottie:", err);
            this.finished = true;
            this.isPlaying = false;
          }
        } else {
          console.error("[NexaLottieAnimation] Erro do main process ao ler arquivo:", res.error);
          this.finished = true;
          this.isPlaying = false;
        }
      }).catch((err) => {
        console.error("[NexaLottieAnimation] Erro na requisição IPC:", err);
        this.finished = true;
        this.isPlaying = false;
      });
    } else {
      console.error("[NexaLottieAnimation] electronAPI.nexaReadFile não está disponível.");
      this.finished = true;
      this.isPlaying = false;
    }
  }

  playSegmentOrFull() {
    if (!this.anim) return;

    // Configura a velocidade de reprodução (playbackRate)
    this.anim.setSpeed(this.playbackRate);

    const frameRate = this.anim.frameRate || 24;
    const totalFrames = this.anim.totalFrames || this.anim.getDuration(true);

    if (this.trimStartMs > 0 || this.introTrimEndMs > 0) {
      const startFrame = Math.round((this.trimStartMs / 1000) * frameRate);
      const endFrame = Math.max(startFrame + 1, totalFrames - Math.round((this.introTrimEndMs / 1000) * frameRate));
      
      console.log(`[NexaLottieAnimation] Reproduzindo segmento [${startFrame}, ${endFrame}] a ${this.playbackRate}x de velocidade.`);
      this.anim.playSegments([startFrame, endFrame], true);
    } else {
      console.log(`[NexaLottieAnimation] Reproduzindo animação inteira a ${this.playbackRate}x de velocidade.`);
      this.anim.goToAndPlay(0, true);
    }
  }

  play() {
    this.isPlaying = true;
    this.finished = false;

    if (!this.anim) {
      this.init();
    } else {
      this.playSegmentOrFull();
    }
  }

  stop() {
    if (this.anim) {
      this.anim.stop();
    }
    this.isPlaying = false;
    this.finished = true;
    console.log("[NexaLottieAnimation] Animação parada.");
  }

  isFinished() {
    return this.finished;
  }

  update(deltaTime) {
    // Atualização de frames controlada internamente pelo lottie-web
  }

  render(ctx, canvasWidth, canvasHeight) {
    if (this.finished || !this.anim || !this.canvas) return;

    // Limpa o canvas principal para evitar o efeito fantasma (eco de braços/frames anteriores)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    ctx.save();

    // Detecta se a animação é horizontal (ex: deitada de lado)
    const isLandscape = this.animationPath.includes("sleeping") || (this.canvas.width > this.canvas.height);

    if (isLandscape) {
      // Redimensionamento responsivo preservando o aspect-ratio horizontal (Object Fit: Contain)
      const animRatio = this.canvas.width / this.canvas.height;
      const canvasRatio = canvasWidth / canvasHeight;
      let drawW, drawH;

      if (canvasRatio > animRatio) {
        drawH = canvasHeight;
        drawW = canvasHeight * animRatio;
      } else {
        drawW = canvasWidth;
        drawH = canvasWidth / animRatio;
      }

      const x = (canvasWidth - drawW) / 2;
      const y = (canvasHeight - drawH) / 2;

      ctx.drawImage(this.canvas, x, y, drawW, drawH);
    } else {
      // Calcula a escala exata baseada na escala do personagem (1280x1280)
      const charScale = Math.min(canvasWidth / 1280, canvasHeight / 1280);
      const charOffsetX = (canvasWidth - 1280 * charScale) / 2;
      const charOffsetY = (canvasHeight - 1280 * charScale) / 2;

      // Desenha o canvas processado utilizando o enquadramento exato e escala do personagem.
      // O frame Lottie é renderizado centralizado na proporção da Nexa.
      const exactX = charOffsetX + 280 * charScale;
      const exactY = charOffsetY;
      const exactW = 720 * charScale;
      const exactH = 1280 * charScale;
      
      ctx.drawImage(this.canvas, exactX, exactY, exactW, exactH);
    }
    ctx.restore();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaLottieAnimation };
}
