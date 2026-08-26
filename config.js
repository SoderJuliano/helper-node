const { ipcRenderer } = require("electron");

document.getElementById('win-maximize-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-toggle-maximize');
});

document.getElementById('win-close-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-close');
});



const instructionTextarea = document.getElementById("prompt-instruction");
const saveButton = document.getElementById("save-btn");
const debugModeToggle = document.getElementById("debug-mode-toggle");
const printModeToggle = document.getElementById("print-mode-toggle");
const osIntegrationToggle = document.getElementById("os-integration-toggle");
const realtimeAssistantToggle = document.getElementById("realtime-assistant-toggle");
const helperToolsToggle = document.getElementById("helper-tools-toggle");
const workspaceAccessToggle = document.getElementById("workspace-access-toggle");
const stealthModeToggle = document.getElementById("stealth-mode-toggle");
const langSelect = document.getElementById("language-select");
const backendUrlValue = document.getElementById("backend-url-value");
const appVersionValue = document.getElementById("app-version-value");
const aiModelSelect = document.getElementById("ai-model");
const openIaTokenContainer = document.getElementById("openai-token-container");
const openIaTokenInput = document.getElementById("openai-token");
const openAiModelContainer = document.getElementById("openai-model-container");
const openAiModelSelect = document.getElementById("openai-model-select");
const visionGuideSection = document.getElementById("vision-guide-section");
const openAiReasoningEffortContainer = document.getElementById("openai-reasoning-effort-container");
const openAiReasoningEffortSelect = document.getElementById("openai-reasoning-effort-select");
const openAiVisionModelContainer = document.getElementById("openai-vision-model-container");
const openAiVisionModelSelect = document.getElementById("openai-vision-model-select");
const ollamaLocalModelContainer = document.getElementById("ollama-local-model-container");
const geminiCliModelContainer = document.getElementById("gemini-cli-model-container");
const claudeCliModelContainer = document.getElementById("claude-cli-model-container");
const copilotCliModelContainer = document.getElementById("copilot-cli-model-container");
const nexaToggle = document.getElementById("nexa-toggle");
const googleTtsToggle = document.getElementById("google-tts-toggle");
const googleTtsContainer = document.getElementById("google-tts-container");
const googleTtsKey = document.getElementById("google-tts-key");
const googleTtsVoiceSelect = document.getElementById("google-tts-voice-select");

