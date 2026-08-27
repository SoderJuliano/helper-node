// renderer/javaSyncModal.js
// Modal de Saida de Build / Sincronizacao Maven & Gradle (estilo IntelliJ)
(function() {
  'use strict';

  let syncModal = null;
  let pollTimer = null;
  let currentProjectDir = '';

  function createSyncModalDom() {
    if (syncModal) return syncModal;

    const overlay = document.createElement('div');
    overlay.className = 'java-sync-modal-overlay';
    overlay.style.display = 'none';

    overlay.innerHTML = `
      <div class="java-sync-modal">
        <div class="java-sync-modal-header">
          <div class="java-sync-modal-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px; color:#38bdf8;">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
            </svg>
            <span id="java-sync-modal-title-text">Sincronizacao de Dependencias Java</span>
          </div>
          <div class="java-sync-modal-actions">
            <button class="java-sync-btn" id="java-sync-btn-resync" title="Sincronizar Novamente">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Rebaixar</span>
            </button>
            <button class="java-sync-btn" id="java-sync-btn-copy" title="Copiar Saida">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copiar</span>
            </button>
            <button class="java-sync-btn-close" id="java-sync-btn-close" title="Fechar">&#10005;</button>
          </div>
        </div>
        <div class="java-sync-modal-body">
          <pre class="java-sync-log-content" id="java-sync-log-content">Aguardando logs...</pre>
        </div>
        <div class="java-sync-modal-footer">
          <span id="java-sync-footer-status">Status: Pronto</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#java-sync-btn-close').addEventListener('click', closeJavaSyncModal);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) closeJavaSyncModal();
    });

    overlay.querySelector('#java-sync-btn-copy').addEventListener('click', () => {
      const txt = overlay.querySelector('#java-sync-log-content').textContent;
      if (window.electronAPI && window.electronAPI.copyToClipboard) {
        window.electronAPI.copyToClipboard(txt);
        if (typeof showToast === 'function') showToast('Log de sincronizacao copiado!');
      }
    });

    overlay.querySelector('#java-sync-btn-resync').addEventListener('click', () => {
      if (currentProjectDir) {
        triggerJavaSync(currentProjectDir, true);
      }
    });

    syncModal = overlay;
    return overlay;
  }

  async function refreshSyncLog() {
    if (!syncModal || syncModal.style.display === 'none') return;
    if (!window.electronAPI || !window.electronAPI.javaDepsGetSyncLog) return;
    try {
      const log = await window.electronAPI.javaDepsGetSyncLog(currentProjectDir);
      const pre = syncModal.querySelector('#java-sync-log-content');
      if (pre && log) {
        pre.textContent = log;
        pre.scrollTop = pre.scrollHeight;
      }
    } catch (_) {}
  }

  function openJavaSyncLogModal(projectDir) {
    currentProjectDir = projectDir || currentProjectDir;
    const modal = createSyncModalDom();
    modal.style.display = 'flex';
    refreshSyncLog();

    clearInterval(pollTimer);
    pollTimer = setInterval(refreshSyncLog, 1000);
  }

  function closeJavaSyncModal() {
    clearInterval(pollTimer);
    if (syncModal) syncModal.style.display = 'none';
  }

  function updateSyncStatusPill(status, msg, projectDir) {
    const contextBar = desiredContextBar();
    if (!contextBar) return;

    let pill = document.getElementById('ctx-java-sync-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'ctx-java-sync-pill';
      pill.className = 'ctx-pill ctx-java-sync-status';
      pill.type = 'button';
      pill.addEventListener('click', () => openJavaSyncLogModal(currentProjectDir));
      contextBar.appendChild(pill);
    }

    if (status === 'hide') {
      pill.style.display = 'none';
      return;
    }

    pill.style.display = 'inline-flex';
    if (status === 'building') {
      pill.innerHTML = `<span class="sync-spinner">🔄</span> ${msg || 'Sincronizando dependências...'} <span class="sync-log-hint">(Ver Saída)</span>`;
      pill.classList.remove('sync-error', 'sync-success');
      pill.classList.add('sync-building');
    } else if (status === 'success') {
      pill.innerHTML = `<span>✓</span> ${msg} <span class="sync-log-hint">(Logs)</span>`;
      pill.classList.remove('sync-building', 'sync-error');
      pill.classList.add('sync-success');
      setTimeout(() => {
        if (pill.classList.contains('sync-success')) pill.style.display = 'none';
      }, 6000);
    } else if (status === 'error') {
      pill.innerHTML = `<span>⚠️</span> ${msg || 'Erro na sincronização'} <span class="sync-log-hint">(Ver Erro)</span>`;
      pill.classList.remove('sync-building', 'sync-success');
      pill.classList.add('sync-error');
    }
  }

  function desiredContextBar() {
    return document.getElementById('composer-context') || document.querySelector('.ws-project-header') || document.body;
  }

  async function triggerJavaSync(projectDir, forceDownload = true) {
    currentProjectDir = projectDir || currentProjectDir;
    if (!currentProjectDir) {
      const wsProj = document.getElementById('ws-project-main');
      if (wsProj) currentProjectDir = wsProj.dataset.path || '';
    }
    if (!currentProjectDir) return;

    updateSyncStatusPill('building', 'Sincronizando dependências...', currentProjectDir);
    if (typeof showToast === 'function') showToast('Iniciando sincronização Maven / Gradle...');

    try {
      const res = await window.electronAPI.javaDepsSync({ projectDir: currentProjectDir, forceDownload });
      if (res && res.ok) {
        const tool = res.type === 'maven' ? 'Maven' : (res.type === 'gradle' ? 'Gradle' : 'Java');
        updateSyncStatusPill('success', `${tool}: ${res.jarCount || 0} jars`, currentProjectDir);
        if (typeof showToast === 'function') showToast(`✓ Dependências ${tool} sincronizadas! (${res.jarCount || 0} bibliotecas)`);
      } else {
        updateSyncStatusPill('error', 'Falha na sincronização', currentProjectDir);
        if (typeof showToast === 'function') showToast('Erro na sincronização: ' + ((res && res.error) || '?'));
      }
    } catch (err) {
      updateSyncStatusPill('error', 'Erro: ' + err.message, currentProjectDir);
      if (typeof showToast === 'function') showToast('Erro na sincronização: ' + err.message);
    } finally {
      if (typeof window.renderTree === 'function') window.renderTree();
    }
  }

  window.openJavaSyncLogModal = openJavaSyncLogModal;
  window.closeJavaSyncModal = closeJavaSyncModal;
  window.triggerJavaSync = triggerJavaSync;
})();
