// renderer/newProjectModal.js
// Modal de Criação de Novo Projeto com escolha de pasta de destino e criação de diretório
(function() {
  'use strict';

  const SVGI_NEW_PROJECT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" class="new-project-icon"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
  const SVGI_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

  async function openNewProjectModal() {
    // Remove modal anterior caso exista
    const existing = document.getElementById('new-project-modal-backdrop');
    if (existing) existing.remove();

    // Determina o diretório pai padrão
    let currentParentDir = '';
    if (window.electronAPI && typeof window.electronAPI.getDefaultParentDir === 'function') {
      try {
        currentParentDir = await window.electronAPI.getDefaultParentDir();
      } catch (err) {
        console.warn('[newProjectModal] Falha ao obter default parent dir:', err);
      }
    }

    if (!currentParentDir) {
      const wsMain = document.getElementById('ws-project-main');
      const curPath = wsMain && wsMain.dataset.path ? wsMain.dataset.path : '';
      if (curPath) {
        const sep = curPath.includes('\\') ? '\\' : '/';
        const parts = curPath.split(/[\\/]/).filter(Boolean);
        if (parts.length > 1) {
          parts.pop();
          currentParentDir = parts.join(sep);
        }
      }
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'new-project-modal-backdrop';
    backdrop.className = 'new-project-modal-backdrop';

    backdrop.innerHTML = `
      <div class="new-project-modal" id="new-project-modal">
        <div class="new-project-header">
          <div class="new-project-title">
            ${SVGI_NEW_PROJECT}
            <span>Novo Projeto</span>
          </div>
          <button type="button" class="new-project-btn-close" id="new-project-btn-close" title="Fechar (Esc)">&times;</button>
        </div>

        <div class="new-project-body">
          <div class="new-project-field-group">
            <label class="new-project-label" for="new-project-name-input">Nome da nova pasta / projeto:</label>
            <input type="text" id="new-project-name-input" class="new-project-input" placeholder="Ex: meu-novo-projeto" autofocus autocomplete="off" spellcheck="false" />
          </div>

          <div class="new-project-field-group">
            <label class="new-project-label" for="new-project-location-input">Onde salvar (pasta de destino):</label>
            <div class="new-project-location-row">
              <input type="text" id="new-project-location-input" class="new-project-location-input" readonly value="${currentParentDir || ''}" title="${currentParentDir || ''}" />
              <button type="button" class="new-project-btn-browse" id="new-project-btn-browse" title="Escolher onde salvar o projeto">
                ${SVGI_FOLDER}
                <span>Escolher pasta…</span>
              </button>
            </div>
          </div>

          <div class="new-project-preview-wrap" id="new-project-preview-wrap">
            Caminho do novo projeto: <strong id="new-project-full-path">...</strong>
          </div>

          <div class="new-project-error-msg" id="new-project-error-msg"></div>
        </div>

        <div class="new-project-footer">
          <div class="new-project-hints">
            <span>Enter para criar &bull; Esc para cancelar</span>
          </div>
          <div class="new-project-actions">
            <button type="button" class="new-project-btn new-project-btn-cancel" id="new-project-btn-cancel">Cancelar</button>
            <button type="button" class="new-project-btn new-project-btn-create" id="new-project-btn-create" disabled>Criar Projeto</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);

    const inputName = document.getElementById('new-project-name-input');
    const inputLocation = document.getElementById('new-project-location-input');
    const btnBrowse = document.getElementById('new-project-btn-browse');
    const fullPathPreview = document.getElementById('new-project-full-path');
    const errorEl = document.getElementById('new-project-error-msg');
    const btnClose = document.getElementById('new-project-btn-close');
    const btnCancel = document.getElementById('new-project-btn-cancel');
    const btnCreate = document.getElementById('new-project-btn-create');

    const closeModal = () => {
      backdrop.remove();
    };

    const showError = (msg) => {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.style.display = 'block';
      }
    };

    const clearError = () => {
      if (errorEl) {
        errorEl.textContent = '';
        errorEl.style.display = 'none';
      }
    };

    const getSeparator = () => {
      return (currentParentDir && currentParentDir.includes('\\')) ? '\\' : '/';
    };

    const updatePreview = () => {
      const rawName = inputName.value.trim();
      const sep = getSeparator();
      const cleanParent = (currentParentDir || '').replace(/[\\/]+$/, '');

      if (!rawName) {
        fullPathPreview.textContent = cleanParent ? `${cleanParent}${sep}...` : '...';
        btnCreate.disabled = true;
        clearError();
        return;
      }

      // Validação de caracteres inválidos para pastas em Windows/Linux
      if (/[\\/:*?"<>|]/.test(rawName)) {
        showError('O nome não pode conter caracteres especiais como: \\ / : * ? " < > |');
        btnCreate.disabled = true;
        fullPathPreview.textContent = cleanParent ? `${cleanParent}${sep}${rawName}` : rawName;
        return;
      }

      clearError();
      btnCreate.disabled = false;
      fullPathPreview.textContent = cleanParent ? `${cleanParent}${sep}${rawName}` : rawName;
    };

    // Botão de procurar pasta onde salvar
    btnBrowse.onclick = async () => {
      if (window.electronAPI && typeof window.electronAPI.pickParentDir === 'function') {
        try {
          const picked = await window.electronAPI.pickParentDir(currentParentDir);
          if (picked) {
            currentParentDir = picked;
            inputLocation.value = picked;
            inputLocation.title = picked;
            updatePreview();
          }
        } catch (err) {
          console.warn('[newProjectModal] Falha ao escolher pasta:', err);
        }
      }
    };

    // Criar e abrir projeto
    const handleCreate = async () => {
      const folderName = inputName.value.trim();
      if (!folderName) {
        inputName.focus();
        return;
      }
      if (!currentParentDir) {
        showError('Selecione uma pasta de destino antes de criar o projeto.');
        return;
      }
      if (/[\\/:*?"<>|]/.test(folderName)) {
        showError('O nome da pasta contém caracteres inválidos.');
        inputName.focus();
        return;
      }

      clearError();
      btnCreate.disabled = true;
      btnCreate.textContent = 'Criando…';

      try {
        let res = null;
        if (window.electronAPI && typeof window.electronAPI.createAndOpenProject === 'function') {
          res = await window.electronAPI.createAndOpenProject(currentParentDir, folderName);
        } else {
          showError('API do sistema indisponível.');
          btnCreate.disabled = false;
          btnCreate.textContent = 'Criar Projeto';
          return;
        }

        if (res && res.ok) {
          closeModal();
          if (typeof window.renderWorkspacePanel === 'function') {
            window.renderWorkspacePanel(res.attachments);
          }
          if (typeof window.refreshProjectContext === 'function') {
            await window.refreshProjectContext();
          }
          if (typeof window.refreshProjectTree === 'function') {
            await window.refreshProjectTree();
          }
          if (typeof window.showToast === 'function') {
            window.showToast(`Projeto criado e aberto: ${folderName}`);
          }
        } else {
          showError((res && res.error) ? res.error : 'Erro ao criar e abrir novo projeto.');
          btnCreate.disabled = false;
          btnCreate.textContent = 'Criar Projeto';
          inputName.focus();
        }
      } catch (err) {
        showError(err.message || 'Erro inesperado ao criar projeto.');
        btnCreate.disabled = false;
        btnCreate.textContent = 'Criar Projeto';
        inputName.focus();
      }
    };

    inputName.oninput = updatePreview;

    inputName.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        if (!btnCreate.disabled) {
          handleCreate();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeModal();
      }
    };

    btnClose.onclick = closeModal;
    btnCancel.onclick = closeModal;
    btnCreate.onclick = handleCreate;

    backdrop.onclick = (e) => {
      if (e.target === backdrop) closeModal();
    };

    // Auto-foco no campo do nome
    setTimeout(() => {
      if (inputName) {
        inputName.focus();
      }
    }, 60);

    updatePreview();
  }

  window.openNewProjectModal = openNewProjectModal;
})();
