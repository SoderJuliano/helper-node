// renderer/appRunner/appRunnerConfigModal.js
// Modal de configurações de execução para projetos Maven, Gradle e Java no Helper Node.
// Permite gerenciar variáveis de ambiente, active profiles (Spring), VM options e sincronização com IntelliJ.

(function() {
  let modalContainer = null;
  let currentProjectDir = null;
  let currentConfig = null;
  let currentBuildInfo = null;
  let currentMode = 'table'; // 'table' | 'raw'

  function createModalDom() {
    if (document.getElementById('app-runner-config-modal')) {
      return document.getElementById('app-runner-config-modal');
    }

    const modal = document.createElement('div');
    modal.id = 'app-runner-config-modal';
    modal.className = 'app-runner-config-modal-backdrop';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="app-runner-config-modal-dialog" role="dialog" aria-modal="true">
        <div class="app-runner-config-header">
          <div class="app-runner-config-title-group">
            <div class="app-runner-config-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
            <div>
              <h2 class="app-runner-config-title">Configurações de Execução</h2>
              <div class="app-runner-config-subtitle" id="app-runner-cfg-project-label">Carregando projeto...</div>
            </div>
          </div>
          <button class="app-runner-config-close-btn" id="app-runner-cfg-btn-close" title="Fechar">&times;</button>
        </div>

        <div class="app-runner-config-body">
          <!-- Project Info Badge Bar -->
          <div class="app-runner-config-badge-bar">
            <span class="app-runner-cfg-badge tool-badge" id="app-runner-cfg-tool-badge">Gradle</span>
            <span class="app-runner-cfg-badge jdk-badge" id="app-runner-cfg-jdk-badge">Java</span>
            <span class="app-runner-cfg-badge sync-badge" id="app-runner-cfg-sync-badge">IntelliJ Sync</span>
          </div>

          <!-- Section: Active Profiles (Spring Boot) -->
          <div class="app-runner-config-section">
            <label class="app-runner-config-label" for="app-runner-cfg-profiles" title="Define a propriedade --spring.profiles.active na inicialização">
              <span>Perfis Ativos (Spring Profiles)</span>
            </label>
            <input type="text" id="app-runner-cfg-profiles" class="app-runner-config-input" placeholder="Ex: dev,local ou homolog (--spring.profiles.active)" />
            <div class="app-runner-config-chips" id="app-runner-cfg-chips">
              <span class="app-runner-chip" data-profile="dev">+ dev</span>
              <span class="app-runner-chip" data-profile="local">+ local</span>
              <span class="app-runner-chip" data-profile="test">+ test</span>
              <span class="app-runner-chip" data-profile="homolog">+ homolog</span>
              <span class="app-runner-chip" data-profile="prod">+ prod</span>
              <span class="app-runner-chip" data-profile="docker">+ docker</span>
            </div>
          </div>

          <!-- Section: Environment Variables -->
          <div class="app-runner-config-section">
            <div class="app-runner-config-section-header">
              <label class="app-runner-config-label" style="margin-bottom:0;" title="Variáveis injetadas no ambiente de execução do processo local">
                <span>Variáveis de Ambiente</span>
              </label>
              <div class="app-runner-config-view-toggle">
                <button type="button" class="app-runner-toggle-btn active" id="app-runner-cfg-btn-mode-table">Tabela</button>
                <button type="button" class="app-runner-toggle-btn" id="app-runner-cfg-btn-mode-raw">Texto (.env)</button>
              </div>
            </div>

            <!-- Table View -->
            <div id="app-runner-cfg-env-table-wrapper" class="app-runner-env-table-wrapper">
              <div class="app-runner-env-table-header">
                <span style="flex: 1.2;">Nome da Variável</span>
                <span style="flex: 2;">Valor</span>
                <span style="width: 80px; text-align:center;">Origem</span>
                <span style="width: 32px;"></span>
              </div>
              <div class="app-runner-env-table-body" id="app-runner-cfg-env-rows">
                <!-- Linhas inseridas dinamicamente -->
              </div>
              <button type="button" class="app-runner-add-env-btn" id="app-runner-cfg-btn-add-env">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Adicionar Variável</span>
              </button>
            </div>

            <!-- Raw Text View -->
            <div id="app-runner-cfg-env-raw-wrapper" class="app-runner-env-raw-wrapper" style="display:none;">
              <textarea id="app-runner-cfg-env-raw" class="app-runner-config-textarea" placeholder="CHAVE=VALOR&#10;DATABASE_URL=jdbc:postgresql://localhost:5432/db&#10;SPRING_PROFILES_ACTIVE=dev" title="Uma variável por linha no formato CHAVE=VALOR. Linhas com # são ignoradas."></textarea>
            </div>
          </div>

          <!-- Section: VM Options & Program Arguments -->
          <div class="app-runner-config-grid-2">
            <div class="app-runner-config-section">
              <label class="app-runner-config-label" for="app-runner-cfg-vm-options" title="Opções de inicialização da JVM (ex: -Xmx2048m, -Dfile.encoding=UTF-8)">
                <span>Opções de VM (JVM Arguments)</span>
              </label>
              <input type="text" id="app-runner-cfg-vm-options" class="app-runner-config-input" placeholder="-Xmx2048m -Dfile.encoding=UTF-8" />
            </div>

            <div class="app-runner-config-section">
              <label class="app-runner-config-label" for="app-runner-cfg-prog-args" title="Argumentos passados diretamente ao método main da aplicação">
                <span>Argumentos do Programa</span>
              </label>
              <input type="text" id="app-runner-cfg-prog-args" class="app-runner-config-input" placeholder="--server.port=8082 --debug" />
            </div>
          </div>

          <!-- Section: IntelliJ Fallback & Sync Info -->
          <div class="app-runner-config-footer-info">
            <label class="app-runner-checkbox-label">
              <input type="checkbox" id="app-runner-cfg-intellij-fallback" checked />
              <span>Usar variáveis do IntelliJ IDEA como baseline quando não customizadas no Helper Node</span>
            </label>
            <div class="app-runner-sync-details" id="app-runner-cfg-sync-details"></div>
          </div>
        </div>

        <div class="app-runner-config-footer">
          <div class="app-runner-footer-left">
            <button type="button" class="app-runner-btn-secondary" id="app-runner-cfg-btn-reimport" title="Recarrega variáveis do .idea do IntelliJ">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              <span>Reimportar do IntelliJ</span>
            </button>
            <button type="button" class="app-runner-btn-text" id="app-runner-cfg-btn-reset" title="Restaura para os valores originais do IntelliJ">
              Restaurar Padrões
            </button>
          </div>
          <div class="app-runner-footer-right">
            <button type="button" class="app-runner-btn-secondary" id="app-runner-cfg-btn-cancel">Cancelar</button>
            <button type="button" class="app-runner-btn-primary" id="app-runner-cfg-btn-save">Salvar Configurações</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    wireModalEvents(modal);
    return modal;
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

    const closeModal = () => {
      modal.style.display = 'none';
    };

    btnClose.addEventListener('click', closeModal);
    btnCancel.addEventListener('click', closeModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display !== 'none') {
        closeModal();
      }
    });

    btnAddEnv.addEventListener('click', () => {
      addEnvRow('', '', 'helper');
      const rows = modal.querySelectorAll('.app-runner-env-row');
      if (rows.length > 0) {
        const lastKeyInput = rows[rows.length - 1].querySelector('.env-key-input');
        if (lastKeyInput) lastKeyInput.focus();
      }
    });

    btnModeTable.addEventListener('click', () => switchMode('table'));
    btnModeRaw.addEventListener('click', () => switchMode('raw'));

    chipsContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.app-runner-chip');
      if (!chip) return;
      const profile = chip.dataset.profile;
      const input = modal.querySelector('#app-runner-cfg-profiles');
      if (!input) return;

      const current = input.value.split(',').map(s => s.trim()).filter(Boolean);
      if (current.includes(profile)) {
        input.value = current.filter(p => p !== profile).join(',');
        chip.classList.remove('active');
      } else {
        current.push(profile);
        input.value = current.join(',');
        chip.classList.add('active');
      }
    });

    btnSave.addEventListener('click', async () => {
      await saveConfigFromModal();
      closeModal();
      if (typeof window.showToast === 'function') {
        window.showToast('Configurações de execução salvas com sucesso!');
      }
    });

    btnReimport.addEventListener('click', async () => {
      if (!currentProjectDir || !window.electronAPI || !window.electronAPI.appRunnerReimportIntelliJ) return;
      btnReimport.disabled = true;
      btnReimport.innerHTML = '<span>Reimportando...</span>';

      try {
        const res = await window.electronAPI.appRunnerReimportIntelliJ(currentProjectDir);
        if (res.ok && res.data) {
          currentConfig = res.data;
          populateModalFields(currentConfig, currentBuildInfo);
          if (typeof window.showToast === 'function') {
            window.showToast('Variáveis e opções reimportadas do IntelliJ!');
          }
        }
      } catch (e) {
        console.error('Erro ao reimportar do IntelliJ:', e);
      } finally {
        btnReimport.disabled = false;
        btnReimport.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg><span>Reimportar do IntelliJ</span>';
      }
    });

    btnReset.addEventListener('click', () => {
      if (!currentConfig || !currentConfig.extractedFromIntelliJ) return;
      if (window.confirm('Deseja descartar as customizações locais e restaurar os valores originais do IntelliJ?')) {
        const intellij = currentConfig.extractedFromIntelliJ;
        currentConfig.envVars = { ...(intellij.envs || {}) };
        currentConfig.activeProfiles = intellij.activeProfiles || '';
        currentConfig.vmOptions = (intellij.vmOptions || []).join(' ');
        currentConfig.programArgs = intellij.programArgs || '';
        populateModalFields(currentConfig, currentBuildInfo);
      }
    });
  }

  function switchMode(newMode) {
    currentMode = newMode;
    const modal = modalContainer;
    const btnTable = modal.querySelector('#app-runner-cfg-btn-mode-table');
    const btnRaw = modal.querySelector('#app-runner-cfg-btn-mode-raw');
    const tableWrapper = modal.querySelector('#app-runner-cfg-env-table-wrapper');
    const rawWrapper = modal.querySelector('#app-runner-cfg-env-raw-wrapper');
    const rawTextarea = modal.querySelector('#app-runner-cfg-env-raw');

    if (newMode === 'table') {
      btnTable.classList.add('active');
      btnRaw.classList.remove('active');
      tableWrapper.style.display = 'block';
      rawWrapper.style.display = 'none';

      // Converte raw text de volta para a tabela
      const text = rawTextarea.value;
      const parsedEnvs = parseRawEnvText(text);
      renderEnvRows(parsedEnvs);
    } else {
      btnTable.classList.remove('active');
      btnRaw.classList.add('active');
      tableWrapper.style.display = 'none';
      rawWrapper.style.display = 'block';

      // Converte tabela para raw text
      const currentEnvs = readEnvsFromTable();
      rawTextarea.value = formatEnvsToRaw(currentEnvs);
    }
  }

  function parseRawEnvText(text) {
    const envs = {};
    if (!text) return envs;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const k = trimmed.substring(0, eqIdx).trim();
        const v = trimmed.substring(eqIdx + 1).trim();
        if (k) envs[k] = v;
      }
    }
    return envs;
  }

  function formatEnvsToRaw(envs) {
    if (!envs) return '';
    return Object.entries(envs)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
  }

  function readEnvsFromTable() {
    const modal = modalContainer;
    const rows = modal.querySelectorAll('.app-runner-env-row');
    const envs = {};
    rows.forEach(row => {
      const keyInput = row.querySelector('.env-key-input');
      const valInput = row.querySelector('.env-val-input');
      if (keyInput && valInput) {
        const k = keyInput.value.trim();
        const v = valInput.value;
        if (k) envs[k] = v;
      }
    });
    return envs;
  }

  function renderEnvRows(envVars = {}) {
    const rowsContainer = modalContainer.querySelector('#app-runner-cfg-env-rows');
    rowsContainer.innerHTML = '';

    const intellijEnvs = (currentConfig && currentConfig.extractedFromIntelliJ && currentConfig.extractedFromIntelliJ.envs) || {};

    const keys = Object.keys(envVars);
    if (keys.length === 0) {
      rowsContainer.innerHTML = '<div class="app-runner-env-empty">Nenhuma variável configurada. Clique em "Adicionar Variável" acima.</div>';
      return;
    }

    keys.forEach(k => {
      const v = envVars[k];
      const origin = intellijEnvs[k] !== undefined ? 'intellij' : 'helper';
      addEnvRow(k, v, origin);
    });
  }

  function addEnvRow(key = '', val = '', origin = 'helper') {
    const rowsContainer = modalContainer.querySelector('#app-runner-cfg-env-rows');
    const emptyMsg = rowsContainer.querySelector('.app-runner-env-empty');
    if (emptyMsg) emptyMsg.remove();

    const row = document.createElement('div');
    row.className = 'app-runner-env-row';

    const originBadge = origin === 'intellij'
      ? '<span class="env-origin-tag intellij" title="Importada do IntelliJ .idea">IntelliJ</span>'
      : '<span class="env-origin-tag helper" title="Definida no Helper Node">Helper</span>';

    row.innerHTML = `
      <input type="text" class="app-runner-config-input env-key-input" placeholder="NOME_VAR" value="${key}" style="flex:1.2;" />
      <input type="text" class="app-runner-config-input env-val-input" placeholder="valor" value="${val}" style="flex:2;" />
      <div style="width:80px; text-align:center;">${originBadge}</div>
      <button type="button" class="env-delete-btn" title="Remover variável">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    row.querySelector('.env-delete-btn').addEventListener('click', () => {
      row.remove();
      if (rowsContainer.children.length === 0) {
        rowsContainer.innerHTML = '<div class="app-runner-env-empty">Nenhuma variável configurada. Clique em "Adicionar Variável" acima.</div>';
      }
    });

    rowsContainer.appendChild(row);
  }

  function populateModalFields(config, buildInfo) {
    const modal = modalContainer;
    const projectLabel = modal.querySelector('#app-runner-cfg-project-label');
    const toolBadge = modal.querySelector('#app-runner-cfg-tool-badge');
    const jdkBadge = modal.querySelector('#app-runner-cfg-jdk-badge');
    const syncBadge = modal.querySelector('#app-runner-cfg-sync-badge');
    const profilesInput = modal.querySelector('#app-runner-cfg-profiles');
    const vmOptionsInput = modal.querySelector('#app-runner-cfg-vm-options');
    const progArgsInput = modal.querySelector('#app-runner-cfg-prog-args');
    const fallbackCheckbox = modal.querySelector('#app-runner-cfg-intellij-fallback');
    const syncDetails = modal.querySelector('#app-runner-cfg-sync-details');
    const chips = modal.querySelectorAll('.app-runner-chip');

    const projectName = config.projectName || (config.projectDir ? config.projectDir.split(/[/\\]/).pop() : 'Projeto');
    projectLabel.textContent = `${projectName} (${config.projectDir})`;

    // Tool badge
    const toolType = (buildInfo && buildInfo.type) || (config.buildTool) || 'gradle';
    const isSpring = (buildInfo && buildInfo.isSpringBoot) || false;
    toolBadge.textContent = toolType === 'gradle'
      ? (isSpring ? 'Gradle (Spring Boot)' : 'Gradle')
      : (toolType === 'maven' ? (isSpring ? 'Maven (Spring Boot)' : 'Maven') : 'Java');
    toolBadge.className = `app-runner-cfg-badge tool-badge tool-${toolType}`;

    // Sync status badge
    const hasIntelliJ = config.extractedFromIntelliJ && config.extractedFromIntelliJ.sourceFile;
    if (hasIntelliJ) {
      syncBadge.textContent = 'IntelliJ Integrado';
      syncBadge.style.display = 'inline-flex';
    } else {
      syncBadge.textContent = 'Helper Node Nativo';
      syncBadge.style.display = 'inline-flex';
    }

    // Profiles & Chips
    profilesInput.value = config.activeProfiles || '';
    const activeProfilesList = (config.activeProfiles || '').split(',').map(s => s.trim());
    chips.forEach(chip => {
      chip.classList.toggle('active', activeProfilesList.includes(chip.dataset.profile));
    });

    // Inputs
    vmOptionsInput.value = config.vmOptions || '';
    progArgsInput.value = config.programArgs || '';
    fallbackCheckbox.checked = config.useIntelliJFallback !== false;

    // Sync details
    if (hasIntelliJ) {
      const srcName = config.extractedFromIntelliJ.sourceFile.split(/[/\\]/).pop();
      syncDetails.innerHTML = `Base importada de: <code>.idea/${srcName}</code> em ${new Date(config.extractedFromIntelliJ.extractedAt || Date.now()).toLocaleTimeString()}`;
    } else {
      syncDetails.textContent = 'Nenhuma configuração .idea do IntelliJ detectada para este projeto.';
    }

    // Render Env Rows
    renderEnvRows(config.envVars || {});
  }

  async function saveConfigFromModal() {
    if (!currentProjectDir || !window.electronAPI || !window.electronAPI.appRunnerSaveConfig) return;

    const modal = modalContainer;
    let envVars = {};
    if (currentMode === 'raw') {
      const rawText = modal.querySelector('#app-runner-cfg-env-raw').value;
      envVars = parseRawEnvText(rawText);
    } else {
      envVars = readEnvsFromTable();
    }

    const activeProfiles = modal.querySelector('#app-runner-cfg-profiles').value.trim();
    const vmOptions = modal.querySelector('#app-runner-cfg-vm-options').value.trim();
    const programArgs = modal.querySelector('#app-runner-cfg-prog-args').value.trim();
    const useIntelliJFallback = modal.querySelector('#app-runner-cfg-intellij-fallback').checked;

    const payload = {
      projectDir: currentProjectDir,
      config: {
        activeProfiles,
        vmOptions,
        programArgs,
        envVars,
        useIntelliJFallback,
      }
    };

    const res = await window.electronAPI.appRunnerSaveConfig(payload);
    if (res && res.ok) {
      currentConfig = res.data;
    }
  }

  async function openAppRunnerConfigModal(projectDir) {
    if (!window.electronAPI) return;

    modalContainer = createModalDom();

    // Se nenhum projectDir foi passado, obtém o projeto do contexto ativo
    let targetDir = projectDir;
    if (!targetDir && window.electronAPI.getProjectContext) {
      const ctx = await window.electronAPI.getProjectContext();
      if (ctx && ctx.path) {
        targetDir = ctx.path;
      }
    }

    if (!targetDir) {
      if (typeof window.showToast === 'function') {
        window.showToast('Nenhum projeto anexado ao workspace. Abra um projeto primeiro.');
      }
      return;
    }

    // Detecta ferramenta de build e valida se é Maven ou Gradle
    if (window.electronAPI.appRunnerDetectProject) {
      const detectRes = await window.electronAPI.appRunnerDetectProject(targetDir);
      if (detectRes && detectRes.ok) {
        currentBuildInfo = detectRes.data;
      }
    }

    if (!currentBuildInfo || (currentBuildInfo.type !== 'gradle' && currentBuildInfo.type !== 'maven')) {
      if (typeof window.showToast === 'function') {
        window.showToast('O projeto anexado não é um projeto Maven ou Gradle.');
      }
      return;
    }

    currentProjectDir = targetDir;

    // Carrega configurações
    if (window.electronAPI.appRunnerGetConfig) {
      const cfgRes = await window.electronAPI.appRunnerGetConfig(targetDir);
      if (cfgRes && cfgRes.ok) {
        currentConfig = cfgRes.data;
      }
    }

    if (!currentConfig) {
      currentConfig = {
        projectDir: targetDir,
        activeProfiles: '',
        vmOptions: '',
        programArgs: '',
        envVars: {},
      };
    }

    populateModalFields(currentConfig, currentBuildInfo);
    modalContainer.style.display = 'flex';
  }

  window.openAppRunnerConfigModal = openAppRunnerConfigModal;

  if (window.electronAPI && window.electronAPI.onOpenAppRunnerConfigModal) {
    window.electronAPI.onOpenAppRunnerConfigModal((projectDir) => {
      openAppRunnerConfigModal(projectDir);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    modalContainer = createModalDom();
  });
})();
