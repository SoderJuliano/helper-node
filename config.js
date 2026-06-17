const { ipcRenderer } = require("electron");

const instructionTextarea = document.getElementById("prompt-instruction");
const saveButton = document.getElementById("save-btn");
const debugModeToggle = document.getElementById("debug-mode-toggle");
const debugModeStatus = document.getElementById("debug-mode-status");
const printModeToggle = document.getElementById("print-mode-toggle");
const printModeStatus = document.getElementById("print-mode-status");
const osIntegrationToggle = document.getElementById("os-integration-toggle");
const osIntegrationStatus = document.getElementById("os-integration-status");
const realtimeAssistantToggle = document.getElementById("realtime-assistant-toggle");
const realtimeAssistantStatus = document.getElementById("realtime-assistant-status");
const helperToolsToggle = document.getElementById("helper-tools-toggle");
const helperToolsStatus = document.getElementById("helper-tools-status");
const workspaceAccessToggle = document.getElementById("workspace-access-toggle");
const workspaceAccessStatus = document.getElementById("workspace-access-status");
const workspaceAccessItem = document.getElementById("workspace-access-item");
const langSelect = document.getElementById("language-select");
const backendUrlValue = document.getElementById("backend-url-value");
const appVersionValue = document.getElementById("app-version-value");
const aiModelSelect = document.getElementById("ai-model");
const openIaTokenContainer = document.getElementById("openai-token-container");
const openIaTokenInput = document.getElementById("openai-token");
const openAiModelContainer = document.getElementById("openai-model-container");
const openAiModelSelect = document.getElementById("openai-model-select");
const ollamaLocalModelContainer = document.getElementById("ollama-local-model-container");
const ollamaLocalModelSelect = document.getElementById("ollama-local-model-select");
const ollamaLocalInfo = document.getElementById("ollama-local-info");
const ollamaPullCmd = document.getElementById("ollama-local-pull-cmd");
const checkOllamaBtn = document.getElementById("check-ollama-btn");
const ollamaStatusResult = document.getElementById("ollama-status-result");

// Helper function to update the debug mode status text
function updateDebugModeStatus(isDebugging) {
  debugModeStatus.textContent = isDebugging ? "ON" : "OFF";
}

// Helper function to update the print mode status text
function updatePrintModeStatus(isPrintMode) {
  printModeStatus.textContent = isPrintMode ? "ON" : "OFF";
}

// Helper function to update the OS integration status text
function updateOsIntegrationStatus(isOsIntegration) {
  osIntegrationStatus.textContent = isOsIntegration ? "ON" : "OFF";
  // "Integrar com SO" e "Capturar e enviar print direto" são independentes:
  // ligar a integração não deve reativar o envio automático de print.
}

function updateRealtimeAssistantStatus(isRealtimeAssistant) {
  realtimeAssistantStatus.textContent = isRealtimeAssistant ? "ON" : "OFF";
}

function updateHelperToolsStatus(isEnabled) {
  if (!helperToolsStatus) return;
  helperToolsStatus.textContent = isEnabled ? "ON" : "OFF";
}

function updateWorkspaceAccessStatus(isEnabled) {
  if (!workspaceAccessStatus) return;
  workspaceAccessStatus.textContent = isEnabled ? "ON" : "OFF";
}

// Mostra/oculta workspaceAccess dependendo do modelo: só disponível pro OpenAI.
function applyWorkspaceAccessVisibility(model) {
  if (!workspaceAccessItem) return;
  const isOpenAI = model === 'openIa';
  workspaceAccessItem.style.display = isOpenAI ? '' : 'none';
  if (!isOpenAI && workspaceAccessToggle) {
    workspaceAccessToggle.checked = false;
    updateWorkspaceAccessStatus(false);
  }
}

