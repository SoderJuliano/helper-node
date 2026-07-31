// Spawns a single `copilot -p <prompt> --allow-all-tools` invocation and
// captures its stdout. One instance per send() call — not a persistent REPL.
//
// ⚠️ Flags abaixo foram confirmados contra a doc oficial (docs.github.com/
// copilot/reference/copilot-cli-reference/cli-programmatic-reference), NÃO
// contra `copilot --help` rodado de verdade nesta máquina (aqui não tem o
// binário instalado). Existe divergência entre fontes sobre o nome exato da
// flag de bypass total: a doc "programmatic reference" usa `--allow-all-tools`,
// mas outra página da mesma doc.github.com (autopilot) cita `--allow-all`
// (alias `--yolo`). Fica ALLOW_ALL_FLAG como constante única — se o binário
// recusar a flag, é o primeiro lugar a corrigir, com `copilot --help` real.
const { spawn, execFile } = require('child_process');
const path = require('path');

const CANDIDATE_BINARIES = ['copilot'];
const ALLOW_ALL_FLAG = '--allow-all-tools'; // ver aviso acima antes de mudar

async function resolveBinary() {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  for (const cmd of CANDIDATE_BINARIES) {
    try {
      const fullPath = await new Promise((resolve, reject) => {
        execFile(locator, [cmd], (err, stdout) => {
          const first = stdout && stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
          if (err || !first) return reject(err || new Error('not found'));
          resolve(first);
        });
      });
      return fullPath;
    } catch (_) {}
  }
  return null;
}

// npm install -g costuma criar um shim .cmd/.bat no Windows, que só roda via
// spawn com shell: true (mesma lição do ClaudeCliProcess/GeminiCliProcess).
function needsShell(bin) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
}

class CopilotCliProcess {
  constructor() {
    this._proc    = null;
    this._onData  = null;
    this._onError = null;
    this._onClose = null;
    this._onStderr = null;
    this.alive    = false;
  }

  get pid() { return this._proc ? this._proc.pid : null; }

  // opts: { cwd, model, prompt, binary }
  async start({ cwd, model, prompt, binary }) {
    if (this.alive) throw new Error('CopilotCliProcess already running');

    const bin = binary || await resolveBinary();
    if (!bin) {
      throw new Error(
        'GitHub Copilot CLI não encontrado. Instale com (não precisa de admin):\n' +
        '  npm install -g @github/copilot\n' +
        '(requer Node.js 22+) e autentique rodando `copilot` e digitando /login.'
      );
    }

    const args = [
      '-p', prompt,
      ALLOW_ALL_FLAG,
      '--add-dir', cwd,
    ];
    if (model) args.push('--model', model);

    const env = { ...process.env, HOME: process.env.HOME || require('os').homedir() };

    this._proc = spawn(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: needsShell(bin),
    });

    this.alive = true;

    this._proc.stdout.setEncoding('utf8');
    this._proc.stderr.setEncoding('utf8');

    this._proc.stdout.on('data', (chunk) => {
      if (this._onData) this._onData(chunk);
    });

    this._proc.stderr.on('data', (chunk) => {
      const line = chunk && chunk.trim();
      if (!line) return;
      console.warn('[copilot-cli] stderr:', line.slice(0, 200));
      if (this._onStderr) this._onStderr(line);
    });

    this._proc.on('close', (code, signal) => {
      this.alive = false;
      if (this._onClose) this._onClose(code, signal);
    });

    this._proc.on('error', (err) => {
      this.alive = false;
      if (this._onError) this._onError(err);
    });

    return this;
  }

  // SIGINT primeiro (equivalente ao Ctrl+C que o usuário daria no terminal),
  // SIGKILL como último recurso — mesmo padrão do ClaudeCliProcess.
  async kill() {
    if (!this.alive || !this._proc) return;
    try { this._proc.kill('SIGINT'); } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 800));
    if (this.alive) {
      try { this._proc.kill('SIGKILL'); } catch (_) {}
    }
    this.alive = false;
    this._proc = null;
  }

  onData(fn)   { this._onData   = fn; }
  onError(fn)  { this._onError  = fn; }
  onClose(fn)  { this._onClose  = fn; }
  onStderr(fn) { this._onStderr = fn; }

  static async checkInstalled() {
    return (await resolveBinary()) !== null;
  }

  static async resolveBinary() {
    return resolveBinary();
  }
}

module.exports = { CopilotCliProcess, resolveBinary, ALLOW_ALL_FLAG };
