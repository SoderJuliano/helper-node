// renderer/gitConflict/gitConflictModalDom.js
// Construção e estruturação do DOM do Visualizador de Conflitos 3-Way (Estilo IntelliJ IDEA).

(function() {
  'use strict';

  const SVGI_PREV_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>';
  const SVGI_NEXT_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const SVGI_UP_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>';
  const SVGI_DOWN_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const SVGI_MAGIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-2 2 4 4 2-2z"/><path d="m8 11-5 5 2 2 5-5"/><path d="m19 11 2 2-2 2-2-2z"/><path d="m5 5 2 2-2 2-2-2z"/></svg>';
  const SVGI_ALL_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>';
  const SVGI_ALL_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>';
  const SVGI_SAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>';
  const SVGI_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  
  // Setas de ação IntelliJ: chevron para a direita (») e chevron para a esquerda («)
  const SVGI_APPLY_RIGHT_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/><polyline points="15 18 21 12 15 6"/></svg>';
  const SVGI_APPLY_LEFT_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/><polyline points="9 18 3 12 9 6"/></svg>';
  const SVGI_IGNORE_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const SVGI_UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>';

  function buildGitConflictModalDom() {
    let modal = document.getElementById('git-conflict-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'git-conflict-modal';
      modal.className = 'git-conflict-modal-backdrop';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div class="git-conflict-header">
        <div class="git-conflict-title-group">
          <div class="git-conflict-file-nav">
            <button type="button" class="git-conflict-nav-btn" id="git-conflict-btn-prev" title="Arquivo anterior">${SVGI_PREV_ARROW}</button>
            <select class="git-conflict-file-select" id="git-conflict-file-select"></select>
            <button type="button" class="git-conflict-nav-btn" id="git-conflict-btn-next" title="Próximo arquivo">${SVGI_NEXT_ARROW}</button>
          </div>

          <div class="git-conflict-jump-group" id="git-conflict-jump-group">
            <button type="button" class="git-conflict-jump-btn" id="git-conflict-btn-prev-conflict" title="Conflito anterior (Alt+Shift+Up)">
              ${SVGI_UP_ARROW}
              <span>Anterior</span>
            </button>
            <span class="git-conflict-jump-counter" id="git-conflict-jump-counter">0 / 0</span>
            <button type="button" class="git-conflict-jump-btn" id="git-conflict-btn-next-conflict" title="Próximo conflito (Alt+Shift+Down)">
              <span>Próximo</span>
              ${SVGI_DOWN_ARROW}
            </button>
          </div>

          <span class="git-conflict-status-badge has-conflicts" id="git-conflict-badge-status">0 conflitos</span>
        </div>

        <div class="git-conflict-actions-center">
          <button type="button" class="git-conflict-action-btn" id="git-conflict-btn-magic" title="Aplica alterações unilaterais da esquerda e direita que não conflitam">
            ${SVGI_MAGIC}
            <span>Aplicar Sem Conflito</span>
          </button>
          <button type="button" class="git-conflict-action-btn git-conflict-btn-left" id="git-conflict-btn-accept-all-left" title="Aceitar todas as alterações da sua branch (Local / Ours)">
            ${SVGI_ALL_LEFT}
            <span>Tudo da Esquerda</span>
          </button>
          <button type="button" class="git-conflict-action-btn git-conflict-btn-right" id="git-conflict-btn-accept-all-right" title="Aceitar todas as alterações da branch de entrada (Incoming / Theirs)">
            <span>Tudo da Direita</span>
            ${SVGI_ALL_RIGHT}
          </button>
        </div>

        <div class="git-conflict-actions-right">
          <button type="button" class="git-conflict-action-btn git-conflict-save-btn" id="git-conflict-btn-save" title="Salvar arquivo resolvido e concluir no Git (Ctrl+S)">
            ${SVGI_SAVE}
            <span>Salvar e Concluir</span>
          </button>
          <button type="button" class="git-conflict-action-btn git-conflict-abort-btn" id="git-conflict-btn-abort" title="Abortar processo de merge">
            <span>Abortar Merge</span>
          </button>
          <button type="button" class="git-conflict-close-btn" id="git-conflict-btn-close" title="Fechar visualizador de conflitos (Esc)">
            ${SVGI_CLOSE}
          </button>
        </div>
      </div>

      <div class="git-conflict-body">
        <!-- Coluna Esquerda: Sua Versão (Local / Ours) -->
        <div class="git-conflict-col left-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-left">Sua Versão (Local)</span>
              <span id="git-conflict-label-left" class="col-branch-label"></span>
            </div>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-left-container">
            <table class="git-conflict-table" id="git-conflict-table-left"></table>
          </div>
        </div>

        <!-- Coluna Central: Resultado do Merge (Result - Arquivo Final) -->
        <div class="git-conflict-col center-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-center">Resultado do Merge (Result)</span>
              <span id="git-conflict-center-badge" class="col-center-badge"></span>
            </div>
            <span id="git-conflict-center-stats" class="col-center-stats"></span>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-center-container">
            <table class="git-conflict-table git-conflict-table-center" id="git-conflict-table-center"></table>
          </div>
        </div>

        <!-- Coluna Direita: Versão de Entrada (Incoming / Theirs) -->
        <div class="git-conflict-col right-col">
          <div class="git-conflict-col-header">
            <div class="git-conflict-col-title">
              <span class="col-tag-right">Versão de Entrada (Incoming)</span>
              <span id="git-conflict-label-right" class="col-branch-label"></span>
            </div>
          </div>
          <div class="git-conflict-editor-container" id="git-conflict-right-container">
            <table class="git-conflict-table" id="git-conflict-table-right"></table>
          </div>
        </div>
      </div>
    `;

    return modal;
  }

  function renderGitConflict3Way(current3WayData, chunkStates, customCenterEdits, onAction, onCenterEdit) {
    const tableLeft = document.getElementById('git-conflict-table-left');
    const tableCenter = document.getElementById('git-conflict-table-center');
    const tableRight = document.getElementById('git-conflict-table-right');
    if (!tableLeft || !tableCenter || !tableRight || !current3WayData) return;

    const fragLeft = document.createDocumentFragment();
    const fragCenter = document.createDocumentFragment();
    const fragRight = document.createDocumentFragment();

    let centerLineCounter = 1;

    current3WayData.chunks.forEach((chunk) => {
      const state = chunkStates.get(chunk.id);
      const isConflict = chunk.type === 'CONFLICT';
      const isLeftOnly = chunk.type === 'LEFT_ONLY';
      const isRightOnly = chunk.type === 'RIGHT_ONLY';
      const isSame = chunk.type === 'SAME_CHANGE';
      const isEqual = chunk.type === 'EQUAL';

      // Determina linhas e destaque para a coluna central (Resultado)
      let centerLines = [];
      let centerChunkClass = '';
      let centerStatusHtml = '';

      if (customCenterEdits && customCenterEdits.has(chunk.id)) {
        centerLines = customCenterEdits.get(chunk.id);
        centerChunkClass = 'chunk-center-custom';
        centerStatusHtml = '<span class="badge-source-edit" title="Editado manualmente no resultado">Editado</span>';
      } else if (state === 'left') {
        centerLines = chunk.leftLines ? [...chunk.leftLines] : [];
        centerChunkClass = 'chunk-center-left';
        centerStatusHtml = '<span class="badge-source-left" title="Aceito da versão Local (Esquerda)">Local</span>';
      } else if (state === 'right') {
        centerLines = chunk.rightLines ? [...chunk.rightLines] : [];
        centerChunkClass = 'chunk-center-right';
        centerStatusHtml = '<span class="badge-source-right" title="Aceito da versão Entrada (Direita)">Entrada</span>';
      } else if (state === 'both') {
        centerLines = chunk.leftLines && chunk.leftLines.length > 0 ? [...chunk.leftLines] : [...chunk.rightLines];
        centerChunkClass = 'chunk-center-both';
        centerStatusHtml = '';
      } else if (state === 'ignored') {
        centerLines = [];
        centerChunkClass = 'chunk-center-ignored';
        centerStatusHtml = '<span class="badge-source-ignored" title="Bloco descartado/ignorado">Desc</span>';
      } else { // 'unresolved'
        if (isConflict) {
          centerLines = [
            `// ⚠️ CONFLITO PENDENTE: Clique [ » ] na Esquerda ou [ « ] na Direita`,
            ...(chunk.leftLines && chunk.leftLines.length > 0 ? chunk.leftLines : chunk.rightLines)
          ];
          centerChunkClass = 'chunk-center-unresolved';
          centerStatusHtml = '<span class="badge-source-unresolved" title="Conflito pendente de decisão">⚠️</span>';
        } else if (isLeftOnly) {
          centerLines = [...chunk.leftLines];
          centerChunkClass = 'chunk-center-left';
          centerStatusHtml = '<span class="badge-source-left" title="Alteração sem conflito da Esquerda">Local</span>';
        } else if (isRightOnly) {
          centerLines = [...chunk.rightLines];
          centerChunkClass = 'chunk-center-right';
          centerStatusHtml = '<span class="badge-source-right" title="Alteração sem conflito da Direita">Entrada</span>';
        } else {
          centerLines = [...chunk.leftLines];
          centerChunkClass = 'chunk-center-both';
          centerStatusHtml = '';
        }
      }

      const leftCount = chunk.leftLines ? chunk.leftLines.length : 0;
      const rightCount = chunk.rightLines ? chunk.rightLines.length : 0;
      const centerCount = centerLines ? centerLines.length : 0;
      const maxLines = Math.max(leftCount, rightCount, centerCount, 1);

      // Classes de destaque das colunas laterais
      let rowClassLeft = 'chunk-row-equal';
      let rowClassRight = 'chunk-row-equal';

      if (isConflict) {
        if (state === 'left') {
          rowClassLeft = 'chunk-row-conflict chunk-side-applied-left';
          rowClassRight = 'chunk-row-conflict chunk-side-other';
        } else if (state === 'right') {
          rowClassLeft = 'chunk-row-conflict chunk-side-other';
          rowClassRight = 'chunk-row-conflict chunk-side-applied-right';
        } else if (state === 'both') {
          rowClassLeft = 'chunk-row-conflict chunk-side-applied-left';
          rowClassRight = 'chunk-row-conflict chunk-side-applied-right';
        } else if (state === 'ignored') {
          rowClassLeft = 'chunk-row-conflict chunk-side-ignored';
          rowClassRight = 'chunk-row-conflict chunk-side-ignored';
        } else {
          rowClassLeft = 'chunk-row-conflict chunk-side-unresolved';
          rowClassRight = 'chunk-row-conflict chunk-side-unresolved';
        }
      } else if (isLeftOnly) {
        rowClassLeft = (state === 'ignored') ? 'chunk-row-left-only chunk-side-ignored' : 'chunk-row-left-only chunk-side-applied-left';
      } else if (isRightOnly) {
        rowClassRight = (state === 'ignored') ? 'chunk-row-right-only chunk-side-ignored' : 'chunk-row-right-only chunk-side-applied-right';
      }

      // 1. Gera linhas da Esquerda (Local)
      for (let i = 0; i < maxLines; i++) {
        const isActualLine = i < leftCount;
        const lineText = isActualLine ? chunk.leftLines[i] : '';

        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${rowClassLeft}${!isActualLine ? ' chunk-row-spacer' : ''}`;
        tr.dataset.chunkId = chunk.id;

        const tdNum = document.createElement('td');
        tdNum.className = 'git-conflict-gutter-num';
        tdNum.textContent = isActualLine ? String(chunk.leftStartLine + i) : '';

        const tdAction = document.createElement('td');
        tdAction.className = 'git-conflict-gutter-action';

        if (i === 0 && (isConflict || isLeftOnly)) {
          const isApplied = (state === 'left' || state === 'both');

          const btnAccept = document.createElement('button');
          btnAccept.type = 'button';
          btnAccept.className = `chunk-action-btn chunk-btn-apply-left ${isApplied ? 'is-applied' : ''}`;
          btnAccept.title = isApplied ? 'Alteração da esquerda aplicada no centro (clique para desfazer)' : 'Aplicar alteração da esquerda no resultado (»)';
          btnAccept.innerHTML = isApplied ? SVGI_UNDO : SVGI_APPLY_RIGHT_ARROW;
          btnAccept.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(chunk.id, isApplied ? 'unresolved' : 'left');
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.type = 'button';
          btnIgnore.className = `chunk-action-btn chunk-btn-ignore ${state === 'ignored' ? 'is-ignored' : ''}`;
          btnIgnore.title = state === 'ignored' ? 'Alteração ignorada (clique para restaurar)' : 'Ignorar esta alteração (✕)';
          btnIgnore.innerHTML = SVGI_IGNORE_X;
          btnIgnore.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(chunk.id, state === 'ignored' ? 'unresolved' : 'ignored');
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

      // 2. Gera linhas do Centro (Resultado do Merge - Editável)
      for (let i = 0; i < maxLines; i++) {
        const isActualLine = i < centerCount;
        const lineText = isActualLine ? centerLines[i] : '';

        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${centerChunkClass}${!isActualLine ? ' chunk-row-spacer' : ''}`;
        tr.dataset.chunkId = chunk.id;

        const tdNum = document.createElement('td');
        tdNum.className = 'git-conflict-gutter-num';
        tdNum.textContent = isActualLine ? String(centerLineCounter++) : '';

        const tdStatus = document.createElement('td');
        tdStatus.className = 'git-conflict-gutter-status';
        if (i === 0 && centerStatusHtml) {
          tdStatus.innerHTML = centerStatusHtml;
        }

        const tdCode = document.createElement('td');
        tdCode.className = 'git-conflict-code-cell git-conflict-editable-cell';
        tdCode.contentEditable = isActualLine ? 'true' : 'false';
        tdCode.spellcheck = false;
        tdCode.textContent = isActualLine ? (lineText || '\u00A0') : '\u00A0';

        if (isActualLine) {
          tdCode.addEventListener('input', () => {
            if (typeof onCenterEdit === 'function') {
              const rows = tableCenter.querySelectorAll(`[data-chunk-id="${chunk.id}"] .git-conflict-editable-cell`);
              const updatedLines = [];
              rows.forEach(cell => {
                if (cell.contentEditable === 'true') {
                  updatedLines.push(cell.textContent.replace(/\u00A0/g, ''));
                }
              });
              onCenterEdit(chunk.id, updatedLines);
            }
          });
        }

        tr.appendChild(tdNum);
        tr.appendChild(tdStatus);
        tr.appendChild(tdCode);
        fragCenter.appendChild(tr);
      }

      // 3. Gera linhas da Direita (Incoming)
      for (let i = 0; i < maxLines; i++) {
        const isActualLine = i < rightCount;
        const lineText = isActualLine ? chunk.rightLines[i] : '';

        const tr = document.createElement('tr');
        tr.className = `git-conflict-row ${rowClassRight}${!isActualLine ? ' chunk-row-spacer' : ''}`;
        tr.dataset.chunkId = chunk.id;

        const tdAction = document.createElement('td');
        tdAction.className = 'git-conflict-gutter-action';

        if (i === 0 && (isConflict || isRightOnly)) {
          const isApplied = (state === 'right' || state === 'both');

          const btnAccept = document.createElement('button');
          btnAccept.type = 'button';
          btnAccept.className = `chunk-action-btn chunk-btn-apply-right ${isApplied ? 'is-applied' : ''}`;
          btnAccept.title = isApplied ? 'Alteração da direita aplicada no centro (clique para desfazer)' : 'Aplicar alteração da direita no resultado («)';
          btnAccept.innerHTML = isApplied ? SVGI_UNDO : SVGI_APPLY_LEFT_ARROW;
          btnAccept.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(chunk.id, isApplied ? 'unresolved' : 'right');
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.type = 'button';
          btnIgnore.className = `chunk-action-btn chunk-btn-ignore ${state === 'ignored' ? 'is-ignored' : ''}`;
          btnIgnore.title = state === 'ignored' ? 'Alteração ignorada (clique para restaurar)' : 'Ignorar esta alteração (✕)';
          btnIgnore.innerHTML = SVGI_IGNORE_X;
          btnIgnore.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(chunk.id, state === 'ignored' ? 'unresolved' : 'ignored');
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
    tableCenter.innerHTML = '';
    tableRight.innerHTML = '';

    tableLeft.appendChild(fragLeft);
    tableCenter.appendChild(fragCenter);
    tableRight.appendChild(fragRight);

    const statsEl = document.getElementById('git-conflict-center-stats');
    if (statsEl) {
      statsEl.textContent = `${centerLineCounter - 1} linhas`;
    }
  }

  window.GitConflictModalDom = {
    buildGitConflictModalDom,
    renderGitConflict3Way
  };
})();