// Edição Lite (100% online): esconde tudo que é local/backend e força OpenAI.
// O Assistente em tempo real CONTINUA visível — na Lite ele roda 100% online
// (transcrição + resposta na OpenAI), sem Vosk/Whisper.
function applyLiteUi() {
  try {
    aiModelSelect.value = 'openIa';
    aiModelSelect.dispatchEvent(new Event('change'));
    const si = aiModelSelect.closest('.setting-item');
    if (si) si.style.display = 'none';
  } catch (_) {}
  ['backend-api-key-container', 'ollama-local-model-container', 'ollama-local-info'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (openIaTokenContainer) openIaTokenContainer.style.display = 'flex';
  if (openAiModelContainer) openAiModelContainer.style.display = 'flex';
}

// Edição do app (full/lite), preenchida no load. Controla a visibilidade da URL do backend.
let _appEdition = 'full';

// URL do backend só aparece quando faz sentido: Modo Debug ON, OU usando o backend
// remoto (llama / llama-stream) na edição Full. Em ChatGPT/Lite/Ollama local → escondida.
function applyBackendUrlVisibility() {
  const el = document.getElementById('backend-url');
  if (!el) return;
  const debugOn = !!(debugModeToggle && debugModeToggle.checked);
  const m = aiModelSelect ? aiModelSelect.value : '';
  const isRemoteBackend = (m === 'llama' || m === 'llama-stream');
  el.style.display = (debugOn || (isRemoteBackend && _appEdition === 'full')) ? '' : 'none';
}

// Mutex: helperTools desativa modo integrado + assistente em tempo real.
function applyHelperToolsExclusivity() {
  if (!helperToolsToggle || !helperToolsToggle.checked) return;
  if (osIntegrationToggle.checked) {
    osIntegrationToggle.checked = false;
    updateOsIntegrationStatus(false);
  }
  if (realtimeAssistantToggle.checked) {
    realtimeAssistantToggle.checked = false;
    updateRealtimeAssistantStatus(false);
  }
}

// Liga modo integrado ou assistente → desliga helperTools.
function disableHelperToolsIfOtherEnabled(toggle) {
  if (!helperToolsToggle) return;
  if (toggle.checked && helperToolsToggle.checked) {
    helperToolsToggle.checked = false;
    updateHelperToolsStatus(false);
  }
}

function applyRealtimeAssistantExclusivity() {
  if (!realtimeAssistantToggle.checked) return;

  debugModeToggle.checked = false;
  printModeToggle.checked = false;
  osIntegrationToggle.checked = false;

  updateDebugModeStatus(false);
  updatePrintModeStatus(false);
  updateOsIntegrationStatus(false);

  // Assistente em tempo real e Tradutor são EXCLUSIVOS (ambos capturam áudio e
  // respondem) — ligar o assistente desliga o tradutor.
  const _ta = document.getElementById('translation-enabled');
  if (_ta && _ta.checked) {
    _ta.checked = false;
    if (typeof updateTranslationEnabledStatus === 'function') updateTranslationEnabledStatus(false);
    ipcRenderer.send('set-translation-assistant-config', { enabled: false });
  }
}

function disableRealtimeIfOtherEnabled(toggle) {
  if (toggle.checked && realtimeAssistantToggle.checked) {
    realtimeAssistantToggle.checked = false;
    updateRealtimeAssistantStatus(false);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // -------------------------
  // Load saved instruction
  // -------------------------
  const instruction = await ipcRenderer.invoke("get-prompt-instruction");
  instructionTextarea.value = instruction;

  // -------------------------
  // Load debug mode
  // -------------------------
  const isDebugging = await ipcRenderer.invoke("get-debug-mode-status");
  debugModeToggle.checked = isDebugging;
  updateDebugModeStatus(isDebugging);

  // -------------------------
  // Load print mode
  // -------------------------
  const isPrintMode = await ipcRenderer.invoke("get-print-mode-status");
  printModeToggle.checked = isPrintMode;
  updatePrintModeStatus(isPrintMode);

  // -------------------------
  // Load OS integration mode
  // -------------------------
  const isOsIntegration = await ipcRenderer.invoke("get-os-integration-status");
  osIntegrationToggle.checked = isOsIntegration;
  updateOsIntegrationStatus(isOsIntegration);

  // -------------------------
  // Load realtime assistant mode
  // -------------------------
  const isRealtimeAssistant = await ipcRenderer.invoke("get-realtime-assistant-status");
  realtimeAssistantToggle.checked = isRealtimeAssistant;
  updateRealtimeAssistantStatus(isRealtimeAssistant);

  if (isRealtimeAssistant) {
    applyRealtimeAssistantExclusivity();
  }

  // -------------------------
  // Load helper tools (ferramentas avançadas)
  // -------------------------
  try {
    const helperToolsEnabled = await ipcRenderer.invoke("get-helper-tools-enabled");
    if (helperToolsToggle) {
      helperToolsToggle.checked = !!helperToolsEnabled;
      updateHelperToolsStatus(!!helperToolsEnabled);
      if (helperToolsEnabled) applyHelperToolsExclusivity();
    }
  } catch (e) {
    console.warn("helperTools enabled load failed:", e);
  }

  // -------------------------
  // Load workspace access
  // -------------------------
  try {
    const wsEnabled = await ipcRenderer.invoke("get-workspace-access-enabled");
    if (workspaceAccessToggle) {
      workspaceAccessToggle.checked = !!wsEnabled;
      updateWorkspaceAccessStatus(!!wsEnabled);
    }
  } catch (e) {
    console.warn("workspaceAccess load failed:", e);
  }

  // -------------------------
  // Load saved language
  // -------------------------
  const savedLang = await ipcRenderer.invoke("get-language");
  if (savedLang) langSelect.value = savedLang;

  // -------------------------
  // Load saved AI model
  // -------------------------
  const savedAiModel = await ipcRenderer.invoke("get-ai-model");
  if (savedAiModel) {
    aiModelSelect.value = savedAiModel;
  }
  applyWorkspaceAccessVisibility(aiModelSelect.value);
  const _isOllamaInit = (aiModelSelect.value === 'llama' || aiModelSelect.value === 'ollamaLocal');
  const backendApiKeyContainerInit = document.getElementById('backend-api-key-container');
  if (backendApiKeyContainerInit) backendApiKeyContainerInit.style.display = _isOllamaInit ? 'flex' : 'none';

  // -------------------------
  // Load app version
  // -------------------------
  try {
    const version = await ipcRenderer.invoke("get-app-version");
    if (appVersionValue) appVersionValue.textContent = version;
  } catch (e) {
    console.warn("get-app-version failed:", e);
  }
  
  // Always load OpenAI token, regardless of current model
  const savedToken = await ipcRenderer.invoke("get-open-ia-token");
  if (savedToken) {
      openIaTokenInput.value = savedToken;
  }

  // Carregar API key do backend (qwen3.6-17b)
  try {
    const savedBackendApiKey = await ipcRenderer.invoke("get-backend-api-key");
    const backendApiKeyInput = document.getElementById("backend-api-key");
    if (savedBackendApiKey && backendApiKeyInput) {
      backendApiKeyInput.value = savedBackendApiKey;
    }
  } catch (e) {
    console.warn("get-backend-api-key failed:", e);
  }

  // Load saved OpenAI model
  const savedOpenAiModel = await ipcRenderer.invoke("get-openai-model");
  if (savedOpenAiModel) {
    openAiModelSelect.value = savedOpenAiModel;
  }

  // Load saved Ollama Local model
  try {
    const savedOllamaModel = await ipcRenderer.invoke("get-ollama-local-model");
    if (savedOllamaModel && ollamaLocalModelSelect) {
      ollamaLocalModelSelect.value = savedOllamaModel;
      updateOllamaPullCmd();
    }
  } catch (e) { console.warn("ollama local model load failed:", e); }

  // Show/hide OpenAI fields based on saved model
  if (aiModelSelect.value === 'openIa') {
    openIaTokenContainer.style.display = 'flex';
    openAiModelContainer.style.display = 'flex';
  } else if (aiModelSelect.value === 'ollamaLocal') {
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = 'flex';
    if (ollamaLocalInfo) ollamaLocalInfo.style.display = 'block';
    applyOllamaLocalExclusivity();
  }

  // -------------------------
  // Load backend URL from abra-api
  // -------------------------
  try {
    const response = await fetch(
      "https://abra-api.top/notifications/retrieve?key=ngrockurl"
    );
    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const lastNotification = data[data.length - 1];
      if (lastNotification && lastNotification.content) {
        backendUrlValue.textContent = lastNotification.content;
        backendUrlValue.style.color = "#00ff00"; // Verde para indicar sucesso
      } else {
        backendUrlValue.textContent = "URL não disponível";
        backendUrlValue.style.color = "#ff6b6b"; // Vermelho para erro
      }
    } else {
      backendUrlValue.textContent = "Nenhuma URL encontrada";
      backendUrlValue.style.color = "#ff6b6b";
    }
  } catch (error) {
    console.error("Erro ao buscar URL do backend:", error);
    backendUrlValue.textContent = "Erro ao carregar URL";
    backendUrlValue.style.color = "#ff6b6b";
  }

  // Edição Lite: ajusta a UI (100% online) depois que tudo carregou.
  try {
    const _edition = await ipcRenderer.invoke('get-edition');
    _appEdition = _edition || 'full';
    if (_edition === 'lite') applyLiteUi();
  } catch (_) {}
  applyBackendUrlVisibility();
});

