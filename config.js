const { ipcRenderer } = require("electron");

const instructionTextarea = document.getElementById("prompt-instruction");
const saveButton = document.getElementById("save-btn");
const debugModeToggle = document.getElementById("debug-mode-toggle");
const debugModeStatus = document.getElementById("debug-mode-status");
const printModeToggle = document.getElementById("print-mode-toggle");
const printModeStatus = document.getElementById("print-mode-status");
const osIntegrationToggle = document.getElementById("os-integration-toggle");
const osIntegrationStatus = document.getElementById("os-integration-status");
const langSelect = document.getElementById("language-select");
const backendUrlValue = document.getElementById("backend-url-value");
const aiModelSelect = document.getElementById("ai-model");
const openIaTokenContainer = document.getElementById("openai-token-container");
const openIaTokenInput = document.getElementById("openai-token");

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
  
  // Always load OpenAI token, regardless of current model
  const savedToken = await ipcRenderer.invoke("get-open-ia-token");
  if (savedToken) {
      openIaTokenInput.value = savedToken;
  }
  
  // Show/hide OpenAI token input based on saved model
  if (aiModelSelect.value === 'openIa') {
    openIaTokenContainer.style.display = 'flex';
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
  updateDebugModeStatus(debugModeToggle.checked);
});

// Handle print mode toggle live update
printModeToggle.addEventListener("change", () => {
  updatePrintModeStatus(printModeToggle.checked);
});

// Handle OS integration toggle live update
osIntegrationToggle.addEventListener("change", () => {
  updateOsIntegrationStatus(osIntegrationToggle.checked);
});

// Show/hide OpenAI token input based on AI model selection
aiModelSelect.addEventListener('change', () => {
    if (aiModelSelect.value === 'openIa') {
        openIaTokenContainer.style.display = 'flex';
    } else {
        openIaTokenContainer.style.display = 'none';
    }
});

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

  // Save language
  ipcRenderer.send("set-language", langSelect.value);

  // Save AI model
  ipcRenderer.send("set-ai-model", aiModelSelect.value);
  
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