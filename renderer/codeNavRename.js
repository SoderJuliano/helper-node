// renderer/codeNavRename.js
// Funcionalidade de renomeação em tempo real (In-place & Project-wide).
(function () {
  'use strict';

  let activeRenameState = null;

  function removeActiveRename() {
    if (activeRenameState) {
      if (activeRenameState.cleanup) {
        activeRenameState.cleanup();
      }
      activeRenameState = null;
    }
  }

  function findSymbolOccurrencesInCm(cm, symbol) {
    if (!cm || !symbol) return [];
    const occurrences = [];
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    const lineCount = cm.lineCount();

    for (let i = 0; i < lineCount; i++) {
      const lineText = cm.getLine(i);
      if (!lineText) continue;
      let match;
      while ((match = regex.exec(lineText)) !== null) {
        occurrences.push({
          line: i,
          chStart: match.index,
          chEnd: match.index + symbol.length
        });
      }
    }
    return occurrences;
  }

  async function updateProjectUsages(originalSymbol, finalName, projectUsages, currentFile) {
    if (!Array.isArray(projectUsages) || projectUsages.length === 0) return;
    const normCurrent = (currentFile || '').replace(/\\/g, '/').toLowerCase();

    const usagesByFile = new Map();
    for (const u of projectUsages) {
      if (!u.filePath) continue;
      const normPath = u.filePath.replace(/\\/g, '/');
      if (normPath.toLowerCase() === normCurrent) continue;
      if (!usagesByFile.has(normPath)) {
        usagesByFile.set(normPath, u.filePath);
      }
    }

    const escaped = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');

    for (const [normPath, rawPath] of usagesByFile.entries()) {
      try {
        if (window.electronAPI && window.electronAPI.readFileContent && window.electronAPI.editorSaveFile) {
          const res = await window.electronAPI.readFileContent(rawPath);
          if (res && typeof res.content === 'string') {
            if (regex.test(res.content)) {
              const updatedContent = res.content.replace(regex, finalName);
              await window.electronAPI.editorSaveFile({ filePath: rawPath, content: updatedContent });
            }
          }
        }
      } catch (err) {
        console.warn(`[codeNavigation] Erro ao renomear em ${rawPath}:`, err);
      }
    }
  }

  function startRenameMethod(cm, filePath, originalSymbol, clickPos) {
    removeActiveRename();
    if (window.CodeNavUsagesPopup) {
      window.CodeNavUsagesPopup.removeActiveUsagesPopup();
      window.CodeNavUsagesPopup.removeActiveDefinitionPopup();
    }

    const originalDocContent = cm.getValue();
    const localOccurrences = findSymbolOccurrencesInCm(cm, originalSymbol);

    let projectUsages = [];
    if (window.electronAPI && window.electronAPI.codeNavFindUsages) {
      window.electronAPI.codeNavFindUsages({ filePath, symbol: originalSymbol }).then(u => {
        if (Array.isArray(u)) projectUsages = u;
      }).catch(() => {});
    }

    let renameMarkers = [];
    function updateRedHighlights(symbolToHighlight) {
      renameMarkers.forEach(m => m.clear());
      renameMarkers = [];
      if (!symbolToHighlight) return;
      const occs = findSymbolOccurrencesInCm(cm, symbolToHighlight);
      for (const occ of occs) {
        const marker = cm.markText(
          { line: occ.line, ch: occ.chStart },
          { line: occ.line, ch: occ.chEnd },
          { className: 'cm-rename-highlight-red' }
        );
        renameMarkers.push(marker);
      }
    }

    updateRedHighlights(originalSymbol);

    const banner = document.createElement('div');
    banner.className = 'code-rename-banner';

    const header = document.createElement('div');
    header.className = 'code-rename-header';

    const warningSpan = document.createElement('span');
    warningSpan.className = 'code-rename-warning-span';
    warningSpan.innerHTML = `<span>Renomeando método <strong>'${originalSymbol}'</strong> (${localOccurrences.length} uso${localOccurrences.length !== 1 ? 's' : ''})</span>`;

    const timerSpan = document.createElement('span');
    timerSpan.className = 'code-rename-timer';
    timerSpan.textContent = 'Auto-confirma em 10s';

    header.appendChild(warningSpan);
    header.appendChild(timerSpan);
    banner.appendChild(header);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'code-rename-input-wrapper';

    const renameInput = document.createElement('input');
    renameInput.type = 'text';
    renameInput.className = 'code-rename-input';
    renameInput.value = originalSymbol;

    inputWrapper.appendChild(renameInput);
    banner.appendChild(inputWrapper);

    const hintsRow = document.createElement('div');
    hintsRow.className = 'code-rename-hints';
    hintsRow.innerHTML = `<span><span class="code-rename-hint-key">Enter</span> confirmar</span> <span><span class="code-rename-hint-key">Esc</span> cancelar</span> <span>10s inativo (>1 char): auto-confirma</span>`;
    banner.appendChild(hintsRow);

    const wrapper = cm.getWrapperElement();
    wrapper.appendChild(banner);

    renameInput.focus();
    renameInput.select();

    let autoConfirmTimer = null;
    let countdownInterval = null;
    let remainingSeconds = 10;

    function resetTimer() {
      clearTimeout(autoConfirmTimer);
      clearInterval(countdownInterval);
      remainingSeconds = 10;
      timerSpan.textContent = `Auto-confirma em ${remainingSeconds}s`;

      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds >= 0) {
          timerSpan.textContent = `Auto-confirma em ${remainingSeconds}s`;
        }
      }, 1000);

      autoConfirmTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        const val = renameInput.value.trim();
        if (val.length > 1 && val !== originalSymbol) {
          confirmRename(val);
        }
      }, 10000);
    }

    resetTimer();

    renameInput.addEventListener('input', () => {
      const newName = renameInput.value.trim();
      if (newName && newName !== originalSymbol) {
        const escaped = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'g');
        const updatedDocContent = originalDocContent.replace(regex, newName);

        const cursor = cm.getCursor();
        cm.setValue(updatedDocContent);
        cm.setCursor(cursor);
        updateRedHighlights(newName);
      } else if (!newName || newName === originalSymbol) {
        const cursor = cm.getCursor();
        cm.setValue(originalDocContent);
        cm.setCursor(cursor);
        updateRedHighlights(originalSymbol);
      }
      resetTimer();
    });

    function confirmRename(finalName) {
      const isConfirmed = finalName && finalName.length > 1 && finalName !== originalSymbol;
      cleanup();
      if (isConfirmed) {
        const escaped = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'g');
        const updatedDocContent = originalDocContent.replace(regex, finalName);
        cm.setValue(updatedDocContent);

        if (projectUsages && projectUsages.length > 0) {
          updateProjectUsages(originalSymbol, finalName, projectUsages, filePath);
        }

        if (window.EditorController && window.EditorController.markDirty) {
          window.EditorController.markDirty(filePath);
        }
      } else {
        cm.setValue(originalDocContent);
      }
    }

    function cancelRename() {
      cleanup();
      cm.setValue(originalDocContent);
    }

    function cleanup() {
      clearTimeout(autoConfirmTimer);
      clearInterval(countdownInterval);
      renameMarkers.forEach(m => m.clear());
      renameMarkers = [];
      if (banner && banner.parentNode) {
        banner.remove();
      }
      document.removeEventListener('keydown', globalKeyListener, true);
      activeRenameState = null;
    }

    const globalKeyListener = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmRename(renameInput.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    };

    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmRename(renameInput.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });

    document.addEventListener('keydown', globalKeyListener, true);

    activeRenameState = {
      cleanup,
      confirm: confirmRename,
      cancel: cancelRename
    };
  }

  window.CodeNavRename = {
    findSymbolOccurrencesInCm,
    startRenameMethod,
    removeActiveRename,
  };
})();
