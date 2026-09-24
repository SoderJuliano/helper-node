// apiConfig.js
// Controlador para a janela de Configurações de APIs e Tokens
const { ipcRenderer } = require("electron");

document.getElementById('win-maximize-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-toggle-maximize');
});

document.getElementById('win-close-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-close');
});

const aiModelSelect = document.getElementById("ai-model");
const googleApiKeyInput = document.getElementById("google-api-key");
const zaiApiKeyInput = document.getElementById("zai-api-key");
const zaiModelSelect = document.getElementById("zai-model-select");

const openIaTokenInput = document.getElementById("openai-token");
const openAiModelSelect = document.getElementById("openai-model-select");
const openAiReasoningEffortSelect = document.getElementById("openai-reasoning-effort-select");
const openAiVisionModelSelect = document.getElementById("openai-vision-model-select");

const backendApiKeyInput = document.getElementById("backend-api-key");
const backendModelSelect = document.getElementById("backend-model-select");
const ollamaLocalModelSelect = document.getElementById("ollama-local-model-select");
const geminiCliModelSelect = document.getElementById("gemini-cli-model-select");
const claudeCliModelSelect = document.getElementById("claude-cli-model-select");
const copilotCliModelSelect = document.getElementById("copilot-cli-model-select");
const copilotCliReasoningEffortSelect = document.getElementById("copilot-cli-reasoning-effort-select");

const saveButton = document.getElementById("save-btn");

document.addEventListener("DOMContentLoaded", async () => {
  const [
    savedAiModel,
    savedGoogleKey,
    savedZaiKey,
    savedZaiModel,
    savedOpenAiToken,
    savedOpenAiModel,
    savedEffort,
    savedVisionModel,
    savedBackendApiKey,
    savedBackendModel,
    savedOllamaModel,
    savedGeminiCliModel,
    savedClaudeCliModel,
    savedCopilotCliModel,
    savedCopilotEffort,
  ] = await Promise.all([
    ipcRenderer.invoke("get-ai-model").catch(() => "geminiCli"),
    ipcRenderer.invoke("get-google-api-key").catch(() => ""),
    ipcRenderer.invoke("get-zai-api-key").catch(() => "b210cf3d04bf4c73916d4878692b7b46.NrhCaCvIMge8oDRF"),
    ipcRenderer.invoke("get-zai-model").catch(() => "glm-4.6"),
    ipcRenderer.invoke("get-open-ia-token").catch(() => ""),
    ipcRenderer.invoke("get-openai-model").catch(() => "gpt-4.1-nano"),
    ipcRenderer.invoke("get-openai-reasoning-effort").catch(() => "low"),
    ipcRenderer.invoke("get-openai-vision-model").catch(() => "gpt-4o"),
    ipcRenderer.invoke("get-backend-api-key").catch(() => ""),
    ipcRenderer.invoke("get-backend-model").catch(() => ""),
    ipcRenderer.invoke("get-ollama-local-model").catch(() => null),
    ipcRenderer.invoke("get-gemini-cli-model").catch(() => null),
    ipcRenderer.invoke("get-claude-cli-model").catch(() => null),
    ipcRenderer.invoke("get-copilot-cli-model").catch(() => null),
    ipcRenderer.invoke("get-copilot-cli-reasoning-effort").catch(() => "medium"),
  ]);

  if (aiModelSelect && savedAiModel) aiModelSelect.value = savedAiModel;
  if (googleApiKeyInput) googleApiKeyInput.value = savedGoogleKey || "";
  if (zaiApiKeyInput) zaiApiKeyInput.value = savedZaiKey || "b210cf3d04bf4c73916d4878692b7b46.NrhCaCvIMge8oDRF";
  if (zaiModelSelect && savedZaiModel) zaiModelSelect.value = savedZaiModel;

  if (openIaTokenInput) openIaTokenInput.value = savedOpenAiToken || "";
  if (openAiReasoningEffortSelect && savedEffort) openAiReasoningEffortSelect.value = savedEffort;
  if (backendApiKeyInput) backendApiKeyInput.value = savedBackendApiKey || "";
  if (copilotCliReasoningEffortSelect && savedCopilotEffort) copilotCliReasoningEffortSelect.value = savedCopilotEffort;

  if (window.ConfigProviders) {
    window.ConfigProviders.populateOpenAiModels(savedOpenAiModel);
    if (savedVisionModel) window.ConfigProviders.populateOpenAiVisionModels(savedVisionModel);
    window.ConfigProviders.populateBackendModels(savedBackendModel);
    window.ConfigProviders.populateOllamaLocalModels(savedOllamaModel);
    window.ConfigProviders.populateGeminiCliModels(savedGeminiCliModel);
    window.ConfigProviders.populateClaudeCliModels(savedClaudeCliModel);
    window.ConfigProviders.populateCopilotCliModels(savedCopilotCliModel);
    if (window.ConfigProviders.refreshCopilotAuthStatus) window.ConfigProviders.refreshCopilotAuthStatus();
  }
});

