// renderer/gitConflict/gitConflictModalEvents.js
// Event listeners for Git Conflict modal.
(function() {
  'use strict';

  function wireGitConflictEventListeners(modal, handlers) {
    const {
      onClose, onAbort, onSave, onMagic, onAcceptAllLeft, onAcceptAllRight,
      onFileChange, onPrevFile, onNextFile, onPrevConflict, onNextConflict,
      onScroll, onResize,
    } = handlers;

    const btnClose = modal.querySelector('#git-conflict-btn-close');
    const btnAbort = modal.querySelector('#git-conflict-btn-abort');
    const btnSave = modal.querySelector('#git-conflict-btn-save');
    const btnMagic = modal.querySelector('#git-conflict-btn-magic');
    const btnAcceptAllLeft = modal.querySelector('#git-conflict-btn-accept-all-left');
    const btnAcceptAllRight = modal.querySelector('#git-conflict-btn-accept-all-right');
    const fileSelect = modal.querySelector('#git-conflict-file-select');
    const btnPrev = modal.querySelector('#git-conflict-btn-prev');
    const btnNext = modal.querySelector('#git-conflict-btn-next');
    const btnPrevConflict = modal.querySelector('#git-conflict-btn-prev-conflict');
    const btnNextConflict = modal.querySelector('#git-conflict-btn-next-conflict');
    const btnWinMin = modal.querySelector('#git-conflict-win-min');
    const btnWinMax = modal.querySelector('#git-conflict-win-max');

    if (btnWinMin) {
      btnWinMin.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.minimizeWindow) window.electronAPI.minimizeWindow();
      };
    }

    if (btnWinMax) {
      btnWinMax.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.electronAPI && window.electronAPI.maximizeWindow) window.electronAPI.maximizeWindow();
      };
    }

    window.addEventListener('keydown', (e) => {
      const m = document.getElementById('git-conflict-modal');
      if (!m || m.style.display === 'none') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (onClose) onClose();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (onSave) onSave();
      }
    });

    if (btnClose && onClose) btnClose.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onClose(); };
    if (btnAbort && onAbort) btnAbort.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAbort(); };
    if (btnSave && onSave) btnSave.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSave(); };
    if (btnMagic && onMagic) btnMagic.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onMagic(); };
    if (btnAcceptAllLeft && onAcceptAllLeft) btnAcceptAllLeft.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAcceptAllLeft(); };
    if (btnAcceptAllRight && onAcceptAllRight) btnAcceptAllRight.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAcceptAllRight(); };

    if (fileSelect && onFileChange) fileSelect.onchange = (e) => onFileChange(parseInt(e.target.value, 10) || 0);
    if (btnPrev && onPrevFile) btnPrev.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onPrevFile(); };
    if (btnNext && onNextFile) btnNext.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onNextFile(); };
    if (btnPrevConflict && onPrevConflict) btnPrevConflict.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onPrevConflict(); };
    if (btnNextConflict && onNextConflict) btnNextConflict.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onNextConflict(); };

    const leftBox = modal.querySelector('#git-conflict-left-container');
    const rightBox = modal.querySelector('#git-conflict-right-container');

    if (onScroll) {
      leftBox.addEventListener('scroll', () => onScroll(leftBox), { passive: true });
      rightBox.addEventListener('scroll', () => onScroll(rightBox), { passive: true });
    }

    if (onResize) {
      window.addEventListener('resize', onResize);
    }
  }

  window.GitConflictModalEvents = {
    wireGitConflictEventListeners,
  };
})();
