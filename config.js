const { ipcRenderer } = require("electron");
const { supportsReasoningEffort } = require("./services/openAiRealtimeModels");

// Botão de tela cheia (janela frameless não tem o botão de maximizar do SO).
document.getElementById('win-maximize-btn')?.addEventListener('click', () => {
  ipcRenderer.send('window-toggle-maximize');
});

// Drag manual no Windows/macOS (app-region:drag é instável em janelas
// transparent+frameless nesses SOs). No Linux o app-region nativo já funciona.
if (process.platform !== 'linux') {
  const dragHandle = document.querySelector('h1');
  if (dragHandle) {
    dragHandle.style.setProperty('-webkit-app-region', 'no-drag');
    dragHandle.style.cursor = 'move';
    dragHandle.addEventListener('mousedown', (e) => { e.preventDefault(); ipcRenderer.send('frameless-drag-start'); });
    const end = () => ipcRenderer.send('frameless-drag-end');
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  }
}

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
const realtimeFastModelNote = document.getElementById("realtime-fast-model-note");
const visionGuideSection = document.getElementById("vision-guide-section");

function updateRealtimeFastModelNote() {
  if (!realtimeFastModelNote) return;
  realtimeFastModelNote.style.display = supportsReasoningEffort(openAiModelSelect.value) ? 'block' : 'none';
}
if (openAiModelSelect) {
  openAiModelSelect.addEventListener('change', updateRealtimeFastModelNote);
}
const openAiReasoningEffortContainer = document.getElementById("openai-reasoning-effort-container");
const openAiReasoningEffortSelect = document.getElementById("openai-reasoning-effort-select");
const openAiVisionModelContainer = document.getElementById("openai-vision-model-container");
const openAiVisionModelSelect = document.getElementById("openai-vision-model-select");
const ollamaLocalModelContainer = document.getElementById("ollama-local-model-container");
const ollamaLocalModelSelect = document.getElementById("ollama-local-model-select");
const ollamaLocalInfo = document.getElementById("ollama-local-info");
const ollamaPullCmd = document.getElementById("ollama-local-pull-cmd");
const checkOllamaBtn = document.getElementById("check-ollama-btn");
const ollamaStatusResult = document.getElementById("ollama-status-result");
// Gemini CLI elements
const geminiCliModelContainer = document.getElementById("gemini-cli-model-container");
const geminiCliModelSelect = document.getElementById("gemini-cli-model-select");
const geminiCliInfo = document.getElementById("gemini-cli-info");
const checkGeminiCliBtn = document.getElementById("check-gemini-cli-btn");
const geminiCliStatusResult = document.getElementById("gemini-cli-status-result");
// Claude Code CLI elements
const claudeCliModelContainer = document.getElementById("claude-cli-model-container");
const claudeCliModelSelect = document.getElementById("claude-cli-model-select");
const claudeCliInfo = document.getElementById("claude-cli-info");
const checkClaudeCliBtn = document.getElementById("check-claude-cli-btn");
const claudeCliStatusResult = document.getElementById("claude-cli-status-result");

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

