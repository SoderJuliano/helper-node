const { ipcRenderer } = require("electron");
const { supportsReasoningEffort } = require("./services/openAiRealtimeModels");

// Botão de tela cheia (janela frameless não tem o botão de maximizar do SO).
document.getElementById('win-maximize-btn')?.addEventListener('click', () => {
  ipcRenderer.send('window-toggle-maximize');
});

// Botão de fechar a janela
document.getElementById('win-close-btn')?.addEventListener('click', () => {
  window.close();
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
const stealthModeToggle = document.getElementById("stealth-mode-toggle");
const stealthModeStatus = document.getElementById("stealth-mode-status");
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

const backendModelContainer = document.getElementById("backend-model-container");
const backendModelSelect = document.getElementById("backend-model-select");
const backendApiKey = document.getElementById("backend-api-key");

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
// Copilot CLI elements
const copilotCliModelContainer = document.getElementById("copilot-cli-model-container");
const copilotCliModelNote = document.getElementById("copilot-cli-model-note");
const copilotCliModelSelect = document.getElementById("copilot-cli-model-select");
const copilotCliInfo = document.getElementById("copilot-cli-info");
const checkCopilotCliBtn = document.getElementById("check-copilot-cli-btn");
const copilotCliStatusResult = document.getElementById("copilot-cli-status-result");

// Nexa elements
// O "Apenas Nexa (Modo Imersivo)" foi removido junto com a janela fullscreen
// dedicada da Nexa; só o toggle da Nexa em si continua na tela.
const nexaToggle = document.getElementById("nexa-toggle");
const nexaStatus = document.getElementById("nexa-status");

function updateNexaStatus(isEnabled) {
  if (nexaStatus) nexaStatus.textContent = isEnabled ? "ON" : "OFF";
  const googleTtsVoiceWrapper = document.getElementById("google-tts-voice-wrapper");
  if (googleTtsVoiceWrapper) {
    googleTtsVoiceWrapper.style.display = isEnabled ? "none" : "block";
  }
  const googleTtsToggleItem = document.getElementById("google-tts-toggle-item");
  if (googleTtsToggleItem) {
    googleTtsToggleItem.style.display = isEnabled ? "none" : "flex";
  }
  if (isEnabled && googleTtsContainer) {
    googleTtsContainer.style.display = "block";
  }
}

// Google TTS elements
const googleTtsToggle = document.getElementById("google-tts-toggle");
const googleTtsStatus = document.getElementById("google-tts-status");
const googleTtsContainer = document.getElementById("google-tts-container");
const googleTtsKey = document.getElementById("google-tts-key");
const googleTtsVoiceSelect = document.getElementById("google-tts-voice-select");
const googleTtsTestBtn = document.getElementById("google-tts-test-btn");
const googleTtsTestResult = document.getElementById("google-tts-test-result");

function updateGoogleTtsStatus(isEnabled) {
  if (googleTtsStatus) googleTtsStatus.textContent = isEnabled ? "ON" : "OFF";
  const isNexa = nexaToggle ? nexaToggle.checked : false;
  if (googleTtsContainer) {
    googleTtsContainer.style.display = (isEnabled || isNexa) ? "block" : "none";
  }
  const googleTtsVoiceWrapper = document.getElementById("google-tts-voice-wrapper");
  if (googleTtsVoiceWrapper) {
    googleTtsVoiceWrapper.style.display = isNexa ? "none" : "block";
  }
  const googleTtsToggleItem = document.getElementById("google-tts-toggle-item");
  if (googleTtsToggleItem) {
    googleTtsToggleItem.style.display = isNexa ? "none" : "flex";
  }
}

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

function updateStealthModeStatus(isEnabled) {
  if (!stealthModeStatus) return;
  stealthModeStatus.textContent = isEnabled ? "ON" : "OFF";
}

// Mostra/oculta workspaceAccess.
// Disponível para OpenAI (helperTools lê o projeto) e para os CLIs (define o
// diretório de trabalho que o CLI usa como cwd e contexto de repositório).
// Backends genéricos e Ollama não suportam — esconde e desliga.
function applyWorkspaceAccessVisibility(model) {
  if (!workspaceAccessItem) return;
  const supportsWorkspace = model === 'openIa' || model === 'geminiCli' || model === 'claudeCli' || model === 'copilotCli' || model === 'ollamaLocal' || model === 'llama' || model === 'llama-stream';
  workspaceAccessItem.style.display = supportsWorkspace ? '' : 'none';
  if (!supportsWorkspace && workspaceAccessToggle) {
    workspaceAccessToggle.checked = false;
    updateWorkspaceAccessStatus(false);
  }
}

// Edição Lite (100% online): esconde tudo que é local/backend e força OpenAI.
// O Assistente em tempo real CONTINUA visível — na Lite ele roda 100% online
// (transcrição + resposta na OpenAI), sem Whisper local.
function applyLiteUi() {
  try {
    aiModelSelect.value = 'openIa';
    aiModelSelect.dispatchEvent(new Event('change'));
    const si = aiModelSelect.closest('.setting-item');
    if (si) si.style.display = 'none';
  } catch (_) {}
  ['backend-api-key-container', 'ollama-local-model-container', 'ollama-local-info',
   'gemini-cli-model-container', 'gemini-cli-info',
   'claude-cli-model-container', 'claude-cli-info',
   'copilot-cli-model-container', 'copilot-cli-info'].forEach((id) => {
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
  if (toggle === helperToolsToggle && toggle.checked && realtimeAssistantToggle.checked) {
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
  // Load stealth mode
  // -------------------------
  try {
    const isStealth = await ipcRenderer.invoke("get-stealth-mode-status");
    if (stealthModeToggle) {
      stealthModeToggle.checked = isStealth;
      updateStealthModeStatus(isStealth);
    }
  } catch (e) {
    console.warn("stealth mode load failed:", e);
  }

  // -------------------------
  // Load Google TTS mode
  // -------------------------
  try {
    const ttsCfg = await ipcRenderer.invoke("get-google-tts-config");
    if (googleTtsToggle && ttsCfg) {
      googleTtsToggle.checked = !!ttsCfg.enabled;
      updateGoogleTtsStatus(!!ttsCfg.enabled);
      if (googleTtsKey) googleTtsKey.value = ttsCfg.keyPathOrKey || "";
      if (googleTtsVoiceSelect) googleTtsVoiceSelect.value = ttsCfg.voiceName || "pt-BR-Neural2-C";
    }
  } catch (e) {
    console.warn("Google TTS load failed:", e);
  }

  // -------------------------
  // Load Nexa AI Assistant mode
  // -------------------------
  try {
    const nexaCfg = await ipcRenderer.invoke("nexa:get-config");
    if (nexaToggle && nexaCfg) {
      nexaToggle.checked = !!nexaCfg.enabled;
      updateNexaStatus(!!nexaCfg.enabled);
    }
  } catch (e) {
    console.warn("Nexa config load failed:", e);
  }

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
  // Se já está num provider CLI, desabilita helperTools visualmente.
  // Para Ollama backend, deixamos `checkBackendToolsAvailability` decidir após carregar o backend model.
  const _disableHelperToolsInit = (aiModelSelect.value === 'geminiCli' || aiModelSelect.value === 'claudeCli');
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

  if (ipcRenderer) {
    ipcRenderer.on('backend-status-update', (event, data) => {
      // console.log("Status do backend remoto atualizado:", data);
    });
  }



  // Load saved backend model when initializing config
  setTimeout(async () => {
    try {
      const saved = await ipcRenderer.invoke("get-backend-model");
      await populateBackendModels(saved);
    } catch(e) {}
  }, 500);

  // Load saved OpenAI model
  const savedOpenAiModel = await ipcRenderer.invoke("get-openai-model");
  await populateOpenAiModels(savedOpenAiModel);
  updateRealtimeFastModelNote();

  // Load saved reasoning effort e modelo de visão
  try {
    const savedEffort = await ipcRenderer.invoke("get-openai-reasoning-effort");
    if (savedEffort && openAiReasoningEffortSelect) openAiReasoningEffortSelect.value = savedEffort;
  } catch (e) { console.warn("get-openai-reasoning-effort failed:", e); }
  try {
    const savedVisionModel = await ipcRenderer.invoke("get-openai-vision-model");
    await populateOpenAiVisionModels(savedVisionModel);
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

  // Load saved Copilot CLI model
  try {
    const savedCopilotCliModel = await ipcRenderer.invoke("get-copilot-cli-model");
    await populateCopilotCliModels(savedCopilotCliModel);
  } catch (e) { console.warn("copilot-cli model load failed:", e); }

  // Show/hide provider fields based on saved model
  const isChatGPT = (aiModelSelect.value === 'openIa' || aiModelSelect.value === 'openIaCodex');
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
  } else if (aiModelSelect.value === 'copilotCli') {
    if (copilotCliModelContainer) copilotCliModelContainer.style.display = 'flex';
    if (copilotCliModelNote) copilotCliModelNote.style.display = 'block';
    if (copilotCliInfo) copilotCliInfo.style.display = 'block';
  } else if (aiModelSelect.value === 'llama' || aiModelSelect.value === 'llama-stream') {
    const backendModelContainerEl = document.getElementById('backend-model-container');
    if (backendModelContainerEl) backendModelContainerEl.style.display = 'flex';
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

  // -------------------------
  // Carrega configurações de execução Java / Maven / Gradle se projeto anexado
  // -------------------------
  try {
    const javaSection = document.getElementById('java-runner-config-section');
    const javaBadge = document.getElementById('java-runner-project-badge');
    const javaDesc = document.getElementById('java-runner-project-desc');
    const javaBtn = document.getElementById('java-runner-open-config-btn');
    const javaStatus = document.getElementById('java-runner-config-status');

    if (javaSection) {
      const ctx = await ipcRenderer.invoke('get-project-context');
      if (ctx && ctx.path) {
        const detectRes = await ipcRenderer.invoke('app-runner-detect-project', ctx.path);
        if (detectRes && detectRes.ok && (detectRes.data.type === 'gradle' || detectRes.data.type === 'maven' || detectRes.data.type === 'java')) {
          javaSection.style.display = 'block';
          const isSpring = detectRes.data.isSpringBoot ? ' (Spring Boot)' : '';
          if (javaBadge) {
            javaBadge.textContent = detectRes.data.type === 'gradle' ? `🐘 Gradle${isSpring}` : (detectRes.data.type === 'maven' ? `🪶 Maven${isSpring}` : '☕ Java');
          }
          if (javaDesc) {
            javaDesc.innerHTML = `Gerencie variáveis de ambiente, perfis ativos do Spring Boot e argumentos para o projeto: <strong>${ctx.name}</strong>.`;
          }
          if (javaBtn) {
            javaBtn.onclick = () => {
              ipcRenderer.send('open-app-runner-config', ctx.path);
            };
          }
          try {
            const cfgRes = await ipcRenderer.invoke('app-runner-get-config', ctx.path);
            if (cfgRes && cfgRes.ok && javaStatus && cfgRes.data) {
              const envCount = Object.keys(cfgRes.data.envVars || {}).length;
              const prof = cfgRes.data.activeProfiles || 'padrão';
              javaStatus.textContent = `Perfis: ${prof} | Variáveis: ${envCount}`;
            }
          } catch (_) {}
        }
      }
    }
  } catch (e) {
    console.warn("Java runner config check in config.html failed:", e);
  }

  // Edição Lite: ajusta a UI (100% online) depois que tudo carregou.
  try {
    const _edition = await ipcRenderer.invoke('get-edition');
    _appEdition = _edition || 'full';
    if (_edition === 'lite') applyLiteUi();
  } catch (_) {}
  applyBackendUrlVisibility();
});

async function populateBackendModels(savedModel = null) {
  if (!backendModelSelect) return;
  const currentVal = savedModel || backendModelSelect.value;
  let models = [];
  let fetchFailed = false;

  try {
    const url = await ipcRenderer.invoke("get-backend-url");
    if (url) {
      const baseUrl = url.replace(/\/+$/, '');
      const apiKey = backendApiKey ? backendApiKey.value : '';
      const headers = {
        'ngrok-skip-browser-warning': 'true'
      };
      if (apiKey) headers['x-api-key'] = apiKey;

      let data = null;
      // Try /models, then /api/tags, then /v1/models
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

      if (!data) {
        try {
          const res = await fetch(`${baseUrl}/v1/models`, { method: 'GET', headers });
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
      } else {
        fetchFailed = true;
      }
    } else {
      fetchFailed = true;
    }
  } catch (e) {
    console.warn("Failed to populate backend models:", e);
    fetchFailed = true;
  }

  // Parse extracted model names
  let parsedNames = models.map(m => typeof m === 'object' ? (m.name || m.model || m.id || String(m)) : String(m)).filter(Boolean);

  // If fetch failed or yielded no models, use saved model & fallbacks instead of breaking UI
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

  checkBackendToolsAvailability();
}

// Modelos da OpenAI: vêm SEMPRE da API (/v1/models), nunca escritos à mão.
// Sem lista de reserva chumbada — se a chave não está configurada ou a API não
// responde, o select diz isso, em vez de oferecer nome que pode não existir
// mais na conta.
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

// Preenche um <select> com a lista vinda da API. Mantém a escolha do usuário
// mesmo que o modelo tenha saído da conta — marcado como (indisponível), pra
// ninguém perder a configuração em silêncio.
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

// Mesma fonte do select principal: a API. O catálogo não marca quais modelos
// aceitam imagem, então listamos os mesmos IDs — adivinhar capacidade de visão
// a partir do nome seria voltar a chutar.
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

function checkBackendToolsAvailability() {
  // Não desabilita nem desmarca as preferências ativas do usuário.
  // Permite que o usuário use ferramentas e anexos de workspace em qualquer provedor/modelo.
}


// Handle debug toggle live update
debugModeToggle.addEventListener("change", () => {
  disableHelperToolsIfOtherEnabled(debugModeToggle);
  updateDebugModeStatus(debugModeToggle.checked);
  applyBackendUrlVisibility();
});

// Handle print mode toggle live update
printModeToggle.addEventListener("change", () => {
  disableHelperToolsIfOtherEnabled(printModeToggle);
  updatePrintModeStatus(printModeToggle.checked);
});

// Handle OS integration toggle live update
osIntegrationToggle.addEventListener("change", () => {
  disableHelperToolsIfOtherEnabled(osIntegrationToggle);
  updateOsIntegrationStatus(osIntegrationToggle.checked);
});

// Handle stealth mode toggle live update
if (stealthModeToggle) {
  stealthModeToggle.addEventListener("change", () => {
    updateStealthModeStatus(stealthModeToggle.checked);
    ipcRenderer.send("save-stealth-mode-status", stealthModeToggle.checked);
  });
}

// Handle Nexa toggle live update
if (nexaToggle) {
  nexaToggle.addEventListener("change", () => {
    const enabled = nexaToggle.checked;
    updateNexaStatus(enabled);
    if (enabled && googleTtsContainer) {
      googleTtsContainer.style.display = "block";
    }
    const toast = document.getElementById("nexa-error-toast");
    if (toast) toast.style.display = "none";
  });
}

// Handle Google TTS toggle live update & test
if (googleTtsToggle) {
  googleTtsToggle.addEventListener("change", async () => {
    const enabled = googleTtsToggle.checked;
    updateGoogleTtsStatus(enabled);

    const keyPathOrKey = googleTtsKey ? googleTtsKey.value.trim() : "";
    const voiceName = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C";

    if (enabled && googleTtsTestResult) {
      googleTtsTestResult.style.color = "#ffb74d";
      googleTtsTestResult.textContent = "Verificando conexão e cota...";
      try {
        const testRes = await ipcRenderer.invoke("google-tts-test", keyPathOrKey);
        if (testRes.ok) {
          googleTtsTestResult.style.color = "#28a745";
          googleTtsTestResult.textContent = "Conexão OK! Cota ativa.";
        } else {
          googleTtsTestResult.style.color = "#ffb74d";
          googleTtsTestResult.textContent = `Aviso: cota zerada ou erro na chave (${testRes.error}). O modo permanece ativo.`;
        }
      } catch (err) {
        googleTtsTestResult.style.color = "#ff6b6b";
        googleTtsTestResult.textContent = `Aviso de conexão: ${err.message}`;
      }
    }

    ipcRenderer.send("save-google-tts-config", {
      enabled,
      keyPathOrKey,
      voiceName
    });
  });
}

const saveGoogleTtsParams = () => {
  if (!googleTtsToggle) return;
  ipcRenderer.send("save-google-tts-config", {
    enabled: googleTtsToggle.checked,
    keyPathOrKey: googleTtsKey ? googleTtsKey.value.trim() : "",
    voiceName: googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C"
  });
};

if (googleTtsKey) googleTtsKey.addEventListener("blur", saveGoogleTtsParams);
if (googleTtsVoiceSelect) googleTtsVoiceSelect.addEventListener("change", saveGoogleTtsParams);

if (googleTtsTestBtn) {
  googleTtsTestBtn.addEventListener("click", async () => {
    if (!googleTtsTestResult) return;
    const keyPathOrKey = googleTtsKey ? googleTtsKey.value.trim() : "";
    googleTtsTestResult.style.color = "#00aaff";
    googleTtsTestResult.textContent = "Testando conexão...";
    try {
      const res = await ipcRenderer.invoke("google-tts-test", keyPathOrKey);
      if (res.ok) {
        googleTtsTestResult.style.color = "#28a745";
        googleTtsTestResult.textContent = res.message || "Conexão e cota validadas!";
      } else {
        googleTtsTestResult.style.color = "#ff6b6b";
        googleTtsTestResult.textContent = `Erro: ${res.error}`;
      }
    } catch (err) {
      googleTtsTestResult.style.color = "#ff6b6b";
      googleTtsTestResult.textContent = `Erro ao testar: ${err.message}`;
    }
  });
}

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
      const isCli = model === 'geminiCli' || model === 'claudeCli' || model === 'copilotCli';
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

async function populateGeminiCliModels(savedModel = null, force = false) {
  if (!geminiCliModelSelect) return;
  const currentVal = savedModel || geminiCliModelSelect.value;
  const spinner = document.getElementById("gemini-cli-model-spinner");
  if (spinner) spinner.style.display = "inline-block";
  geminiCliModelSelect.disabled = true;
  try {
    const models = await ipcRenderer.invoke('get-gemini-cli-models', force);
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
      option.textContent = 'Nenhum modelo Antigravity (agy) encontrado';
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
  } finally {
    if (spinner) spinner.style.display = "none";
    geminiCliModelSelect.disabled = false;
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

// Sondagem ao vivo do binário da Copilot CLI (igual ao Claude e Gemini)
async function populateCopilotCliModels(savedModel = null) {
  if (!copilotCliModelSelect) return;
  const currentVal = savedModel != null ? savedModel : copilotCliModelSelect.value;
  try {
    const models = await ipcRenderer.invoke('get-copilot-cli-models');
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

      const hasModel = models.some(m => (m.id || m.value || m) === currentVal);
      if (currentVal && !hasModel) {
        const option = document.createElement('option');
        option.value = currentVal;
        option.textContent = `${currentVal} (indisponível)`;
        copilotCliModelSelect.appendChild(option);
      }

      if (currentVal) {
        copilotCliModelSelect.value = currentVal;
      } else {
        copilotCliModelSelect.selectedIndex = 0;
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Nenhum modelo Copilot CLI encontrado';
      option.disabled = true;
      copilotCliModelSelect.appendChild(option);
    }
  } catch (e) {
    console.error("Failed to populate Copilot CLI models:", e);
    if (currentVal) {
      const option = document.createElement('option');
      option.value = currentVal;
      option.textContent = currentVal;
      copilotCliModelSelect.appendChild(option);
      copilotCliModelSelect.value = currentVal;
    } else {
      copilotCliModelSelect.innerHTML = '<option value="" disabled>Erro ao carregar modelos</option>';
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
    ipcRenderer.send("set-ai-model", v);
    const isChatGPT = (v === 'openIa' || v === 'openIaCodex');
    if (visionGuideSection) {
      visionGuideSection.style.display = isChatGPT ? 'block' : 'none';
      if (!isChatGPT && visionGuideEnabledToggle && visionGuideEnabledToggle.checked) {
        visionGuideEnabledToggle.checked = false;
        updateVisionGuideEnabledStatus(false);
        ipcRenderer.send('set-vision-guide-config', { enabled: false });
      }
    }
    const isOllama = (v === 'llama' || v === 'llama-stream' || v === 'ollamaLocal');
    const isCli = (v === 'geminiCli' || v === 'claudeCli' || v === 'copilotCli');
    let disableHelperTools = (v === 'geminiCli' || v === 'claudeCli' || v === 'copilotCli');
    const isRemoteBackend = (v === 'llama' || v === 'llama-stream');
    if (isRemoteBackend) {
       // Evaluate if remote backend allows tools based on model size
       let modelName = backendModelSelect ? backendModelSelect.value : '';
       let allowTools = false;
       if (modelName) {
           const sizeMatch = modelName.match(/(\d+(?:\.\d+)?)b/i);
           if (sizeMatch && parseFloat(sizeMatch[1]) > 10) allowTools = true;
       }
       disableHelperTools = disableHelperTools || !allowTools;
     }
    const showOpenAi = (v === 'openIa' || v === 'openIaCodex');
    openIaTokenContainer.style.display = showOpenAi ? 'flex' : 'none';
    openAiModelContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (openAiReasoningEffortContainer) openAiReasoningEffortContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (openAiVisionModelContainer) openAiVisionModelContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = (v === 'ollamaLocal') ? 'flex' : 'none';
    if (ollamaLocalInfo) ollamaLocalInfo.style.display = (v === 'ollamaLocal') ? 'block' : 'none';
    if (geminiCliModelContainer) geminiCliModelContainer.style.display = (v === 'geminiCli') ? 'flex' : 'none';
    if (geminiCliInfo) geminiCliInfo.style.display = (v === 'geminiCli') ? 'block' : 'none';
    if (claudeCliModelContainer) claudeCliModelContainer.style.display = (v === 'claudeCli') ? 'flex' : 'none';
    if (claudeCliInfo) claudeCliInfo.style.display = (v === 'claudeCli') ? 'block' : 'none';
    if (copilotCliModelContainer) copilotCliModelContainer.style.display = (v === 'copilotCli') ? 'flex' : 'none';
    if (copilotCliModelNote) copilotCliModelNote.style.display = (v === 'copilotCli') ? 'block' : 'none';
    if (copilotCliInfo) copilotCliInfo.style.display = (v === 'copilotCli') ? 'block' : 'none';
    const backendApiKeyContainer = document.getElementById('backend-api-key-container');
    if (backendApiKeyContainer) backendApiKeyContainer.style.display = isOllama ? 'flex' : 'none';
    const backendModelContainerEl = document.getElementById('backend-model-container');
    if (backendModelContainerEl) backendModelContainerEl.style.display = isRemoteBackend ? 'flex' : 'none';
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
        populateGeminiCliModels(null, true);
      } else if (v === 'claudeCli') {
        populateClaudeCliModels();
      } else if (v === 'copilotCli') {
        populateCopilotCliModels();
      } else if (v === 'openIa' || v === 'openIaCodex') {
        populateOpenAiModels();
      } else if (v === 'llama' || v === 'llama-stream') {
        ipcRenderer.invoke("get-backend-model").then(saved => {
          populateBackendModels(saved);
        }).catch(() => {
          populateBackendModels();
        });
      }
    }
    applyBackendUrlVisibility();
});

if (openAiModelSelect) {
  openAiModelSelect.addEventListener('change', () => {
    ipcRenderer.send("set-openai-model", openAiModelSelect.value);
  });
}
if (geminiCliModelSelect) {
  geminiCliModelSelect.addEventListener('change', () => {
    ipcRenderer.send("set-gemini-cli-model", geminiCliModelSelect.value);
  });
}
if (claudeCliModelSelect) {
  claudeCliModelSelect.addEventListener('change', () => {
    ipcRenderer.send("set-claude-cli-model", claudeCliModelSelect.value);
  });
}
if (copilotCliModelSelect) {
  copilotCliModelSelect.addEventListener('change', () => {
    ipcRenderer.send("set-copilot-cli-model", copilotCliModelSelect.value);
  });
}
if (ollamaLocalModelSelect) {
  ollamaLocalModelSelect.addEventListener('change', () => {
    ipcRenderer.send("set-ollama-local-model", ollamaLocalModelSelect.value);
  });
}
if (backendModelSelect) {
  backendModelSelect.addEventListener('change', () => {
    ipcRenderer.send("set-backend-model", backendModelSelect.value);
    checkBackendToolsAvailability();
  });
}

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

if (checkCopilotCliBtn) {
  checkCopilotCliBtn.addEventListener('click', async () => {
    if (!copilotCliStatusResult) return;
    copilotCliStatusResult.textContent = 'Verificando...';
    copilotCliStatusResult.style.color = '#888';
    try {
      const res = await ipcRenderer.invoke('check-copilot-cli-installed');
      if (res && res.installed) {
        copilotCliStatusResult.innerHTML = '<span style="color:#9ef0a8">✓ Copilot CLI instalado.</span> (isso confirma o binário — não confirma login/autenticação)';
      } else {
        copilotCliStatusResult.innerHTML = '<span style="color:#ff6b6b">✗ Não encontrado.</span> Instale com <code style="background:#0d0d0d;padding:2px 5px;border-radius:3px;color:#9ef0a8;">npm install -g @github/copilot</code>';
      }
    } catch (e) {
      copilotCliStatusResult.innerHTML = `<span style="color:#ff6b6b">Erro: ${e.message}</span>`;
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
  // Validação obrigatória da Nexa + Google TTS JSON
  const isNexaOn = nexaToggle ? nexaToggle.checked : false;
  const ttsKey = googleTtsKey ? googleTtsKey.value.trim() : "";

  if (isNexaOn && !ttsKey) {
    const toast = document.getElementById("nexa-error-toast");
    if (toast) {
      toast.textContent = "Para usar a Nexa, adicione as credenciais do Google Text-to-Speech.";
      toast.style.display = "block";
      toast.scrollIntoView({ behavior: "smooth" });
    } else {
      alert("Para usar a Nexa, adicione as credenciais do Google Text-to-Speech.");
    }
    return; // BLOQUEIA O SALVAMENTO
  }

  // Save Nexa mode (onlyNexa saiu junto com a janela fullscreen dedicada)
  if (nexaToggle) {
    ipcRenderer.send("nexa:save-config", {
      enabled: isNexaOn,
      onlyNexa: false
    });
  }

  // Save Google TTS config (se Nexa estiver ON, força voz padrão da persona)
  if (googleTtsToggle) {
    ipcRenderer.send("save-google-tts-config", {
      enabled: isNexaOn ? true : googleTtsToggle.checked,
      keyPathOrKey: ttsKey,
      voiceName: isNexaOn ? "pt-BR-Neural2-C" : (googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C")
    });
  }

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

  // Save stealth mode
  if (stealthModeToggle) {
    ipcRenderer.send("save-stealth-mode-status", stealthModeToggle.checked);
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

  // Save Copilot CLI model
  if (copilotCliModelSelect) {
    ipcRenderer.send("set-copilot-cli-model", copilotCliModelSelect.value);
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
    if (visionGuideCooldownSelect) visionGuideCooldownSelect.value = String(vg.minInterventionSeconds ?? 0);
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
