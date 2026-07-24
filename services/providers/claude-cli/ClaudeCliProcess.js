// Spawns a single `claude --print` invocation and streams its JSON output.
// One instance per send() call — not a persistent REPL process.

const { spawn, execFile } = require('child_process');

const CANDIDATE_BINARIES = ['claude'];

// No Windows o comando de localização é `where` (não existe `which`); no
// restante (Linux/macOS) é `which`. Retornamos o caminho completo resolvido
// para que o spawn saiba se está lidando com um .exe ou um shim .cmd/.bat.
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

// No Windows, o binário instalado via `npm install -g` costuma ser um shim
// `claude.cmd`/`claude.bat`, que o spawn só consegue executar com `shell: true`.
// Um `.exe` (instalação nativa) roda direto sem shell.
function needsShell(bin) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
}

class ClaudeCliProcess {
  constructor() {
    this._proc     = null;
    this._onData   = null;
    this._onError  = null;
    this._onClose  = null;
    this._onStderr = null;
    this.alive     = false;
  }

  get pid() { return this._proc ? this._proc.pid : null; }

  // Start a non-interactive claude --print invocation.
  // opts: { cwd, model, sessionId, prompt }
  //   sessionId: pass to --resume when resuming an existing conversation.
  async start({ cwd, model, sessionId, prompt, binary }) {
    if (this.alive) throw new Error('ClaudeCliProcess already running');

    const bin = binary || await resolveBinary();
    if (!bin) {
      throw new Error(
        'Claude Code CLI não encontrado. Instale com:\n' +
        '  npm install -g @anthropic-ai/claude-code\n' +
        'e autentique com:\n' +
        '  claude'
      );
    }

    const args = [
      '--print',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      // bypassPermissions: aprova automaticamente todas as ferramentas (Bash, Read, Write, etc.)
      // sem bloquear esperando confirmação em stdin.
      '--permission-mode', 'bypassPermissions',
      '--no-chrome',
    ];

    if (model) args.push('--model', model);



    if (sessionId) {
      // Resume existing conversation
      args.push('--resume', sessionId);
    }

    // HOME explícito garante que o CLI encontra ~/.claude/ com as credenciais
    // do usuário da máquina, mesmo que o Electron tenha modificado o env.
    const env = { ...process.env, HOME: process.env.HOME || require('os').homedir() };
    this._proc = spawn(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      // shim .cmd/.bat no Windows exige shell para ser executável pelo spawn.
      shell: needsShell(bin),
    });

    this.alive = true;

    // Escreve o prompt no stdin e fecha o fluxo (necessário para o CLI processar sem travar ou acusar E2BIG)
    try {
      this._proc.stdin.write(prompt + '\n');
      this._proc.stdin.end();
    } catch (stdinErr) {
      console.error('[claude-cli] failed to write prompt to stdin:', stdinErr.message);
    }

    this._proc.stdout.setEncoding('utf8');
    this._proc.stderr.setEncoding('utf8');

    this._proc.stdout.on('data', (chunk) => {
      if (this._onData) this._onData(chunk);
    });

    this._proc.stderr.on('data', (chunk) => {
      const line = chunk && chunk.trim();
      if (!line) return;
      console.warn('[claude-cli] stderr:', line.slice(0, 200));
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

  // Force-kill if still running (e.g. on abort / session change).
  // SIGINT (não SIGTERM) — mesmo sinal que Ctrl+C manda no terminal; é o que o
  // CLI já sabe tratar como "cancela o turno atual" (SIGTERM é mais brusco e
  // não é o caminho que o próprio CLI espera pra uma interrupção pedida pelo
  // usuário). SIGKILL continua como último recurso se não morrer em 800ms.
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

module.exports = { ClaudeCliProcess, resolveBinary };
