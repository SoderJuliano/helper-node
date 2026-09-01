// renderer/gitConflict/gitConflictModalEvents.js
// Vinculação de eventos para a janela modal de resolução de conflitos Git 3-way.

(function() {
  'use strict';

  let keydownHandler = null;

  function wireGitConflictEventListeners(modal, handlers) {
    if (!modal || !handlers) return;

    const {
      onClose, onAbort, onSave, onMagic, onAcceptAllLeft, onAcceptAllRight,
      onFileChange, onPrevFile, onNextFile, onPrevConflict, onNextConflict,
      onScroll
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

    const triggerClose = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (typeof onClose === 'function') onClose();
    };

    if (btnClose) {
      btnClose.onclick = triggerClose;
      btnClose.onmousedown = triggerClose;
    }

    modal.addEventListener('click', (e) => {
      if (e.target && (e.target.closest('#git-conflict-btn-close') || e.target.closest('.git-conflict-close-btn'))) {
        triggerClose(e);
      }
    });

    modal.addEventListener('mousedown', (e) => {
      if (e.target && (e.target.closest('#git-conflict-btn-close') || e.target.closest('.git-conflict-close-btn'))) {
        triggerClose(e);
      }
    });

    if (btnAbort && onAbort) {
      btnAbort.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAbort(); };
    }
    if (btnSave && onSave) {
      btnSave.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onSave(); };
    }
    if (btnMagic && onMagic) {
      btnMagic.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onMagic(); };
    }
    if (btnAcceptAllLeft && onAcceptAllLeft) {
      btnAcceptAllLeft.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAcceptAllLeft(); };
    }
    if (btnAcceptAllRight && onAcceptAllRight) {
      btnAcceptAllRight.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onAcceptAllRight(); };
    }

    if (fileSelect && onFileChange) {
      fileSelect.onchange = (e) => onFileChange(parseInt(e.target.value, 10) || 0);
    }
    if (btnPrev && onPrevFile) {
      btnPrev.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onPrevFile(); };
    }
    if (btnNext && onNextFile) {
      btnNext.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onNextFile(); };
    }
    if (btnPrevConflict && onPrevConflict) {
      btnPrevConflict.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onPrevConflict(); };
    }
    if (btnNextConflict && onNextConflict) {
      btnNextConflict.onclick = (e) => { e.preventDefault(); e.stopPropagation(); onNextConflict(); };
    }

    const leftBox = modal.querySelector('#git-conflict-left-container');
    const centerBox = modal.querySelector('#git-conflict-center-container');
    const rightBox = modal.querySelector('#git-conflict-right-container');

    if (onScroll) {
      if (leftBox) leftBox.onscroll = () => onScroll(leftBox);
      if (centerBox) centerBox.onscroll = () => onScroll(centerBox);
      if (rightBox) rightBox.onscroll = () => onScroll(rightBox);
    }

    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler, true);
    }

    keydownHandler = (e) => {
      const m = document.getElementById('git-conflict-modal');
      const isOpen = m && (m.classList.contains('is-open') || (m.style.display && m.style.display !== 'none'));
      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        triggerClose(e);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onSave === 'function') onSave();
      } else if (e.altKey && e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onNextConflict === 'function') onNextConflict();
      } else if (e.altKey && e.shiftKey && e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onPrevConflict === 'function') onPrevConflict();
      }
    };

    window.addEventListener('keydown', keydownHandler, true);
  }

  window.GitConflictModalEvents = {
    wireGitConflictEventListeners
  };
})();
