const { ipcRenderer } = require("electron");

// Botão de tela cheia (janela frameless não tem o botão de maximizar do SO).
document.getElementById('win-maximize-btn')?.addEventListener('click', () => {
  ipcRenderer.send('window-toggle-maximize');
});

// Drag manual no Windows/macOS (app-region:drag é instável em janelas
// transparent+frameless nesses SOs). No Linux o app-region nativo já funciona.
if (process.platform !== 'linux') {
  const dragHandle = document.querySelector('h1');
  if (dragHandle) {
    dragHandle.style.setProperty('-webkit-app-region', 'no-drag');
    dragHandle.style.cursor = 'move';
    dragHandle.addEventListener('mousedown', (e) => { e.preventDefault(); ipcRenderer.send('frameless-drag-start'); });
    const end = () => ipcRenderer.send('frameless-drag-end');
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  }
}

// === Dados pessoais (nome/background) ===
const usernameInput = document.getElementById('pref-username');
const backgroundInput = document.getElementById('pref-background');

(async () => {
  try {
    const ta = await ipcRenderer.invoke('get-translation-assistant-config');
    if (!ta) return;
    if (usernameInput) usernameInput.value = ta.userName || '';
    if (backgroundInput) backgroundInput.value = ta.userBackground || '';
  } catch (e) {
    console.warn('[preferences] load user info failed:', e.message);
  }
})();

// === Base de Conhecimento (RAG) ===
const kbEnabledToggle = document.getElementById('kb-enabled');
const kbEnabledStatus = document.getElementById('kb-enabled-status');
const kbText = document.getElementById('kb-text');
const kbRewriteBtn = document.getElementById('kb-rewrite-btn');
const kbStatus = document.getElementById('kb-status');
const kbSourceLink = document.getElementById('kb-source-link');

if (kbSourceLink) {
  kbSourceLink.addEventListener('click', () => ipcRenderer.send('kb-open-source-file'));
}

function updateKbEnabledStatus(v) { if (kbEnabledStatus) kbEnabledStatus.textContent = v ? 'ON' : 'OFF'; }

if (kbEnabledToggle) kbEnabledToggle.addEventListener('change', () => updateKbEnabledStatus(kbEnabledToggle.checked));

// "Resumir e organizar com IA": reescreve o texto da base e devolve NO CAMPO (não salva —
// salvar é no "Salvar e Fechar"). Mantém as travas (pula código, descarta se encurtar).
if (kbRewriteBtn) {
  kbRewriteBtn.addEventListener('click', async () => {
    if (!kbText || !kbText.value.trim()) {
      if (kbStatus) { kbStatus.style.color = '#ffb74d'; kbStatus.textContent = 'Cole algum texto primeiro.'; }
      return;
    }
    if (kbStatus) { kbStatus.style.color = '#888'; kbStatus.textContent = 'Reorganizando com IA…'; }
    kbRewriteBtn.disabled = true;
    try {
      const res = await ipcRenderer.invoke('kb-rewrite', { text: kbText.value });
      if (res && res.ok) {
        if (typeof res.text === 'string') kbText.value = res.text;
        if (kbStatus) {
          if (res.codeSkipped) { kbStatus.style.color = '#9ef0a8'; kbStatus.textContent = 'Contém código — mantido sem reorganizar.'; }
          else if (res.shrunk) { kbStatus.style.color = '#ffb74d'; kbStatus.textContent = 'A IA encurtou demais — mantive o original.'; }
          else if (res.rewritten) { kbStatus.style.color = '#9ef0a8'; kbStatus.textContent = 'Reorganizado ✓ — lembre de Salvar e Fechar.'; }
          else { kbStatus.style.color = '#888'; kbStatus.textContent = 'Sem alterações.'; }
        }
      } else if (kbStatus) {
        kbStatus.style.color = '#ff6b6b'; kbStatus.textContent = 'Erro: ' + ((res && res.error) || 'falha ao reorganizar');
      }
    } catch (e) {
      if (kbStatus) { kbStatus.style.color = '#ff6b6b'; kbStatus.textContent = 'Erro: ' + e.message; }
    } finally {
      kbRewriteBtn.disabled = false;
    }
  });
}

(async () => {
  try {
    const kb = await ipcRenderer.invoke('kb-get');
    if (!kb) return;
    if (kbEnabledToggle) { kbEnabledToggle.checked = kb.enabled !== false; updateKbEnabledStatus(kbEnabledToggle.checked); }
    // O campo começa SEMPRE vazio — é só pra adicionar conteúdo novo, não carrega
    // (nem edita) o arquivo consolidado. Ver a base completa é pelo link abaixo.
    if (kbText) kbText.value = '';
    if (kbStatus) kbStatus.textContent = kb.chunks ? `${kb.chunks} trecho(s) na base` : 'base vazia — nada salvo ainda';
    if (kbSourceLink) kbSourceLink.style.display = kb.chunks ? '' : 'none';
  } catch (e) { console.warn('[kb] load failed:', e.message); }
})();

// === Salvar e Fechar ===
document.getElementById('save-btn').addEventListener('click', async () => {
  ipcRenderer.send('set-translation-assistant-config', {
    userName: usernameInput ? usernameInput.value : '',
    userBackground: backgroundInput ? backgroundInput.value : '',
  });

  // Anexa SÓ o que o usuário digitou agora (o campo não carrega mais a base
  // inteira). Texto vazio = no-op instantâneo. Com a base habilitada, a IA
  // resume/organiza apenas esse trecho novo antes de anexar ao arquivo.
  try {
    const kbEnabled = kbEnabledToggle ? kbEnabledToggle.checked : true;
    await ipcRenderer.invoke('kb-append', {
      text: kbText ? kbText.value : '',
      aiRewrite: kbEnabled,
      enabled: kbEnabled,
    });
  } catch (e) { console.warn('[kb] append on close failed:', e.message); }

  window.close();
});
