// renderer/config/configNav.js
// Controlador compartilhado de navegação por abas e botões de janela para todas as telas de configuração.
(function() {
  'use strict';
  const { ipcRenderer } = require("electron");

  // Controles de janela frameless
  document.getElementById('win-maximize-btn')?.addEventListener('click', (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    ipcRenderer.send('window-toggle-maximize');
  });

  document.getElementById('win-close-btn')?.addEventListener('click', (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    ipcRenderer.send('window-close');
  });

  document.getElementById('cancel-btn')?.addEventListener('click', (e) => {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    window.close();
  });

  // Navegação por abas
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const target = tab.getAttribute('data-tab');
      if (!target) return;
      const current = window.location.pathname.split('/').pop().split('\\').pop();
      if (current !== target) {
        window.location.href = target;
      }
    });
  });
})();
