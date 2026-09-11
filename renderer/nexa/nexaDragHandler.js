/**
 * renderer/nexa/nexaDragHandler.js
 * Gerenciador de arraste da janela da Nexa com protecao contra interrupcao de estados ativos (THINKING, WORKING, SPEAKING, LISTENING)
 * e selecao probabilistica de animacao de arraste (90% se equilibrando / 10% flutuando com pouso).
 */

class NexaDragHandler {
  constructor({ canvas, animController, getCurrentAnimation, setCurrentAnimation, getIsSleeping, randomProvider }) {
    this.canvas = canvas;
    this.animController = animController;
    this.getCurrentAnimation = getCurrentAnimation;
    this.setCurrentAnimation = setCurrentAnimation;
    this.getIsSleeping = getIsSleeping;
    this.randomProvider = randomProvider || Math.random;
    this.isDraggingWindow = false;

    this._bindEvents();
  }

  isBusyWorkingState() {
    const currentState = this.animController ? this.animController.getCurrentState() : 'IDLE';
    if (
      currentState === 'THINKING' ||
      currentState === 'WORKING' ||
      currentState === 'SPEAKING' ||
      currentState === 'LISTENING' ||
      currentState === 'SEARCHING'
    ) {
      return true;
    }
    const curAnim = this.getCurrentAnimation ? this.getCurrentAnimation() : null;
    if (curAnim && curAnim.isPlaying) {
      const animPath = (curAnim.animationPath || curAnim.videoPath || '').toLowerCase();
      if (
        animPath.includes('thinking') ||
        animPath.includes('typing') ||
        animPath.includes('writing') ||
        animPath.includes('tesseract') ||
        animPath.includes('cube') ||
        animPath.includes('speaking') ||
        animPath.includes('listening') ||
        animPath.includes('globe')
      ) {
        return true;
      }
    }
    return false;
  }

  getDragAnimation() {
    // 90% de chance para a nova animação de se equilibrar, 10% para a animação antiga de flutuar
    const rand = this.randomProvider();
    if (rand < 0.90) {
      return {
        path: 'renderer/nexa/assets/lottie/balancing_lottie/animations/main.json',
        type: 'balancing'
      };
    } else {
      return {
        path: 'renderer/nexa/assets/lottie/floating_lottie/animations/main.json',
        type: 'floating'
      };
    }
  }

  _bindEvents() {
    if (!this.canvas) return;

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.isDraggingWindow = true;
        this.canvas.style.cursor = 'grabbing';

        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.startWindowDrag) {
          window.electronAPI.startWindowDrag();
        }

        if (this.getIsSleeping && this.getIsSleeping()) {
          console.log('[NexaDragHandler] Janela arrastada enquanto dorme. Mantendo sono.');
          return;
        }

        if (this.isBusyWorkingState()) {
          console.log('[NexaDragHandler] Janela arrastada durante atividade (pensando/trabalhando/falando). Mantendo animacao ininterrupta.');
          return;
        }

        const curAnim = this.getCurrentAnimation ? this.getCurrentAnimation() : null;
        if (curAnim && curAnim.isPlaying) {
          curAnim.stop();
        }

        const animChoice = this.getDragAnimation();
        console.log(`[NexaDragHandler] Arrastando em idle. Iniciando animacao de ${animChoice.type === 'balancing' ? 'equilibrio (nova, 90%)' : 'flutuacao (antiga, 10%)'}.`);

        if (typeof NexaLottieAnimation !== 'undefined') {
          const dragAnim = new NexaLottieAnimation({
            animationPath: animChoice.path,
            loop: true
          });
          this.setCurrentAnimation(dragAnim);
          dragAnim.play();
        }
      }
    });

    const targetWindow = typeof window !== 'undefined' ? window : this.canvas;
    targetWindow.addEventListener('mouseup', () => {
      if (this.isDraggingWindow) {
        this.isDraggingWindow = false;
        this.canvas.style.cursor = 'grab';

        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.endWindowDrag) {
          window.electronAPI.endWindowDrag();
        }

        if (this.getIsSleeping && this.getIsSleeping()) {
          console.log('[NexaDragHandler] Janela solta enquanto dorme. Mantendo sono.');
          return;
        }

        if (this.isBusyWorkingState()) {
          console.log('[NexaDragHandler] Janela solta durante atividade. Mantendo animacao ativa ininterrupta.');
          return;
        }

        const curAnim = this.getCurrentAnimation ? this.getCurrentAnimation() : null;
        if (!curAnim || !curAnim.isPlaying) return;

        const animPath = (curAnim.animationPath || curAnim.videoPath || '').toLowerCase();

        // Se estiver reproduzindo a nova animação de se equilibrar (balancing), não precisa de animação de pouso (landing)
        if (animPath.includes('balancing') || animPath.includes('balance')) {
          console.log('[NexaDragHandler] Soltou janela (animacao nova de equilibrio). Retornando diretamente ao repouso sem pouso.');
          curAnim.stop();
          this.setCurrentAnimation(null);
          return;
        }

        // Se for a animação antiga de flutuar (floating), executa a animação de pouso (landing)
        if (!animPath.includes('floating')) return;

        const landingLottiePath = 'renderer/nexa/assets/lottie/landing_lottie/animations/main.json';
        console.log('[NexaDragHandler] Soltou janela (animacao antiga de flutuacao). Iniciando pouso...');

        if (typeof NexaLottieAnimation === 'undefined') return;

        const landingAnim = new NexaLottieAnimation({
          animationPath: landingLottiePath,
          introTrimEndMs: 350,
          loop: false,
          playbackRate: 1.5,
          trimStartMs: 150
        });
        landingAnim.play();

        const oldAnim = curAnim;
        const checkReadyInterval = setInterval(() => {
          if (landingAnim.canvas) {
            clearInterval(checkReadyInterval);
            if (oldAnim && oldAnim.isPlaying && oldAnim !== landingAnim) {
              oldAnim.stop();
            }
            if (this.getCurrentAnimation() === oldAnim) {
              this.setCurrentAnimation(landingAnim);
              console.log('[NexaDragHandler] Animacao de pouso pronta. Trocando de flutuacao para pouso.');
            }
          }
        }, 16);

        setTimeout(() => {
          clearInterval(checkReadyInterval);
          if (this.getCurrentAnimation() === oldAnim) {
            if (oldAnim && oldAnim.isPlaying) oldAnim.stop();
            this.setCurrentAnimation(landingAnim);
          }
        }, 500);
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NexaDragHandler };
} else {
  window.NexaDragHandler = NexaDragHandler;
}

