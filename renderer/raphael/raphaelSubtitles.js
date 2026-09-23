// renderer/raphael/raphaelSubtitles.js
// Controlador de Legendas e Transcrição em Tempo Real do Raphael Core.
// Suporta streaming contínuo sem cortes ou spans deformados, com auto-scroll suave.

(function(root) {
  'use strict';

  class RaphaelSubtitles {
    constructor(options = {}) {
      this.containerId = options.containerId || 'raphaelSubtitleContainer';
      this.container = null;
      this.textEl = null;
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

      // Elemento de texto interno limpo
      let textEl = this.container.querySelector('.raphael-subtitle-content');
      if (!textEl) {
        this.container.innerHTML = '';
        textEl = document.createElement('div');
        textEl.className = 'raphael-subtitle-content';
        this.container.appendChild(textEl);
      }
      this.textEl = textEl;
    }

    _cleanText(raw) {
      if (!raw) return '';
      return String(raw)
        .replace(/<voice_summary>[\s\S]*?<\/voice_summary>/gi, '')
        .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/```[\s\S]*?```/g, ' [código omitido no HUD] ')
        .trim();
    }

    /**
     * Atualização em tempo real (Streaming) do texto acumulado do turno atual.
     * Não destrói nem limpa o DOM a cada delta, garantindo leitura contínua e sem piscamentos.
     * @param {string} fullText Texto completo acumulado até o momento
     */
    updateStreaming(fullText) {
      if (!this.container || !fullText) return;
      const clean = this._cleanText(fullText);
      if (!clean) return;

      this.initDom();
      if (this.activeTimer) {
        clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }

      this.container.classList.remove('fade-out');
      this.container.classList.add('visible');

      if (this.textEl) {
        this.textEl.textContent = clean;
      }

      // Auto-scroll suave para o final do texto
      this.container.scrollTop = this.container.scrollHeight;
    }

    /**
     * Finaliza o streaming do turno mantendo o texto visível por alguns segundos para leitura.
     * @param {number} holdMs Tempo em milissegundos antes de iniciar o fade-out
     */
    finishStreaming(holdMs = 7000) {
      if (!this.container) return;
      if (this.activeTimer) clearTimeout(this.activeTimer);
      this.activeTimer = setTimeout(() => {
        this.hide();
      }, Math.max(3000, holdMs));
    }

    /**
     * Exibe um texto estático completo (legado TTS ou notificação pontual).
     * @param {string} text Texto a exibir
     * @param {number} estimatedDurationMs Duração estimada em ms
     */
    show(text, estimatedDurationMs = 5000) {
      this.updateStreaming(text);
      this.finishStreaming(Math.max(5000, estimatedDurationMs + 2000));
    }

    /**
     * Oculta a legenda com transição suave de fade-out.
     */
    hide() {
      if (!this.container) return;
      this.container.classList.add('fade-out');
      if (this.fadeTimer) clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => {
        if (this.container) {
          this.container.classList.remove('visible', 'fade-out');
          if (this.textEl) this.textEl.textContent = '';
        }
      }, 400);
    }

    /**
     * Limpa imediatamente o container (usado em Barge-In / Interrupções).
     */
    clear() {
      if (this.activeTimer) {
        clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      if (this.fadeTimer) {
        clearTimeout(this.fadeTimer);
        this.fadeTimer = null;
      }
      if (this.container) {
        this.container.classList.remove('visible', 'fade-out');
        if (this.textEl) this.textEl.textContent = '';
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
