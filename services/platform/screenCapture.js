// services/platform/screenCapture.js
//
// Captura de tela cross-platform via Electron desktopCapturer.
//
// POR QUE existe: no Linux (Wayland/COSMIC) o desktopCapturer dispara o diálogo
// "Compartilhar a tela" do XDG Portal — quebra o stealth. Por isso no Linux o
// app usa ferramentas de sistema (cosmic-screenshot/grim/gnome-screenshot).
//
// No Windows e macOS é o OPOSTO: desktopCapturer captura SILENCIOSAMENTE, sem
// diálogo, e a janela do próprio helper fica fora da captura via
// setContentProtection (que É efetivo nessas plataformas, ao contrário do Linux).
// Logo, este é o caminho stealth NATIVO para Windows/macOS.

const { desktopCapturer, screen } = require('electron');
const fs = require('fs').promises;

// Captura a tela inteira (o monitor onde está o cursor, em multi-monitor) e
// grava um PNG em `outPath`. Retorna o caminho gravado, ou null em falha.
async function captureFullScreenToFile(outPath) {
  // Monitor sob o cursor — correto em setups multi-monitor no Windows/macOS.
  const cursor = screen.getCursorScreenPoint();
  const target = screen.getDisplayNearestPoint(cursor) || screen.getPrimaryDisplay();
  const sf = target.scaleFactor || 1;

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(target.size.width * sf),
      height: Math.round(target.size.height * sf),
    },
  });

  if (!sources || sources.length === 0) {
    throw new Error('Nenhuma fonte de tela disponível (desktopCapturer vazio).');
  }

  // Casa a fonte pelo display_id do Electron (== target.id em string). Se não
  // casar (alguns drivers não populam display_id), cai na primeira fonte.
  const targetId = String(target.id);
  const match =
    sources.find((s) => String(s.display_id) === targetId) || sources[0];

  const png = match.thumbnail.toPNG();
  if (!png || png.length < 100) {
    throw new Error('Thumbnail de captura vazio/corrompido.');
  }

  await fs.writeFile(outPath, png);
  return outPath;
}

module.exports = { captureFullScreenToFile };
