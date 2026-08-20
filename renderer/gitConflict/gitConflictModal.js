// renderer/gitConflict/gitConflictModal.js
// Visualizador e Resolvedor de Conflitos Git em 3 Vias (Estilo IntelliJ IDEA)

(function() {
  let modalContainer = null;
  let currentProjectDir = null;
  let conflictFiles = [];
  let currentFileIndex = 0;
  let current3WayData = null;
  let chunkStates = new Map(); // chunkId -> 'unresolved' | 'left' | 'right' | 'both' | 'ignored'
  let cmCenter = null;
  let isSyncingScroll = false;

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
          <div class="git-conflict-icon" title="Conflitos de Merge Git">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M6 9v12"></path>
              <path d="M18 9a9 9 0 0 0-9 9"></path>
            </svg>
          </div>
          <div class="git-conflict-file-nav">
            <button type="button" class="git-conflict-nav-btn" id="git-conflict-btn-prev" title="Arquivo anterior">◀</button>
            <select class="git-conflict-file-select" id="git-conflict-file-select"></select>
            <button type="button" class="git-conflict-nav-btn" id="git-conflict-btn-next" title="Próximo arquivo">▶</button>
          </div>
          <span class="git-conflict-status-badge has-conflicts" id="git-conflict-badge-status">0 conflitos</span>
        </div>

        <div class="git-conflict-actions-center">
          <button type="button" class="git-conflict-btn git-conflict-btn-magic" id="git-conflict-btn-magic" title="Aceita automaticamente todas as alterações unilaterais que não conflitam">
            <span>🪄 Aplicar Sem Conflito</span>
          </button>
          <button type="button" class="git-conflict-btn" id="git-conflict-btn-accept-all-left" title="Aceitar todas as alterações da sua branch">
            <span>⏪ Tudo da Esquerda</span>
          </button>
          <button type="button" class="git-conflict-btn" id="git-conflict-btn-accept-all-right" title="Aceitar todas as alterações da branch de entrada">
            <span>Tudo da Direita ⏩</span>
          </button>
        </div>

        <div class="git-conflict-actions-right">
          <button type="button" class="git-conflict-btn git-conflict-btn-save" id="git-conflict-btn-save" title="Salvar arquivo resolvido e marcar como resolvido no Git (git add)">
            <span>💾 Salvar e Concluir</span>
          </button>
          <button type="button" class="git-conflict-btn git-conflict-btn-abort" id="git-conflict-btn-abort" title="Abortar processo de merge">
            <span>Abortar Merge</span>
          </button>
          <button type="button" class="git-conflict-btn-close" id="git-conflict-btn-close" title="Fechar">&times;</button>
        </div>
      </div>

      <div class="git-conflict-body">
        <!-- Coluna Esquerda: Sua Versão (Ours) -->
        <div class="git-conflict-col left-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-left">● Sua Versão (Local)</span>
              <span id="git-conflict-label-left" style="color:var(--text-3); font-weight:normal;"></span>
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
              <span class="col-tag-center">★ Resultado do Merge (Editável)</span>
            </div>
            <span id="git-conflict-center-stats" style="font-size:11px; color:var(--text-3);"></span>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-center-container">
            <textarea id="git-conflict-cm-textarea"></textarea>
          </div>
        </div>

        <!-- Coluna Direita: Versão de Entrada (Theirs) -->
        <div class="git-conflict-col right-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-right">● Versão de Entrada (Incoming)</span>
              <span id="git-conflict-label-right" style="color:var(--text-3); font-weight:normal;"></span>
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
    });

    btnAcceptAllRight.addEventListener('click', () => {
      if (!current3WayData) return;
      current3WayData.chunks.forEach(c => chunkStates.set(c.id, 'right'));
      rebuildCenterResult();
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

    // Sincronização de Scroll
    const leftBox = modal.querySelector('#git-conflict-left-container');
    const rightBox = modal.querySelector('#git-conflict-right-container');

    const handleScroll = (source) => {
      if (isSyncingScroll) return;
      isSyncingScroll = true;
      const top = source.scrollTop;
      const left = source.scrollLeft;

      if (source !== leftBox) { leftBox.scrollTop = top; leftBox.scrollLeft = left; }
      if (source !== rightBox) { rightBox.scrollTop = top; rightBox.scrollLeft = left; }
      if (cmCenter && source !== cmCenter.getScrollerElement()) {
        cmCenter.scrollTo(left, top);
      }
      setTimeout(() => { isSyncingScroll = false; }, 20);
    };

    leftBox.addEventListener('scroll', () => handleScroll(leftBox));
    rightBox.addEventListener('scroll', () => handleScroll(rightBox));
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
      if (leftBox) { leftBox.scrollTop = scrollInfo.top; leftBox.scrollLeft = scrollInfo.left; }
      if (rightBox) { rightBox.scrollTop = scrollInfo.top; rightBox.scrollLeft = scrollInfo.left; }
      setTimeout(() => { isSyncingScroll = false; }, 20);
    });

    cmCenter.on('change', () => {
      updateConflictStatusBadge();
    });
  }

  async function openGitConflictModal(projectDir) {
    currentProjectDir = projectDir || (window.ctxProject ? window.ctxProject.path : null);
    modalContainer = createModalDom();
    modalContainer.style.display = 'flex';

    initCodeMirror();

    if (window.electronAPI && window.electronAPI.gitConflictGetStatus) {
      const res = await window.electronAPI.gitConflictGetStatus(currentProjectDir);
      if (res && res.ok && res.data) {
        conflictFiles = res.data.conflictFiles || [];
        currentFileIndex = 0;
        updateFileListUi();
        if (conflictFiles.length > 0) {
          loadFile3Way(conflictFiles[0].path);
        } else {
          alert('Nenhum arquivo em conflito detectado neste repositório.');
          closeGitConflictModal();
        }
      }
    }
  }

  function closeGitConflictModal() {
    if (modalContainer) {
      modalContainer.style.display = 'none';
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
      cmCenter.refresh();
    }

    updateConflictStatusBadge();
  }

  function renderSideTables() {
    const tableLeft = document.getElementById('git-conflict-table-left');
    const tableRight = document.getElementById('git-conflict-table-right');
    if (!tableLeft || !tableRight || !current3WayData) return;

    tableLeft.innerHTML = '';
    tableRight.innerHTML = '';

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

      // Linhas da Esquerda (Ours)
      const leftLines = chunk.leftLines.length > 0 ? chunk.leftLines : [''];
      leftLines.forEach((lineText, lIdx) => {
        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${rowClass}`;
        tr.dataset.chunkId = chunk.id;

        const tdNum = document.createElement('td');
        tdNum.className = 'git-conflict-gutter-num';
        tdNum.textContent = chunk.leftLines.length > 0 ? (chunk.leftStartLine + lIdx) : '';

        const tdAction = document.createElement('td');
        tdAction.className = 'git-conflict-gutter-action';

        if (lIdx === 0 && (isConflict || isLeftOnly)) {
          const btnAccept = document.createElement('button');
          btnAccept.className = 'chunk-action-btn chunk-btn-accept-left';
          btnAccept.title = 'Aceitar este bloco no resultado (»)';
          btnAccept.textContent = '»';
          btnAccept.addEventListener('click', (e) => {
            e.stopPropagation();
            chunkStates.set(chunk.id, 'left');
            rebuildCenterResult();
            renderSideTables();
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.className = 'chunk-action-btn chunk-btn-ignore';
          btnIgnore.title = 'Ignorar este bloco (✕)';
          btnIgnore.textContent = '✕';
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
        tdCode.textContent = lineText;

        tr.appendChild(tdNum);
        tr.appendChild(tdAction);
        tr.appendChild(tdCode);
        tableLeft.appendChild(tr);
      });

      // Linhas da Direita (Theirs)
      const rightLines = chunk.rightLines.length > 0 ? chunk.rightLines : [''];
      rightLines.forEach((lineText, rIdx) => {
        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${rowClass}`;
        tr.dataset.chunkId = chunk.id;

        const tdAction = document.createElement('td');
        tdAction.className = 'git-conflict-gutter-action';

        if (rIdx === 0 && (isConflict || isRightOnly)) {
          const btnAccept = document.createElement('button');
          btnAccept.className = 'chunk-action-btn chunk-btn-accept-right';
          btnAccept.title = 'Aceitar este bloco no resultado («)';
          btnAccept.textContent = '«';
          btnAccept.addEventListener('click', (e) => {
            e.stopPropagation();
            chunkStates.set(chunk.id, 'right');
            rebuildCenterResult();
            renderSideTables();
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.className = 'chunk-action-btn chunk-btn-ignore';
          btnIgnore.title = 'Ignorar este bloco (✕)';
          btnIgnore.textContent = '✕';
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
        tdNum.textContent = chunk.rightLines.length > 0 ? (chunk.rightStartLine + rIdx) : '';

        const tdCode = document.createElement('td');
        tdCode.className = 'git-conflict-code-cell';
        tdCode.textContent = lineText;

        tr.appendChild(tdAction);
        tr.appendChild(tdNum);
        tr.appendChild(tdCode);
        tableRight.appendChild(tr);
      });
    });
  }

  function rebuildCenterResult() {
    if (!current3WayData || !cmCenter) return;

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
        // Nada inserido
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

    const scrollInfo = cmCenter.getScrollInfo();
    cmCenter.setValue(resultLines.join('\n'));
    cmCenter.scrollTo(scrollInfo.left, scrollInfo.top);
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
    if (!badge || !cmCenter) return;

    const text = cmCenter.getValue();
    const markerMatches = text.match(/<<<<<<< /g);
    const unresolvedCount = markerMatches ? markerMatches.length : 0;

    if (unresolvedCount > 0) {
      badge.className = 'git-conflict-status-badge has-conflicts';
      badge.textContent = `🔴 ${unresolvedCount} conflito${unresolvedCount > 1 ? 's' : ''} pendente${unresolvedCount > 1 ? 's' : ''}`;
    } else {
      badge.className = 'git-conflict-status-badge resolved';
      badge.textContent = `✓ Todos os conflitos resolvidos`;
    }

    if (statsEl) {
      statsEl.textContent = `${cmCenter.lineCount()} linhas`;
    }
  }

  async function saveCurrentResolution() {
    if (!cmCenter || !current3WayData) return;

    const text = cmCenter.getValue();
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
        showToast(`✓ Arquivo ${current3WayData.relPath} salvo e adicionado ao Git!`);
      }

      if (res.remainingConflicts > 0 && res.conflictFiles && res.conflictFiles.length > 0) {
        conflictFiles = res.conflictFiles;
        currentFileIndex = 0;
        updateFileListUi();
        loadFile3Way(conflictFiles[0].path);
      } else {
        if (typeof showToast === 'function') {
          showToast('🎉 Todos os conflitos do repositório foram resolvidos com sucesso!');
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
