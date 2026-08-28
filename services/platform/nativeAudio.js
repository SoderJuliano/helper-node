// services/platform/nativeAudio.js
//
// Fonte de PCM cross-platform (Windows/macOS) para os motores de VAD.
// Substitui o `parec` (PulseAudio, Linux-only) por captura via Chromium:
//   - mic  → getUserMedia({audio})
//   - sys  → getDisplayMedia({audio}) com `audio:'loopback'` (áudio do sistema)
//
// Entrega PCM s16le / 16 kHz / mono — MESMO formato que o parec produzia — para
// que os motores (realtimeAudioCapture.js e translationAssistant/vadEngine.js)
// reutilizem toda a lógica de VAD/segmentação/WAV SEM alteração.
//
// Só é usado fora do Linux. No Linux os motores continuam com parec direto.
//
// Loopback de sistema:
//   - Windows: `audio:'loopback'` funciona nativamente (WASAPI). ✅
//   - macOS: o Chromium não faz loopback de sistema sem driver virtual
//     (BlackHole/Soundflower). O mic funciona; o áudio do sistema fica mudo.
//     É a mesma limitação de sempre — no Linux era parec, no Mac nunca houve.

const path = require('path');

let win = null;              // BrowserWindow oculto de captura
let starting = null;         // Promise de inicialização em andamento (idempotência)
const subscribers = new Map(); // source ('mic'|'sys') -> Set<cb(Buffer)>

function electron() {
  // require tardio: só quando realmente for usado (evita custo no Linux).
  return require('electron');
}

function routePcm(source, buf) {
  const set = subscribers.get(source);
  if (!set) return;
  for (const cb of set) {
    try { cb(buf); } catch (e) { console.error('[native-audio] callback erro:', e.message); }
  }
}

async function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  if (starting) return starting;

  starting = (async () => {
    const { BrowserWindow, ipcMain, session, desktopCapturer } = electron();

    // Auto-aprova permissões de mídia e getDisplayMedia com loopback de áudio (sem UI de seleção).
    // Só precisamos do áudio; o vídeo é obrigatório pela API mas é descartado.
    try {
      session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        if (permission === 'media' || permission === 'microphone' || permission === 'audio-capture') return true;
        return true;
      });
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        desktopCapturer.getSources({ types: ['screen'] })
          .then((sources) => {
            callback({ video: sources[0], audio: 'loopback' });
          })
          .catch(() => callback({}));
      }, { useSystemPicker: false });
    } catch (e) {
      console.warn('[native-audio] permission/displayMedia handlers falhou:', e.message);
    }

    // Recebe os chunks PCM do renderer e roteia pros assinantes.
    if (!ensureWindow._ipcBound) {
      ipcMain.on('native-audio-pcm', (_evt, payload) => {
        if (!payload || !payload.source || !payload.bytes) return;
        routePcm(payload.source, Buffer.from(payload.bytes));
      });
      ipcMain.on('native-audio-log', (_evt, msg) => console.log('[native-audio][renderer]', msg));
      ensureWindow._ipcBound = true;
    }

    win = new BrowserWindow({
      show: false,
      width: 200,
      height: 200,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false, // CRÍTICO: janela oculta não pode throttlar o áudio
      },
    });

    await win.loadFile(path.join(__dirname, 'nativeAudioRenderer.html'));
    win.on('closed', () => { win = null; });
    return win;
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
}

let closeIdleTimer = null;

// Assina o stream de uma fonte. Abre a janela de captura na primeira assinatura.
async function subscribe(source, cb, options = {}) {
  clearTimeout(closeIdleTimer);
  if (!subscribers.has(source)) subscribers.set(source, new Set());
  subscribers.get(source).add(cb);
  const w = await ensureWindow();
  // Pede ao renderer para (re)garantir que a fonte está capturando.
  if (w && !w.isDestroyed()) {
    const deviceId = (options && options.deviceId) ? String(options.deviceId) : '';
    w.webContents.send('native-audio-start', { source, deviceId });
  }
}

// Cancela a assinatura. Para a captura da fonte e agenda fechamento apos inatividade.
function unsubscribe(source, cb) {
  const set = subscribers.get(source);
  if (set) {
    if (cb) set.delete(cb); else set.clear();
    if (set.size === 0) {
      subscribers.delete(source);
      if (win && !win.isDestroyed()) win.webContents.send('native-audio-stop', { source });
    }
  }
  if (subscribers.size === 0) {
    clearTimeout(closeIdleTimer);
    closeIdleTimer = setTimeout(() => {
      if (subscribers.size === 0 && win && !win.isDestroyed()) {
        try { win.close(); } catch (_) {}
        win = null;
      }
    }, 60000);
  }
}

// Pré-aquece a janela oculta de áudio na inicialização do app (0ms de atraso no primeiro Ctrl+D)
async function prewarm() {
  if (process.platform === 'linux') return;
  try {
    await ensureWindow();
  } catch (e) {
    console.warn('[native-audio] prewarm falhou:', e.message);
  }
}

function destroy() {
  clearTimeout(closeIdleTimer);
  subscribers.clear();
  if (win && !win.isDestroyed()) {
    try { win.destroy(); } catch (_) {}
    win = null;
  }
}

module.exports = { subscribe, unsubscribe, prewarm, destroy };