// Mostra/oculta workspaceAccess.
// Disponível para OpenAI (helperTools lê o projeto) e para os CLIs (define o
// diretório de trabalho que o CLI usa como cwd e contexto de repositório).
// Backends genéricos e Ollama não suportam — esconde e desliga.
function applyWorkspaceAccessVisibility(model) {
  if (!workspaceAccessItem) return;
  const supportsWorkspace = model === 'openIa' || model === 'geminiCli' || model === 'claudeCli' || model === 'ollamaLocal';
  workspaceAccessItem.style.display = supportsWorkspace ? '' : 'none';
  if (!supportsWorkspace && workspaceAccessToggle) {
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
  ['backend-api-key-container', 'ollama-local-model-container', 'ollama-local-info',
   'gemini-cli-model-container', 'gemini-cli-info',
   'claude-cli-model-container', 'claude-cli-info'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (openIaTokenContainer) openIaTokenContainer.style.display = 'flex';
  if (openAiModelContainer) openAiModelContainer.style.display = 'flex';
  if (openAiReasoningEffortContainer) openAiReasoningEffortContainer.style.display = 'flex';
  if (openAiVisionModelContainer) openAiVisionModelContainer.style.display = 'flex';
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
  // Se já está num provider CLI ou Ollama com backend, desabilita helperTools visualmente.
  const _disableHelperToolsInit = (aiModelSelect.value === 'geminiCli' || aiModelSelect.value === 'claudeCli' || aiModelSelect.value === 'llama' || aiModelSelect.value === 'llama-stream');
  if (_disableHelperToolsInit && helperToolsToggle) {
    helperToolsToggle.disabled = true;
    helperToolsToggle.checked = false;
    updateHelperToolsStatus(false);
    const si = helperToolsToggle.closest && helperToolsToggle.closest('.setting-item');
    if (si) si.style.opacity = '0.4';
  }
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
  updateRealtimeFastModelNote();

  // Load saved reasoning effort e modelo de visão
  try {
    const savedEffort = await ipcRenderer.invoke("get-openai-reasoning-effort");
    if (savedEffort && openAiReasoningEffortSelect) openAiReasoningEffortSelect.value = savedEffort;
  } catch (e) { console.warn("get-openai-reasoning-effort failed:", e); }
  try {
    const savedVisionModel = await ipcRenderer.invoke("get-openai-vision-model");
    if (savedVisionModel && openAiVisionModelSelect) openAiVisionModelSelect.value = savedVisionModel;
  } catch (e) { console.warn("get-openai-vision-model failed:", e); }

  // Load saved Ollama Local model
  let savedOllamaModel = null;
  try {
    savedOllamaModel = await ipcRenderer.invoke("get-ollama-local-model");
  } catch (e) { console.warn("ollama local model load failed:", e); }
  await populateOllamaLocalModels(savedOllamaModel);

  // Load saved Claude Code CLI model
  try {
    const savedClaudeCliModel = await ipcRenderer.invoke("get-claude-cli-model");
    await populateClaudeCliModels(savedClaudeCliModel);
  } catch (e) { console.warn("claude-cli model load failed:", e); }

  // Load saved Gemini CLI model
  try {
    const savedGeminiCliModel = await ipcRenderer.invoke("get-gemini-cli-model");
    await populateGeminiCliModels(savedGeminiCliModel);
  } catch (e) { console.warn("gemini-cli model load failed:", e); }

  // Show/hide provider fields based on saved model
  const isChatGPT = (aiModelSelect.value === 'openIa');
  if (visionGuideSection) {
    visionGuideSection.style.display = isChatGPT ? 'block' : 'none';
  }
  if (!isChatGPT && visionGuideEnabledToggle && visionGuideEnabledToggle.checked) {
    visionGuideEnabledToggle.checked = false;
    updateVisionGuideEnabledStatus(false);
    ipcRenderer.send('set-vision-guide-config', { enabled: false });
  }

  if (isChatGPT) {
    openIaTokenContainer.style.display = 'flex';
    openAiModelContainer.style.display = 'flex';
    if (openAiReasoningEffortContainer) openAiReasoningEffortContainer.style.display = 'flex';
    if (openAiVisionModelContainer) openAiVisionModelContainer.style.display = 'flex';
  } else if (aiModelSelect.value === 'ollamaLocal') {
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = 'flex';
    if (ollamaLocalInfo) ollamaLocalInfo.style.display = 'block';
    populateOllamaLocalModels();
    applyOllamaLocalExclusivity();
  } else if (aiModelSelect.value === 'geminiCli') {
    if (geminiCliModelContainer) geminiCliModelContainer.style.display = 'flex';
    if (geminiCliInfo) geminiCliInfo.style.display = 'block';
  } else if (aiModelSelect.value === 'claudeCli') {
    if (claudeCliModelContainer) claudeCliModelContainer.style.display = 'flex';
    if (claudeCliInfo) claudeCliInfo.style.display = 'block';
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
    } else {
      // Se helperTools desliga, workspaceAccess deve desligar também (dependência)
      if (workspaceAccessToggle && workspaceAccessToggle.checked) {
        workspaceAccessToggle.checked = false;
        updateWorkspaceAccessStatus(false);
      }
    }
  });
}