// Handle debug toggle live update
debugModeToggle.addEventListener("change", () => {
  disableRealtimeIfOtherEnabled(debugModeToggle);
  disableHelperToolsIfOtherEnabled(debugModeToggle);
  updateDebugModeStatus(debugModeToggle.checked);
  applyBackendUrlVisibility();
});

// Handle print mode toggle live update
printModeToggle.addEventListener("change", () => {
  disableRealtimeIfOtherEnabled(printModeToggle);
  disableHelperToolsIfOtherEnabled(printModeToggle);
  updatePrintModeStatus(printModeToggle.checked);
});

// Handle OS integration toggle live update
osIntegrationToggle.addEventListener("change", () => {
  disableRealtimeIfOtherEnabled(osIntegrationToggle);
  disableHelperToolsIfOtherEnabled(osIntegrationToggle);
  updateOsIntegrationStatus(osIntegrationToggle.checked);
});

realtimeAssistantToggle.addEventListener("change", () => {
  updateRealtimeAssistantStatus(realtimeAssistantToggle.checked);
  if (realtimeAssistantToggle.checked) {
    applyRealtimeAssistantExclusivity();
    disableHelperToolsIfOtherEnabled(realtimeAssistantToggle);
  }
});

if (helperToolsToggle) {
  helperToolsToggle.addEventListener("change", () => {
    updateHelperToolsStatus(helperToolsToggle.checked);
    if (helperToolsToggle.checked) {
      applyHelperToolsExclusivity();
    }
  });
}

