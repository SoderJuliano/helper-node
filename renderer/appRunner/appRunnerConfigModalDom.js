// renderer/appRunner/appRunnerConfigModalDom.js
// DOM generation and table/raw conversions for AppRunner config modal.
(function() {
  'use strict';

  function buildAppRunnerConfigModalDom() {
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
          <div class="app-runner-config-badge-bar">
            <span class="app-runner-cfg-badge tool-badge" id="app-runner-cfg-tool-badge">Gradle</span>
            <span class="app-runner-cfg-badge jdk-badge" id="app-runner-cfg-jdk-badge">Java</span>
            <span class="app-runner-cfg-badge sync-badge" id="app-runner-cfg-sync-badge">IntelliJ Sync</span>
          </div>

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

            <div id="app-runner-cfg-env-table-wrapper" class="app-runner-env-table-wrapper">
              <div class="app-runner-env-table-header">
                <span style="flex: 1.2;">Nome da Variável</span>
                <span style="flex: 2;">Valor</span>
                <span style="width: 80px; text-align:center;">Origem</span>
                <span style="width: 64px; text-align:center;" title="Marcar para ativar ou desmarcar para ignorar temporariamente">Ativo</span>
              </div>
              <div class="app-runner-env-table-body" id="app-runner-cfg-env-rows"></div>
              <button type="button" class="app-runner-add-env-btn" id="app-runner-cfg-btn-add-env">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                <span>Adicionar Variável</span>
              </button>
            </div>

            <div id="app-runner-cfg-env-raw-wrapper" class="app-runner-env-raw-wrapper" style="display:none;">
              <textarea id="app-runner-cfg-env-raw" class="app-runner-config-textarea" placeholder="CHAVE=VALOR&#10;DATABASE_URL=jdbc:postgresql://localhost:5432/db&#10;# SPRING_PROFILES_ACTIVE=dev (comentadas são desativadas)" title="Uma variável por linha no formato CHAVE=VALOR. Linhas iniciadas com # são mantidas como desativadas."></textarea>
            </div>
          </div>

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
    return modal;
  }

  function renderAppRunnerEnvRow(key = '', val = '', origin = 'custom', enabled = true) {
    const row = document.createElement('div');
    row.className = 'app-runner-env-row' + (enabled ? '' : ' env-disabled');

    const originLabel = origin === 'intellij' ? 'IntelliJ' : (origin === 'env-file' ? '.env' : 'Custom');
    const originClass = origin === 'intellij' ? 'origin-intellij' : 'origin-custom';

    row.innerHTML = `
      <input type="text" class="app-runner-env-key" placeholder="NOME_VARIAVEL" value="${key.replace(/"/g, '&quot;')}" />
      <input type="text" class="app-runner-env-val" placeholder="valor" value="${val.replace(/"/g, '&quot;')}" />
      <span class="app-runner-env-origin ${originClass}">${originLabel}</span>
      <div class="app-runner-env-actions" style="display:inline-flex; align-items:center; gap:6px; flex-shrink:0;">
        <label class="app-runner-env-toggle-label" title="${enabled ? 'Variável ativa (desmarque para não injetar na execução)' : 'Variável desativada (marque para ativar)'}" style="cursor:pointer; display:inline-flex; align-items:center; margin:0;">
          <input type="checkbox" class="app-runner-env-checkbox" ${enabled ? 'checked' : ''} style="cursor:pointer; width:15px; height:15px; accent-color:#38bdf8; margin:0;" />
        </label>
        <button type="button" class="app-runner-env-del-btn" title="Excluir variável">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:14px; height:14px;">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>
      </div>
    `;

    const checkbox = row.querySelector('.app-runner-env-checkbox');
    const keyInput = row.querySelector('.app-runner-env-key');
    const valInput = row.querySelector('.app-runner-env-val');

    const updateRowVisual = (isChecked) => {
      if (isChecked) {
        row.classList.remove('env-disabled');
        row.style.opacity = '1';
        if (keyInput) keyInput.style.color = '';
        if (valInput) valInput.style.color = '';
        checkbox.parentElement.title = 'Variável ativa (desmarque para não injetar na execução)';
      } else {
        row.classList.add('env-disabled');
        row.style.opacity = '0.55';
        if (keyInput) keyInput.style.color = '#94a3b8';
        if (valInput) valInput.style.color = '#94a3b8';
        checkbox.parentElement.title = 'Variável desativada (marque para ativar)';
      }
    };

    checkbox.onchange = () => {
      updateRowVisual(checkbox.checked);
    };
    updateRowVisual(enabled);

    const delBtn = row.querySelector('.app-runner-env-del-btn');
    delBtn.onclick = (e) => {
      e.stopPropagation();
      row.remove();
    };
    return row;
  }

  function parseAppRunnerRawEnv(text) {
    const env = {};
    const disabledEnvs = [];
    const lines = (text || '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const isDisabled = trimmed.startsWith('#');
      const clean = isDisabled ? trimmed.replace(/^#+\s*/, '') : trimmed;
      const eqIdx = clean.indexOf('=');
      if (eqIdx !== -1) {
        const k = clean.substring(0, eqIdx).trim();
        let v = clean.substring(eqIdx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (k) {
          env[k] = v;
          if (isDisabled) {
            disabledEnvs.push(k);
          }
        }
      }
    }
    return { env, disabledEnvs };
  }

  function formatAppRunnerRawEnv(env, disabledEnvs = []) {
    if (!env || typeof env !== 'object') return '';
    const disabledSet = new Set(Array.isArray(disabledEnvs) ? disabledEnvs : []);
    return Object.entries(env).map(([k, v]) => {
      return disabledSet.has(k) ? `# ${k}=${v}` : `${k}=${v}`;
    }).join('\n');
  }

  window.AppRunnerConfigModalDom = {
    buildAppRunnerConfigModalDom,
    renderAppRunnerEnvRow,
    parseAppRunnerRawEnv,
    formatAppRunnerRawEnv,
  };
})();
