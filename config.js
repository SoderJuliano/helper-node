const { ipcRenderer } = require("electron");

const instructionTextarea = document.getElementById("prompt-instruction");
const saveButton = document.getElementById("save-btn");
const debugModeToggle = document.getElementById("debug-mode-toggle");
const debugModeStatus = document.getElementById("debug-mode-status");
const langSelect = document.getElementById("language-select");

// Helper function to update the debug mode status text
function updateDebugModeStatus(isDebugging) {
  debugModeStatus.textContent = isDebugging ? "ON" : "OFF";
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
  // Load saved language
  // -------------------------
  const savedLang = await ipcRenderer.invoke("get-language");
  if (savedLang) langSelect.value = savedLang;
});

// Handle debug toggle live update
debugModeToggle.addEventListener("change", () => {
  updateDebugModeStatus(debugModeToggle.checked);
});

// Save everything
saveButton.addEventListener("click", async () => {
  // Save prompt instruction
  ipcRenderer.send("save-prompt-instruction", instructionTextarea.value);

  // Save debug mode
  ipcRenderer.send("save-debug-mode-status", debugModeToggle.checked);

  // Save language
  ipcRenderer.send("set-language", langSelect.value);

  // Close window
  window.close();
});
