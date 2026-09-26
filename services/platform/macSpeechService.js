// services/platform/macSpeechService.js
// Adapter para transcrição nativa offline no macOS via SFSpeechRecognizer (Speech.framework)
// Acelerado pela Apple Neural Engine nos Macs com Apple Silicon (M1/M2/M3/M4).
// Zero consumo de tokens e latência instantânea.

const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class MacSpeechService {
  constructor() {
    this.isMac = process.platform === 'darwin';
  }

  /**
   * Verifica se o sistema suporta o Speech Framework nativo do macOS.
   */
  isAvailable() {
    if (!this.isMac) return false;
    const cliPath = this._getCliPath();
    return !!(cliPath && fs.existsSync(cliPath));
  }

  _getCliPath() {
    if (!this.isMac) return null;
    const candidates = [
      path.join(__dirname, '..', '..', 'bin', 'darwin', 'macos-speech'),
      path.join(process.env.HOME || '', '.local', 'bin', 'macos-speech'),
      '/usr/local/bin/macos-speech'
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  /**
   * Transcreve um arquivo de áudio utilizando o SFSpeechRecognizer do macOS.
   * @param {string} audioPath Caminho do áudio
   * @param {Object} [options] Opções (ex: language: 'pt-BR' ou 'en-US')
   */
  async transcribeFile(audioPath, options = {}) {
    if (!this.isMac) {
      throw new Error('O motor nativo Speech.framework só é suportado em sistemas macOS (Apple).');
    }

    const cliPath = this._getCliPath();
    if (!cliPath) {
      throw new Error(
        'Binário nativo macos-speech não encontrado. Consulte a documentação em docs/MACOS_SPEECH_ROADMAP.md para compilar o utilitário nativo Swift.'
      );
    }

    const lang = options.language || 'pt-BR';
    return new Promise((resolve, reject) => {
      execFile(cliPath, ['--file', audioPath, '--lang', lang], { timeout: 30000 }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`Falha no speech-to-text nativo macOS: ${stderr || err.message}`));
        }
        resolve(stdout.trim());
      });
    });
  }
}

module.exports = new MacSpeechService();