document.addEventListener("DOMContentLoaded", async () => {
  const [
    instruction,
    isDebugging,
    isPrintMode,
    isOsIntegration,
    isStealth,
    ttsCfg,
    nexaCfg,
    isRealtimeAssistant,
    helperToolsEnabled,
    wsEnabled,
    savedLang,
    savedAiModel,
    version,
    savedToken,
    savedBackendApiKey,
    savedOpenAiModel,
    savedEffort,
    savedVisionModel,
    savedOllamaModel,
    savedClaudeCliModel,
    savedGeminiCliModel,
    savedCopilotCliModel,
    _edition
  ] = await Promise.all([
    ipcRenderer.invoke("get-prompt-instruction").catch(() => ""),
    ipcRenderer.invoke("get-debug-mode-status").catch(() => false),
    ipcRenderer.invoke("get-print-mode-status").catch(() => false),
    ipcRenderer.invoke("get-os-integration-status").catch(() => false),
    ipcRenderer.invoke("get-stealth-mode-status").catch(() => false),
    ipcRenderer.invoke("get-google-tts-config").catch(() => null),
    ipcRenderer.invoke("nexa:get-config").catch(() => null),
    ipcRenderer.invoke("get-realtime-assistant-status").catch(() => false),
    ipcRenderer.invoke("get-helper-tools-enabled").catch(() => false),
    ipcRenderer.invoke("get-workspace-access-enabled").catch(() => false),
    ipcRenderer.invoke("get-language").catch(() => "pt-br"),
    ipcRenderer.invoke("get-ai-model").catch(() => "geminiCli"),
    ipcRenderer.invoke("get-app-version").catch(() => ""),
    ipcRenderer.invoke("get-open-ia-token").catch(() => ""),
    ipcRenderer.invoke("get-backend-api-key").catch(() => ""),
    ipcRenderer.invoke("get-openai-model").catch(() => ""),
    ipcRenderer.invoke("get-openai-reasoning-effort").catch(() => ""),
    ipcRenderer.invoke("get-openai-vision-model").catch(() => ""),
    ipcRenderer.invoke("get-ollama-local-model").catch(() => null),
    ipcRenderer.invoke("get-claude-cli-model").catch(() => null),
    ipcRenderer.invoke("get-gemini-cli-model").catch(() => null),
    ipcRenderer.invoke("get-copilot-cli-model").catch(() => null),
    ipcRenderer.invoke("get-edition").catch(() => "full")
  ]);

  if (instructionTextarea) instructionTextarea.value = instruction || "";
  if (debugModeToggle) { debugModeToggle.checked = !!isDebugging; window.ConfigToggles.updateDebugModeStatus(!!isDebugging); }
  if (printModeToggle) { printModeToggle.checked = !!isPrintMode; window.ConfigToggles.updatePrintModeStatus(!!isPrintMode); }
  if (osIntegrationToggle) { osIntegrationToggle.checked = !!isOsIntegration; window.ConfigToggles.updateOsIntegrationStatus(!!isOsIntegration); }
  if (stealthModeToggle) { stealthModeToggle.checked = !!isStealth; window.ConfigToggles.updateStealthModeStatus(!!isStealth); }
  
  if (googleTtsToggle && ttsCfg) {
    googleTtsToggle.checked = !!ttsCfg.enabled;
    window.ConfigToggles.updateGoogleTtsStatus(!!ttsCfg.enabled);
    if (googleTtsKey) googleTtsKey.value = ttsCfg.keyPathOrKey || "";
    if (googleTtsVoiceSelect) googleTtsVoiceSelect.value = ttsCfg.voiceName || "pt-BR-Neural2-C";
  }

  if (nexaToggle && nexaCfg) {
    nexaToggle.checked = !!nexaCfg.enabled;
    window.ConfigToggles.updateNexaStatus(!!nexaCfg.enabled);
  }

  if (realtimeAssistantToggle) {
    realtimeAssistantToggle.checked = !!isRealtimeAssistant;
    window.ConfigToggles.updateRealtimeAssistantStatus(!!isRealtimeAssistant);
    if (isRealtimeAssistant) window.ConfigToggles.applyRealtimeAssistantExclusivity();
  }

  if (helperToolsToggle) {
    helperToolsToggle.checked = !!helperToolsEnabled;
    window.ConfigToggles.updateHelperToolsStatus(!!helperToolsEnabled);
    if (helperToolsEnabled) window.ConfigToggles.applyHelperToolsExclusivity();
  }

  if (workspaceAccessToggle) {
    workspaceAccessToggle.checked = !!wsEnabled;
    window.ConfigToggles.updateWorkspaceAccessStatus(!!wsEnabled);
  }

  if (savedLang && langSelect) langSelect.value = savedLang;
  if (savedAiModel && aiModelSelect) aiModelSelect.value = savedAiModel;
  window.ConfigToggles.applyWorkspaceAccessVisibility(aiModelSelect ? aiModelSelect.value : 'geminiCli');

  const _disableHelperToolsInit = (aiModelSelect.value === 'geminiCli' || aiModelSelect.value === 'claudeCli');
  if (_disableHelperToolsInit && helperToolsToggle) {
    helperToolsToggle.disabled = true;
    helperToolsToggle.checked = false;
    window.ConfigToggles.updateHelperToolsStatus(false);
    const si = helperToolsToggle.closest && helperToolsToggle.closest('.setting-item');
    if (si) si.style.opacity = '0.4';
  }
  const _isOllamaInit = (aiModelSelect.value === 'llama' || aiModelSelect.value === 'ollamaLocal');
  const backendApiKeyContainerInit = document.getElementById('backend-api-key-container');
  if (backendApiKeyContainerInit) backendApiKeyContainerInit.style.display = _isOllamaInit ? 'flex' : 'none';

  if (appVersionValue) appVersionValue.textContent = version || "";
  if (openIaTokenInput && savedToken) openIaTokenInput.value = savedToken;
  const backendApiKeyInput = document.getElementById("backend-api-key");
  if (backendApiKeyInput && savedBackendApiKey) backendApiKeyInput.value = savedBackendApiKey;

  if (savedEffort && openAiReasoningEffortSelect) openAiReasoningEffortSelect.value = savedEffort;

  const currentProvider = aiModelSelect ? aiModelSelect.value : 'geminiCli';
  const isChatGPT = (currentProvider === 'openIa' || currentProvider === 'openIaCodex');

  if (visionGuideSection) {
    visionGuideSection.style.display = isChatGPT ? 'block' : 'none';
  }
  const vgToggle = document.getElementById('vision-guide-enabled');
  if (!isChatGPT && vgToggle && vgToggle.checked) {
    vgToggle.checked = false;
    if (window.ConfigVisionTranslation) window.ConfigVisionTranslation.updateVisionGuideEnabledStatus(false);
    ipcRenderer.send('set-vision-guide-config', { enabled: false });
  }

  if (isChatGPT) {
    if (openIaTokenContainer) openIaTokenContainer.style.display = 'flex';
    if (openAiModelContainer) openAiModelContainer.style.display = 'flex';
    if (openAiReasoningEffortContainer) openAiReasoningEffortContainer.style.display = 'flex';
    if (openAiVisionModelContainer) openAiVisionModelContainer.style.display = 'flex';
    window.ConfigProviders.populateOpenAiModels(savedOpenAiModel);
    if (savedVisionModel) window.ConfigProviders.populateOpenAiVisionModels(savedVisionModel);
  } else if (currentProvider === 'ollamaLocal') {
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = 'flex';
    window.ConfigProviders.populateOllamaLocalModels(savedOllamaModel);
    window.ConfigToggles.applyOllamaLocalExclusivity();
  } else if (currentProvider === 'geminiCli') {
    if (geminiCliModelContainer) geminiCliModelContainer.style.display = 'flex';
    window.ConfigProviders.populateGeminiCliModels(savedGeminiCliModel);
  } else if (currentProvider === 'claudeCli') {
    if (claudeCliModelContainer) claudeCliModelContainer.style.display = 'flex';
    window.ConfigProviders.populateClaudeCliModels(savedClaudeCliModel);
  } else if (currentProvider === 'copilotCli') {
    if (copilotCliModelContainer) copilotCliModelContainer.style.display = 'flex';
    window.ConfigProviders.populateCopilotCliModels(savedCopilotCliModel);
  } else if (currentProvider === 'llama' || currentProvider === 'llama-stream') {
    const backendModelContainerEl = document.getElementById('backend-model-container');
    if (backendModelContainerEl) backendModelContainerEl.style.display = 'flex';
    ipcRenderer.invoke("get-backend-model").then(saved => window.ConfigProviders.populateBackendModels(saved)).catch(() => {});
  }

  (async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1800);
      const response = await fetch(
        "https://abra-api.top/notifications/retrieve?key=ngrockurl",
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        const lastNotification = data[data.length - 1];
        if (lastNotification && lastNotification.content && backendUrlValue) {
          backendUrlValue.textContent = lastNotification.content;
          backendUrlValue.style.color = "#00ff00";
        }
      }
    } catch (_) {}
  })();

  if (_edition === 'lite') window.ConfigToggles.applyLiteUi();
  window.ConfigToggles.applyBackendUrlVisibility();
});

