// Spawns a single `agy --print` invocation.
// One instance per send() call — not a persistent REPL process.

const { spawn } = require('child_process');
const { execFile } = require('child_process');

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
    this._onStderr = null;
    this._onClose = null;
    this.alive = false;
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
    args.push('--log-file', '/dev/stderr');

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

    this._proc = spawn(spawnBin, spawnArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.alive = true;

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
