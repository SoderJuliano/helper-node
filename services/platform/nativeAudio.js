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
const EventEmitter = require('events');

const events = new EventEmitter();
let win = null;              // BrowserWindow oculto de captura
let starting = null;         // Promise de inicialização em andamento (idempotência)
const subscribers = new Map(); // source ('mic'|'sys') -> Set<cb(Buffer)>
const sourceOptions = new Map(); // source -> options ({ deviceId })

function electron() {
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

      ipcMain.on('native-audio-device-lost', (_evt, payload) => {
        console.warn(`[native-audio] Dispositivo de áudio desconectado (${payload && payload.source}):`, payload);
        events.emit('device-lost', payload);
      });

      ipcMain.on('native-audio-device-change', () => {
        events.emit('device-change');
      });

      ipcMain.on('native-audio-error', (_evt, payload) => {
        console.warn('[native-audio] Erro de captura do renderer:', payload);
        events.emit('error', payload);
      });

      ipcMain.on('native-audio-renderer-ready', () => {
        // Reativa todas as fontes que possuam assinantes ativos
        if (win && !win.isDestroyed()) {
          for (const [source, set] of subscribers.entries()) {
            if (set && set.size > 0) {
              const opts = sourceOptions.get(source) || {};
              const deviceId = opts.deviceId || '';
              win.webContents.send('native-audio-start', { source, deviceId });
            }
          }
        }
      });

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

    win.webContents.on('render-process-gone', (_evt, details) => {
      console.warn('[native-audio] Processo do renderer finalizou/caiu:', details);
      win = null;
      if (subscribers.size > 0) {
        setTimeout(() => {
          ensureWindow().catch((e) => console.error('[native-audio] Falha ao recriar janela após crash:', e.message));
        }, 500);
      }
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
  sourceOptions.set(source, options || {});

  const w = await ensureWindow();
  // Pede ao renderer para (re)garantir que a fonte está capturando com o deviceId mais recente.
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
      sourceOptions.delete(source);
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
    }, 45000);
  }
}

// Força reinício de uma fonte (útil ao mudar configurações de microfone ou após reconexão manual)
async function restart(source, options = {}) {
  if (options) sourceOptions.set(source, options);
  const opts = sourceOptions.get(source) || options || {};
  const deviceId = (opts && opts.deviceId) ? String(opts.deviceId) : '';
  const w = await ensureWindow();
  if (w && !w.isDestroyed()) {
    w.webContents.send('native-audio-restart', { source, deviceId });
  }
}

// Lista dispositivos de áudio disponíveis via Chromium
async function listInputDevices() {
  if (process.platform === 'linux') return [];
  try {
    const w = await ensureWindow();
    if (!w || w.isDestroyed()) return [];

    const { ipcMain } = electron();
    const reqId = 'devs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    return await new Promise((resolve) => {
      let timer = null;
      const onReply = (_evt, data) => {
        if (data && data.reqId === reqId) {
          if (timer) clearTimeout(timer);
          ipcMain.removeListener('native-audio-list-devices-reply', onReply);
          resolve(data.devices || []);
        }
      };

      timer = setTimeout(() => {
        ipcMain.removeListener('native-audio-list-devices-reply', onReply);
        resolve([]);
      }, 3000);

      ipcMain.on('native-audio-list-devices-reply', onReply);
      w.webContents.send('native-audio-list-devices', { reqId });
    });
  } catch (err) {
    console.error('[native-audio] listInputDevices falhou:', err.message);
    return [];
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
  sourceOptions.clear();
  if (win && !win.isDestroyed()) {
    try { win.destroy(); } catch (_) {}
    win = null;
  }
}

module.exports = {
  subscribe,
  unsubscribe,
  restart,
  listInputDevices,
  prewarm,
  destroy,
  events,
  on: (event, cb) => events.on(event, cb),
  once: (event, cb) => events.once(event, cb),
  removeListener: (event, cb) => events.removeListener(event, cb)
};
