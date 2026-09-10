// services/platform/screenCapture.js
//
// Captura de tela cross-platform via Electron desktopCapturer.
// Suporta multi-monitores (telas secundárias) e janelas específicas (Brave, Chrome, editores).

const { desktopCapturer, screen } = require('electron');
const fs = require('fs').promises;

/**
 * Captura a tela inteira (monitor relevante ou especificado) ou uma janela específica (ex: Brave, Chrome)
 * e grava um PNG em `outPath`.
 * 
 * @param {string} outPath Caminho de saída do PNG
 * @param {Object} [options]
 * @param {string} [options.targetApp] Nome do app/janela desejada (ex: 'brave', 'chrome', 'browser')
 * @param {number} [options.displayIndex] Índice do monitor desejado (0, 1, ...)
 * @param {boolean} [options.allScreens] Se deve listar ou combinar telas
 * @returns {Promise<{ path: string, sourceName: string, sourceType: string, totalSources: number, availableWindows: string[] }>}
 */
async function captureFullScreenToFile(outPath, options = {}) {
  const { targetApp, displayIndex } = options;

  const displays = (screen && typeof screen.getAllDisplays === 'function') ? screen.getAllDisplays() : [];
  const primaryDisplay = (screen && typeof screen.getPrimaryDisplay === 'function') ? screen.getPrimaryDisplay() : { size: { width: 1920, height: 1080 }, scaleFactor: 1 };
  const cursor = (screen && typeof screen.getCursorScreenPoint === 'function') ? screen.getCursorScreenPoint() : { x: 0, y: 0 };
  const currentDisplay = (screen && typeof screen.getDisplayNearestPoint === 'function') ? (screen.getDisplayNearestPoint(cursor) || primaryDisplay) : primaryDisplay;

  let maxW = 1920;
  let maxH = 1080;
  for (const d of displays) {
    const sf = d.scaleFactor || 1;
    const w = Math.round((d.size ? d.size.width : 1920) * sf);
    const h = Math.round((d.size ? d.size.height : 1080) * sf);
    if (w > maxW) maxW = w;
    if (h > maxH) maxH = h;
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: {
      width: Math.max(maxW, 1920),
      height: Math.max(maxH, 1080),
    },
    fetchWindowIcons: false,
  });

  if (!sources || sources.length === 0) {
    throw new Error('Nenhuma fonte de tela ou janela disponível (desktopCapturer vazio).');
  }

  const screenSources = sources.filter(s => s.id.startsWith('screen:'));
  const windowSources = sources.filter(s => s.id.startsWith('window:'));
  const availableWindows = windowSources.map(w => w.name).filter(Boolean);

  let selectedSource = null;

  // 1. Se foi pedido um app/janela específico (ex: "brave", "chrome", "navegador", "browser", "code")
  if (targetApp && typeof targetApp === 'string') {
    const appQuery = targetApp.toLowerCase().trim();
    selectedSource = windowSources.find(s => {
      const name = (s.name || '').toLowerCase();
      if (appQuery === 'browser' || appQuery === 'navegador') {
        return name.includes('brave') || name.includes('chrome') || name.includes('edge') || name.includes('firefox') || name.includes('opera') || name.includes('browser');
      }
      return name.includes(appQuery);
    });
  }

  // 2. Se displayIndex foi especificado (ex: 1 para segundo monitor / tela secundária)
  if (!selectedSource && typeof displayIndex === 'number' && displayIndex >= 0) {
    if (screenSources[displayIndex]) {
      selectedSource = screenSources[displayIndex];
    }
  }

  // 3. Se targetApp foi informado mas não casou nome exato, verifica se algum navegador existe
  if (!selectedSource && targetApp) {
    const browserWin = windowSources.find(s => {
      const n = (s.name || '').toLowerCase();
      return n.includes('brave') || n.includes('chrome') || n.includes('edge') || n.includes('firefox') || n.includes('opera');
    });
    if (browserWin) {
      selectedSource = browserWin;
    }
  }

  // 4. Se o usuário tem múltiplos monitores e o app/janela não foi isolado como janela individual,
  // e se o displayIndex não foi fornecido mas temos mais de 1 tela:
  // Se cursor estiver na tela secundária ou se houver tela secundária (screenSources[1]), prioriza monitor relevante
  if (!selectedSource && screenSources.length > 1) {
    if (typeof displayIndex === 'number' && screenSources[displayIndex]) {
      selectedSource = screenSources[displayIndex];
    } else {
      // Se não especificou índice, escolhe a tela com base no cursor ou tela secundária se o alvo for navegador externo
      selectedSource = screenSources[1] || screenSources[0];
    }
  }

  // 5. Fallback para monitor principal ou primeira fonte disponível
  if (!selectedSource) {
    selectedSource = screenSources[0] || sources[0];
  }

  const png = selectedSource.thumbnail.toPNG();
  if (!png || png.length < 100) {
    throw new Error('Thumbnail de captura vazio ou corrompido.');
  }

  await fs.writeFile(outPath, png);

  return {
    path: outPath,
    sourceName: selectedSource.name,
    sourceType: selectedSource.id.startsWith('window:') ? 'window' : 'screen',
    totalSources: sources.length,
    availableWindows: availableWindows.slice(0, 20),
    displaysCount: displays.length,
  };
}

module.exports = { captureFullScreenToFile };