if (workspaceAccessToggle) {
  workspaceAccessToggle.addEventListener("change", () => {
    updateWorkspaceAccessStatus(workspaceAccessToggle.checked);
    if (workspaceAccessToggle.checked) {
      // Se ligar o workspaceAccess, e não for CLI, requer helperTools ligado!
      const model = aiModelSelect ? aiModelSelect.value : 'openIa';
      const isCli = model === 'geminiCli' || model === 'claudeCli';
      if (!isCli && helperToolsToggle && !helperToolsToggle.checked) {
        helperToolsToggle.checked = true;
        updateHelperToolsStatus(true);
        applyHelperToolsExclusivity();
      }
    }
  });
}

// Mostra/esconde campos do provider selecionado.
function updateOllamaPullCmd() {
  if (!ollamaLocalModelSelect || !ollamaPullCmd) return;
  const val = ollamaLocalModelSelect.value;
  ollamaPullCmd.textContent = val ? `ollama pull ${val}` : `ollama pull <modelo>`;
}

async function populateOllamaLocalModels(savedModel = null) {
  if (!ollamaLocalModelSelect) return;
  
  const currentVal = savedModel || ollamaLocalModelSelect.value;
  
  try {
    const res = await ipcRenderer.invoke('check-ollama-local-status');
    ollamaLocalModelSelect.innerHTML = '';
    
    let models = [];
    if (res && res.running && Array.isArray(res.models)) {
      models = res.models;
    }
    
    if (models.length > 0) {
      // Adiciona cada modelo como uma opção
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        ollamaLocalModelSelect.appendChild(option);
      });
      
      // Se o modelo configurado atualmente não estiver na lista instalada, adiciona ele no final
      if (currentVal && !models.includes(currentVal)) {
        const option = document.createElement('option');
        option.value = currentVal;
        option.textContent = `${currentVal} (não baixado)`;
        ollamaLocalModelSelect.appendChild(option);
      }
      
      // Seleciona o modelo atual/configurado
      if (currentVal) {
        ollamaLocalModelSelect.value = currentVal;
      } else {
        ollamaLocalModelSelect.selectedIndex = 0;
      }
    } else {
      // Nenhum modelo encontrado ou Ollama offline
      if (currentVal) {
        const option = document.createElement('option');
        option.value = currentVal;
        option.textContent = `${currentVal} (indisponível)`;
        ollamaLocalModelSelect.appendChild(option);
        ollamaLocalModelSelect.value = currentVal;
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = (res && res.running) ? 'Nenhum modelo encontrado no Ollama' : 'Ollama offline / não respondendo';
        option.disabled = true;
        ollamaLocalModelSelect.appendChild(option);
      }
    }
  } catch (e) {
    console.error("Failed to populate Ollama Local models:", e);
    if (currentVal) {
      const option = document.createElement('option');
      option.value = currentVal;
      option.textContent = currentVal;
      ollamaLocalModelSelect.appendChild(option);
      ollamaLocalModelSelect.value = currentVal;
    } else {
      ollamaLocalModelSelect.innerHTML = '<option value="" disabled>Erro ao carregar modelos</option>';
    }
  }
  
  updateOllamaPullCmd();
}

async function populateGeminiCliModels(savedModel = null) {
  if (!geminiCliModelSelect) return;
  const currentVal = savedModel || geminiCliModelSelect.value;
  try {
    const models = await ipcRenderer.invoke('get-gemini-cli-models');
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
      
      const hasModel = models.some(m => (m.id || m.value || m) === currentVal);
      if (currentVal && !hasModel) {
        const option = document.createElement('option');
        option.value = currentVal;
        option.textContent = `${currentVal} (indisponível)`;
        geminiCliModelSelect.appendChild(option);
      }
      
      if (currentVal) {
        geminiCliModelSelect.value = currentVal;
      } else {
        geminiCliModelSelect.selectedIndex = 0;
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum modelo Gemini CLI encontrado';
      option.disabled = true;
      geminiCliModelSelect.appendChild(option);
    }
  } catch (e) {
    console.error("Failed to populate Gemini CLI models:", e);
    if (currentVal) {
      const option = document.createElement('option');
      option.value = currentVal;
      option.textContent = currentVal;
      geminiCliModelSelect.appendChild(option);
      geminiCliModelSelect.value = currentVal;
    } else {
      geminiCliModelSelect.innerHTML = '<option value="" disabled>Erro ao carregar modelos</option>';
    }
  }
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
      
      const hasModel = models.some(m => (m.id || m.value || m) === currentVal);
      if (currentVal && !hasModel) {
        const option = document.createElement('option');
        option.value = currentVal;
        option.textContent = `${currentVal} (indisponível)`;
        claudeCliModelSelect.appendChild(option);
      }
      
      if (currentVal) {
        claudeCliModelSelect.value = currentVal;
      } else {
        claudeCliModelSelect.selectedIndex = 0;
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum modelo Claude CLI encontrado';
      option.disabled = true;
      claudeCliModelSelect.appendChild(option);
    }
  } catch (e) {
    console.error("Failed to populate Claude CLI models:", e);
    if (currentVal) {
      const option = document.createElement('option');
      option.value = currentVal;
      option.textContent = currentVal;
      claudeCliModelSelect.appendChild(option);
      claudeCliModelSelect.value = currentVal;
    } else {
      claudeCliModelSelect.innerHTML = '<option value="" disabled>Erro ao carregar modelos</option>';
    }
  }
}

