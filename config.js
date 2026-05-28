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
  
  // When OS integration is enabled, automatically enable print mode
  if (isOsIntegration && !printModeToggle.checked) {
    printModeToggle.checked = true;
    updatePrintModeStatus(true);
    ipcRenderer.send("save-print-mode-status", true);
  }
}

function updateRealtimeAssistantStatus(isRealtimeAssistant) {
  realtimeAssistantStatus.textContent = isRealtimeAssistant ? "ON" : "OFF";
}

function updateHelperToolsStatus(isEnabled) {
  if (!helperToolsStatus) return;
  helperToolsStatus.textContent = isEnabled ? "ON" : "OFF";
  // Atualiza disponibilidade de workspaceAccess (depende de helperTools).
  if (workspaceAccessToggle && workspaceAccessItem) {
    if (!isEnabled) {
      workspaceAccessToggle.checked = false;
      updateWorkspaceAccessStatus(false);
      workspaceAccessToggle.disabled = true;
      workspaceAccessItem.style.opacity = "0.5";
      workspaceAccessItem.title = "Requer Ferramentas Avançadas ligado.";
    } else {
      workspaceAccessToggle.disabled = false;
      workspaceAccessItem.style.opacity = "1";
      workspaceAccessItem.title = "Permite anexar pastas/arquivos como contexto. A IA pode ler/editar dentro deles (com confirmação).";
    }
  }
}

function updateWorkspaceAccessStatus(isEnabled) {
  if (!workspaceAccessStatus) return;
  workspaceAccessStatus.textContent = isEnabled ? "ON" : "OFF";
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
});

// Handle debug toggle live update
debugModeToggle.addEventListener("change", () => {
  disableRealtimeIfOtherEnabled(debugModeToggle);
  disableHelperToolsIfOtherEnabled(debugModeToggle);
  updateDebugModeStatus(debugModeToggle.checked);
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
    // Garante que helperTools esteja ligado
    if (workspaceAccessToggle.checked && !(helperToolsToggle && helperToolsToggle.checked)) {
      workspaceAccessToggle.checked = false;
    }
    updateWorkspaceAccessStatus(workspaceAccessToggle.checked);
  });
}

// Mostra/esconde campos do provider selecionado.
function updateOllamaPullCmd() {
  if (!ollamaLocalModelSelect || !ollamaPullCmd) return;
  ollamaPullCmd.textContent = `ollama pull ${ollamaLocalModelSelect.value}`;
}

// Quando ollamaLocal selecionado, desliga helperTools/workspaceAccess.
function applyOllamaLocalExclusivity() {
  if (aiModelSelect.value !== 'ollamaLocal') return;
  if (helperToolsToggle && helperToolsToggle.checked) {
    helperToolsToggle.checked = false;
    updateHelperToolsStatus(false);
  }
  if (workspaceAccessToggle && workspaceAccessToggle.checked) {
    workspaceAccessToggle.checked = false;
    updateWorkspaceAccessStatus(false);
  }
  // Desabilita os toggles (visual) enquanto ollamaLocal estiver selecionado.
  if (helperToolsToggle) {
    helperToolsToggle.disabled = true;
    const item = helperToolsToggle.closest('.setting-item');
    if (item) { item.style.opacity = '0.5'; item.title = 'Indisponível com Ollama Local — troque pro ChatGPT pra usar.'; }
  }
  if (workspaceAccessToggle) {
    workspaceAccessToggle.disabled = true;
  }
}

function releaseOllamaLocalExclusivity() {
  if (helperToolsToggle) {
    helperToolsToggle.disabled = false;
    const item = helperToolsToggle.closest('.setting-item');
    if (item) { item.style.opacity = '1'; item.title = 'Permite à IA ler e editar arquivos do seu computador, executar comandos e gerar scripts.'; }
  }
  if (workspaceAccessToggle && helperToolsToggle && helperToolsToggle.checked) {
    workspaceAccessToggle.disabled = false;
  }
}

// Show/hide OpenAI/Ollama fields based on AI model selection
aiModelSelect.addEventListener('change', () => {
    const v = aiModelSelect.value;
    openIaTokenContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    openAiModelContainer.style.display = (v === 'openIa') ? 'flex' : 'none';
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = (v === 'ollamaLocal') ? 'flex' : 'none';
    if (ollamaLocalInfo) ollamaLocalInfo.style.display = (v === 'ollamaLocal') ? 'block' : 'none';
    if (v === 'ollamaLocal') {
      applyOllamaLocalExclusivity();
    } else {
      releaseOllamaLocalExclusivity();
    }
});

if (ollamaLocalModelSelect) {
    ollamaLocalModelSelect.addEventListener('change', updateOllamaPullCmd);
}

if (checkOllamaBtn) {
    checkOllamaBtn.addEventListener('click', async () => {
        ollamaStatusResult.textContent = '⏳ Verificando...';
        ollamaStatusResult.style.color = '#888';
        try {
            const res = await ipcRenderer.invoke('check-ollama-local-status');
            if (!res || !res.running) {
                ollamaStatusResult.innerHTML = '❌ <span style="color:#ff6b6b">Ollama não está rodando.</span> Rode <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama serve</code> no terminal.';
                return;
            }
            const selected = ollamaLocalModelSelect.value;
            const installed = res.models || [];
            const hasIt = installed.some(m => m === selected || m.startsWith(selected.split(':')[0] + ':'));
            if (hasIt) {
                ollamaStatusResult.innerHTML = `✅ <span style="color:#9ef0a8">Ollama rodando.</span> Modelo <code style="color:#9ef0a8">${selected}</code> está baixado. Pronto pra uso!`;
            } else {
                ollamaStatusResult.innerHTML = `⚠️ <span style="color:#ffb74d">Ollama rodando, mas modelo <code>${selected}</code> não está baixado.</span><br>Modelos disponíveis: ${installed.length ? installed.join(', ') : '(nenhum)'}<br>Rode: <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">ollama pull ${selected}</code>`;
            }
        } catch (e) {
            ollamaStatusResult.innerHTML = `❌ Erro ao verificar: ${e.message}`;
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

  // Close window
  window.close();
});

// Handle clear OpenAI token
document.getElementById("clear-openai-token").addEventListener("click", () => {
    openIaTokenInput.value = "";
    ipcRenderer.send("set-open-ia-token", ""); // Clear token in main process as well
});