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
const nexaToggle = document.getElementById("nexa-toggle");

document.addEventListener("DOMContentLoaded", async () => {
  const [
    instruction,
    isDebugging,
    isPrintMode,
    isOsIntegration,
    isStealth,
    nexaCfg,
    isRealtimeAssistant,
    helperToolsEnabled,
    wsEnabled,
    savedLang,
    version,
    _edition
  ] = await Promise.all([
    ipcRenderer.invoke("get-prompt-instruction").catch(() => ""),
    ipcRenderer.invoke("get-debug-mode-status").catch(() => false),
    ipcRenderer.invoke("get-print-mode-status").catch(() => false),
    ipcRenderer.invoke("get-os-integration-status").catch(() => false),
    ipcRenderer.invoke("get-stealth-mode-status").catch(() => false),
    ipcRenderer.invoke("nexa:get-config").catch(() => null),
    ipcRenderer.invoke("get-realtime-assistant-status").catch(() => false),
    ipcRenderer.invoke("get-helper-tools-enabled").catch(() => false),
    ipcRenderer.invoke("get-workspace-access-enabled").catch(() => false),
    ipcRenderer.invoke("get-language").catch(() => "pt-br"),
    ipcRenderer.invoke("get-app-version").catch(() => ""),
    ipcRenderer.invoke("get-edition").catch(() => "full")
  ]);

  if (instructionTextarea) instructionTextarea.value = instruction || "";
  if (debugModeToggle) { debugModeToggle.checked = !!isDebugging; window.ConfigToggles?.updateDebugModeStatus(!!isDebugging); }
  if (printModeToggle) { printModeToggle.checked = !!isPrintMode; window.ConfigToggles?.updatePrintModeStatus(!!isPrintMode); }
  if (osIntegrationToggle) { osIntegrationToggle.checked = !!isOsIntegration; window.ConfigToggles?.updateOsIntegrationStatus(!!isOsIntegration); }
  if (stealthModeToggle) { stealthModeToggle.checked = !!isStealth; window.ConfigToggles?.updateStealthModeStatus(!!isStealth); }
  
  if (nexaToggle && nexaCfg) {
    nexaToggle.checked = !!nexaCfg.enabled;
    window.ConfigToggles?.updateNexaStatus(!!nexaCfg.enabled);
  } else if (window.ConfigToggles?.updateNexaStatus) {
    window.ConfigToggles.updateNexaStatus(false);
  }

  if (realtimeAssistantToggle) {
    realtimeAssistantToggle.checked = !!isRealtimeAssistant;
    window.ConfigToggles?.updateRealtimeAssistantStatus(!!isRealtimeAssistant);
    if (isRealtimeAssistant) window.ConfigToggles?.applyRealtimeAssistantExclusivity();
  }

  if (helperToolsToggle) {
    helperToolsToggle.checked = !!helperToolsEnabled;
    window.ConfigToggles?.updateHelperToolsStatus(!!helperToolsEnabled);
    if (helperToolsEnabled) window.ConfigToggles?.applyHelperToolsExclusivity();
  }

  if (workspaceAccessToggle) {
    workspaceAccessToggle.checked = !!wsEnabled;
    window.ConfigToggles?.updateWorkspaceAccessStatus(!!wsEnabled);
  }

  if (savedLang && langSelect) langSelect.value = savedLang;
  if (appVersionValue) appVersionValue.textContent = version || "";

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

  if (_edition === 'lite') window.ConfigToggles?.applyLiteUi();
  window.ConfigToggles?.applyBackendUrlVisibility();
});

if (debugModeToggle) {
  debugModeToggle.addEventListener("change", () => {
    window.ConfigToggles?.updateDebugModeStatus(debugModeToggle.checked);
    window.ConfigToggles?.applyBackendUrlVisibility();
  });
}
if (printModeToggle) {
  printModeToggle.addEventListener("change", () => {
    window.ConfigToggles?.updatePrintModeStatus(printModeToggle.checked);
  });
}
if (osIntegrationToggle) {
  osIntegrationToggle.addEventListener("change", () => {
    window.ConfigToggles?.updateOsIntegrationStatus(osIntegrationToggle.checked);
    if (osIntegrationToggle.checked && window.ConfigToggles?.disableNexaIfActive) {
      window.ConfigToggles.disableNexaIfActive();
    }
  });
}
if (realtimeAssistantToggle) {
  realtimeAssistantToggle.addEventListener("change", () => {
    window.ConfigToggles?.updateRealtimeAssistantStatus(realtimeAssistantToggle.checked);
    if (realtimeAssistantToggle.checked) {
      if (window.ConfigToggles?.disableNexaIfActive) {
        window.ConfigToggles.disableNexaIfActive();
      }
      window.ConfigToggles?.applyRealtimeAssistantExclusivity();
    }
  });
}
if (stealthModeToggle) {
  stealthModeToggle.addEventListener("change", () => {
    window.ConfigToggles?.updateStealthModeStatus(stealthModeToggle.checked);
    ipcRenderer.send("save-stealth-mode-status", stealthModeToggle.checked);
  });
}
if (nexaToggle) {
  nexaToggle.addEventListener("change", () => {
    const enabled = nexaToggle.checked;
    window.ConfigToggles?.updateNexaStatus(enabled);
    const toast = document.getElementById("nexa-error-toast");
    if (toast) toast.style.display = "none";
  });
}

saveButton?.addEventListener("click", async () => {
  if (nexaToggle) {
    const isExclusiveFeatureOn = (osIntegrationToggle && osIntegrationToggle.checked) ||
                                 (realtimeAssistantToggle && realtimeAssistantToggle.checked) ||
                                 (document.getElementById('translation-enabled') && document.getElementById('translation-enabled').checked);
    const isNexaOn = !isExclusiveFeatureOn && nexaToggle.checked;

    if (isExclusiveFeatureOn) {
      nexaToggle.checked = false;
      window.ConfigToggles?.updateNexaStatus(false);
    }
    ipcRenderer.send("nexa:save-config", { enabled: isNexaOn, onlyNexa: false });
  }

  if (instructionTextarea) ipcRenderer.send("save-prompt-instruction", instructionTextarea.value);
  if (debugModeToggle) ipcRenderer.send("save-debug-mode-status", debugModeToggle.checked);
  if (printModeToggle) ipcRenderer.send("save-print-mode-status", printModeToggle.checked);
  if (osIntegrationToggle) ipcRenderer.send("save-os-integration-status", osIntegrationToggle.checked);
  if (realtimeAssistantToggle) ipcRenderer.send("save-realtime-assistant-status", realtimeAssistantToggle.checked);

  if (helperToolsToggle) ipcRenderer.send("set-helper-tools-enabled", helperToolsToggle.checked);
  if (workspaceAccessToggle) ipcRenderer.send("set-workspace-access-enabled", workspaceAccessToggle.checked);
  if (stealthModeToggle) ipcRenderer.send("save-stealth-mode-status", stealthModeToggle.checked);
  if (langSelect) ipcRenderer.send("set-language", langSelect.value);

  window.close();
});

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
