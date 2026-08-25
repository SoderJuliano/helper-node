// renderer/gitConflict/gitConflictModal.js
// Visualizador e Resolvedor de Conflitos Git em 3 Vias (Estilo IntelliJ IDEA / VS Code)

(function() {
  let modalContainer = null;
  let currentProjectDir = null;
  let conflictFiles = [];
  let currentFileIndex = 0;
  let current3WayData = null;
  let chunkStates = new Map(); // chunkId -> 'unresolved' | 'left' | 'right' | 'both' | 'ignored'
  let activeConflictIndex = 0;
  let cmCenter = null;
  let isSyncingScroll = false;

  const SVGI_PREV_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const SVGI_NEXT_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const SVGI_UP_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
  const SVGI_DOWN_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const SVGI_MAGIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-2 2 4 4 2-2z"/><path d="m8 11-5 5 2 2 5-5"/><path d="m19 11 2 2-2 2-2-2z"/><path d="m5 5 2 2-2 2-2-2z"/></svg>';
  const SVGI_ALL_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>';
  const SVGI_ALL_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>';
  const SVGI_SAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
  const SVGI_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const SVGI_ACCEPT_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const SVGI_ACCEPT_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const SVGI_IGNORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function createModalDom() {
    if (document.getElementById('git-conflict-modal')) {
      return document.getElementById('git-conflict-modal');
    }

    const modal = document.createElement('div');
    modal.id = 'git-conflict-modal';
    modal.className = 'git-conflict-modal-backdrop';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="git-conflict-header">
        <div class="git-conflict-title-group">
          <div class="git-conflict-file-nav">
            <button type="button" class="git-conflict-nav-btn" id="git-conflict-btn-prev" title="Arquivo anterior">${SVGI_PREV_ARROW}</button>
            <select class="git-conflict-file-select" id="git-conflict-file-select"></select>
            <button type="button" class="git-conflict-nav-btn" id="git-conflict-btn-next" title="Próximo arquivo">${SVGI_NEXT_ARROW}</button>
          </div>

          <div class="git-conflict-jump-group" id="git-conflict-jump-group">
            <button type="button" class="git-conflict-jump-btn" id="git-conflict-btn-prev-conflict" title="Conflito anterior">
              ${SVGI_UP_ARROW}
              <span>Anterior</span>
            </button>
            <span class="git-conflict-jump-counter" id="git-conflict-jump-counter">0 / 0</span>
            <button type="button" class="git-conflict-jump-btn" id="git-conflict-btn-next-conflict" title="Próximo conflito">
              <span>Próximo</span>
              ${SVGI_DOWN_ARROW}
            </button>
          </div>

          <span class="git-conflict-status-badge has-conflicts" id="git-conflict-badge-status">0 conflitos</span>
        </div>

        <div class="git-conflict-actions-center">
          <button type="button" class="git-conflict-btn" id="git-conflict-btn-magic" title="Aceita automaticamente todas as alterações unilaterais que não conflitam">
            ${SVGI_MAGIC}
            <span>Aplicar Sem Conflito</span>
          </button>
          <button type="button" class="git-conflict-btn" id="git-conflict-btn-accept-all-left" title="Aceitar todas as alterações da sua branch">
            ${SVGI_ALL_LEFT}
            <span>Tudo da Esquerda</span>
          </button>
          <button type="button" class="git-conflict-btn" id="git-conflict-btn-accept-all-right" title="Aceitar todas as alterações da branch de entrada">
            <span>Tudo da Direita</span>
            ${SVGI_ALL_RIGHT}
          </button>
        </div>

        <div class="git-conflict-actions-right">
          <button type="button" class="git-conflict-btn git-conflict-btn-save" id="git-conflict-btn-save" title="Salvar arquivo resolvido e marcar como resolvido no Git (Ctrl+S)">
            ${SVGI_SAVE}
            <span>Salvar</span>
          </button>
          <button type="button" class="git-conflict-btn git-conflict-btn-abort" id="git-conflict-btn-abort" title="Abortar processo de merge">
            <span>Abortar Merge</span>
          </button>
          <button type="button" class="git-conflict-btn-close" id="git-conflict-btn-close" title="Fechar visualizador de conflitos e voltar ao Helper Node (Esc)">
            ${SVGI_CLOSE}
            <span>Fechar</span>
          </button>
          <div class="git-conflict-win-controls">
            <button type="button" class="git-conflict-win-btn" id="git-conflict-win-min" title="Minimizar janela">—</button>
            <button type="button" class="git-conflict-win-btn" id="git-conflict-win-max" title="Maximizar / Restaurar janela">⛶</button>
          </div>
        </div>
      </div>

      <div class="git-conflict-body">
        <!-- Coluna Esquerda: Sua Versão (Ours) -->
        <div class="git-conflict-col left-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-left">Sua Versão (Local)</span>
              <span id="git-conflict-label-left" style="color:#858585; font-weight:normal;"></span>
            </div>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-left-container">
            <table class="git-conflict-table" id="git-conflict-table-left"></table>
          </div>
        </div>

        <!-- Coluna Central: Resultado do Merge (Editável) -->
        <div class="git-conflict-col center-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-center">Resultado do Merge (Editável)</span>
            </div>
            <span id="git-conflict-center-stats" style="font-size:11px; color:#858585;"></span>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-center-container">
            <textarea id="git-conflict-cm-textarea"></textarea>
          </div>
        </div>

        <!-- Coluna Direita: Versão de Entrada (Theirs) -->
        <div class="git-conflict-col right-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-right">Versão de Entrada (Incoming)</span>
              <span id="git-conflict-label-right" style="color:#858585; font-weight:normal;"></span>
            </div>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-right-container">
            <table class="git-conflict-table" id="git-conflict-table-right"></table>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    wireEventListeners(modal);
    return modal;
  }

  function getSyntaxMode(filePath) {
    const ext = String(filePath || '').split('.').pop().toLowerCase();
    const modes = {
      js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
      json: 'javascript', html: 'htmlmixed', xml: 'xml', css: 'css',
      java: 'text/x-java', py: 'python', sh: 'shell', yml: 'yaml', yaml: 'yaml',
      md: 'markdown', sql: 'sql', c: 'clike', cpp: 'clike', cs: 'clike',
      go: 'go', rs: 'rust', php: 'php', rb: 'ruby'
    };
    return modes[ext] || 'javascript';
  }

  function wireEventListeners(modal) {
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
      btnWinMin.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.minimizeWindow) window.electronAPI.minimizeWindow();
      });
    }

    if (btnWinMax) {
      btnWinMax.addEventListener('click', () => {
        if (window.electronAPI && window.electronAPI.maximizeWindow) window.electronAPI.maximizeWindow();
      });
    }

    window.addEventListener('keydown', (e) => {
      const m = document.getElementById('git-conflict-modal');
      if (!m || m.style.display === 'none') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeGitConflictModal();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveCurrentResolution();
      }
    });

    btnClose.addEventListener('click', () => closeGitConflictModal());
    
    btnAbort.addEventListener('click', async () => {
      if (!confirm('Deseja realmente abortar o processo de merge atual? Todas as alterações não comitadas do merge serão revertidas.')) return;
      if (window.electronAPI && window.electronAPI.gitConflictAbortMerge) {
        const res = await window.electronAPI.gitConflictAbortMerge(currentProjectDir);
        if (res && res.ok) {
          if (typeof showToast === 'function') showToast('Merge abortado com sucesso.');
          closeGitConflictModal();
          if (window.fetchAndUpdateGitStatus) window.fetchAndUpdateGitStatus();
        } else {
          alert('Erro ao abortar merge: ' + (res ? res.error : 'erro desconhecido'));
        }
      }
    });

    btnSave.addEventListener('click', () => saveCurrentResolution());

    btnMagic.addEventListener('click', () => applyNonConflictingChanges());

    btnAcceptAllLeft.addEventListener('click', () => {
      if (!current3WayData) return;
      current3WayData.chunks.forEach(c => chunkStates.set(c.id, 'left'));
      rebuildCenterResult();
      renderSideTables();
    });

    btnAcceptAllRight.addEventListener('click', () => {
      if (!current3WayData) return;
      current3WayData.chunks.forEach(c => chunkStates.set(c.id, 'right'));
      rebuildCenterResult();
      renderSideTables();
    });

    fileSelect.addEventListener('change', (e) => {
      currentFileIndex = parseInt(e.target.value, 10) || 0;
      loadFile3Way(conflictFiles[currentFileIndex].path);
    });

    btnPrev.addEventListener('click', () => {
      if (currentFileIndex > 0) {
        currentFileIndex--;
        fileSelect.value = currentFileIndex;
        loadFile3Way(conflictFiles[currentFileIndex].path);
      }
    });

    btnNext.addEventListener('click', () => {
      if (currentFileIndex < conflictFiles.length - 1) {
        currentFileIndex++;
        fileSelect.value = currentFileIndex;
        loadFile3Way(conflictFiles[currentFileIndex].path);
      }
    });

    btnPrevConflict.addEventListener('click', () => {
      navigateConflicts(-1);
    });

    btnNextConflict.addEventListener('click', () => {
      navigateConflicts(1);
    });

    // Sincronização de Scroll Suave
    const leftBox = modal.querySelector('#git-conflict-left-container');
    const rightBox = modal.querySelector('#git-conflict-right-container');

    const handleScroll = (source) => {
      if (isSyncingScroll) return;
      isSyncingScroll = true;
      const top = source.scrollTop;
      const left = source.scrollLeft;

      requestAnimationFrame(() => {
        if (source !== leftBox && Math.abs(leftBox.scrollTop - top) > 1) {
          leftBox.scrollTop = top;
          leftBox.scrollLeft = left;
        }
        if (source !== rightBox && Math.abs(rightBox.scrollTop - top) > 1) {
          rightBox.scrollTop = top;
          rightBox.scrollLeft = left;
        }
        if (cmCenter && source !== cmCenter.getScrollerElement()) {
          cmCenter.scrollTo(left, top);
        }
        isSyncingScroll = false;
      });
    };

    leftBox.addEventListener('scroll', () => handleScroll(leftBox), { passive: true });
    rightBox.addEventListener('scroll', () => handleScroll(rightBox), { passive: true });

    window.addEventListener('resize', () => {
      if (modalContainer && modalContainer.style.display !== 'none' && cmCenter) {
        cmCenter.refresh();
      }
    });
  }

  function initCodeMirror() {
    if (cmCenter) return;
    const ta = document.getElementById('git-conflict-cm-textarea');
    if (!ta || !window.CodeMirror) return;

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
    setTimeout(() => {
      if (cmCenter) cmCenter.refresh();
    }, 50);
    setTimeout(() => {
      if (cmCenter) cmCenter.refresh();
    }, 150);
  }

  async function openGitConflictModal(projectDir) {
    currentProjectDir = projectDir || (window.ctxProject ? window.ctxProject.path : null) || null;
    modalContainer = createModalDom();
    modalContainer.style.display = 'flex';
    document.body.classList.add('git-conflict-open');
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    if (modalContainer) modalContainer.scrollTop = 0;

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
          alert('Nenhum arquivo em conflito detectado neste repositório.');
          closeGitConflictModal();
        }
      } else {
        alert('Erro ao verificar status do repositório: ' + (res ? res.error : 'erro desconhecido'));
        closeGitConflictModal();
      }
    }
  }

  function closeGitConflictModal() {
    document.body.classList.remove('git-conflict-open');
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
    if (modalContainer) {
      modalContainer.style.display = 'none';
      modalContainer.scrollTop = 0;
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
    btnPrev.disabled = currentFileIndex <= 0;
    btnNext.disabled = currentFileIndex >= conflictFiles.length - 1;
  }

  async function loadFile3Way(relPath) {
    if (!window.electronAPI || !window.electronAPI.gitConflictGetFile3Way) return;

    const res = await window.electronAPI.gitConflictGetFile3Way({
      projectPath: currentProjectDir,
      relPath
    });

    if (!res || !res.ok) {
      alert('Erro ao carregar dados do arquivo: ' + (res ? res.error : 'erro desconhecido'));
      return;
    }

    current3WayData = res;
    chunkStates.clear();
    activeConflictIndex = 0;

    // Inicializa os estados dos chunks
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

    // Labels das branches
    const labelLeft = document.getElementById('git-conflict-label-left');
    const labelRight = document.getElementById('git-conflict-label-right');
    if (labelLeft) labelLeft.textContent = `(${res.currentBranch || 'Ours'})`;
    if (labelRight) labelRight.textContent = `(${res.incomingBranch || 'Theirs'})`;

    // Renderiza tabelas laterais
    renderSideTables();

    // Atualiza CodeMirror no centro
    if (cmCenter) {
      cmCenter.setOption('mode', getSyntaxMode(relPath));
      rebuildCenterResult();
      triggerCmRefresh();
    } else {
      const ta = document.getElementById('git-conflict-cm-textarea');
      if (ta) ta.value = res.initialResult || '';
    }

    updateConflictStatusBadge();

    // Pula automaticamente para o 1º conflito
    setTimeout(() => {
      scrollToConflict(0);
    }, 80);
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

    // Destaca linha nas tabelas
    document.querySelectorAll('.chunk-row-active-conflict').forEach(el => el.classList.remove('chunk-row-active-conflict'));
    document.querySelectorAll(`[data-chunk-id="${targetChunk.id}"]`).forEach(el => el.classList.add('chunk-row-active-conflict'));

    // Rola tabela lateral de forma contida
    const firstRow = document.querySelector(`#git-conflict-table-left [data-chunk-id="${targetChunk.id}"]`);
    const leftContainer = document.getElementById('git-conflict-left-container');
    if (firstRow && leftContainer) {
      const topPos = Math.max(0, firstRow.offsetTop - 80);
      leftContainer.scrollTop = topPos;
    }

    // Rola CodeMirror central
    if (cmCenter) {
      const lineNum = Math.max(0, (targetChunk.leftStartLine || 1) - 1);
      cmCenter.scrollIntoView({ line: lineNum, ch: 0 }, 100);
    }

    // Garante que o header e o modal nunca saiam do topo da tela
    if (modalContainer) modalContainer.scrollTop = 0;
    window.scrollTo(0, 0);
    document.body.scrollTop = 0;
  }

  function renderSideTables() {
    const tableLeft = document.getElementById('git-conflict-table-left');
    const tableRight = document.getElementById('git-conflict-table-right');
    if (!tableLeft || !tableRight || !current3WayData) return;

    const fragLeft = document.createDocumentFragment();
    const fragRight = document.createDocumentFragment();

    current3WayData.chunks.forEach((chunk) => {
      const state = chunkStates.get(chunk.id);
      const isConflict = chunk.type === 'CONFLICT';
      const isLeftOnly = chunk.type === 'LEFT_ONLY';
      const isRightOnly = chunk.type === 'RIGHT_ONLY';

      let rowClass = 'chunk-row-equal';
      if (isConflict) rowClass = 'chunk-row-conflict';
      else if (isLeftOnly) rowClass = 'chunk-row-left-only';
      else if (isRightOnly) rowClass = 'chunk-row-right-only';

      if (state === 'ignored' || (state !== 'unresolved' && state !== 'left' && state !== 'both' && isConflict)) {
        rowClass += ' chunk-row-resolved';
      }

      const leftCount = chunk.leftLines.length;
      const rightCount = chunk.rightLines.length;
      const maxLines = Math.max(leftCount, rightCount, 1);

      // Linhas da Esquerda (Ours)
      for (let i = 0; i < maxLines; i++) {
        const isActualLine = i < leftCount;
        const lineText = isActualLine ? chunk.leftLines[i] : '';

        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${rowClass}${!isActualLine ? ' chunk-row-spacer' : ''}`;
        tr.dataset.chunkId = chunk.id;

        const tdNum = document.createElement('td');
        tdNum.className = 'git-conflict-gutter-num';
        tdNum.textContent = isActualLine ? String(chunk.leftStartLine + i) : '';

        const tdAction = document.createElement('td');
        tdAction.className = 'git-conflict-gutter-action';

        if (i === 0 && (isConflict || isLeftOnly)) {
          const btnAccept = document.createElement('button');
          btnAccept.className = 'chunk-action-btn chunk-btn-accept-left';
          btnAccept.title = 'Aceitar alteração da esquerda no resultado';
          btnAccept.innerHTML = SVGI_ACCEPT_LEFT;
          btnAccept.addEventListener('click', (e) => {
            e.stopPropagation();
            chunkStates.set(chunk.id, 'left');
            rebuildCenterResult();
            renderSideTables();
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.className = 'chunk-action-btn chunk-btn-ignore';
          btnIgnore.title = 'Ignorar este bloco';
          btnIgnore.innerHTML = SVGI_IGNORE;
          btnIgnore.addEventListener('click', (e) => {
            e.stopPropagation();
            chunkStates.set(chunk.id, 'ignored');
            rebuildCenterResult();
            renderSideTables();
          });

          tdAction.appendChild(btnAccept);
          tdAction.appendChild(btnIgnore);
        }

        const tdCode = document.createElement('td');
        tdCode.className = 'git-conflict-code-cell';
        tdCode.textContent = isActualLine ? (lineText || '\u00A0') : '\u00A0';

        tr.appendChild(tdNum);
        tr.appendChild(tdAction);
        tr.appendChild(tdCode);
        fragLeft.appendChild(tr);
      }

      // Linhas da Direita (Theirs)
      for (let i = 0; i < maxLines; i++) {
        const isActualLine = i < rightCount;
        const lineText = isActualLine ? chunk.rightLines[i] : '';

        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${rowClass}${!isActualLine ? ' chunk-row-spacer' : ''}`;
        tr.dataset.chunkId = chunk.id;

        const tdAction = document.createElement('td');
        tdAction.className = 'git-conflict-gutter-action';

        if (i === 0 && (isConflict || isRightOnly)) {
          const btnAccept = document.createElement('button');
          btnAccept.className = 'chunk-action-btn chunk-btn-accept-right';
          btnAccept.title = 'Aceitar alteração da direita no resultado';
          btnAccept.innerHTML = SVGI_ACCEPT_RIGHT;
          btnAccept.addEventListener('click', (e) => {
            e.stopPropagation();
            chunkStates.set(chunk.id, 'right');
            rebuildCenterResult();
            renderSideTables();
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.className = 'chunk-action-btn chunk-btn-ignore';
          btnIgnore.title = 'Ignorar este bloco';
          btnIgnore.innerHTML = SVGI_IGNORE;
          btnIgnore.addEventListener('click', (e) => {
            e.stopPropagation();
            chunkStates.set(chunk.id, 'ignored');
            rebuildCenterResult();
            renderSideTables();
          });

          tdAction.appendChild(btnAccept);
          tdAction.appendChild(btnIgnore);
        }

        const tdNum = document.createElement('td');
        tdNum.className = 'git-conflict-gutter-num';
        tdNum.textContent = isActualLine ? String(chunk.rightStartLine + i) : '';

        const tdCode = document.createElement('td');
        tdCode.className = 'git-conflict-code-cell';
        tdCode.textContent = isActualLine ? (lineText || '\u00A0') : '\u00A0';

        tr.appendChild(tdAction);
        tr.appendChild(tdNum);
        tr.appendChild(tdCode);
        fragRight.appendChild(tr);
      }
    });

    tableLeft.innerHTML = '';
    tableRight.innerHTML = '';
    tableLeft.appendChild(fragLeft);
    tableRight.appendChild(fragRight);
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
        // Bloco ignorado
      } else if (state === 'unresolved' && chunk.type === 'CONFLICT') {
        resultLines.push(`<<<<<<< ${current3WayData.currentBranch || 'Ours'}`);
        resultLines.push(...chunk.leftLines);
        resultLines.push('=======');
        resultLines.push(...chunk.rightLines);
        resultLines.push(`>>>>>>> ${current3WayData.incomingBranch || 'Theirs'}`);
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
    if (!current3WayData) return;

    const text = cmCenter ? cmCenter.getValue() : (document.getElementById('git-conflict-cm-textarea')?.value || '');
    if (text.includes('<<<<<<<') || text.includes('>>>>>>>') || text.includes('=======')) {
      if (!confirm('Atenção: O arquivo ainda contém marcadores de conflito (<<<<<<<, =======, >>>>>>>). Deseja salvar mesmo assim?')) {
        return;
      }
    }

    if (!window.electronAPI || !window.electronAPI.gitConflictSaveResolved) return;

    const res = await window.electronAPI.gitConflictSaveResolved({
      projectPath: currentProjectDir,
      relPath: current3WayData.relPath,
      content: text
    });

    if (res && res.ok) {
      if (typeof showToast === 'function') {
        showToast(`Arquivo ${current3WayData.relPath} salvo e adicionado ao Git.`);
      }

      if (res.remainingConflicts > 0 && res.conflictFiles && res.conflictFiles.length > 0) {
        conflictFiles = res.conflictFiles;
        currentFileIndex = 0;
        updateFileListUi();
        loadFile3Way(conflictFiles[0].path);
      } else {
        if (typeof showToast === 'function') {
          showToast('Todos os conflitos do repositório foram resolvidos com sucesso.');
        }
        closeGitConflictModal();
        if (window.fetchAndUpdateGitStatus) window.fetchAndUpdateGitStatus();
      }
    } else {
      alert('Erro ao salvar resolução: ' + (res ? res.error : 'erro desconhecido'));
    }
  }

  // Expor globalmente
  window.openGitConflictModal = openGitConflictModal;
  window.closeGitConflictModal = closeGitConflictModal;
})();