if (aiModelSelect) {
  aiModelSelect.addEventListener('change', () => {
    const v = aiModelSelect.value;
    ipcRenderer.send("set-ai-model", v);
    const isChatGPT = (v === 'openIa' || v === 'openIaCodex');
    if (visionGuideSection) {
      visionGuideSection.style.display = isChatGPT ? 'block' : 'none';
      const vgToggle = document.getElementById('vision-guide-enabled');
      if (!isChatGPT && vgToggle && vgToggle.checked) {
        vgToggle.checked = false;
        if (window.ConfigVisionTranslation) window.ConfigVisionTranslation.updateVisionGuideEnabledStatus(false);
        ipcRenderer.send('set-vision-guide-config', { enabled: false });
      }
    }
    const isOllama = (v === 'llama' || v === 'llama-stream' || v === 'ollamaLocal');
    let disableHelperTools = (v === 'geminiCli' || v === 'claudeCli' || v === 'copilotCli');
    const isRemoteBackend = (v === 'llama' || v === 'llama-stream');
    const backendModelSelect = document.getElementById("backend-model-select");
    if (isRemoteBackend) {
       let modelName = backendModelSelect ? backendModelSelect.value : '';
       let allowTools = false;
       if (modelName) {
           const sizeMatch = modelName.match(/(\d+(?:\.\d+)?)b/i);
           if (sizeMatch && parseFloat(sizeMatch[1]) > 10) allowTools = true;
       }
       disableHelperTools = disableHelperTools || !allowTools;
    }
    const showOpenAi = (v === 'openIa' || v === 'openIaCodex');
    if (openIaTokenContainer) openIaTokenContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (openAiModelContainer) openAiModelContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (openAiReasoningEffortContainer) openAiReasoningEffortContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (openAiVisionModelContainer) openAiVisionModelContainer.style.display = showOpenAi ? 'flex' : 'none';
    if (ollamaLocalModelContainer) ollamaLocalModelContainer.style.display = (v === 'ollamaLocal') ? 'flex' : 'none';
    if (geminiCliModelContainer) geminiCliModelContainer.style.display = (v === 'geminiCli') ? 'flex' : 'none';
    if (claudeCliModelContainer) claudeCliModelContainer.style.display = (v === 'claudeCli') ? 'flex' : 'none';
    if (copilotCliModelContainer) copilotCliModelContainer.style.display = (v === 'copilotCli') ? 'flex' : 'none';
    const backendApiKeyContainer = document.getElementById('backend-api-key-container');
    if (backendApiKeyContainer) backendApiKeyContainer.style.display = isOllama ? 'flex' : 'none';
    const backendModelContainerEl = document.getElementById('backend-model-container');
    if (backendModelContainerEl) backendModelContainerEl.style.display = isRemoteBackend ? 'flex' : 'none';
    if (helperToolsToggle) {
      helperToolsToggle.disabled = disableHelperTools;
      helperToolsToggle.closest && helperToolsToggle.closest('.setting-item') &&
        (helperToolsToggle.closest('.setting-item').style.opacity = disableHelperTools ? '0.4' : '');
      if (disableHelperTools && helperToolsToggle.checked) {
        helperToolsToggle.checked = false;
        window.ConfigToggles.updateHelperToolsStatus(false);
      }
    }
    window.ConfigToggles.applyWorkspaceAccessVisibility(v);
    if (v === 'ollamaLocal') {
      window.ConfigProviders.populateOllamaLocalModels();
      window.ConfigToggles.applyOllamaLocalExclusivity();
    } else {
      window.ConfigToggles.releaseOllamaLocalExclusivity();
      if (v === 'geminiCli') {
        window.ConfigProviders.populateGeminiCliModels(null, true);
      } else if (v === 'claudeCli') {
        window.ConfigProviders.populateClaudeCliModels();
      } else if (v === 'copilotCli') {
        window.ConfigProviders.populateCopilotCliModels();
      } else if (v === 'openIa' || v === 'openIaCodex') {
        window.ConfigProviders.populateOpenAiModels();
      } else if (v === 'llama' || v === 'llama-stream') {
        ipcRenderer.invoke("get-backend-model").then(saved => {
          window.ConfigProviders.populateBackendModels(saved);
        }).catch(() => {
          window.ConfigProviders.populateBackendModels();
        });
      }
    }
    window.ConfigToggles.applyBackendUrlVisibility();
  });
}