// Clear buttons
document.getElementById("clear-google-api-key")?.addEventListener("click", () => {
  if (googleApiKeyInput) googleApiKeyInput.value = "";
  ipcRenderer.send("set-google-api-key", "");
});

document.getElementById("clear-zai-api-key")?.addEventListener("click", () => {
  if (zaiApiKeyInput) zaiApiKeyInput.value = "";
  ipcRenderer.send("set-zai-api-key", "");
});

document.getElementById("clear-openai-token")?.addEventListener("click", () => {
  if (openIaTokenInput) openIaTokenInput.value = "";
  ipcRenderer.send("set-open-ia-token", "");
});

document.getElementById("clear-backend-api-key")?.addEventListener("click", () => {
  if (backendApiKeyInput) backendApiKeyInput.value = "";
  ipcRenderer.send("save-backend-api-key", "");
});

// Select changes
if (aiModelSelect) {
  aiModelSelect.addEventListener("change", () => {
    ipcRenderer.send("set-ai-model", aiModelSelect.value);
  });
}
if (zaiModelSelect) {
  zaiModelSelect.addEventListener("change", () => {
    ipcRenderer.send("set-zai-model", zaiModelSelect.value);
  });
}
if (copilotCliModelSelect) {
  copilotCliModelSelect.addEventListener("change", () => {
    if (copilotCliModelSelect.value) ipcRenderer.send("set-copilot-cli-model", copilotCliModelSelect.value);
  });
}
if (copilotCliReasoningEffortSelect) {
  copilotCliReasoningEffortSelect.addEventListener("change", () => {
    if (copilotCliReasoningEffortSelect.value) ipcRenderer.send("set-copilot-cli-reasoning-effort", copilotCliReasoningEffortSelect.value);
  });
}
if (claudeCliModelSelect) {
  claudeCliModelSelect.addEventListener("change", () => {
    if (claudeCliModelSelect.value) ipcRenderer.send("set-claude-cli-model", claudeCliModelSelect.value);
  });
}
if (geminiCliModelSelect) {
  geminiCliModelSelect.addEventListener("change", () => {
    if (geminiCliModelSelect.value) ipcRenderer.send("set-gemini-cli-model", geminiCliModelSelect.value);
  });
}
if (ollamaLocalModelSelect) {
  ollamaLocalModelSelect.addEventListener("change", () => {
    if (ollamaLocalModelSelect.value) ipcRenderer.send("set-ollama-local-model", ollamaLocalModelSelect.value);
  });
}

// Salvar
if (saveButton) {
  saveButton.addEventListener("click", async () => {
    if (aiModelSelect) ipcRenderer.send("set-ai-model", aiModelSelect.value);

    const _googleKeyVal = (googleApiKeyInput ? googleApiKeyInput.value : "").trim();
    ipcRenderer.send("set-google-api-key", _googleKeyVal);

    const _zaiKeyVal = (zaiApiKeyInput ? zaiApiKeyInput.value : "").trim();
    ipcRenderer.send("set-zai-api-key", _zaiKeyVal);

    if (zaiModelSelect) ipcRenderer.send("set-zai-model", zaiModelSelect.value);

    const _tokenVal = (openIaTokenInput ? openIaTokenInput.value : "").trim();
    ipcRenderer.send("set-open-ia-token", _tokenVal);

    if (openAiModelSelect) ipcRenderer.send("set-openai-model", openAiModelSelect.value);
    if (openAiReasoningEffortSelect) ipcRenderer.send("set-openai-reasoning-effort", openAiReasoningEffortSelect.value);
    if (openAiVisionModelSelect) ipcRenderer.send("set-openai-vision-model", openAiVisionModelSelect.value);

    if (backendApiKeyInput) ipcRenderer.send("save-backend-api-key", backendApiKeyInput.value);
    if (backendModelSelect) ipcRenderer.send("set-backend-model", backendModelSelect.value);

    if (copilotCliModelSelect && copilotCliModelSelect.value) ipcRenderer.send("set-copilot-cli-model", copilotCliModelSelect.value);
    if (copilotCliReasoningEffortSelect) ipcRenderer.send("set-copilot-cli-reasoning-effort", copilotCliReasoningEffortSelect.value);
    if (claudeCliModelSelect && claudeCliModelSelect.value) ipcRenderer.send("set-claude-cli-model", claudeCliModelSelect.value);
    if (geminiCliModelSelect && geminiCliModelSelect.value) ipcRenderer.send("set-gemini-cli-model", geminiCliModelSelect.value);
    if (ollamaLocalModelSelect && ollamaLocalModelSelect.value) ipcRenderer.send("set-ollama-local-model", ollamaLocalModelSelect.value);

    window.close();
  });
}
