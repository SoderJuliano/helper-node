// renderer/gitConflict/gitConflictModal.js
// Visualizador e Resolvedor de Conflitos Git em 3 Vias (Estilo IntelliJ IDEA)

(function() {
  'use strict';

  let modalContainer = null;
  let currentProjectDir = null;
  let conflictFiles = [];
  let currentFileIndex = 0;
  let current3WayData = null;
  let chunkStates = new Map();
  let customCenterEdits = new Map();
  let activeConflictIndex = 0;
  let isSyncingScroll = false;

  function initGitConflictModalDom() {
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
        customCenterEdits.clear();
        current3WayData.chunks.forEach(c => {
          chunkStates.set(c.id, c.type === 'EQUAL' || c.type === 'SAME_CHANGE' ? 'both' : 'left');
        });
        renderAllPanels();
        updateConflictStatusBadge();
      },
      onAcceptAllRight: () => {
        if (!current3WayData || !current3WayData.chunks) return;
        customCenterEdits.clear();
        current3WayData.chunks.forEach(c => {
          chunkStates.set(c.id, c.type === 'EQUAL' || c.type === 'SAME_CHANGE' ? 'both' : 'right');
        });
        renderAllPanels();
        updateConflictStatusBadge();
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
          const centerBox = modalContainer ? modalContainer.querySelector('#git-conflict-center-container') : null;
          const rightBox = modalContainer ? modalContainer.querySelector('#git-conflict-right-container') : null;

          if (source !== leftBox && leftBox && Math.abs(leftBox.scrollTop - top) > 1) {
            leftBox.scrollTop = top;
            leftBox.scrollLeft = left;
          }
          if (source !== centerBox && centerBox && Math.abs(centerBox.scrollTop - top) > 1) {
            centerBox.scrollTop = top;
            centerBox.scrollLeft = left;
          }
          if (source !== rightBox && rightBox && Math.abs(rightBox.scrollTop - top) > 1) {
            rightBox.scrollTop = top;
            rightBox.scrollLeft = left;
          }
          isSyncingScroll = false;
        });
      }
    });
    return modalContainer;
  }

  async function openGitConflictModal(projectDir) {
    currentProjectDir = projectDir || (window.ctxProject ? window.ctxProject.path : null) || null;
    modalContainer = initGitConflictModalDom();
    modalContainer.classList.add('is-open');
    modalContainer.style.display = 'flex';
    document.body.classList.add('git-conflict-open');

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
    customCenterEdits.clear();
    activeConflictIndex = 0;

    // Inicialização estilo IntelliJ:
    // Mudanças não conflitantes da esquerda e da direita são pré-aplicadas;
    // Conflitos reais iniciam em 'unresolved' para o usuário decidir.
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

    renderAllPanels();
    updateConflictStatusBadge();

    setTimeout(() => {
      scrollToConflict(0);
    }, 60);
  }

  function renderAllPanels() {
    window.GitConflictModalDom.renderGitConflict3Way(
      current3WayData,
      chunkStates,
      customCenterEdits,
      (chunkId, action) => {
        customCenterEdits.delete(chunkId);
        chunkStates.set(chunkId, action);
        renderAllPanels();
        updateConflictStatusBadge();
      },
      (chunkId, updatedLines) => {
        customCenterEdits.set(chunkId, updatedLines);
        updateConflictStatusBadge();
      }
    );
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
    const centerContainer = document.getElementById('git-conflict-center-container');
    const rightContainer = document.getElementById('git-conflict-right-container');

    if (firstRow) {
      const topPos = Math.max(0, firstRow.offsetTop - 80);
      if (leftContainer) leftContainer.scrollTop = topPos;
      if (centerContainer) centerContainer.scrollTop = topPos;
      if (rightContainer) rightContainer.scrollTop = topPos;
    }
  }

  function applyNonConflictingChanges() {
    if (!current3WayData) return;
    customCenterEdits.clear();
    current3WayData.chunks.forEach(c => {
      if (c.type === 'LEFT_ONLY') chunkStates.set(c.id, 'left');
      else if (c.type === 'RIGHT_ONLY') chunkStates.set(c.id, 'right');
      else if (c.type === 'SAME_CHANGE' || c.type === 'EQUAL') chunkStates.set(c.id, 'both');
    });
    renderAllPanels();
    updateConflictStatusBadge();
    if (typeof window.showToast === 'function') {
      window.showToast('Alterações sem conflito aplicadas no centro.');
    }
  }

  function updateConflictStatusBadge() {
    const badge = document.getElementById('git-conflict-badge-status');
    const centerBadge = document.getElementById('git-conflict-center-badge');
    const resolvedBanner = document.getElementById('git-conflict-resolved-banner');
    const resolvedBannerText = document.getElementById('git-conflict-resolved-banner-text');
    const saveBtn = document.getElementById('git-conflict-btn-save');
    if (!current3WayData) return;

    const conflictChunks = getConflictChunks();
    const unresolvedList = conflictChunks.filter(c => chunkStates.get(c.id) === 'unresolved' && !customCenterEdits.has(c.id));
    const unresolvedCount = unresolvedList.length;

    if (badge) {
      if (unresolvedCount > 0) {
        badge.className = 'git-conflict-status-badge has-conflicts';
        badge.textContent = `${unresolvedCount} conflito${unresolvedCount > 1 ? 's' : ''} pendente${unresolvedCount > 1 ? 's' : ''}`;
      } else {
        badge.className = 'git-conflict-status-badge resolved';
        badge.textContent = 'Todos os conflitos resolvidos';
      }
    }

    if (centerBadge) {
      if (unresolvedCount > 0) {
        centerBadge.className = 'col-center-badge is-pending';
        centerBadge.textContent = `${unresolvedCount} pendente${unresolvedCount > 1 ? 's' : ''}`;
      } else {
        centerBadge.className = 'col-center-badge is-resolved';
        centerBadge.textContent = '100% resolvido';
      }
    }

    if (resolvedBanner) {
      if (unresolvedCount === 0 && conflictChunks.length > 0) {
        resolvedBanner.style.display = 'flex';
        if (resolvedBannerText) {
          if (conflictFiles.length > 1) {
            resolvedBannerText.innerHTML = `Todos os conflitos deste arquivo foram resolvidos! Clique em <strong>Salvar e Concluir</strong> para avançar.`;
          } else {
            resolvedBannerText.innerHTML = `Todos os conflitos deste arquivo foram resolvidos! Clique em <strong>Salvar e Concluir</strong> para finalizar.`;
          }
        }
        if (saveBtn) saveBtn.classList.add('is-ready-pulse');
      } else {
        resolvedBanner.style.display = 'none';
        if (saveBtn) saveBtn.classList.remove('is-ready-pulse');
      }
    }
  }

  function buildFinalMergedContent() {
    if (!current3WayData) return '';

    const resultLines = [];
    current3WayData.chunks.forEach(chunk => {
      if (customCenterEdits.has(chunk.id)) {
        resultLines.push(...customCenterEdits.get(chunk.id));
        return;
      }

      const state = chunkStates.get(chunk.id);
      if (state === 'left') {
        resultLines.push(...chunk.leftLines);
      } else if (state === 'right') {
        resultLines.push(...chunk.rightLines);
      } else if (state === 'both') {
        resultLines.push(...(chunk.leftLines && chunk.leftLines.length > 0 ? chunk.leftLines : chunk.rightLines));
      } else if (state === 'ignored') {
      } else if (state === 'unresolved') {
        if (chunk.type === 'CONFLICT') {
          resultLines.push(`<<<<<<< ${current3WayData.currentBranch || 'Local'}`);
          resultLines.push(...chunk.leftLines);
          resultLines.push('=======');
          resultLines.push(...chunk.rightLines);
          resultLines.push(`>>>>>>> ${current3WayData.incomingBranch || 'Incoming'}`);
        } else {
          resultLines.push(...chunk.leftLines);
        }
      } else {
        resultLines.push(...chunk.leftLines);
      }
    });

    return resultLines.join('\n');
  }

  async function saveCurrentResolution() {
    if (!current3WayData) {
      console.warn('[GitConflictModal] Salvar acionado sem arquivo carregado.');
      return;
    }

    const conflictChunks = getConflictChunks();
    const unresolvedList = conflictChunks.filter(c => chunkStates.get(c.id) === 'unresolved' && !customCenterEdits.has(c.id));

    if (unresolvedList.length > 0) {
      const confirmSave = confirm(
        `Atenção: Ainda restam ${unresolvedList.length} conflito(s) não resolvido(s) neste arquivo.\n\n` +
        `Se você salvar agora, os marcadores de conflito Git (<<<<<<< / ======= / >>>>>>>) serão incluídos no arquivo.\n\n` +
        `Deseja salvar mesmo assim com os marcadores de conflito?`
      );
      if (!confirmSave) {
        const firstUnresolvedIdx = conflictChunks.findIndex(c => c.id === unresolvedList[0].id);
        if (firstUnresolvedIdx >= 0) {
          scrollToConflict(firstUnresolvedIdx);
        }
        return;
      }
    }

    if (!window.electronAPI || !window.electronAPI.gitConflictSaveResolved) {
      alert('API gitConflictSaveResolved não disponível.');
      return;
    }

    const text = buildFinalMergedContent();

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

