// Spawns a single `claude --print` invocation and streams its JSON output.
// One instance per send() call — not a persistent REPL process.

const { spawn, execFile } = require('child_process');

const CANDIDATE_BINARIES = ['claude'];

async function resolveBinary() {
  for (const cmd of CANDIDATE_BINARIES) {
    try {
      await new Promise((resolve, reject) => {
        execFile('which', [cmd], (err, stdout) => {
          if (err || !stdout.trim()) return reject(err || new Error('not found'));
          resolve(stdout.trim());
        });
      });
      return cmd;
    } catch (_) {}
  }
  return null;
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

    // Prompt goes as the positional argument (last)
    args.push(prompt);

    // HOME explícito garante que o CLI encontra ~/.claude/ com as credenciais
    // do usuário da máquina, mesmo que o Electron tenha modificado o env.
    const env = { ...process.env, HOME: process.env.HOME || require('os').homedir() };
    this._proc = spawn(bin, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    this.alive = true;

    // stdin PRECISA ser fechado: com o pipe aberto o CLI espera dados de stdin
    // antes de processar (3s de atraso por mensagem nas versões atuais; hang
    // indefinido em versões antigas — era a causa do travamento no 2º envio).
    try { this._proc.stdin.end(); } catch (_) {}

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
