// Spawns a single `agy --print` invocation.
// One instance per send() call — not a persistent REPL process.

const { spawn } = require('child_process');
const { execFile } = require('child_process');

const CANDIDATE_COMMANDS = ['agy', 'gemini', 'gemini-cli'];

// No Windows o comando de localização é `where` (não existe `which`); no
// restante (Linux/macOS) é `which`. Retornamos o caminho completo resolvido
// para que o spawn saiba se está lidando com um .exe ou um shim .cmd/.bat.
async function resolveBinary() {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  for (const cmd of CANDIDATE_COMMANDS) {
    try {
      const fullPath = await new Promise((resolve, reject) => {
        execFile(locator, [cmd], (err, stdout) => {
          const first = stdout && stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
          if (err || !first) return reject(err || new Error('not found'));
          resolve(first);
        });
      });
      return fullPath; // found
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

// No Windows, o binário instalado via `npm install -g` costuma ser um shim
// `agy.cmd`/`agy.bat`, que o spawn só consegue executar com `shell: true`.
// Um `.exe` (instalação nativa) roda direto sem shell.
function needsShell(bin) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
}

class GeminiCliProcess {
  constructor() {
    this._proc = null;
    this._binary = null;
    this._onData = null;
    this._onError = null;
    this._onStderr = null;
    this._onClose = null;
    this.alive = false;
    this._logFile = null;      // Windows: arquivo temporário de log da CLI
    this._logTail = null;      // Windows: intervalo de polling do log
    this._logOffset = 0;       // Windows: bytes já lidos do log
  }

  get pid() { return this._proc ? this._proc.pid : null; }

  // Start the process in the given working directory.
  // opts: { cwd, model, prompt, isContinue }
  async start({ cwd, model, prompt, isContinue }) {
    if (this.alive) throw new Error('GeminiCliProcess already running');

    if (!this._binary) {
      this._binary = await resolveBinary();
    }
    if (!this._binary) {
      throw new Error(
        'Antigravity CLI (agy) não encontrado. Instale com:\n' +
        '  npm install -g @google/antigravity-cli\n' +
        'e faça login/configuração com:\n' +
        '  agy install'
      );
    }

    const args = [];
    if (model) args.push('--model', model);
    
    // Automatically approve tool use in print mode
    args.push('--dangerously-skip-permissions');
    // No Unix, `/dev/stderr` faz a CLI escrever os logs na própria stderr do
    // processo, que capturamos pelo pipe. Esse caminho não existe no Windows,
    // então logamos para um arquivo temporário e fazemos "tail" dele para o
    // mesmo handler de stderr (o parser depende desses logs p/ achar o convId).
    let logFilePath = '/dev/stderr';
    if (process.platform === 'win32') {
      const os = require('os');
      const path = require('path');
      logFilePath = path.join(os.tmpdir(), `agy-log-${process.pid}-${Date.now()}.log`);
      this._logFile = logFilePath;
    }
    args.push('--log-file', logFilePath);

    if (isContinue) {
      args.push('--continue');
    }

    // Prompt is sent via stdin instead of argument list to prevent E2BIG
    const env = { ...process.env, HOME: process.env.HOME || require('os').homedir() };

    let spawnBin = this._binary;
    let spawnArgs = [...args];

    // On Linux, use stdbuf to force line buffering for stdout/stderr in real-time
    if (process.platform === 'linux') {
      spawnBin = 'stdbuf';
      spawnArgs = ['-oL', '-eL', this._binary, ...args];
    }

    const path = require('path');
    const { resolvePortalPath } = require('../../workspace/store');
    
    let resolvedCwd = cwd;
    if (resolvePortalPath) {
      try {
        resolvedCwd = resolvePortalPath(cwd);
      } catch (e) {
        console.warn('[gemini-cli] failed to resolve portal path in process:', e.message);
      }
    }
    resolvedCwd = path.resolve(resolvedCwd);

    this._proc = spawn(spawnBin, spawnArgs, {
      cwd: resolvedCwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      // shim .cmd/.bat no Windows exige shell para ser executável pelo spawn.
      shell: needsShell(spawnBin),
    });

    this.alive = true;

    // No Windows, os logs da CLI vão para o arquivo temporário; fazemos "tail"
    // dele e encaminhamos para o mesmo handler de stderr do provider.
    if (this._logFile) {
      this._startLogTail();
    }

    // Write prompt to stdin and close it
    try {
      this._proc.stdin.write(prompt + '\n');
      this._proc.stdin.end();
    } catch (stdinErr) {
      console.error('[gemini-cli] failed to write prompt to stdin:', stdinErr.message);
    }

    this._proc.stdout.setEncoding('utf8');
    this._proc.stderr.setEncoding('utf8');

    this._proc.stdout.on('data', (chunk) => {
      if (this._onData) this._onData(chunk);
    });

    this._proc.stdout.on('end', () => {
      if (this._onStdoutEnd) this._onStdoutEnd();
    });

    this._proc.stderr.on('data', (chunk) => {
      if (this._onStderr) this._onStderr(chunk);
    });

    this._proc.on('close', (code, signal) => {
      this.alive = false;
      this._stopLogTail();
      if (this._onClose) this._onClose(code, signal);
    });

    this._proc.on('error', (err) => {
      this.alive = false;
      if (this._onError) this._onError(`Process error: ${err.message}`);
    });

    return this;
  }

  // Send is no longer used since we write to command line args, but we keep a stub
  send(text) {
    throw new Error('Send is not supported in print mode');
  }

  // Force kill the process
  async kill() {
    if (!this.alive || !this._proc) return;
    try {
      this._proc.kill('SIGINT');
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 800));
    if (this.alive) {
      try {
        this._proc.kill('SIGKILL');
      } catch (_) {}
    }
    this.alive = false;
    this._proc = null;
    this._stopLogTail();
  }

  // Windows: poll do arquivo de log da CLI, emitindo apenas os bytes novos
  // pelo mesmo callback de stderr (parser + coleta de erros).
  _startLogTail() {
    if (this._logTail || !this._logFile) return;
    const fs = require('fs');
    this._logOffset = 0;
    const readNew = () => {
      let stats;
      try { stats = fs.statSync(this._logFile); } catch (_) { return; }
      if (stats.size <= this._logOffset) return;
      try {
        const fd = fs.openSync(this._logFile, 'r');
        const len = stats.size - this._logOffset;
        const buf = Buffer.allocUnsafe(len);
        const read = fs.readSync(fd, buf, 0, len, this._logOffset);
        fs.closeSync(fd);
        this._logOffset += read;
        const text = buf.slice(0, read).toString('utf8');
        if (text && this._onStderr) this._onStderr(text);
      } catch (_) {}
    };
    this._logTail = setInterval(readNew, 120);
  }

  _stopLogTail() {
    if (this._logTail) {
      clearInterval(this._logTail);
      this._logTail = null;
    }
    if (this._logFile) {
      // Drena o que restou antes de remover o arquivo.
      try {
        const fs = require('fs');
        const stats = fs.statSync(this._logFile);
        if (stats.size > this._logOffset && this._onStderr) {
          const fd = fs.openSync(this._logFile, 'r');
          const len = stats.size - this._logOffset;
          const buf = Buffer.allocUnsafe(len);
          const read = fs.readSync(fd, buf, 0, len, this._logOffset);
          fs.closeSync(fd);
          this._onStderr(buf.slice(0, read).toString('utf8'));
        }
        fs.unlinkSync(this._logFile);
      } catch (_) {}
      this._logFile = null;
    }
  }

  onData(fn)   { this._onData   = fn; }
  onError(fn)  { this._onError  = fn; }
  onStderr(fn) { this._onStderr = fn; }
  onClose(fn)  { this._onClose  = fn; }
  onStdoutEnd(fn) { this._onStdoutEnd = fn; }

  static async checkInstalled() {
    const bin = await resolveBinary();
    return bin !== null;
  }
}

module.exports = { GeminiCliProcess, resolveBinary };
