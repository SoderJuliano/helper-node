// renderer/config/configToggles.js
// Toggle state updaters and exclusivity rules for Settings window.
(function() {
  'use strict';

  function updateNexaStatus(isEnabled) {
    const nexaStatus = document.getElementById("nexa-status");
    if (nexaStatus) nexaStatus.textContent = isEnabled ? "ON" : "OFF";
    const googleTtsContainer = document.getElementById("google-tts-container");
    if (googleTtsContainer) {
      googleTtsContainer.style.display = isEnabled ? "block" : "none";
    }
    const googleTtsVoiceWrapper = document.getElementById("google-tts-voice-wrapper");
    if (googleTtsVoiceWrapper) {
      googleTtsVoiceWrapper.style.display = isEnabled ? "block" : "none";
    }
    const googleTtsToggleItem = document.getElementById("google-tts-toggle-item");
    if (googleTtsToggleItem) {
      googleTtsToggleItem.style.display = "none";
    }
  }

  function updateGoogleTtsStatus(isEnabled) {
    const nexaToggle = document.getElementById("nexa-toggle");
    const isNexa = nexaToggle ? nexaToggle.checked : false;
    const googleTtsContainer = document.getElementById("google-tts-container");
    const googleTtsVoiceWrapper = document.getElementById("google-tts-voice-wrapper");
    const googleTtsToggleItem = document.getElementById("google-tts-toggle-item");

    if (googleTtsToggleItem) {
      googleTtsToggleItem.style.display = "none";
    }
    if (googleTtsContainer) {
      googleTtsContainer.style.display = isNexa ? "block" : "none";
    }
    if (googleTtsVoiceWrapper) {
      googleTtsVoiceWrapper.style.display = isNexa ? "block" : "none";
    }
  }

  function updateDebugModeStatus(isDebugging) {
    const debugModeStatus = document.getElementById("debug-mode-status");
    if (debugModeStatus) debugModeStatus.textContent = isDebugging ? "ON" : "OFF";
  }

  function updatePrintModeStatus(isPrinting) {
    const printModeStatus = document.getElementById("print-mode-status");
    if (printModeStatus) printModeStatus.textContent = isPrinting ? "ON" : "OFF";
  }

  function updateOsIntegrationStatus(isOsIntegration) {
    const osIntegrationStatus = document.getElementById("os-integration-status");
    if (osIntegrationStatus) osIntegrationStatus.textContent = isOsIntegration ? "ON" : "OFF";
  }

  function updateStealthModeStatus(isStealth) {
    const stealthModeStatus = document.getElementById("stealth-mode-status");
    if (stealthModeStatus) stealthModeStatus.textContent = isStealth ? "ON" : "OFF";
  }

  function updateRealtimeAssistantStatus(isEnabled) {
    const realtimeAssistantStatus = document.getElementById("realtime-assistant-status");
    if (realtimeAssistantStatus) realtimeAssistantStatus.textContent = isEnabled ? "ON" : "OFF";
  }

  function updateHelperToolsStatus(isEnabled) {
    const helperToolsStatus = document.getElementById("helper-tools-status");
    if (helperToolsStatus) helperToolsStatus.textContent = isEnabled ? "ON" : "OFF";
  }

  function updateWorkspaceAccessStatus(isEnabled) {
    const workspaceAccessStatus = document.getElementById("workspace-access-status");
    if (workspaceAccessStatus) workspaceAccessStatus.textContent = isEnabled ? "ON" : "OFF";
  }

  function applyWorkspaceAccessVisibility(provider) {
    const isCli = (provider === 'geminiCli' || provider === 'claudeCli' || provider === 'copilotCli');
    const workspaceAccessItem = document.getElementById("workspace-access-item");
    if (workspaceAccessItem) {
      workspaceAccessItem.style.display = isCli ? 'none' : 'flex';
    }
  }

  function applyBackendUrlVisibility() {
    const el = document.getElementById('backend-url');
    if (!el) return;
    const aiModelSelect = document.getElementById('ai-model');
    const provider = aiModelSelect ? aiModelSelect.value : '';
    const isRemote = (provider === 'llama' || provider === 'llama-stream');
    el.style.display = isRemote ? 'block' : 'none';
  }

  function applyHelperToolsExclusivity() {
    const helperToolsToggle = document.getElementById("helper-tools-toggle");
    const realtimeAssistantToggle = document.getElementById("realtime-assistant-toggle");
    if (helperToolsToggle && helperToolsToggle.checked && realtimeAssistantToggle) {
      realtimeAssistantToggle.checked = false;
      updateRealtimeAssistantStatus(false);
    }
  }

  function applyRealtimeAssistantExclusivity() {
    const realtimeAssistantToggle = document.getElementById("realtime-assistant-toggle");
    if (!realtimeAssistantToggle || !realtimeAssistantToggle.checked) return;
    const _ta = document.getElementById('translation-enabled');
    if (_ta && _ta.checked) {
      _ta.checked = false;
      if (typeof updateTranslationEnabledStatus === 'function') updateTranslationEnabledStatus(false);
      const { ipcRenderer } = require("electron");
      ipcRenderer.send('set-translation-assistant-config', { enabled: false });
    }
  }

  function applyOllamaLocalExclusivity() {}
  function releaseOllamaLocalExclusivity() {}

  function applyLiteUi() {
    document.querySelectorAll('.full-only').forEach(el => el.style.display = 'none');
    document.querySelectorAll('.full-only-inline').forEach(el => el.style.display = 'none');
  }

  function checkBackendToolsAvailability() {
    const aiModelSelect = document.getElementById('ai-model');
    const backendModelSelect = document.getElementById('backend-model-select');
    const helperToolsToggle = document.getElementById('helper-tools-toggle');
    if (!aiModelSelect || !helperToolsToggle) return;
    const v = aiModelSelect.value;
    if (v === 'llama' || v === 'llama-stream') {
      let modelName = backendModelSelect ? backendModelSelect.value : '';
      let allowTools = false;
      if (modelName) {
        const sizeMatch = modelName.match(/(\d+(?:\.\d+)?)b/i);
        if (sizeMatch && parseFloat(sizeMatch[1]) > 10) allowTools = true;
      }
      const disableHelperTools = !allowTools;
      helperToolsToggle.disabled = disableHelperTools;
      const si = helperToolsToggle.closest && helperToolsToggle.closest('.setting-item');
      if (si) si.style.opacity = disableHelperTools ? '0.4' : '';
      if (disableHelperTools && helperToolsToggle.checked) {
        helperToolsToggle.checked = false;
        updateHelperToolsStatus(false);
      }
    }
  }

  function disableNexaIfActive() {
    const nexaToggle = document.getElementById("nexa-toggle");
    if (nexaToggle && nexaToggle.checked) {
      nexaToggle.checked = false;
      updateNexaStatus(false);
      try {
        const { ipcRenderer } = require("electron");
        ipcRenderer.send("nexa:save-config", { enabled: false, onlyNexa: false });
      } catch (_) {}
    }
  }

  window.ConfigToggles = {
    updateNexaStatus,
    updateGoogleTtsStatus,
    updateDebugModeStatus,
    updatePrintModeStatus,
    updateOsIntegrationStatus,
    updateStealthModeStatus,
    updateRealtimeAssistantStatus,
    updateHelperToolsStatus,
    updateWorkspaceAccessStatus,
    applyWorkspaceAccessVisibility,
    applyBackendUrlVisibility,
    applyHelperToolsExclusivity,
    applyRealtimeAssistantExclusivity,
    applyOllamaLocalExclusivity,
    releaseOllamaLocalExclusivity,
    applyLiteUi,
    checkBackendToolsAvailability,
    disableNexaIfActive,
  };
})();
