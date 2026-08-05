/**
 * renderer/nexa/nexaIntroAnimation.js
 * Reprodutor de Animação de Entrada baseado em Vídeo HTML5 em memória.
 * Renderiza no MESMO Canvas 2D da Nexa com remoção de fundo laranja (Chroma Key).
 */

class NexaIntroAnimation {
  constructor(options = {}) {
    this.video = null;
    this.isPlaying = false;
    this.finished = false;
    this.videoPath = options.videoPath || "/home/soder/Documents/nexa-workspace/animacoes_google_flow/White-haired_girl_waving_202608051124.mp4";
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.introTrimEndMs = options.introTrimEndMs !== undefined ? options.introTrimEndMs : 100;
  }

  init() {
    this.video = document.createElement("video");
    this.video.src = `file://${this.videoPath}`;
    this.video.muted = true;
    this.video.autoplay = false;
    this.video.loop = false;
    this.video.setAttribute("playsinline", "");
    this.video.setAttribute("webkit-playsinline", "");

    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCtx = this.offscreenCanvas.getContext("2d", { willReadFrequently: true });

    this.video.onended = () => {
      this.finished = true;
      this.isPlaying = false;
      console.log("[NexaIntroAnimation] Animação de entrada concluída.");
    };

    this.video.onerror = (err) => {
      console.error("[NexaIntroAnimation] Erro ao carregar o vídeo:", err);
      this.finished = true;
      this.isPlaying = false;
    };
  }

  play() {
    if (!this.video) {
      this.init();
    }
    try {
      this.video.currentTime = 0;
    } catch (_) {}
    this.video.play().then(() => {
      this.isPlaying = true;
      this.finished = false;
      console.log("[NexaIntroAnimation] Reproduzindo vídeo:", this.videoPath);
    }).catch((err) => {
      console.error("[NexaIntroAnimation] Falha ao iniciar reprodução:", err);
      this.finished = true;
      this.isPlaying = false;
    });
  }

  stop() {
    if (this.video) {
      this.video.pause();
    }
    this.isPlaying = false;
    this.finished = true;
  }

  isFinished() {
    if (this.finished) return true;
    if (this.video) {
      if (this.video.ended) {
        this.finished = true;
        this.isPlaying = false;
        return true;
      }
      const duration = this.video.duration || 0;
      const currentTime = this.video.currentTime || 0;
      const trimSeconds = this.introTrimEndMs / 1000.0;
      if (duration > 0 && currentTime >= duration - trimSeconds) {
        this.finished = true;
        this.isPlaying = false;
        return true;
      }
    }
    return this.finished;
  }

  update(deltaTime) {
    // A atualização do frame é feita nativamente pelo elemento de vídeo
  }

  render(ctx, canvasWidth, canvasHeight) {
    if (this.finished || !this.video || !this.offscreenCtx) return;

    // Limpa o canvas principal para evitar o efeito fantasma (eco de braços)
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const vidW = this.video.videoWidth || 720;
    const vidH = this.video.videoHeight || 1280;

    // Calcula a escala exata baseada na escala do personagem (1280x1280)
    const charScale = Math.min(canvasWidth / 1280, canvasHeight / 1280);
    const charOffsetX = (canvasWidth - 1280 * charScale) / 2;
    const charOffsetY = (canvasHeight - 1280 * charScale) / 2;

    // Dimensões do canvas offscreen arredondadas para inteiros para a filtragem Chroma Key
    const drawW = Math.round(vidW * charScale);
    const drawH = Math.round(vidH * charScale);

    if (drawW <= 0 || drawH <= 0) return;

    // Redimensiona o canvas offscreen para processar o menor número de pixels possível
    this.offscreenCanvas.width = drawW;
    this.offscreenCanvas.height = drawH;

    try {
      this.offscreenCtx.drawImage(this.video, 0, 0, drawW, drawH);
    } catch (e) {
      return; // O vídeo pode não estar pronto para o primeiro frame
    }

    const imgData = this.offscreenCtx.getImageData(0, 0, drawW, drawH);
    const data = imgData.data;
    let transparentCount = 0;
    const totalPixels = data.length / 4;

    // Chroma Key para remover o fundo laranja (#FD7800 / R:253, G:120, B:0)
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];

      // Distância euclidiana para a cor de fundo laranja
      const dr = r - 253;
      const dg = g - 120;
      const db = b;
      const dist = Math.sqrt(dr*dr + dg*dg + db*db);

      // Se estiver próximo do laranja, remove (alpha = 0)
      if (dist < 125) {
        data[i+3] = 0;
        transparentCount++;
      }
    }

    // Se o frame tiver menos de 15% de pixels laranjas (transparentes),
    // significa que é um frame corrompido/glitch do decodificador ou frame vazio.
    // Nesse caso, encerramos a animação de entrada de forma imediata e limpa.
    if (transparentCount < totalPixels * 0.15) {
      this.finished = true;
      this.isPlaying = false;
      return;
    }

    this.offscreenCtx.putImageData(imgData, 0, 0);

    ctx.save();
    // Desenha o canvas processado utilizando o enquadramento exato e escala float do personagem
    const exactX = charOffsetX + 280 * charScale;
    const exactY = charOffsetY;
    const exactW = 720 * charScale;
    const exactH = 1280 * charScale;
    ctx.drawImage(this.offscreenCanvas, exactX, exactY, exactW, exactH);
    ctx.restore();
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { NexaIntroAnimation };
}
