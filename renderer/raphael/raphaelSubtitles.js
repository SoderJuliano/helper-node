// renderer/raphael/raphaelSubtitles.js
// Controlador de Legendas Holograficas com Efeito Cinético (Quantum Cascade Drop)
// para o orbe/bolinha do Raphael Core.

(function(root) {
  'use strict';

  class RaphaelSubtitles {
    constructor(options = {}) {
      this.containerId = options.containerId || 'raphaelSubtitleContainer';
      this.container = null;
      this.activeTimer = null;
      this.fadeTimer = null;
      this.initDom();
    }

    initDom() {
      if (typeof document === 'undefined') return;
      let existing = document.getElementById(this.containerId);
      if (!existing) {
        existing = document.createElement('div');
        existing.id = this.containerId;
        existing.className = 'raphael-subtitle-hud';
        document.body.appendChild(existing);
      }
      this.container = existing;
    }

    /**
     * Exibe o texto falado com animacao de cascata cinetica suave de palavras.
     * @param {string} text Texto falado pelo assistente
     * @param {number} estimatedDurationMs Duracao estimada do audio em ms
     */
    show(text, estimatedDurationMs = 5000) {
      if (!this.container || !text) return;

      this.clear();

      // Limpa tags HTML se houver
      const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!cleanText) return;

      const words = cleanText.split(' ');
      this.container.innerHTML = '';
      this.container.classList.remove('fade-out');
      this.container.classList.add('visible');

      const wrapper = document.createElement('div');
      wrapper.className = 'raphael-words-wrapper';

      // Ajuste responsivo de tamanho de fonte baseado no comprimento do texto
      if (cleanText.length > 180) {
        wrapper.style.fontSize = '10.5px';
        wrapper.style.lineHeight = '1.34';
      } else if (cleanText.length > 110) {
        wrapper.style.fontSize = '11px';
        wrapper.style.lineHeight = '1.38';
      } else {
        wrapper.style.fontSize = '12px';
        wrapper.style.lineHeight = '1.45';
      }

      const totalWords = words.length;
      const pacingMs = Math.min(220, Math.max(80, Math.floor(estimatedDurationMs / (totalWords || 1))));

      words.forEach((word, index) => {
        const span = document.createElement('span');
        span.className = 'raphael-word-drop';
        span.textContent = word + ' ';
        const delay = index * pacingMs;
        span.style.animationDelay = `${delay}ms`;
        wrapper.appendChild(span);

        // Acompanha a leitura rolando o container suavemente para baixo
        setTimeout(() => {
          if (this.container) {
            this.container.scrollTop = this.container.scrollHeight;
          }
        }, delay + 40);
      });

      this.container.appendChild(wrapper);

      // Auto-oculta suavemente apos o tempo de fala estimado com margem de leitura
      const holdTime = Math.max(5500, estimatedDurationMs + 2500);
      this.activeTimer = setTimeout(() => {
        this.hide();
      }, holdTime);
    }

    /**
     * Oculta a legenda com transicao suave de fade-out.
     */
    hide() {
      if (!this.container) return;
      this.container.classList.add('fade-out');
      if (this.fadeTimer) clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => {
        if (this.container) {
          this.container.classList.remove('visible', 'fade-out');
          this.container.innerHTML = '';
        }
      }, 500);
    }

    clear() {
      if (this.activeTimer) clearTimeout(this.activeTimer);
      if (this.fadeTimer) clearTimeout(this.fadeTimer);
      if (this.container) {
        this.container.classList.remove('visible', 'fade-out');
        this.container.innerHTML = '';
      }
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RaphaelSubtitles };
  }
  if (root) {
    root.RaphaelSubtitles = RaphaelSubtitles;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
