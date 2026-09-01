// renderer/gitConflict/gitConflictModal.js
// Visualizador e Resolvedor de Conflitos Git em 3 Vias (Estilo IntelliJ IDEA / VS Code)

(function() {
  'use strict';

  let modalContainer = null;
  let currentProjectDir = null;
  let conflictFiles = [];
  let currentFileIndex = 0;
  let current3WayData = null;
  let chunkStates = new Map();
  let activeConflictIndex = 0;
  let cmCenter = null;
  let isSyncingScroll = false;

  function initGitConflictModalDom() {
    if (cmCenter) {
      try { cmCenter.toTextArea(); } catch (_) {}
      cmCenter = null;
    }
    modalContainer = window.GitConflictModalDom.buildGitConflictModalDom();
    window.GitConflictModalEvents.wireGitConflictEventListeners(modalContainer, {
      onClose: closeGitConflictModal,
      onAbort: async () => {
        if (!confirm('Deseja realmente abortar o processo de merge atual? Todas as alterações não comitadas do merge serão revertidas.')) return;
        if (window.electronAPI && window.electronAPI.gitConflictAbortMerge) {
          const res = await window.electronAPI.gitConflictAbortMerge(currentProjectDir);
          if (res && res.ok) {
            if (typeof window.showToast === 'function') window.showToast('Merge abortado com sucesso.');
          } else {
            alert('Aviso ao abortar merge: ' + (res ? res.error : 'erro desconhecido'));
          }
          closeGitConflictModal();
          if (typeof window.fetchAndUpdateGitStatus === 'function') window.fetchAndUpdateGitStatus();
          if (typeof window.triggerTreeRefresh === 'function') window.triggerTreeRefresh();
        } else {
          closeGitConflictModal();
        }
      },
      onSave: saveCurrentResolution,
      onMagic: applyNonConflictingChanges,
      onAcceptAllLeft: () => {
        if (!current3WayData || !current3WayData.chunks) return;
        current3WayData.chunks.forEach(c => {
          chunkStates.set(c.id, c.type === 'EQUAL' || c.type === 'SAME_CHANGE' ? 'both' : 'left');
        });
        rebuildCenterResult();
        renderSideTables();
      },
      onAcceptAllRight: () => {
        if (!current3WayData || !current3WayData.chunks) return;
        current3WayData.chunks.forEach(c => {
          chunkStates.set(c.id, c.type === 'EQUAL' || c.type === 'SAME_CHANGE' ? 'both' : 'right');
        });
        rebuildCenterResult();
        renderSideTables();
      },
      onFileChange: (idx) => {
        currentFileIndex = idx;
        if (conflictFiles[currentFileIndex]) {
          loadFile3Way(conflictFiles[currentFileIndex].path);
        }
      },
      onPrevFile: () => {
        if (currentFileIndex > 0) {
          currentFileIndex--;
          const fileSelect = document.getElementById('git-conflict-file-select');
          if (fileSelect) fileSelect.value = currentFileIndex;
          if (conflictFiles[currentFileIndex]) {
            loadFile3Way(conflictFiles[currentFileIndex].path);
          }
        }
      },
      onNextFile: () => {
        if (currentFileIndex < conflictFiles.length - 1) {
          currentFileIndex++;
          const fileSelect = document.getElementById('git-conflict-file-select');
          if (fileSelect) fileSelect.value = currentFileIndex;
          if (conflictFiles[currentFileIndex]) {
            loadFile3Way(conflictFiles[currentFileIndex].path);
          }
        }
      },
      onPrevConflict: () => navigateConflicts(-1),
      onNextConflict: () => navigateConflicts(1),
      onScroll: (source) => {
        if (isSyncingScroll) return;
        isSyncingScroll = true;
        const top = source.scrollTop;
        const left = source.scrollLeft;

        requestAnimationFrame(() => {
          const leftBox = modalContainer ? modalContainer.querySelector('#git-conflict-left-container') : null;
          const rightBox = modalContainer ? modalContainer.querySelector('#git-conflict-right-container') : null;
          if (source !== leftBox && leftBox && Math.abs(leftBox.scrollTop - top) > 1) {
            leftBox.scrollTop = top;
            leftBox.scrollLeft = left;
          }
          if (source !== rightBox && rightBox && Math.abs(rightBox.scrollTop - top) > 1) {
            rightBox.scrollTop = top;
            rightBox.scrollLeft = left;
          }
          if (cmCenter && source !== cmCenter.getScrollerElement()) {
            cmCenter.scrollTo(left, top);
          }
          isSyncingScroll = false;
        });
      }
    });
    return modalContainer;
  }

  function initCodeMirror() {
    const ta = document.getElementById('git-conflict-cm-textarea');
    if (!ta || !window.CodeMirror) return;
    if (cmCenter) {
      try { cmCenter.toTextArea(); } catch (_) {}
      cmCenter = null;
    }

    cmCenter = window.CodeMirror.fromTextArea(ta, {
      lineNumbers: true,
      mode: 'javascript',
      theme: 'dracula',
      lineWrapping: false,
      tabSize: 2
    });

    cmCenter.on('scroll', () => {
      if (isSyncingScroll) return;
      isSyncingScroll = true;
      const scrollInfo = cmCenter.getScrollInfo();
      const leftBox = document.getElementById('git-conflict-left-container');
      const rightBox = document.getElementById('git-conflict-right-container');

      requestAnimationFrame(() => {
        if (leftBox && Math.abs(leftBox.scrollTop - scrollInfo.top) > 1) {
          leftBox.scrollTop = scrollInfo.top;
          leftBox.scrollLeft = scrollInfo.left;
        }
        if (rightBox && Math.abs(rightBox.scrollTop - scrollInfo.top) > 1) {
          rightBox.scrollTop = scrollInfo.top;
          rightBox.scrollLeft = scrollInfo.left;
        }
        isSyncingScroll = false;
      });
    });

    cmCenter.on('change', () => {
      updateConflictStatusBadge();
    });
  }

  function triggerCmRefresh() {
    if (!cmCenter) return;
    cmCenter.refresh();
    requestAnimationFrame(() => {
      if (cmCenter) cmCenter.refresh();
    });
    setTimeout(() => { if (cmCenter) cmCenter.refresh(); }, 50);
  }

  async function openGitConflictModal(projectDir) {
    currentProjectDir = projectDir || (window.ctxProject ? window.ctxProject.path : null) || null;
    modalContainer = initGitConflictModalDom();
    modalContainer.classList.add('is-open');
    modalContainer.style.display = 'flex';
    document.body.classList.add('git-conflict-open');

    initCodeMirror();
    triggerCmRefresh();

    if (window.electronAPI && window.electronAPI.gitConflictGetStatus) {
      const res = await window.electronAPI.gitConflictGetStatus(currentProjectDir);
      if (res && res.ok && res.data) {
        if (res.data.projectPath) currentProjectDir = res.data.projectPath;
        conflictFiles = res.data.conflictFiles || [];
        currentFileIndex = 0;
        updateFileListUi();
        if (conflictFiles.length > 0) {
          loadFile3Way(conflictFiles[0].path);
        } else {
          if (typeof window.showToast === 'function') window.showToast('Nenhum conflito pendente detectado.');
          closeGitConflictModal();
        }
      } else {
        alert('Erro ao verificar status de conflito: ' + (res ? res.error : 'erro desconhecido'));
        closeGitConflictModal();
      }
    }
  }

  function closeGitConflictModal() {
    document.body.classList.remove('git-conflict-open');
    const m = modalContainer || document.getElementById('git-conflict-modal');
    if (m) {
      m.classList.remove('is-open');
      m.style.display = 'none';
    }
  }

  function updateFileListUi() {
    const fileSelect = document.getElementById('git-conflict-file-select');
    const btnPrev = document.getElementById('git-conflict-btn-prev');
    const btnNext = document.getElementById('git-conflict-btn-next');
    if (!fileSelect) return;

    fileSelect.innerHTML = '';
    conflictFiles.forEach((file, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${idx + 1}/${conflictFiles.length}: ${file.path}`;
      fileSelect.appendChild(opt);
    });

    fileSelect.value = currentFileIndex;
    if (btnPrev) btnPrev.disabled = currentFileIndex <= 0;
    if (btnNext) btnNext.disabled = currentFileIndex >= conflictFiles.length - 1;
  }

  async function loadFile3Way(relPath) {
    if (!window.electronAPI || !window.electronAPI.gitConflictGetFile3Way) return;

    const res = await window.electronAPI.gitConflictGetFile3Way({
      projectPath: currentProjectDir,
      relPath
    });

    if (!res || !res.ok) {
      alert('Erro ao carregar arquivo de conflito: ' + (res ? res.error : 'erro desconhecido'));
      return;
    }

    current3WayData = res;
    chunkStates.clear();
    activeConflictIndex = 0;

    current3WayData.chunks.forEach(c => {
      if (c.type === 'EQUAL' || c.type === 'SAME_CHANGE') {
        chunkStates.set(c.id, 'both');
      } else if (c.type === 'LEFT_ONLY') {
        chunkStates.set(c.id, 'left');
      } else if (c.type === 'RIGHT_ONLY') {
        chunkStates.set(c.id, 'right');
      } else {
        chunkStates.set(c.id, 'unresolved');
      }
    });

    const labelLeft = document.getElementById('git-conflict-label-left');
    const labelRight = document.getElementById('git-conflict-label-right');
    if (labelLeft) labelLeft.textContent = `(${res.currentBranch || 'Local'})`;
    if (labelRight) labelRight.textContent = `(${res.incomingBranch || 'Incoming'})`;

    renderSideTables();

    if (cmCenter) {
      cmCenter.setOption('mode', window.GitConflictModalDom.getGitConflictSyntaxMode(relPath));
      rebuildCenterResult();
      triggerCmRefresh();
    } else {
      const ta = document.getElementById('git-conflict-cm-textarea');
      if (ta) ta.value = res.initialResult || '';
    }

    updateConflictStatusBadge();

    setTimeout(() => {
      scrollToConflict(0);
    }, 60);
  }

  function getConflictChunks() {
    if (!current3WayData || !current3WayData.chunks) return [];
    return current3WayData.chunks.filter(c => c.type === 'CONFLICT');
  }

  function navigateConflicts(delta) {
    const conflicts = getConflictChunks();
    if (conflicts.length === 0) return;
    let nextIdx = activeConflictIndex + delta;
    if (nextIdx < 0) nextIdx = conflicts.length - 1;
    if (nextIdx >= conflicts.length) nextIdx = 0;
    scrollToConflict(nextIdx);
  }

  function scrollToConflict(idx) {
    const conflicts = getConflictChunks();
    const jumpCounter = document.getElementById('git-conflict-jump-counter');
    const btnPrevConflict = document.getElementById('git-conflict-btn-prev-conflict');
    const btnNextConflict = document.getElementById('git-conflict-btn-next-conflict');

    if (conflicts.length === 0) {
      if (jumpCounter) jumpCounter.textContent = '0 / 0';
      if (btnPrevConflict) btnPrevConflict.disabled = true;
      if (btnNextConflict) btnNextConflict.disabled = true;
      return;
    }

    if (btnPrevConflict) btnPrevConflict.disabled = false;
    if (btnNextConflict) btnNextConflict.disabled = false;

    activeConflictIndex = Math.max(0, Math.min(idx, conflicts.length - 1));
    if (jumpCounter) {
      jumpCounter.textContent = `${activeConflictIndex + 1} / ${conflicts.length}`;
    }

    const targetChunk = conflicts[activeConflictIndex];
    if (!targetChunk) return;

    document.querySelectorAll('.chunk-row-active-conflict').forEach(el => el.classList.remove('chunk-row-active-conflict'));
    document.querySelectorAll(`[data-chunk-id="${targetChunk.id}"]`).forEach(el => el.classList.add('chunk-row-active-conflict'));

    const firstRow = document.querySelector(`#git-conflict-table-left [data-chunk-id="${targetChunk.id}"]`);
    const leftContainer = document.getElementById('git-conflict-left-container');
    if (firstRow && leftContainer) {
      const topPos = Math.max(0, firstRow.offsetTop - 80);
      leftContainer.scrollTop = topPos;
    }

    if (cmCenter) {
      const lineNum = Math.max(0, (targetChunk.leftStartLine || 1) - 1);
      cmCenter.scrollIntoView({ line: lineNum, ch: 0 }, 100);
    }
  }

  function renderSideTables() {
    window.GitConflictModalDom.renderGitConflictSideTables(current3WayData, chunkStates, (chunkId, action) => {
      chunkStates.set(chunkId, action);
      rebuildCenterResult();
      renderSideTables();
    });
  }

  function rebuildCenterResult() {
    if (!current3WayData) return;

    const resultLines = [];
    current3WayData.chunks.forEach(chunk => {
      const state = chunkStates.get(chunk.id);

      if (state === 'left') {
        resultLines.push(...chunk.leftLines);
      } else if (state === 'right') {
        resultLines.push(...chunk.rightLines);
      } else if (state === 'both') {
        resultLines.push(...(chunk.leftLines.length > 0 ? chunk.leftLines : chunk.rightLines));
      } else if (state === 'ignored') {
      } else if (state === 'unresolved' && chunk.type === 'CONFLICT') {
        resultLines.push(`<<<<<<< ${current3WayData.currentBranch || 'Local'}`);
        resultLines.push(...chunk.leftLines);
        resultLines.push('=======');
        resultLines.push(...chunk.rightLines);
        resultLines.push(`>>>>>>> ${current3WayData.incomingBranch || 'Incoming'}`);
      } else {
        resultLines.push(...chunk.leftLines);
      }
    });

    const finalContent = resultLines.join('\n');
    if (cmCenter) {
      const scrollInfo = cmCenter.getScrollInfo();
      cmCenter.setValue(finalContent);
      cmCenter.scrollTo(scrollInfo.left, scrollInfo.top);
      triggerCmRefresh();
    } else {
      const ta = document.getElementById('git-conflict-cm-textarea');
      if (ta) ta.value = finalContent;
    }
    updateConflictStatusBadge();
  }

  function applyNonConflictingChanges() {
    if (!current3WayData) return;
    current3WayData.chunks.forEach(c => {
      if (c.type === 'LEFT_ONLY') chunkStates.set(c.id, 'left');
      else if (c.type === 'RIGHT_ONLY') chunkStates.set(c.id, 'right');
      else if (c.type === 'SAME_CHANGE' || c.type === 'EQUAL') chunkStates.set(c.id, 'both');
    });
    rebuildCenterResult();
    renderSideTables();
  }

  function updateConflictStatusBadge() {
    const badge = document.getElementById('git-conflict-badge-status');
    const statsEl = document.getElementById('git-conflict-center-stats');
    if (!badge) return;

    const text = cmCenter ? cmCenter.getValue() : (document.getElementById('git-conflict-cm-textarea')?.value || '');
    const markerMatches = text.match(/<<<<<<< /g);
    const unresolvedCount = markerMatches ? markerMatches.length : 0;

    if (unresolvedCount > 0) {
      badge.className = 'git-conflict-status-badge has-conflicts';
      badge.textContent = `${unresolvedCount} conflito${unresolvedCount > 1 ? 's' : ''} pendente${unresolvedCount > 1 ? 's' : ''}`;
    } else {
      badge.className = 'git-conflict-status-badge resolved';
      badge.textContent = 'Todos os conflitos resolvidos';
    }

    if (statsEl) {
      const lineCount = cmCenter ? cmCenter.lineCount() : (text.split('\n').length);
      statsEl.textContent = `${lineCount} linhas`;
    }
  }

  async function saveCurrentResolution() {
    if (!current3WayData) {
      console.warn('[GitConflictModal] Salvar acionado sem arquivo carregado.');
      return;
    }

    const text = cmCenter ? cmCenter.getValue() : (document.getElementById('git-conflict-cm-textarea')?.value || '');
    if (text.includes('<<<<<<<') || text.includes('>>>>>>>') || text.includes('=======')) {
      if (!confirm('Atenção: O arquivo ainda contém marcadores de conflito.\n\nDeseja salvar mesmo assim com os marcadores de conflito?')) {
        scrollToConflict(activeConflictIndex);
        return;
      }
    }

    if (!window.electronAPI || !window.electronAPI.gitConflictSaveResolved) {
      alert('API gitConflictSaveResolved não disponível.');
      return;
    }

    try {
      const res = await window.electronAPI.gitConflictSaveResolved({
        projectPath: currentProjectDir,
        relPath: current3WayData.relPath,
        content: text
      });

      if (res && res.ok) {
        if (typeof window.showToast === 'function') {
          window.showToast(`Arquivo ${current3WayData.relPath} salvo e adicionado ao Git.`);
        }

        if (res.remainingConflicts > 0 && res.conflictFiles && res.conflictFiles.length > 0) {
          conflictFiles = res.conflictFiles;
          currentFileIndex = 0;
          updateFileListUi();
          loadFile3Way(conflictFiles[0].path);
        } else {
          if (typeof window.showToast === 'function') {
            window.showToast('Todos os conflitos foram resolvidos com sucesso.');
          }
          closeGitConflictModal();
          if (typeof window.fetchAndUpdateGitStatus === 'function') window.fetchAndUpdateGitStatus();
          if (typeof window.triggerTreeRefresh === 'function') window.triggerTreeRefresh();
        }
      } else {
        alert('Erro ao salvar resolução: ' + (res ? res.error : 'erro desconhecido'));
      }
    } catch (err) {
      alert('Erro inesperado ao salvar: ' + (err ? err.message : 'desconhecido'));
    }
  }

  window.GitConflictModal = {
    openGitConflictModal,
    closeGitConflictModal
  };

  window.openGitConflictModal = openGitConflictModal;
  window.closeGitConflictModal = closeGitConflictModal;
})();
