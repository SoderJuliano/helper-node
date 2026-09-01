// renderer/gitDiff/gitDiffModal.js
// Controlador principal do Visualizador de Alterações Git (Diff Viewer).

(function() {
  'use strict';

  let modalContainer = null;
  let currentProjectDir = null;
  let diffSummaryData = null;
  let activeFile = null;
  let activeFileDiffData = null;

  function escapeDiffHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getStatusLabel(statusCode) {
    switch (statusCode) {
      case 'A': return { label: 'Adicionado', badgeClass: 'badge-added' };
      case 'D': return { label: 'Deletado', badgeClass: 'badge-deleted' };
      case 'U': return { label: 'Não rastreado', badgeClass: 'badge-untracked' };
      case 'R': return { label: 'Renomeado', badgeClass: 'badge-renamed' };
      default: return { label: 'Modificado', badgeClass: 'badge-modified' };
    }
  }

  function initModal() {
    if (modalContainer) return modalContainer;
    modalContainer = window.GitDiffModalDom.buildGitDiffModalDom();
    window.GitDiffModalEvents.wireGitDiffEventListeners(modalContainer, {
      onClose: closeGitDiffModal,
      onRefresh: () => {
        if (currentProjectDir) openGitDiffModal(currentProjectDir);
      },
      onCopyPath: () => {
        if (activeFile && activeFile.relPath && window.electronAPI && window.electronAPI.copyToClipboard) {
          window.electronAPI.copyToClipboard(activeFile.relPath);
          if (typeof window.showToast === 'function') window.showToast('Caminho copiado!');
        }
      },
      onCopyCode: () => {
        if (activeFileDiffData && window.electronAPI && window.electronAPI.copyToClipboard) {
          const textToCopy = activeFileDiffData.newText || activeFileDiffData.oldText || '';
          window.electronAPI.copyToClipboard(textToCopy);
          if (typeof window.showToast === 'function') window.showToast('Código copiado!');
        }
      }
    });
    return modalContainer;
  }

  function renderFileList(files) {
    const listEl = modalContainer.querySelector('#git-diff-file-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!files || files.length === 0) {
      listEl.innerHTML = '<div class="git-diff-no-files">Nenhum arquivo alterado.</div>';
      return;
    }

    files.forEach((file) => {
      const item = document.createElement('div');
      item.className = 'git-diff-file-item' + (activeFile && activeFile.relPath === file.relPath ? ' active' : '');
      item.dataset.fileName = file.fileName;
      item.dataset.relPath = file.relPath;

      const { badgeClass } = getStatusLabel(file.statusCode);

      item.innerHTML = `
        <span class="git-diff-file-badge ${badgeClass}">${file.statusCode}</span>
        <div class="git-diff-file-meta">
          <span class="git-diff-file-name" title="${escapeDiffHtml(file.relPath)}">${escapeDiffHtml(file.fileName)}</span>
          ${file.dirName ? `<span class="git-diff-file-dir" title="${escapeDiffHtml(file.dirName)}">${escapeDiffHtml(file.dirName)}</span>` : ''}
        </div>
      `;

      item.onclick = () => {
        modalContainer.querySelectorAll('.git-diff-file-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');
        loadFileDiff(file);
      };

      listEl.appendChild(item);
    });
  }

  function renderDiffRows(diffData) {
    const leftTable = modalContainer.querySelector('#git-diff-table-left');
    const rightTable = modalContainer.querySelector('#git-diff-table-right');
    const emptyState = modalContainer.querySelector('#git-diff-empty-state');
    const viewport = modalContainer.querySelector('#git-diff-viewport');

    if (!leftTable || !rightTable) return;
    leftTable.innerHTML = '';
    rightTable.innerHTML = '';

    if (!diffData) return;

    if (diffData.isBinary) {
      if (emptyState) emptyState.style.display = 'none';
      if (viewport) viewport.style.display = 'flex';
      leftTable.innerHTML = '<div class="git-diff-binary-msg">Arquivo binário — visualização textual indisponível.</div>';
      rightTable.innerHTML = '<div class="git-diff-binary-msg">Arquivo binário — visualização textual indisponível.</div>';
      return;
    }

    const rows = diffData.rows || [];
    if (rows.length === 0) {
      leftTable.innerHTML = '<div class="git-diff-binary-msg">Arquivo sem alterações de conteúdo.</div>';
      rightTable.innerHTML = '<div class="git-diff-binary-msg">Arquivo sem alterações de conteúdo.</div>';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (viewport) viewport.style.display = 'flex';

    let leftHtml = '';
    let rightHtml = '';

    for (let idx = 0; idx < rows.length; idx++) {
      const r = rows[idx];
      const l = r.left;
      const right = r.right;

      const leftClass = l.type === 'delete' ? 'git-diff-line-delete' : (l.type === 'empty' ? 'git-diff-line-empty' : 'git-diff-line-equal');
      const rightClass = right.type === 'insert' ? 'git-diff-line-insert' : (right.type === 'empty' ? 'git-diff-line-empty' : 'git-diff-line-equal');

      const leftNum = l.lineNum != null ? l.lineNum : '';
      const rightNum = right.lineNum != null ? right.lineNum : '';

      leftHtml += `
        <div class="git-diff-row ${leftClass}">
          <span class="git-diff-num">${leftNum}</span>
          <span class="git-diff-sign">${l.type === 'delete' ? '-' : (l.type === 'empty' ? '' : ' ')}</span>
          <pre class="git-diff-content"><code>${escapeDiffHtml(l.text)}</code></pre>
        </div>
      `;

      rightHtml += `
        <div class="git-diff-row ${rightClass}">
          <span class="git-diff-num">${rightNum}</span>
          <span class="git-diff-sign">${right.type === 'insert' ? '+' : (right.type === 'empty' ? '' : ' ')}</span>
          <pre class="git-diff-content"><code>${escapeDiffHtml(right.text)}</code></pre>
        </div>
      `;
    }

    leftTable.innerHTML = leftHtml;
    rightTable.innerHTML = rightHtml;
  }

  async function loadFileDiff(file) {
    activeFile = file;
    const pathEl = modalContainer.querySelector('#git-diff-current-path');
    const badgeEl = modalContainer.querySelector('#git-diff-current-status-badge');
    const statsEl = modalContainer.querySelector('#git-diff-file-stats');

    if (pathEl) pathEl.textContent = file.relPath;
    if (badgeEl) {
      const { badgeClass } = getStatusLabel(file.statusCode);
      badgeEl.className = `git-diff-file-status-badge ${badgeClass}`;
      badgeEl.textContent = file.statusCode;
    }
    if (statsEl) statsEl.textContent = 'Carregando...';

    if (window.electronAPI && window.electronAPI.gitDiffGetFile) {
      const res = await window.electronAPI.gitDiffGetFile({
        projectPath: currentProjectDir,
        relPath: file.relPath,
        baseRef: diffSummaryData ? diffSummaryData.baseRef : null
      });

      if (res && res.ok && res.data) {
        activeFileDiffData = res.data;
        if (statsEl) {
          statsEl.innerHTML = `<span class="stat-add">+${res.data.additions}</span> <span class="stat-del">-${res.data.deletions}</span>`;
        }
        renderDiffRows(res.data);
      } else {
        if (statsEl) statsEl.textContent = 'Erro ao carregar';
      }
    }
  }

  async function openGitDiffModal(projectPath) {
    currentProjectDir = projectPath || (window.ctxProject ? window.ctxProject.path : null) || null;
    modalContainer = initModal();
    modalContainer.style.display = 'flex';
    document.body.classList.add('git-diff-open');

    const branchBadge = modalContainer.querySelector('#git-diff-branch-name');
    const upstreamBadge = modalContainer.querySelector('#git-diff-upstream-badge');
    const summaryPill = modalContainer.querySelector('#git-diff-summary-pill');
    const emptyState = modalContainer.querySelector('#git-diff-empty-state');
    const viewport = modalContainer.querySelector('#git-diff-viewport');

    if (summaryPill) summaryPill.textContent = 'Carregando alterações...';

    if (window.electronAPI && window.electronAPI.gitDiffGetSummary) {
      const res = await window.electronAPI.gitDiffGetSummary(currentProjectDir);
      if (res && res.ok && res.data) {
        diffSummaryData = res.data;
        if (branchBadge) branchBadge.textContent = res.data.currentBranch || 'master';
        if (upstreamBadge) upstreamBadge.textContent = `Comparando com: ${res.data.upstreamName || 'Base'}`;
        if (summaryPill) summaryPill.textContent = `${res.data.filesCount} arquivo(s) com alterações`;

        const files = res.data.files || [];
        renderFileList(files);

        if (files.length > 0) {
          if (emptyState) emptyState.style.display = 'none';
          if (viewport) viewport.style.display = 'flex';
          loadFileDiff(files[0]);
        } else {
          if (emptyState) emptyState.style.display = 'flex';
          if (viewport) viewport.style.display = 'none';
          const pathEl = modalContainer.querySelector('#git-diff-current-path');
          if (pathEl) pathEl.textContent = 'Nenhuma alteração pendente';
          const statsEl = modalContainer.querySelector('#git-diff-file-stats');
          if (statsEl) statsEl.textContent = '';
        }
      } else {
        if (summaryPill) summaryPill.textContent = 'Erro ao verificar Git';
        if (emptyState) {
          emptyState.style.display = 'flex';
          emptyState.querySelector('.git-diff-empty-title').textContent = 'Erro ao carregar alterações';
          emptyState.querySelector('.git-diff-empty-desc').textContent = res ? res.error : 'Erro desconhecido';
        }
        if (viewport) viewport.style.display = 'none';
      }
    }
  }

  function closeGitDiffModal() {
    if (modalContainer) {
      modalContainer.style.display = 'none';
    }
    document.body.classList.remove('git-diff-open');
  }

  window.GitDiffModal = {
    openGitDiffModal,
    closeGitDiffModal
  };

  window.openGitDiffModal = openGitDiffModal;
  window.closeGitDiffModal = closeGitDiffModal;
})();