if (workspaceAccessToggle) {
  workspaceAccessToggle.addEventListener("change", () => {
    updateWorkspaceAccessStatus(workspaceAccessToggle.checked);
  });
}

// Mostra/esconde campos do provider selecionado.
function updateOllamaPullCmd() {
  if (!ollamaLocalModelSelect || !ollamaPullCmd) return;
  ollamaPullCmd.textContent = `ollama pull ${ollamaLocalModelSelect.value}`;
}

// Quando ollamaLocal selecionado, desliga workspaceAccess (exclusivo do OpenAI).
function applyOllamaLocalExclusivity() {
  if (aiModelSelect.value !== 'ollamaLocal') return;
  if (workspaceAccessToggle && workspaceAccessToggle.checked) {
    workspaceAccessToggle.checked = false;
    updateWorkspaceAccessStatus(false);
  }
}

function releaseOllamaLocalExclusivity() {
  // nada a fazer — visibilidade do workspaceAccess já é controlada por applyWorkspaceAccessVisibility
}

// Show/hide OpenAI/Ollama fields based on AI model selection
aiModelSelect.addEventListener('change', () => {
    const v = aiModelSelect.value;
    const isOllama = (v === 'llama' || v === 'ollamaLocal');
    openIaTokenContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    openAiModelContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = (v === 'ollamaLocal') ? 'flex' : 'none';
    if (ollamaLocalInfo) ollamaLocalInfo.style.display = (v === 'ollamaLocal') ? 'block' : 'none';
    const backendApiKeyContainer = document.getElementById('backend-api-key-container');
    if (backendApiKeyContainer) backendApiKeyContainer.style.display = isOllama ? 'flex' : 'none';
    applyWorkspaceAccessVisibility(v);
    if (v === 'ollamaLocal') applyOllamaLocalExclusivity();
    else releaseOllamaLocalExclusivity();
    applyBackendUrlVisibility();
});