// Quando ollamaLocal selecionado, nada a fazer extra
function applyOllamaLocalExclusivity() {
}

function releaseOllamaLocalExclusivity() {
}

// Show/hide OpenAI/Ollama/GeminiCli fields based on AI model selection
aiModelSelect.addEventListener('change', () => {
    const v = aiModelSelect.value;
    const isChatGPT = (v === 'openIa');
    if (visionGuideSection) {
      visionGuideSection.style.display = isChatGPT ? 'block' : 'none';
      if (!isChatGPT && visionGuideEnabledToggle && visionGuideEnabledToggle.checked) {
        visionGuideEnabledToggle.checked = false;
        updateVisionGuideEnabledStatus(false);
        ipcRenderer.send('set-vision-guide-config', { enabled: false });
      }
    }
    const isOllama = (v === 'llama' || v === 'llama-stream' || v === 'ollamaLocal');
    const isCli = (v === 'geminiCli' || v === 'claudeCli');
    const disableHelperTools = (v === 'geminiCli' || v === 'claudeCli' || v === 'llama' || v === 'llama-stream');
    openIaTokenContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    openAiModelContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    if (openAiReasoningEffortContainer) openAiReasoningEffortContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    if (openAiVisionModelContainer) openAiVisionModelContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = (v === 'ollamaLocal') ? 'flex' : 'none';
    if (ollamaLocalInfo) ollamaLocalInfo.style.display = (v === 'ollamaLocal') ? 'block' : 'none';
    if (geminiCliModelContainer) geminiCliModelContainer.style.display = (v === 'geminiCli') ? 'flex' : 'none';
    if (geminiCliInfo) geminiCliInfo.style.display = (v === 'geminiCli') ? 'block' : 'none';
    if (claudeCliModelContainer) claudeCliModelContainer.style.display = (v === 'claudeCli') ? 'flex' : 'none';
    if (claudeCliInfo) claudeCliInfo.style.display = (v === 'claudeCli') ? 'block' : 'none';
    const backendApiKeyContainer = document.getElementById('backend-api-key-container');
    if (backendApiKeyContainer) backendApiKeyContainer.style.display = isOllama ? 'flex' : 'none';
    // CLI/backend providers gerenciam/não suportam ferramentas — helperTools fica desabilitado.
    if (helperToolsToggle) {
      helperToolsToggle.disabled = disableHelperTools;
      helperToolsToggle.closest && helperToolsToggle.closest('.setting-item') &&
        (helperToolsToggle.closest('.setting-item').style.opacity = disableHelperTools ? '0.4' : '');
      if (disableHelperTools && helperToolsToggle.checked) {
        helperToolsToggle.checked = false;
        updateHelperToolsStatus(false);
      }
    }
    applyWorkspaceAccessVisibility(v);
    if (v === 'ollamaLocal') {
      populateOllamaLocalModels();
      applyOllamaLocalExclusivity();
    } else {
      releaseOllamaLocalExclusivity();
      if (v === 'geminiCli') {
        populateGeminiCliModels();
      } else if (v === 'claudeCli') {
        populateClaudeCliModels();
      }
    }
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
            await populateOllamaLocalModels();
            const res = await ipcRenderer.invoke('check-ollama-local-status');
            if (!res || !res.running) {
                ollamaStatusResult.innerHTML = '<span style="color:#ff6b6b">Ollama não está rodando.</span> Rode <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama serve</code> no terminal.';
                return;
            }
            const selected = ollamaLocalModelSelect.value;
            const installed = res.models || [];
            const hasIt = installed.some(m => m === selected || m.startsWith(selected.split(':')[0] + ':'));
            if (hasIt && selected) {
                ollamaStatusResult.innerHTML = `<span style="color:#9ef0a8">Ollama rodando.</span> Modelo <code style="color:#9ef0a8">${selected}</code> está baixado. Pronto pra uso!`;
            } else if (selected) {
                ollamaStatusResult.innerHTML = `<span style="color:#ffb74d">Ollama rodando, mas modelo <code>${selected}</code> não está baixado.</span><br>Modelos disponíveis: ${installed.length ? installed.join(', ') : '(nenhum)'}<br>Rode: <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama pull ${selected}</code>`;
            } else {
                ollamaStatusResult.innerHTML = `<span style="color:#ffb74d">Ollama rodando, mas nenhum modelo foi encontrado.</span> Instale um com <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama pull qwen2.5-coder:7b</code> no terminal.`;
            }
        } catch (e) {
            ollamaStatusResult.innerHTML = `Erro ao verificar: ${e.message}`;
            ollamaStatusResult.style.color = '#ff6b6b';
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
        claudeCliStatusResult.innerHTML = '<span style="color:#9ef0a8">✓ Claude Code CLI instalado.</span>';
      } else {
        claudeCliStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Não encontrado.</span> Instale com <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">npm install -g @anthropic-ai/claude-code</code>';
      }
    } catch (e) {
      claudeCliStatusResult.innerHTML = `<span style="color:#ff6b6b">Erro: ${e.message}</span>`;
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
        geminiCliStatusResult.innerHTML = '<span style="color:#9ef0a8">✓ Gemini CLI instalado e pronto.</span>';
      } else {
        geminiCliStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Não encontrado.</span> Instale com <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">npm install -g @google/gemini-cli</code>';
      }
    } catch (e) {
      geminiCliStatusResult.innerHTML = `<span style="color:#ff6b6b">Erro: ${e.message}</span>`;
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

  // Save reasoning effort e modelo de visão
  if (openAiReasoningEffortSelect) {
    ipcRenderer.send("set-openai-reasoning-effort", openAiReasoningEffortSelect.value);
  }
  if (openAiVisionModelSelect) {
    ipcRenderer.send("set-openai-vision-model", openAiVisionModelSelect.value);
  }

  // Save Ollama Local model
  if (ollamaLocalModelSelect) {
    ipcRenderer.send("set-ollama-local-model", ollamaLocalModelSelect.value);
  }

  // Save Claude Code CLI model
  if (claudeCliModelSelect) {
    ipcRenderer.send("set-claude-cli-model", claudeCliModelSelect.value);
  }

  // Save Gemini CLI model
  if (geminiCliModelSelect) {
    ipcRenderer.send("set-gemini-cli-model", geminiCliModelSelect.value);
  }

  // Salva o token OpenAI de forma NÃO-destrutiva: só grava quando o campo tem
  // conteúdo. Se o campo estiver vazio (ex.: o load falhou, ou outra janela/
  // sessão abriu o config sem preencher), NÃO reenviamos "" — isso apagaria a
  // chave já salva. Limpar a chave é feito exclusivamente pelo botão "clear"
  // (set-open-ia-token com "" explícito). Bug já queimou a chave do usuário.
  const _tokenVal = (openIaTokenInput.value || "").trim();
  if (_tokenVal) {
    ipcRenderer.send("set-open-ia-token", _tokenVal);
  }

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
// Nome/background do usuário (dados pessoais) moraram pra preferences.js —
// ver "Preferências do Usuário". Aqui só o que é funcional/técnico do tradutor.
const translationEnabledToggle = document.getElementById('translation-enabled');
const translationEnabledStatus = document.getElementById('translation-enabled-status');
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
    if (translationTargetLangSelect) translationTargetLangSelect.value = ta.targetLanguage || 'pt-br';
    // Modo de Teste é só por sessão — sempre começa desmarcado ao abrir o config.
    if (translationTestModeInput) translationTestModeInput.checked = false;
    await populateMicDevices(ta.micDevice || '');
  } catch (e) {
    console.warn('[TranslationAssistant] load config failed:', e.message);
  }
})();

