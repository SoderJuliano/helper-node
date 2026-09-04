// renderer/appRunner/appRunnerConfigModal.js
// Modal de configurações de execução para projetos Maven, Gradle e Java no Helper Node.

(function() {
  let modalContainer = null;
  let currentProjectDir = null;
  let currentConfig = null;
  let currentBuildInfo = null;
  let currentMode = 'table';

  function initAppRunnerModalDom() {
    modalContainer = window.AppRunnerConfigModalDom.buildAppRunnerConfigModalDom();
    wireModalEvents(modalContainer);
    return modalContainer;
  }

  function wireModalEvents(modal) {
    const btnClose = modal.querySelector('#app-runner-cfg-btn-close');
    const btnCancel = modal.querySelector('#app-runner-cfg-btn-cancel');
    const btnSave = modal.querySelector('#app-runner-cfg-btn-save');
    const btnReimport = modal.querySelector('#app-runner-cfg-btn-reimport');
    const btnReset = modal.querySelector('#app-runner-cfg-btn-reset');
    const btnAddEnv = modal.querySelector('#app-runner-cfg-btn-add-env');
    const btnModeTable = modal.querySelector('#app-runner-cfg-btn-mode-table');
    const btnModeRaw = modal.querySelector('#app-runner-cfg-btn-mode-raw');
    const chipsContainer = modal.querySelector('#app-runner-cfg-chips');

    btnClose.onclick = () => closeAppRunnerConfigModal();
    btnCancel.onclick = () => closeAppRunnerConfigModal();

    btnSave.onclick = async () => {
      await saveModalConfig();
      closeAppRunnerConfigModal();
    };

    btnReimport.onclick = async () => {
      if (!currentProjectDir || !window.electronAPI) return;
      btnReimport.disabled = true;
      try {
        const res = await window.electronAPI.appRunnerReimportIntelliJ(currentProjectDir);
        if (res && res.ok) {
          currentConfig = res.config || res.data;
          populateFormWithConfig(currentConfig);
          populateFormWithBuildInfo(currentBuildInfo);
          if (typeof showToast === 'function') showToast('Configurações reimportadas do IntelliJ.');
        } else {
          alert('Erro ao reimportar: ' + (res ? res.error : 'desconhecido'));
        }
      } finally {
        btnReimport.disabled = false;
      }
    };

    btnReset.onclick = () => {
      if (!confirm('Deseja restaurar as configurações padrão do projeto? Suas customizações serão perdidas.')) return;
      if (currentBuildInfo) {
        populateFormWithBuildInfo(currentBuildInfo);
      }
    };

    btnAddEnv.onclick = () => {
      const rowsContainer = modal.querySelector('#app-runner-cfg-env-rows');
      const newRow = window.AppRunnerConfigModalDom.renderAppRunnerEnvRow('', '', 'custom');
      rowsContainer.appendChild(newRow);
      const keyInput = newRow.querySelector('.app-runner-env-key');
      if (keyInput) keyInput.focus();
    };

    btnModeTable.onclick = () => switchMode('table');
    btnModeRaw.onclick = () => switchMode('raw');

    chipsContainer.onclick = (e) => {
      const chip = e.target.closest('.app-runner-chip');
      if (!chip) return;
      const profile = chip.dataset.profile;
      const input = modal.querySelector('#app-runner-cfg-profiles');
      const current = (input.value || '').trim();
      if (!current) {
        input.value = profile;
      } else {
        const parts = current.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.includes(profile)) {
          parts.push(profile);
          input.value = parts.join(',');
        }
      }
    };

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAppRunnerConfigModal();
    });

    window.addEventListener('keydown', (e) => {
      if (modal.style.display !== 'none' && e.key === 'Escape') {
        closeAppRunnerConfigModal();
      }
    });
  }

  function switchMode(newMode) {
    if (newMode === currentMode) return;
    const modal = document.getElementById('app-runner-config-modal');
    if (!modal) return;

    const btnTable = modal.querySelector('#app-runner-cfg-btn-mode-table');
    const btnRaw = modal.querySelector('#app-runner-cfg-btn-mode-raw');
    const wrapperTable = modal.querySelector('#app-runner-cfg-env-table-wrapper');
    const wrapperRaw = modal.querySelector('#app-runner-cfg-env-raw-wrapper');
    const textareaRaw = modal.querySelector('#app-runner-cfg-env-raw');

    if (newMode === 'raw') {
      const { env, disabledEnvs } = collectEnvFromTable();
      textareaRaw.value = window.AppRunnerConfigModalDom.formatAppRunnerRawEnv(env, disabledEnvs);
      wrapperTable.style.display = 'none';
      wrapperRaw.style.display = 'block';
      btnTable.classList.remove('active');
      btnRaw.classList.add('active');
    } else {
      const { env, disabledEnvs } = window.AppRunnerConfigModalDom.parseAppRunnerRawEnv(textareaRaw.value);
      populateEnvTable(env, disabledEnvs);
      wrapperRaw.style.display = 'none';
      wrapperTable.style.display = 'block';
      btnRaw.classList.remove('active');
      btnTable.classList.add('active');
    }
    currentMode = newMode;
  }

  function collectEnvFromTable() {
    const modal = document.getElementById('app-runner-config-modal');
    if (!modal) return { env: {}, disabledEnvs: [] };
    const rows = modal.querySelectorAll('.app-runner-env-row');
    const env = {};
    const disabledEnvs = [];
    rows.forEach(row => {
      const k = (row.querySelector('.app-runner-env-key')?.value || '').trim();
      const v = (row.querySelector('.app-runner-env-val')?.value || '').trim();
      const isChecked = row.querySelector('.app-runner-env-checkbox')?.checked !== false;
      if (k) {
        env[k] = v;
        if (!isChecked) {
          disabledEnvs.push(k);
        }
      }
    });
    return { env, disabledEnvs };
  }

  function populateEnvTable(env = {}, disabledEnvs = []) {
    const modal = document.getElementById('app-runner-config-modal');
    if (!modal) return;
    const container = modal.querySelector('#app-runner-cfg-env-rows');
    container.innerHTML = '';

    const disabledSet = new Set(Array.isArray(disabledEnvs) ? disabledEnvs : []);
    const origins = (currentConfig && currentConfig.envOrigins) || {};
    for (const [k, v] of Object.entries(env)) {
      const origin = origins[k] || 'custom';
      const isEnabled = !disabledSet.has(k);
      const row = window.AppRunnerConfigModalDom.renderAppRunnerEnvRow(k, v, origin, isEnabled);
      container.appendChild(row);
    }
  }

  function populateFormWithConfig(config) {
    const modal = document.getElementById('app-runner-config-modal');
    if (!modal || !config) return;

    modal.querySelector('#app-runner-cfg-profiles').value = config.activeProfiles || '';
    modal.querySelector('#app-runner-cfg-vm-options').value = config.vmOptions || '';
    modal.querySelector('#app-runner-cfg-prog-args').value = config.programArguments || config.programArgs || '';
    modal.querySelector('#app-runner-cfg-intellij-fallback').checked = config.useIntelliJFallback !== false;

    const envMap = config.env || config.envVars || {};
    const disabledEnvs = config.disabledEnvs || config.disabledKeys || [];
    populateEnvTable(envMap, disabledEnvs);

    const detailsEl = modal.querySelector('#app-runner-cfg-sync-details');
    const syncTime = config.lastSync || config.lastModified || (config.extractedFromIntelliJ && config.extractedFromIntelliJ.extractedAt);
    if (syncTime) {
      const dateStr = new Date(syncTime).toLocaleString('pt-BR');
      detailsEl.textContent = `Última sincronização com IntelliJ: ${dateStr}`;
    } else {
      detailsEl.textContent = 'Sem sincronização com o IntelliJ detectada para este projeto.';
    }
  }

  function populateFormWithBuildInfo(buildInfo) {
    const modal = document.getElementById('app-runner-config-modal');
    if (!modal) return;

    const toolBadge = modal.querySelector('#app-runner-cfg-tool-badge');
    const jdkBadge = modal.querySelector('#app-runner-cfg-jdk-badge');
    const syncBadge = modal.querySelector('#app-runner-cfg-sync-badge');

    if (buildInfo) {
      toolBadge.textContent = buildInfo.buildTool ? buildInfo.buildTool.toUpperCase() : (buildInfo.type ? buildInfo.type.toUpperCase() : 'JAVA');
      jdkBadge.textContent = buildInfo.javaVersion ? `Java ${buildInfo.javaVersion}` : 'Java';
    }

    const hasIntelliJ = (buildInfo && buildInfo.intellijConfig && buildInfo.intellijConfig.hasRunConfig) ||
                        (currentConfig && currentConfig.extractedFromIntelliJ && Object.keys(currentConfig.extractedFromIntelliJ.envs || {}).length > 0) ||
                        (currentConfig && currentConfig.extractedFromIntelliJ && !!currentConfig.extractedFromIntelliJ.sourceFile);

    if (hasIntelliJ) {
      syncBadge.textContent = 'IntelliJ detectado';
      syncBadge.className = 'app-runner-cfg-badge sync-badge sync-ok';
    } else {
      syncBadge.textContent = 'Sem IntelliJ';
      syncBadge.className = 'app-runner-cfg-badge sync-badge sync-none';
    }
  }

  async function saveModalConfig() {
    const modal = document.getElementById('app-runner-config-modal');
    if (!modal || !currentProjectDir || !window.electronAPI) return;

    let env = {};
    let disabledEnvs = [];
    if (currentMode === 'table') {
      const collected = collectEnvFromTable();
      env = collected.env;
      disabledEnvs = collected.disabledEnvs;
    } else {
      const rawText = modal.querySelector('#app-runner-cfg-env-raw')?.value || '';
      const parsed = window.AppRunnerConfigModalDom.parseAppRunnerRawEnv(rawText);
      env = parsed.env;
      disabledEnvs = parsed.disabledEnvs;
    }

    const payload = {
      activeProfiles: (modal.querySelector('#app-runner-cfg-profiles')?.value || '').trim(),
      vmOptions: (modal.querySelector('#app-runner-cfg-vm-options')?.value || '').trim(),
      programArgs: (modal.querySelector('#app-runner-cfg-prog-args')?.value || '').trim(),
      programArguments: (modal.querySelector('#app-runner-cfg-prog-args')?.value || '').trim(),
      useIntelliJFallback: modal.querySelector('#app-runner-cfg-intellij-fallback')?.checked !== false,
      envVars: env,
      env: env,
      disabledEnvs: disabledEnvs,
    };

    const res = await window.electronAPI.appRunnerSaveConfig(currentProjectDir, payload);
    if (res && res.ok) {
      currentConfig = res.config || res.data;
      if (typeof showToast === 'function') showToast('Configurações de execução salvas com sucesso.');
    } else {
      alert('Erro ao salvar configurações: ' + (res ? res.error : 'desconhecido'));
    }
  }

  async function openAppRunnerConfigModal(projectDir) {
    const wsProjectMain = document.getElementById('ws-project-main');
    const wsPath = wsProjectMain && wsProjectMain.dataset ? wsProjectMain.dataset.path : null;
    currentProjectDir = projectDir || (window.ctxProject ? window.ctxProject.path : null) || (window.workspaceContext ? window.workspaceContext.projectPath : null) || wsPath || null;
    if (!currentProjectDir) {
      alert('Nenhum projeto aberto para configurar.');
      return;
    }

    modalContainer = initAppRunnerModalDom();
    modalContainer.style.display = 'flex';

    const projLabel = modalContainer.querySelector('#app-runner-cfg-project-label');
    const folderName = currentProjectDir.replace(/\\/g, '/').split('/').pop();
    projLabel.textContent = folderName;
    projLabel.title = currentProjectDir;

    switchMode('table');

    if (window.electronAPI && window.electronAPI.appRunnerGetConfig) {
      const res = await window.electronAPI.appRunnerGetConfig(currentProjectDir);
      if (res && res.ok) {
        currentConfig = res.config || res.data;
        currentBuildInfo = res.buildInfo;
        populateFormWithBuildInfo(currentBuildInfo);
        populateFormWithConfig(currentConfig);
      }
    }
  }

  function closeAppRunnerConfigModal() {
    if (modalContainer) {
      modalContainer.style.display = 'none';
    }
  }

  window.openAppRunnerConfigModal = openAppRunnerConfigModal;
  window.closeAppRunnerConfigModal = closeAppRunnerConfigModal;
})();