if (ollamaLocalModelSelect) {
    ollamaLocalModelSelect.addEventListener('change', updateOllamaPullCmd);
}

if (checkOllamaBtn) {
    checkOllamaBtn.addEventListener('click', async () => {
        ollamaStatusResult.textContent = 'Verificando...';
        ollamaStatusResult.style.color = '#888';
        try {
            const res = await ipcRenderer.invoke('check-ollama-local-status');
            if (!res || !res.running) {
                ollamaStatusResult.innerHTML = '<span style="color:#ff6b6b">Ollama não está rodando.</span> Rode <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama serve</code> no terminal.';
                return;
            }
            const selected = ollamaLocalModelSelect.value;
            const installed = res.models || [];
            const hasIt = installed.some(m => m === selected || m.startsWith(selected.split(':')[0] + ':'));
            if (hasIt) {
                ollamaStatusResult.innerHTML = `<span style="color:#9ef0a8">Ollama rodando.</span> Modelo <code style="color:#9ef0a8">${selected}</code> está baixado. Pronto pra uso!`;
            } else {
                ollamaStatusResult.innerHTML = `<span style="color:#ffb74d">Ollama rodando, mas modelo <code>${selected}</code> não está baixado.</span><br>Modelos disponíveis: ${installed.length ? installed.join(', ') : '(nenhum)'}<br>Rode: <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama pull ${selected}</code>`;
            }
        } catch (e) {
            ollamaStatusResult.innerHTML = `Erro ao verificar: ${e.message}`;
            ollamaStatusResult.style.color = '#ff6b6b';
        }
    });
}

// Save everything
saveButton.addEventListener("click", async () => {
  // Save prompt instruction
  ipcRenderer.send("save-prompt-instruction", instructionTextarea.value);

  // Save debug mode
  ipcRenderer.send("save-debug-mode-status", debugModeToggle.checked);

  // Save print mode
  ipcRenderer.send("save-print-mode-status", printModeToggle.checked);

  // Save OS integration mode
  ipcRenderer.send("save-os-integration-status", osIntegrationToggle.checked);

  // Save realtime assistant mode
  ipcRenderer.send("save-realtime-assistant-status", realtimeAssistantToggle.checked);

  // Save helper tools (ferramentas avançadas)
  if (helperToolsToggle) {
    ipcRenderer.send("set-helper-tools-enabled", helperToolsToggle.checked);
  }

  // Save workspace access
  if (workspaceAccessToggle) {
    ipcRenderer.send("set-workspace-access-enabled", workspaceAccessToggle.checked);
  }

  // Save language
  ipcRenderer.send("set-language", langSelect.value);

  // Save AI model
  ipcRenderer.send("set-ai-model", aiModelSelect.value);
  
  // Save OpenAI model
  ipcRenderer.send("set-openai-model", openAiModelSelect.value);

  // Save Ollama Local model
  if (ollamaLocalModelSelect) {
    ipcRenderer.send("set-ollama-local-model", ollamaLocalModelSelect.value);
  }

  // Always save OpenAI token, regardless of current model
  // This ensures the token persists even when switching to other models
  ipcRenderer.send("set-open-ia-token", openIaTokenInput.value);

  // Salvar API key do backend (qwen3.6-17b)
  const backendApiKeyInput = document.getElementById("backend-api-key");
  if (backendApiKeyInput) {
    ipcRenderer.send("save-backend-api-key", backendApiKeyInput.value);
  }

  // Close window
  window.close();
});

// Handle clear OpenAI token
document.getElementById("clear-openai-token").addEventListener("click", () => {
    openIaTokenInput.value = "";
    ipcRenderer.send("set-open-ia-token", ""); // Clear token in main process as well
});

// === Assistente de Tradução ===
const translationEnabledToggle = document.getElementById('translation-enabled');
const translationEnabledStatus = document.getElementById('translation-enabled-status');
const translationUsernameInput = document.getElementById('translation-username');
const translationBackgroundInput = document.getElementById('translation-background');
const translationTargetLangSelect = document.getElementById('translation-target-lang');