if (debugModeToggle) {
  debugModeToggle.addEventListener("change", () => {
    window.ConfigToggles.updateDebugModeStatus(debugModeToggle.checked);
    window.ConfigToggles.applyBackendUrlVisibility();
  });
}
if (printModeToggle) {
  printModeToggle.addEventListener("change", () => {
    window.ConfigToggles.updatePrintModeStatus(printModeToggle.checked);
  });
}
if (osIntegrationToggle) {
  osIntegrationToggle.addEventListener("change", () => {
    window.ConfigToggles.updateOsIntegrationStatus(osIntegrationToggle.checked);
  });
}
if (stealthModeToggle) {
  stealthModeToggle.addEventListener("change", () => {
    window.ConfigToggles.updateStealthModeStatus(stealthModeToggle.checked);
    ipcRenderer.send("save-stealth-mode-status", stealthModeToggle.checked);
  });
}
if (nexaToggle) {
  nexaToggle.addEventListener("change", () => {
    const enabled = nexaToggle.checked;
    window.ConfigToggles.updateNexaStatus(enabled);
    if (enabled && googleTtsContainer) {
      googleTtsContainer.style.display = "block";
    }
    const toast = document.getElementById("nexa-error-toast");
    if (toast) toast.style.display = "none";
  });
}
if (googleTtsToggle) {
  googleTtsToggle.addEventListener("change", async () => {
    const enabled = googleTtsToggle.checked;
    window.ConfigToggles.updateGoogleTtsStatus(enabled);
    const keyPathOrKey = googleTtsKey ? googleTtsKey.value.trim() : "";
    const voiceName = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C";
    ipcRenderer.send("save-google-tts-config", { enabled, keyPathOrKey, voiceName });
  });
}

