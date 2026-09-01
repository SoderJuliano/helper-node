// renderer/gitDiff/gitDiffModalDom.js
// Construção e estruturação do DOM do Visualizador de Alterações (Diff Modal).

(function() {
  'use strict';

  const SVGI_DIFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px; height:16px;"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';
  const SVGI_BRANCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>';
  const SVGI_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const SVGI_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  const SVGI_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const SVGI_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';

  function buildGitDiffModalDom() {
    let container = document.getElementById('git-diff-modal-root');
    if (container) return container;

    container = document.createElement('div');
    container.id = 'git-diff-modal-root';
    container.className = 'git-diff-modal-backdrop';
    container.style.display = 'none';

    container.innerHTML = `
      <div class="git-diff-header">
        <div class="git-diff-header-left">
          <span class="git-diff-header-icon">${SVGI_DIFF}</span>
          <span class="git-diff-title">Visualizador de Alterações (Diff)</span>
          <span class="git-diff-branch-badge" id="git-diff-branch-badge">
            <span class="git-diff-branch-icon">${SVGI_BRANCH}</span>
            <span id="git-diff-branch-name">master</span>
          </span>
          <span class="git-diff-upstream-badge" id="git-diff-upstream-badge">origin/master</span>
        </div>

        <div class="git-diff-header-center">
          <span class="git-diff-stat-pill" id="git-diff-summary-pill">0 arquivos alterados</span>
        </div>

        <div class="git-diff-header-right">
          <button class="git-diff-btn-icon" id="git-diff-refresh-btn" title="Recarregar Alterações">
            ${SVGI_REFRESH}
          </button>
          <button class="git-diff-close-btn" id="git-diff-close-btn" title="Fechar (Esc)">
            ${SVGI_CLOSE}
          </button>
        </div>
      </div>

      <div class="git-diff-body">
        <div class="git-diff-sidebar" id="git-diff-sidebar">
          <div class="git-diff-sidebar-search-box">
            <span class="git-diff-search-icon">${SVGI_SEARCH}</span>
            <input type="text" class="git-diff-search-input" id="git-diff-search-input" placeholder="Filtrar arquivos..." />
          </div>
          <div class="git-diff-file-list" id="git-diff-file-list"></div>
        </div>

        <div class="git-diff-main" id="git-diff-main">
          <div class="git-diff-file-toolbar" id="git-diff-file-toolbar">
            <div class="git-diff-file-path-group">
              <span class="git-diff-file-status-badge" id="git-diff-current-status-badge">M</span>
              <span class="git-diff-file-current-path" id="git-diff-current-path">Selecione um arquivo</span>
            </div>
            <div class="git-diff-file-actions">
              <span class="git-diff-file-stats" id="git-diff-file-stats">+0 -0</span>
              <button class="git-diff-action-btn" id="git-diff-copy-path-btn" title="Copiar caminho relativo">
                ${SVGI_COPY} Copiar Caminho
              </button>
              <button class="git-diff-action-btn" id="git-diff-copy-code-btn" title="Copiar código com alterações">
                ${SVGI_COPY} Copiar Código
              </button>
            </div>
          </div>

          <div class="git-diff-panes-header">
            <div class="git-diff-pane-title git-diff-pane-title-left">
              <span>Antes (Base / Repositório)</span>
            </div>
            <div class="git-diff-pane-title git-diff-pane-title-right">
              <span>Depois (Alterações Locais)</span>
            </div>
          </div>

          <div class="git-diff-viewport" id="git-diff-viewport">
            <div class="git-diff-pane-scroll" id="git-diff-pane-left-scroll">
              <div class="git-diff-code-table" id="git-diff-table-left"></div>
            </div>
            <div class="git-diff-pane-scroll" id="git-diff-pane-right-scroll">
              <div class="git-diff-code-table" id="git-diff-table-right"></div>
            </div>
          </div>

          <div class="git-diff-empty-state" id="git-diff-empty-state" style="display:none;">
            <div class="git-diff-empty-icon">${SVGI_DIFF}</div>
            <div class="git-diff-empty-title">Nenhuma alteração pendente</div>
            <div class="git-diff-empty-desc">Todos os arquivos locais estão sincronizados com a branch base.</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(container);
    return container;
  }

  window.GitDiffModalDom = {
    buildGitDiffModalDom,
    SVGI_DIFF,
    SVGI_BRANCH,
    SVGI_CLOSE,
    SVGI_COPY,
    SVGI_REFRESH
  };
})();