function updateTranslationEnabledStatus(v) {
  if (translationEnabledStatus) translationEnabledStatus.textContent = v ? 'ON' : 'OFF';
}

if (translationEnabledToggle) {
  translationEnabledToggle.addEventListener('change', () => {
    updateTranslationEnabledStatus(translationEnabledToggle.checked);
    // Exclusivo com o Assistente em tempo real — ligar o tradutor desliga o assistente.
    if (translationEnabledToggle.checked && realtimeAssistantToggle && realtimeAssistantToggle.checked) {
      realtimeAssistantToggle.checked = false;
      updateRealtimeAssistantStatus(false);
    }
    ipcRenderer.send('set-translation-assistant-config', { enabled: translationEnabledToggle.checked });
  });
}

if (translationUsernameInput) {
  translationUsernameInput.addEventListener('input', () => {
    ipcRenderer.send('set-translation-assistant-config', { userName: translationUsernameInput.value });
  });
}

if (translationBackgroundInput) {
  translationBackgroundInput.addEventListener('input', () => {
    ipcRenderer.send('set-translation-assistant-config', { userBackground: translationBackgroundInput.value });
  });
}

if (translationTargetLangSelect) {
  translationTargetLangSelect.addEventListener('change', () => {
    ipcRenderer.send('set-translation-assistant-config', { targetLanguage: translationTargetLangSelect.value });
  });
}

const translationTestModeInput = document.getElementById('translation-test-mode');
if (translationTestModeInput) {
  translationTestModeInput.addEventListener('change', () => {
    // Usa canal dedicado para que o main process possa disparar o teste
    ipcRenderer.send('set-translation-test-mode', translationTestModeInput.checked);
  });
}

// === Seletor de microfone do Assistente de Tradução ===
const translationMicSelect = document.getElementById('translation-mic-device');
const translationMicRefresh = document.getElementById('translation-mic-refresh');

async function populateMicDevices(selected) {
  if (!translationMicSelect) return;
  let devices = [];
  try { devices = await ipcRenderer.invoke('get-audio-input-devices'); } catch (_) {}
  // Mantém só a opção "Automático" e reconstrói a lista.
  translationMicSelect.innerHTML = '<option value="">Automático (padrão do sistema)</option>';
  for (const d of (devices || [])) {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.textContent = d.description || d.name;
    translationMicSelect.appendChild(opt);
  }
  // Restaura a escolha salva (mesmo se o device não estiver na lista agora).
  if (selected) {
    if (![...translationMicSelect.options].some(o => o.value === selected)) {
      const opt = document.createElement('option');
      opt.value = selected;
      opt.textContent = selected + ' (desconectado?)';
      translationMicSelect.appendChild(opt);
    }
    translationMicSelect.value = selected;
  }
}

if (translationMicSelect) {
  translationMicSelect.addEventListener('change', () => {
    ipcRenderer.send('set-translation-assistant-config', { micDevice: translationMicSelect.value });
  });
}
if (translationMicRefresh) {
  translationMicRefresh.addEventListener('click', () => {
    populateMicDevices(translationMicSelect ? translationMicSelect.value : '');
  });
}

// Carrega valores salvos do Assistente de Tradução ao abrir config
(async () => {
  try {
    const ta = await ipcRenderer.invoke('get-translation-assistant-config');
    if (!ta) return;
    if (translationEnabledToggle) {
      translationEnabledToggle.checked = !!ta.enabled;
      updateTranslationEnabledStatus(!!ta.enabled);
    }
    if (translationUsernameInput) translationUsernameInput.value = ta.userName || '';
    if (translationBackgroundInput) translationBackgroundInput.value = ta.userBackground || '';
    if (translationTargetLangSelect) translationTargetLangSelect.value = ta.targetLanguage || 'pt-br';
    // Modo de Teste é só por sessão — sempre começa desmarcado ao abrir o config.
    if (translationTestModeInput) translationTestModeInput.checked = false;
    await populateMicDevices(ta.micDevice || '');
  } catch (e) {
    console.warn('[TranslationAssistant] load config failed:', e.message);
  }
})();