// === Assistente Guiado por Visão (Tutor) ===
const visionGuideEnabledToggle  = document.getElementById('vision-guide-enabled');
const visionGuideEnabledStatus  = document.getElementById('vision-guide-enabled-status');
const visionGuideIntervalSelect = document.getElementById('vision-guide-interval');
const visionGuideCooldownSelect = document.getElementById('vision-guide-cooldown');
const visionGuideAudioInput     = document.getElementById('vision-guide-audio');
const visionGuideRagInput       = document.getElementById('vision-guide-rag');

function updateVisionGuideEnabledStatus(v) {
  if (visionGuideEnabledStatus) visionGuideEnabledStatus.textContent = v ? 'ON' : 'OFF';
}

if (visionGuideEnabledToggle) {
  visionGuideEnabledToggle.addEventListener('change', () => {
    updateVisionGuideEnabledStatus(visionGuideEnabledToggle.checked);
    // Exclusivo com o Tradutor e o Assistente em tempo real (concorrência de mic/tela).
    if (visionGuideEnabledToggle.checked) {
      if (translationEnabledToggle && translationEnabledToggle.checked) {
        translationEnabledToggle.checked = false;
        updateTranslationEnabledStatus(false);
        ipcRenderer.send('set-translation-assistant-config', { enabled: false });
      }
      if (typeof realtimeAssistantToggle !== 'undefined' && realtimeAssistantToggle && realtimeAssistantToggle.checked) {
        realtimeAssistantToggle.checked = false;
        if (typeof updateRealtimeAssistantStatus === 'function') updateRealtimeAssistantStatus(false);
      }
    }
    ipcRenderer.send('set-vision-guide-config', { enabled: visionGuideEnabledToggle.checked });
  });
}
if (visionGuideIntervalSelect) {
  visionGuideIntervalSelect.addEventListener('change', () => {
    ipcRenderer.send('set-vision-guide-config', { intervalSeconds: parseInt(visionGuideIntervalSelect.value, 10) });
  });
}
if (visionGuideCooldownSelect) {
  visionGuideCooldownSelect.addEventListener('change', () => {
    ipcRenderer.send('set-vision-guide-config', { minInterventionSeconds: parseInt(visionGuideCooldownSelect.value, 10) });
  });
}
if (visionGuideAudioInput) {
  visionGuideAudioInput.addEventListener('change', () => {
    ipcRenderer.send('set-vision-guide-config', { listenAudio: visionGuideAudioInput.checked });
  });
}
if (visionGuideRagInput) {
  visionGuideRagInput.addEventListener('change', () => {
    ipcRenderer.send('set-vision-guide-config', { useKnowledgeBase: visionGuideRagInput.checked });
  });
}

