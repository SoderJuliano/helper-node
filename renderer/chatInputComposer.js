// renderer/chatInputComposer.js
// Token counter, shortcuts and hero suggestion chips for chat composer.
(function() {
  'use strict';

  const welcomeHero = document.getElementById('welcome-hero');
  const composerGhost = document.getElementById('composer-ghost');
  const composerShell = document.getElementById('composer-shell');
  const composerSendBtn = document.getElementById('composer-send');

  document.querySelectorAll('.hero-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const prompt = chip.dataset.prompt || '';
      if (typeof window.openManualInput === 'function') window.openManualInput(prompt);
      if (welcomeHero) welcomeHero.classList.add('hidden');
    });
  });

  if (composerGhost && composerShell) {
    composerShell.addEventListener('click', (e) => {
      if (e.target.closest('.composer-send')) return;
      if (window.manualInputActive || window.isEditingQuestion) return;
      if (typeof window.openManualInput === 'function') window.openManualInput();
    });
  }

  if (composerSendBtn) {
    composerSendBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.manualInputActive) {
        if (typeof window.openManualInput === 'function') window.openManualInput();
        return;
      }
      const input = document.querySelector('.manual-input-container .terminal-input');
      if (input) {
        const question = (input.value || '').trim();
        const container = input.closest('.manual-input-container');
        if ((question || window.pastedImageForManualInput) && container && typeof window.submitManualQuestion === 'function') {
          window.submitManualQuestion(question, container);
        }
      }
    });
  }

  if (composerGhost) {
    composerGhost.setAttribute('tabindex', '0');
    composerGhost.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openManualInput === 'function') {
          window.openManualInput(e.key.length === 1 && e.key !== ' ' ? e.key : '');
        }
      }
    });
    setTimeout(() => {
      try {
        composerGhost.focus({ preventScroll: true });
      } catch (_) {
        composerGhost.focus();
      }
    }, 20);
  }

  function handleCtrlI(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (typeof window.isChatCollapsed === 'function' && window.isChatCollapsed()) {
      if (typeof window.setChatCollapsed === 'function') {
        window.setChatCollapsed(false);
      }
    }

    const composer = document.getElementById('composer');
    if (composer && composer.classList.contains('collapsed')) {
      composer.classList.remove('collapsed');
      const toggleBtn = document.getElementById('composer-collapse-toggle');
      if (toggleBtn) {
        const svg = toggleBtn.querySelector('svg');
        if (svg) svg.style.transform = 'rotate(0deg)';
      }
    }

    const ghost = document.getElementById('composer-ghost');
    if (ghost) {
      ghost.setAttribute('tabindex', '0');
      setTimeout(() => {
        try {
          ghost.focus({ preventScroll: true });
        } catch (_) {
          ghost.focus();
        }
      }, 60);
    } else if (typeof window.openManualInput === 'function') {
      window.openManualInput();
    }
  }

  window.handleCtrlI = handleCtrlI;

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i' && !e.shiftKey && !e.altKey) {
      handleCtrlI(e);
    }
  });

  const tokenLabel = document.getElementById('composer-token-count');

  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  function formatCount(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function updateTokenLabel(text) {
    if (!tokenLabel) return;
    const t = estimateTokens(text);
    if (t === 0) {
      tokenLabel.textContent = '';
      tokenLabel.className = 'composer-token-count';
      return;
    }
    tokenLabel.textContent = formatCount(t) + ' tok';
    tokenLabel.className = 'composer-token-count' + (t > 4000 ? ' danger' : t > 2000 ? ' warn' : '');
  }

  window.updateTokenLabel = updateTokenLabel;
})();
