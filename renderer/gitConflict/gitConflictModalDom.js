// renderer/gitConflict/gitConflictModalDom.js
// DOM creation and side-table rendering for Git Conflict 3-way modal.
(function() {
  'use strict';

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

  function buildGitConflictModalDom() {
    const existing = document.getElementById('git-conflict-modal');
    if (existing) {
      existing.remove();
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
    return modal;
  }

  function getGitConflictSyntaxMode(filePath) {
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

  function renderGitConflictSideTables(current3WayData, chunkStates, onAction) {
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
            onAction(chunk.id, 'left');
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.className = 'chunk-action-btn chunk-btn-ignore';
          btnIgnore.title = 'Ignorar este bloco';
          btnIgnore.innerHTML = SVGI_IGNORE;
          btnIgnore.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(chunk.id, 'ignored');
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
            onAction(chunk.id, 'right');
          });

          const btnIgnore = document.createElement('button');
          btnIgnore.className = 'chunk-action-btn chunk-btn-ignore';
          btnIgnore.title = 'Ignorar este bloco';
          btnIgnore.innerHTML = SVGI_IGNORE;
          btnIgnore.addEventListener('click', (e) => {
            e.stopPropagation();
            onAction(chunk.id, 'ignored');
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

  window.GitConflictModalDom = {
    buildGitConflictModalDom,
    getGitConflictSyntaxMode,
    renderGitConflictSideTables,
  };
})();