// Carrega valores salvos do Assistente Guiado por Visão ao abrir config
(async () => {
  try {
    const vg = await ipcRenderer.invoke('get-vision-guide-config');
    if (!vg) return;
    if (visionGuideEnabledToggle) {
      visionGuideEnabledToggle.checked = !!vg.enabled;
      updateVisionGuideEnabledStatus(!!vg.enabled);
    }
    if (visionGuideIntervalSelect) visionGuideIntervalSelect.value = String(vg.intervalSeconds || 5);
    if (visionGuideCooldownSelect) visionGuideCooldownSelect.value = String(vg.minInterventionSeconds || 12);
    if (visionGuideAudioInput) visionGuideAudioInput.checked = vg.listenAudio !== false;
    if (visionGuideRagInput) visionGuideRagInput.checked = vg.useKnowledgeBase !== false;
  } catch (e) {
    console.warn('[VisionGuide] load config failed:', e.message);
  }
})();

// Base de Conhecimento (RAG) e dados pessoais (nome/background) moraram pra
// preferences.js — ver "Preferências do Usuário".
const openPreferencesBtn = document.getElementById('open-preferences-btn');
if (openPreferencesBtn) {
  openPreferencesBtn.addEventListener('click', () => ipcRenderer.send('open-preferences-ui'));
}

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
