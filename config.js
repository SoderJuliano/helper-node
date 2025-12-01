const { ipcRenderer } = require('electron');

const instructionTextarea = document.getElementById('prompt-instruction');
const saveButton = document.getElementById('save-btn');

// Ao carregar a janela, pede a configuração atual para o processo principal
document.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.invoke('get-prompt-instruction').then((instruction) => {
    instructionTextarea.value = instruction;
  });
});

// Ao clicar em salvar, envia a nova instrução para o processo principal
saveButton.addEventListener('click', () => {
  const newInstruction = instructionTextarea.value;
  ipcRenderer.send('save-prompt-instruction', newInstruction);
  
  // Opcional: Fechar a janela após salvar
  window.close();
});
