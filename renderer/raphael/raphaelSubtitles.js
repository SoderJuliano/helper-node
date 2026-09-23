// renderer/raphael/raphaelSubtitles.js
// Controlador de Legendas e Transcrição em Tempo Real do Raphael Core.
// Suporta streaming dinâmico frase-a-frase (subtitles), onde novas frases substituem as antigas,
// sem caixas, balões ou acúmulo excessivo de texto.

(function(root) {
  'use strict';

  class RaphaelSubtitles {
    constructor(options = {}) {
      this.containerId = options.containerId || 'raphaelSubtitleContainer';
      this.container = null;
      this.textEl = null;
      this.activeTimer = null;
      this.fadeTimer = null;
      this.lastRenderedPhrase = '';
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
        .replace(/```[\s\S]*?```/g, '')
        .replace(/[`*_~#]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    /**
     * Extrai a frase ativa mais recente para exibição como legenda dinâmica.
     * Conforme a fala avança e novas frases aparecem, as antigas deixam a tela.
     */
    _extractActivePhrase(fullText) {
      const clean = this._cleanText(fullText);
      if (!clean) return '';

      // Divide em sentenças por pontuação (. ! ? \n)
      const sentences = clean.split(/(?<=[.!?\n])\s+/).map(s => s.trim()).filter(Boolean);
      if (sentences.length === 0) return clean;

      let active = sentences[sentences.length - 1];

      // Se a última sentença ainda estiver muito longa (> 100 caracteres), quebra por vírgula ou cláusula
      if (active.length > 100) {
        const clauses = active.split(/(?<=[,;])\s+/).map(s => s.trim()).filter(Boolean);
        if (clauses.length > 1) {
          active = clauses[clauses.length - 1];
        }
        if (active.length > 100) {
          const words = active.split(/\s+/);
          active = words.slice(-14).join(' ');
        }
      }

      return active;
    }

    /**
     * Atualização em tempo real (Streaming) da fala da IA ou do usuário.
     * Exibe apenas a frase ativa no momento, substituindo frases anteriores suavemente.
     * @param {string} fullText Texto acumulado até o momento
     */
    updateStreaming(fullText) {
      if (!fullText) return;
      const phrase = this._extractActivePhrase(fullText);
      if (!phrase) return;

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

      if (this.textEl && this.lastRenderedPhrase !== phrase) {
        this.lastRenderedPhrase = phrase;
        this.textEl.textContent = phrase;
      }
    }

    /**
     * Finaliza a exibição da frase ao término do turno com fade-out suave após breve pausa.
     * @param {number} holdMs Tempo em milissegundos antes de desaparecer (padrão 3.5s)
     */
    finishStreaming(holdMs = 3500) {
      if (!this.container) return;
      if (this.activeTimer) clearTimeout(this.activeTimer);
      this.activeTimer = setTimeout(() => {
        this.hide();
      }, Math.max(2000, holdMs));
    }

    /**
     * Exibe uma frase ou texto estático pontual.
     * @param {string} text Texto a exibir
     * @param {number} durationMs Duração em ms
     */
    show(text, durationMs = 3500) {
      this.updateStreaming(text);
      this.finishStreaming(durationMs);
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
          this.lastRenderedPhrase = '';
        }
      }, 350);
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
      this.lastRenderedPhrase = '';
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

