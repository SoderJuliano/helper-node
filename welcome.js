const { ipcRenderer } = require("electron");

document.getElementById('win-close-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-close');
});

const configApisBtn = document.getElementById('welcome-config-apis-btn');
const skipBtn = document.getElementById('welcome-skip-btn');

if (configApisBtn) {
  configApisBtn.addEventListener('click', () => {
    ipcRenderer.send('set-welcome-completed', true);
    ipcRenderer.send('open-api-config-ui');
    window.close();
  });
}

if (skipBtn) {
  skipBtn.addEventListener('click', () => {
    ipcRenderer.send('set-welcome-completed', true);
    window.close();
  });
}
