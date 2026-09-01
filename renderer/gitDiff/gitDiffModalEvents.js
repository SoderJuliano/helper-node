// renderer/gitDiff/gitDiffModalEvents.js
// Vinculação de eventos, scroll sincronizado e interações de teclado do visualizador de Diff.

(function() {
  'use strict';

  function wireGitDiffEventListeners(container, handlers) {
    if (!container || !handlers) return;

    const closeBtn = container.querySelector('#git-diff-close-btn');
    const refreshBtn = container.querySelector('#git-diff-refresh-btn');
    const searchInput = container.querySelector('#git-diff-search-input');
    const copyPathBtn = container.querySelector('#git-diff-copy-path-btn');
    const copyCodeBtn = container.querySelector('#git-diff-copy-code-btn');

    const leftScroll = container.querySelector('#git-diff-pane-left-scroll');
    const rightScroll = container.querySelector('#git-diff-pane-right-scroll');

    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof handlers.onClose === 'function') handlers.onClose();
      };
    }

    if (refreshBtn) {
      refreshBtn.onclick = (e) => {
        e.stopPropagation();
        if (typeof handlers.onRefresh === 'function') handlers.onRefresh();
      };
    }

    if (searchInput) {
      searchInput.oninput = () => {
        const query = searchInput.value.toLowerCase().trim();
        const items = container.querySelectorAll('.git-diff-file-item');
        items.forEach(item => {
          const name = (item.dataset.fileName || '').toLowerCase();
          const path = (item.dataset.relPath || '').toLowerCase();
          if (!query || name.includes(query) || path.includes(query)) {
            item.style.display = 'flex';
          } else {
            item.style.display = 'none';
          }
        });
      };
    }

    if (copyPathBtn) {
      copyPathBtn.onclick = () => {
        if (typeof handlers.onCopyPath === 'function') handlers.onCopyPath();
      };
    }

    if (copyCodeBtn) {
      copyCodeBtn.onclick = () => {
        if (typeof handlers.onCopyCode === 'function') handlers.onCopyCode();
      };
    }

    // Scroll Sincronizado Suave e Bidirecional
    let isSyncing = false;

    const syncScroll = (source, target) => {
      if (isSyncing || !source || !target) return;
      isSyncing = true;
      target.scrollTop = source.scrollTop;
      target.scrollLeft = source.scrollLeft;
      requestAnimationFrame(() => {
        isSyncing = false;
      });
    };

    if (leftScroll && rightScroll) {
      leftScroll.onscroll = () => syncScroll(leftScroll, rightScroll);
      rightScroll.onscroll = () => syncScroll(rightScroll, leftScroll);
    }

    // Atalho ESC para fechar
    const onKeyDown = (ev) => {
      if (container.style.display !== 'none' && ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof handlers.onClose === 'function') handlers.onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
  }

  window.GitDiffModalEvents = {
    wireGitDiffEventListeners
  };
})();
