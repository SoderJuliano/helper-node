const { ipcRenderer } = require('electron');

const instructionTextarea = document.getElementById('prompt-instruction');
const saveButton = document.getElementById('save-btn');
const debugModeToggle = document.getElementById('debug-mode-toggle');
const debugModeStatus = document.getElementById('debug-mode-status');

// Helper function to update the debug mode status text
function updateDebugModeStatus(isDebugging) {
  debugModeStatus.textContent = isDebugging ? 'ON' : 'OFF';
}

// Ao carregar a janela, pede a configuração atual para o processo principal
document.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.invoke('get-prompt-instruction').then((instruction) => {
    instructionTextarea.value = instruction;
  });

  // Get initial debug mode status
  ipcRenderer.invoke('get-debug-mode-status').then((isDebugging) => {
    debugModeToggle.checked = isDebugging;
    updateDebugModeStatus(isDebugging);
  });
});

// Ao clicar em salvar, envia a nova instrução e o status do debug mode para o processo principal
saveButton.addEventListener('click', () => {
  const newInstruction = instructionTextarea.value;
  ipcRenderer.send('save-prompt-instruction', newInstruction);
  
  const newDebugModeStatus = debugModeToggle.checked;
  ipcRenderer.send('save-debug-mode-status', newDebugModeStatus);
  
  // Opcional: Fechar a janela após salvar
  window.close();
});

// Listener for debug mode toggle change
debugModeToggle.addEventListener('change', () => {
  updateDebugModeStatus(debugModeToggle.checked);
});
