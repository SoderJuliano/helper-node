// Thin wrapper around the `gemini` child process.
// Handles spawn, kill, stdin write, stdout/stderr piping.
// Does NOT contain business logic — that lives in GeminiCliSession.

const { spawn } = require('child_process');
const { execFile } = require('child_process');

// Searches common locations for the `agy` or `gemini` binary.
const CANDIDATE_COMMANDS = ['agy', 'gemini', 'gemini-cli'];

async function resolveBinary() {
  for (const cmd of CANDIDATE_COMMANDS) {
    try {
      await new Promise((resolve, reject) => {
        execFile('which', [cmd], (err, stdout) => {
          if (err || !stdout.trim()) return reject(err || new Error('not found'));
          resolve(stdout.trim());
        });
      });
      return cmd; // found
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

class GeminiCliProcess {
  constructor() {
    this._proc = null;
    this._binary = null;
    this._onData = null;
    this._onError = null;
    this._onClose = null;
    this.alive = false;
  }

  get pid() { return this._proc ? this._proc.pid : null; }

  // Start the process in the given working directory.
  // model: Gemini model id (e.g. 'gemini-2.5-flash')
  async start(cwd, model) {
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
    // --no-color to minimise ANSI noise; --debug off
    args.push('--no-color');

    // HOME explícito garante que o CLI encontra ~/.gemini/ com as credenciais
    // do usuário da máquina, mesmo que o Electron tenha modificado o env.
    const env = { ...process.env, HOME: process.env.HOME || require('os').homedir() };
    this._proc = spawn(this._binary, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.alive = true;

    this._proc.stdout.setEncoding('utf8');
    this._proc.stderr.setEncoding('utf8');

    this._proc.stdout.on('data', (chunk) => {
      if (this._onData) this._onData(chunk);
    });

    this._proc.stderr.on('data', (chunk) => {
      if (this._onError) this._onError(chunk);
    });

    this._proc.on('close', (code, signal) => {
      this.alive = false;
      if (this._onClose) this._onClose(code, signal);
    });

    this._proc.on('error', (err) => {
      this.alive = false;
      if (this._onError) this._onError(`Process error: ${err.message}`);
    });

    return this;
  }

  // Send text to the process stdin (appends a newline).
  send(text) {
    if (!this.alive || !this._proc) throw new Error('Process not running');
    this._proc.stdin.write(text + '\n');
  }

  // Graceful shutdown: send /exit, depois SIGINT (mesmo sinal do Ctrl+C no
  // terminal — é o que o CLI espera pra uma interrupção pedida pelo usuário,
  // diferente de SIGTERM), SIGKILL como último recurso.
  async kill() {
    if (!this.alive || !this._proc) return;
    try {
      this._proc.stdin.write('/exit\n');
    } catch (_) { /* stdin may already be closed */ }
    await new Promise(resolve => setTimeout(resolve, 400));
    if (this.alive) {
      try { this._proc.kill('SIGINT'); } catch (_) {}
    }
    await new Promise(resolve => setTimeout(resolve, 1600));
    if (this.alive) {
      try { this._proc.kill('SIGKILL'); } catch (_) {}
    }
    this.alive = false;
    this._proc = null;
  }

  onData(fn)  { this._onData  = fn; }
  onError(fn) { this._onError = fn; }
  onClose(fn) { this._onClose = fn; }

  static async checkInstalled() {
    const bin = await resolveBinary();
    return bin !== null;
  }
}

module.exports = { GeminiCliProcess, resolveBinary };