saveButton.addEventListener("click", async () => {
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
    return;
  }

  if (nexaToggle) {
    ipcRenderer.send("nexa:save-config", { enabled: isNexaOn, onlyNexa: false });
  }
  if (googleTtsToggle) {
    ipcRenderer.send("save-google-tts-config", {
      enabled: isNexaOn ? true : googleTtsToggle.checked,
      keyPathOrKey: ttsKey,
      voiceName: isNexaOn ? "pt-BR-Neural2-C" : (googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C")
    });
  }

  ipcRenderer.send("save-prompt-instruction", instructionTextarea.value);
  ipcRenderer.send("save-debug-mode-status", debugModeToggle.checked);
  ipcRenderer.send("save-print-mode-status", printModeToggle.checked);
  ipcRenderer.send("save-os-integration-status", osIntegrationToggle.checked);
  ipcRenderer.send("save-realtime-assistant-status", realtimeAssistantToggle.checked);

  if (helperToolsToggle) ipcRenderer.send("set-helper-tools-enabled", helperToolsToggle.checked);
  if (workspaceAccessToggle) ipcRenderer.send("set-workspace-access-enabled", workspaceAccessToggle.checked);
  if (stealthModeToggle) ipcRenderer.send("save-stealth-mode-status", stealthModeToggle.checked);

  ipcRenderer.send("set-language", langSelect.value);
  ipcRenderer.send("set-ai-model", aiModelSelect.value);
  ipcRenderer.send("set-openai-model", openAiModelSelect.value);

  if (openAiReasoningEffortSelect) ipcRenderer.send("set-openai-reasoning-effort", openAiReasoningEffortSelect.value);
  if (openAiVisionModelSelect) ipcRenderer.send("set-openai-vision-model", openAiVisionModelSelect.value);

  const _tokenVal = (openIaTokenInput.value || "").trim();
  if (_tokenVal) ipcRenderer.send("set-open-ia-token", _tokenVal);

  const backendApiKeyInput = document.getElementById("backend-api-key");
  if (backendApiKeyInput) ipcRenderer.send("save-backend-api-key", backendApiKeyInput.value);

  window.close();
});

document.getElementById("clear-openai-token")?.addEventListener("click", () => {
  openIaTokenInput.value = "";
  ipcRenderer.send("set-open-ia-token", "");
});

const openPreferencesBtn = document.getElementById('open-preferences-btn');
if (openPreferencesBtn) {
  openPreferencesBtn.addEventListener('click', () => ipcRenderer.send('open-preferences-ui'));
}

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
