// services/terminalLogService.js
const fs = require('fs');
const path = require('path');
const os = require('os');

// Regex para remover sequencias de escape ANSI (SGR, OSC, CSI, modos de terminal)
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

class TerminalLogService {
  constructor() {
    this._writeStream = null;
    this._logFilePath = path.join(os.homedir(), 'terminal-logs.txt');
  }

  getLogFilePath() {
    return this._logFilePath;
  }

  setLogFilePath(customPath) {
    if (customPath && typeof customPath === 'string') {
      this.closeStream();
      this._logFilePath = customPath;
    }
  }

  stripAnsi(raw) {
    if (!raw) return '';
    const noAnsi = String(raw).replace(ANSI_REGEX, '');
    return noAnsi.replace(/[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F]/g, '');
  }

  getStream() {
    if (!this._writeStream) {
      try {
        this._writeStream = fs.createWriteStream(this._logFilePath, {
          flags: 'a',
          encoding: 'utf8',
        });
        this._writeStream.on('error', (err) => {
          console.error('[terminalLogService] Erro no stream de log:', err && err.message);
          this.closeStream();
        });
      } catch (err) {
        console.error('[terminalLogService] Falha ao criar stream:', err && err.message);
        this._writeStream = null;
      }
    }
    return this._writeStream;
  }

  closeStream() {
    if (this._writeStream) {
      try {
        this._writeStream.end();
      } catch (_) {}
      this._writeStream = null;
    }
  }

  writeChunk(chunk) {
    if (!chunk) return;
    const cleanText = this.stripAnsi(chunk);
    if (!cleanText) return;

    const stream = this.getStream();
    if (stream && stream.writable) {
      stream.write(cleanText);
    }
  }

  writeSessionMarker(type, detail = '') {
    const stream = this.getStream();
    if (!stream || !stream.writable) return;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    if (type === 'start') {
      const header = `\n--- [Sessao do terminal iniciada: ${timestamp}${detail ? ' | ' + detail : ''}] ---\n`;
      stream.write(header);
    } else if (type === 'end') {
      const footer = `\n--- [Sessao do terminal finalizada: ${timestamp}${detail ? ' | ' + detail : ''}] ---\n`;
      stream.write(footer);
    }
  }
}

const terminalLogService = new TerminalLogService();
module.exports = terminalLogService;
