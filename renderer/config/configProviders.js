// renderer/config/configProviders.js
// Model populators, validation buttons and provider dropdowns for Settings window.
(function() {
  'use strict';
  const { ipcRenderer } = require("electron");

  const openAiModelSelect = document.getElementById("openai-model-select");
  const openAiVisionModelSelect = document.getElementById("openai-vision-model-select");
  const backendModelSelect = document.getElementById("backend-model-select");
  const backendApiKey = document.getElementById("backend-api-key");
  const ollamaLocalModelSelect = document.getElementById("ollama-local-model-select");
  const checkOllamaBtn = document.getElementById("check-ollama-btn");
  const ollamaStatusResult = document.getElementById("ollama-status-result");
  const geminiCliModelSelect = document.getElementById("gemini-cli-model-select");
  const checkGeminiCliBtn = document.getElementById("check-gemini-cli-btn");
  const geminiCliStatusResult = document.getElementById("gemini-cli-status-result");
  const claudeCliModelSelect = document.getElementById("claude-cli-model-select");
  const checkClaudeCliBtn = document.getElementById("check-claude-cli-btn");
  const claudeCliStatusResult = document.getElementById("claude-cli-status-result");
  const copilotCliModelSelect = document.getElementById("copilot-cli-model-select");
  const checkCopilotCliBtn = document.getElementById("check-copilot-cli-btn");
  const copilotCliStatusResult = document.getElementById("copilot-cli-status-result");
  const copilotResetBlockedBtn = document.getElementById("copilot-reset-blocked-btn");
  const copilotResetBlockedResult = document.getElementById("copilot-reset-blocked-result");

  async function fetchOpenAiModelIds() {
    const token = await ipcRenderer.invoke("get-open-ia-token");
    if (!token) throw new Error("Chave da OpenAI não configurada");

    const res = await fetch("https://api.openai.com/v1/models", {
      method: "GET",
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Erro HTTP " + res.status);
    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data
      .map(m => m.id)
      .filter(id => id.startsWith('gpt-') || id.startsWith('o1-') || id.startsWith('o3-'))
      .sort();
  }

  function fillOpenAiSelect(select, models, currentVal) {
    select.innerHTML = '';
    for (const m of models) {
      const option = document.createElement('option');
      option.value = m;
      option.textContent = m;
      select.appendChild(option);
    }
    if (currentVal && !models.includes(currentVal)) {
      const option = document.createElement('option');
      option.value = currentVal;
      option.textContent = `${currentVal} (indisponível)`;
      select.appendChild(option);
    }
    if (currentVal) select.value = currentVal;
    else select.selectedIndex = 0;
  }

  function showOpenAiSelectError(select, currentVal, motivo) {
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = currentVal || '';
    option.textContent = currentVal
      ? `${currentVal} (não foi possível confirmar: ${motivo})`
      : `Não foi possível listar modelos: ${motivo}`;
    option.disabled = !currentVal;
    select.appendChild(option);
    if (currentVal) select.value = currentVal;
  }

  async function populateOpenAiModels(savedModel = null) {
    if (!openAiModelSelect) return;
    const currentVal = savedModel || openAiModelSelect.value;
    try {
      const models = await fetchOpenAiModelIds();
      if (!models.length) throw new Error("a API não devolveu nenhum modelo");
      fillOpenAiSelect(openAiModelSelect, models, currentVal);
    } catch (e) {
      console.warn("Falha ao carregar modelos dinâmicos da OpenAI:", e.message);
      showOpenAiSelectError(openAiModelSelect, currentVal, e.message);
    }
  }

  async function populateOpenAiVisionModels(savedModel = null) {
    if (!openAiVisionModelSelect) return;
    const currentVal = savedModel || openAiVisionModelSelect.value;
    try {
      const models = await fetchOpenAiModelIds();
      if (!models.length) throw new Error("a API não devolveu nenhum modelo");
      fillOpenAiSelect(openAiVisionModelSelect, models, currentVal);
    } catch (e) {
      console.warn("Falha ao carregar modelos de visão da OpenAI:", e.message);
      showOpenAiSelectError(openAiVisionModelSelect, currentVal, e.message);
    }
  }

  async function populateBackendModels(savedModel = null) {
    if (!backendModelSelect) return;
    const currentVal = savedModel || backendModelSelect.value;
    let models = [];
    try {
      const url = await ipcRenderer.invoke("get-backend-url");
      if (url) {
        const baseUrl = url.replace(/\/+$/, '');
        const apiKey = backendApiKey ? backendApiKey.value : '';
        const headers = { 'ngrok-skip-browser-warning': 'true' };
        if (apiKey) headers['x-api-key'] = apiKey;

        let data = null;
        try {
          const res = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
          if (res && res.ok) data = await res.json();
        } catch (_) {}

        if (!data) {
          try {
            const res = await fetch(`${baseUrl}/api/tags`, { method: 'GET', headers });
            if (res && res.ok) data = await res.json();
          } catch (_) {}
        }

        if (data) {
          if (data.models && Array.isArray(data.models)) {
            models = data.models;
          } else if (data.data && Array.isArray(data.data)) {
            models = data.data;
          } else if (Array.isArray(data)) {
            models = data;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to populate backend models:", e);
    }

    let parsedNames = models.map(m => typeof m === 'object' ? (m.name || m.model || m.id || String(m)) : String(m)).filter(Boolean);
    if (parsedNames.length === 0) {
      const defaultFallbacks = ['qwen2.5-coder:7b', 'llama3.1:8b', 'llama3:8b', 'gemma2:9b'];
      if (currentVal && !defaultFallbacks.includes(currentVal)) {
        parsedNames = [currentVal, ...defaultFallbacks];
      } else {
        parsedNames = defaultFallbacks;
      }
    }

    backendModelSelect.innerHTML = '';
    for (const name of parsedNames) {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      backendModelSelect.appendChild(option);
    }

    if (currentVal) {
      let found = false;
      for (const opt of backendModelSelect.options) {
        if (opt.value === currentVal) found = true;
      }
      if (found) backendModelSelect.value = currentVal;
      else backendModelSelect.selectedIndex = 0;
    } else {
      backendModelSelect.selectedIndex = 0;
    }
  }

  async function populateOllamaLocalModels(savedModel = null) {
    if (!ollamaLocalModelSelect) return;
    const currentVal = savedModel || ollamaLocalModelSelect.value;
    try {
      const status = await ipcRenderer.invoke('check-ollama-local-status');
      const models = (status && status.running && Array.isArray(status.models)) ? status.models : [];
      ollamaLocalModelSelect.innerHTML = '';
      if (models.length) {
        models.forEach(m => {
          const option = document.createElement('option');
          option.value = m;
          option.textContent = m;
          ollamaLocalModelSelect.appendChild(option);
        });
        if (currentVal && models.includes(currentVal)) {
          ollamaLocalModelSelect.value = currentVal;
        } else {
          ollamaLocalModelSelect.selectedIndex = 0;
        }
      } else {
        const option = document.createElement('option');
        option.value = currentVal || '';
        option.textContent = currentVal ? `${currentVal} (não instalado)` : 'Nenhum modelo baixado';
        ollamaLocalModelSelect.appendChild(option);
      }
    } catch (_) {}
  }

  async function populateGeminiCliModels(savedModel = null, forceRefresh = false) {
    if (!geminiCliModelSelect) return;
    const currentVal = savedModel || geminiCliModelSelect.value;
    try {
      const models = await ipcRenderer.invoke('get-gemini-cli-models', forceRefresh);
      geminiCliModelSelect.innerHTML = '';
      if (models && models.length) {
        models.forEach(m => {
          const option = document.createElement('option');
          const val = m.id || m.value || m;
          const text = m.label || val;
          option.value = val;
          option.textContent = text;
          geminiCliModelSelect.appendChild(option);
        });
        if (currentVal) geminiCliModelSelect.value = currentVal;
        else geminiCliModelSelect.selectedIndex = 0;
      }
    } catch (_) {}
  }

  async function populateClaudeCliModels(savedModel = null) {
    if (!claudeCliModelSelect) return;
    const currentVal = savedModel || claudeCliModelSelect.value;
    try {
      const models = await ipcRenderer.invoke('get-claude-cli-models');
      claudeCliModelSelect.innerHTML = '';
      if (models && models.length) {
        models.forEach(m => {
          const option = document.createElement('option');
          const val = m.id || m.value || m;
          const text = m.label || val;
          option.value = val;
          option.textContent = text;
          claudeCliModelSelect.appendChild(option);
        });
        if (currentVal) claudeCliModelSelect.value = currentVal;
        else claudeCliModelSelect.selectedIndex = 0;
      }
    } catch (_) {}
  }

  async function populateCopilotCliModels(savedModel = null, forceRefresh = false) {
    if (!copilotCliModelSelect) return;
    const currentVal = savedModel || copilotCliModelSelect.value;
    try {
      const models = await ipcRenderer.invoke('get-copilot-cli-models', forceRefresh);
      copilotCliModelSelect.innerHTML = '';
      if (models && models.length) {
        models.forEach(m => {
          const option = document.createElement('option');
          const val = m.id || m.value || m;
          const text = m.label || val;
          option.value = val;
          option.textContent = text;
          copilotCliModelSelect.appendChild(option);
        });
        if (currentVal) copilotCliModelSelect.value = currentVal;
        else copilotCliModelSelect.selectedIndex = 0;
      }
    } catch (_) {}
  }

  if (checkOllamaBtn) {
    checkOllamaBtn.addEventListener('click', async () => {
      ollamaStatusResult.textContent = 'Verificando...';
      ollamaStatusResult.style.color = '#888';
      try {
        await populateOllamaLocalModels();
        const res = await ipcRenderer.invoke('check-ollama-local-status');
        if (!res || !res.running) {
          ollamaStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Offline</span>';
          return;
        }
        const selected = ollamaLocalModelSelect.value;
        const installed = res.models || [];
        const hasIt = installed.some(m => m === selected || m.startsWith(selected.split(':')[0] + ':'));
        if (hasIt && selected) {
          ollamaStatusResult.innerHTML = `<span style="color:#9ef0a8">✓ Pronto</span>`;
        } else {
          ollamaStatusResult.innerHTML = `<span style="color:#9ef0a8">✓ Online</span>`;
        }
      } catch (e) {
        ollamaStatusResult.innerHTML = `<span style="color:#ff6b6b">${e.message}</span>`;
      }
    });
  }

  if (checkClaudeCliBtn) {
    checkClaudeCliBtn.addEventListener('click', async () => {
      if (!claudeCliStatusResult) return;
      claudeCliStatusResult.textContent = 'Verificando...';
      claudeCliStatusResult.style.color = '#888';
      try {
        const res = await ipcRenderer.invoke('check-claude-cli-installed');
        if (res && res.installed) {
          claudeCliStatusResult.innerHTML = '<span style="color:#9ef0a8">✓ Instalado</span>';
        } else {
          claudeCliStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Não instalado</span>';
        }
      } catch (e) {
        claudeCliStatusResult.innerHTML = `<span style="color:#ff6b6b">${e.message}</span>`;
      }
    });
  }

  if (checkCopilotCliBtn) {
    checkCopilotCliBtn.addEventListener('click', async () => {
      if (!copilotCliStatusResult) return;
      copilotCliStatusResult.textContent = 'Verificando...';
      copilotCliStatusResult.style.color = '#888';
      try {
        await populateCopilotCliModels(null, true);
        const res = await ipcRenderer.invoke('check-copilot-cli-installed');
        if (res && res.installed) {
          copilotCliStatusResult.innerHTML = '<span style="color:#9ef0a8">✓ Instalado</span>';
        } else {
          copilotCliStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Não instalado</span>';
        }
      } catch (e) {
        copilotCliStatusResult.innerHTML = `<span style="color:#ff6b6b">${e.message}</span>`;
      }
    });
  }

  if (copilotResetBlockedBtn) {
    copilotResetBlockedBtn.addEventListener('click', async () => {
      if (copilotResetBlockedResult) {
        copilotResetBlockedResult.textContent = 'Restaurando...';
        copilotResetBlockedResult.style.color = '#888';
      }
      try {
        await ipcRenderer.invoke('copilot-cli-reset-blocked-models');
        await populateCopilotCliModels(null, true);
        if (copilotResetBlockedResult) {
          copilotResetBlockedResult.textContent = '✓ Restaurado';
          copilotResetBlockedResult.style.color = '#9ef0a8';
          setTimeout(() => { if (copilotResetBlockedResult) copilotResetBlockedResult.textContent = ''; }, 3000);
        }
      } catch (e) {
        if (copilotResetBlockedResult) {
          copilotResetBlockedResult.textContent = 'Erro ao restaurar';
          copilotResetBlockedResult.style.color = '#ff6b6b';
        }
      }
    });
  }

  if (checkGeminiCliBtn) {
    checkGeminiCliBtn.addEventListener('click', async () => {
      if (!geminiCliStatusResult) return;
      geminiCliStatusResult.textContent = 'Verificando...';
      geminiCliStatusResult.style.color = '#888';
      try {
        const res = await ipcRenderer.invoke('check-gemini-cli-installed');
        if (res && res.installed) {
          geminiCliStatusResult.innerHTML = '<span style="color:#9ef0a8">✓ Instalado</span>';
        } else {
          geminiCliStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Não instalado</span>';
        }
      } catch (e) {
        geminiCliStatusResult.innerHTML = `<span style="color:#ff6b6b">${e.message}</span>`;
      }
    });
  }

  const copilotAuthBadge = document.getElementById("copilot-auth-badge");
  const copilotAuthUserInfo = document.getElementById("copilot-auth-user-info");
  const copilotDetectedAlert = document.getElementById("copilot-detected-alert");
  const copilotDetectedMsg = document.getElementById("copilot-detected-msg");
  const copilotImportDetectedBtn = document.getElementById("copilot-import-detected-btn");
  const copilotLoginWebBtn = document.getElementById("copilot-login-web-btn");
  const copilotLogoutBtn = document.getElementById("copilot-logout-btn");
  const copilotLoginStatus = document.getElementById("copilot-login-status");
  const copilotDeviceCodeBox = document.getElementById("copilot-device-code-box");
  const copilotUserCode = document.getElementById("copilot-user-code");

  let copilotPollTimer = null;

  async function refreshCopilotAuthStatus() {
    if (!copilotAuthBadge) return;
    try {
      const status = await ipcRenderer.invoke('github-auth-get-status');
      if (status && status.authenticated) {
        copilotAuthBadge.textContent = 'Conectado';
        copilotAuthBadge.style.backgroundColor = 'rgba(74, 222, 128, 0.2)';
        copilotAuthBadge.style.color = '#9ef0a8';
        if (copilotAuthUserInfo) {
          copilotAuthUserInfo.style.display = 'block';
          copilotAuthUserInfo.innerHTML = `Logado como: <strong style="color:#fff;">${status.user}</strong> (Fonte: ${status.source})`;
        }
        if (copilotDetectedAlert) copilotDetectedAlert.style.display = 'none';
        if (copilotLoginWebBtn) copilotLoginWebBtn.style.display = 'none';
        if (copilotLogoutBtn) copilotLogoutBtn.style.display = 'inline-block';
        if (copilotDeviceCodeBox) copilotDeviceCodeBox.style.display = 'none';
      } else {
        copilotAuthBadge.textContent = 'Desconectado';
        copilotAuthBadge.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
        copilotAuthBadge.style.color = '#f87171';
        if (copilotAuthUserInfo) copilotAuthUserInfo.style.display = 'none';
        if (copilotLogoutBtn) copilotLogoutBtn.style.display = 'none';
        if (copilotLoginWebBtn) copilotLoginWebBtn.style.display = 'inline-block';

        if (status && status.detectedAvailable) {
          if (copilotDetectedAlert) {
            copilotDetectedAlert.style.display = 'block';
            if (copilotDetectedMsg) {
              copilotDetectedMsg.textContent = `Sessão ativa encontrada no ${status.detectedSource} (${status.detectedUser})!`;
            }
          }
        } else {
          if (copilotDetectedAlert) copilotDetectedAlert.style.display = 'none';
        }
      }
    } catch (_) {}
  }

  if (copilotImportDetectedBtn) {
    copilotImportDetectedBtn.addEventListener('click', async () => {
      copilotImportDetectedBtn.textContent = 'Importando...';
      copilotImportDetectedBtn.disabled = true;
      try {
        const res = await ipcRenderer.invoke('github-auth-auto-import');
        if (res && res.success) {
          await refreshCopilotAuthStatus();
          await populateCopilotCliModels(null, true);
        } else {
          alert(res.error || 'Não foi possível importar credenciais.');
        }
      } catch (err) {
        alert(err.message);
      } finally {
        copilotImportDetectedBtn.textContent = 'Importar Agora (1-Clique)';
        copilotImportDetectedBtn.disabled = false;
      }
    });
  }

  if (copilotLoginWebBtn) {
    copilotLoginWebBtn.addEventListener('click', async () => {
      copilotLoginStatus.textContent = 'Iniciando autenticação...';
      copilotLoginStatus.style.color = '#38bdf8';
      try {
        const flow = await ipcRenderer.invoke('github-auth-start-device-flow');
        if (!flow.success || !flow.data) {
          throw new Error(flow.error || 'Falha ao iniciar Device Flow');
        }

        const data = flow.data;
        if (copilotUserCode) copilotUserCode.textContent = data.user_code;
        if (copilotDeviceCodeBox) copilotDeviceCodeBox.style.display = 'block';
        copilotLoginStatus.textContent = 'Aguardando autorização no navegador...';

        if (copilotPollTimer) clearInterval(copilotPollTimer);
        const intervalMs = ((data.interval || 5) + 1) * 1000;

        copilotPollTimer = setInterval(async () => {
          try {
            const poll = await ipcRenderer.invoke('github-auth-poll-device-flow', { deviceCode: data.device_code });
            if (poll.status === 'success') {
              clearInterval(copilotPollTimer);
              copilotPollTimer = null;
              copilotLoginStatus.textContent = '✓ Login concluído com sucesso!';
              copilotLoginStatus.style.color = '#9ef0a8';
              await refreshCopilotAuthStatus();
              await populateCopilotCliModels(null, true);
            } else if (poll.status === 'expired' || poll.status === 'error') {
              clearInterval(copilotPollTimer);
              copilotPollTimer = null;
              copilotLoginStatus.textContent = poll.error || 'Autorização expirada.';
              copilotLoginStatus.style.color = '#f87171';
            }
          } catch (_) {}
        }, intervalMs);
      } catch (err) {
        copilotLoginStatus.textContent = err.message;
        copilotLoginStatus.style.color = '#f87171';
      }
    });
  }

  if (copilotLogoutBtn) {
    copilotLogoutBtn.addEventListener('click', async () => {
      await ipcRenderer.invoke('github-auth-logout');
      if (copilotDeviceCodeBox) copilotDeviceCodeBox.style.display = 'none';
      if (copilotLoginStatus) copilotLoginStatus.textContent = '';
      await refreshCopilotAuthStatus();
    });
  }

  window.ConfigProviders = {
    populateOpenAiModels,
    populateOpenAiVisionModels,
    populateBackendModels,
    populateOllamaLocalModels,
    populateGeminiCliModels,
    populateClaudeCliModels,
    populateCopilotCliModels,
    refreshCopilotAuthStatus,
  };
})();