// === Base de Conhecimento (RAG) ===
const kbEnabledToggle = document.getElementById('kb-enabled');
const kbEnabledStatus = document.getElementById('kb-enabled-status');
const kbRewriteToggle = document.getElementById('kb-airewrite');
const kbRewriteStatus = document.getElementById('kb-airewrite-status');
const kbRewriteWarn = document.getElementById('kb-airewrite-warn');
const kbText = document.getElementById('kb-text');
const kbSaveBtn = document.getElementById('kb-save-btn');
const kbStatus = document.getElementById('kb-status');

function updateKbEnabledStatus(v) { if (kbEnabledStatus) kbEnabledStatus.textContent = v ? 'ON' : 'OFF'; }
function updateKbRewriteStatus(v) {
  if (kbRewriteStatus) kbRewriteStatus.textContent = v ? 'ON' : 'OFF';
  if (kbRewriteWarn) kbRewriteWarn.style.display = v ? 'block' : 'none';
}

if (kbEnabledToggle) kbEnabledToggle.addEventListener('change', () => updateKbEnabledStatus(kbEnabledToggle.checked));
if (kbRewriteToggle) kbRewriteToggle.addEventListener('change', () => updateKbRewriteStatus(kbRewriteToggle.checked));

if (kbSaveBtn) {
  kbSaveBtn.addEventListener('click', async () => {
    const aiRewrite = kbRewriteToggle ? kbRewriteToggle.checked : true;
    if (kbStatus) { kbStatus.style.color = '#888'; kbStatus.textContent = aiRewrite ? 'Reorganizando com IA e salvando…' : 'Salvando…'; }
    kbSaveBtn.disabled = true;
    try {
      const res = await ipcRenderer.invoke('kb-save', {
        text: kbText ? kbText.value : '',
        aiRewrite,
        enabled: kbEnabledToggle ? kbEnabledToggle.checked : true,
      });
      if (res && res.ok) {
        if (res.rewritten && kbText && typeof res.text === 'string') kbText.value = res.text;
        if (kbStatus) { kbStatus.style.color = '#9ef0a8'; kbStatus.textContent = `Salvo — ${res.chunks} trecho(s)` + (res.rewritten ? ' (reorganizado pela IA)' : ''); }
      } else if (kbStatus) {
        kbStatus.style.color = '#ff6b6b'; kbStatus.textContent = 'Erro: ' + ((res && res.error) || 'falha ao salvar');
      }
    } catch (e) {
      if (kbStatus) { kbStatus.style.color = '#ff6b6b'; kbStatus.textContent = 'Erro: ' + e.message; }
    } finally {
      kbSaveBtn.disabled = false;
    }
  });
}

(async () => {
  try {
    const kb = await ipcRenderer.invoke('kb-get');
    if (!kb) return;
    if (kbEnabledToggle) { kbEnabledToggle.checked = kb.enabled !== false; updateKbEnabledStatus(kbEnabledToggle.checked); }
    if (kbRewriteToggle) { kbRewriteToggle.checked = kb.aiRewrite !== false; updateKbRewriteStatus(kbRewriteToggle.checked); }
    if (kbText) kbText.value = kb.source || '';
    if (kbStatus && kb.chunks != null) kbStatus.textContent = kb.chunks ? `${kb.chunks} trecho(s) indexado(s)` : 'vazio';
  } catch (e) { console.warn('[kb] load failed:', e.message); }
})();

// === "Instrução para IA": read-only por padrão + cadeado (área sensível) ===
const promptEditToggle = document.getElementById('prompt-edit-toggle');
const promptEditWarn = document.getElementById('prompt-edit-warn');
if (promptEditToggle && instructionTextarea) {
  promptEditToggle.addEventListener('click', () => {
    const locked = instructionTextarea.hasAttribute('readonly');
    if (locked) {
      instructionTextarea.removeAttribute('readonly');
      instructionTextarea.focus();
      promptEditToggle.textContent = 'bloquear';
      promptEditToggle.classList.add('editing');
      if (promptEditWarn) promptEditWarn.style.display = 'block';
    } else {
      instructionTextarea.setAttribute('readonly', '');
      promptEditToggle.textContent = 'editar';
      promptEditToggle.classList.remove('editing');
      if (promptEditWarn) promptEditWarn.style.display = 'none';
    }
  });
}
