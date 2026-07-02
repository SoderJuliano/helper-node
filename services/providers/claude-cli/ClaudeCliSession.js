// Manages the conversation session for a given project directory.
// Each send() spawns a fresh `claude --print` process; conversation continuity
// is maintained by the CLI itself via --resume <session_id>.

const { ClaudeCliProcess } = require('./ClaudeCliProcess');
const { ClaudeCliParser }  = require('./ClaudeCliParser');

class ClaudeCliSession {
  constructor(projectPath) {
    this._projectPath = projectPath;
    this._sessionId   = null;  // set after first successful response
    this._binary      = null;  // cached binary path
    this._activeProc  = null;  // currently running process (for kill on abort)
  }

  getProjectPath() { return this._projectPath; }
  getSessionId()   { return this._sessionId;   }
  isActive()       { return !!(this._activeProc && this._activeProc.alive); }

  // Send a prompt and stream the response.
  // opts: { model, onChunk, onThinking, onToolStart, onToolDone, onFileTool,
  //         onStatus, onTokenUpdate, onRateLimit, onDone, onError }
  async send(prompt, opts = {}) {
    // Nunca deixa dois processos disputarem a sessão: se um envio anterior
    // ficou preso (API retry, hang), mata antes de começar o novo.
    if (this._activeProc && this._activeProc.alive) {
      console.warn('[claude-cli] envio anterior ainda ativo — abortando antes do novo');
      await this.abort().catch(() => {});
    }

    // Resolve binary once per session
    if (!this._binary) {
      const { resolveBinary } = require('./ClaudeCliProcess');
      this._binary = await resolveBinary();
      if (!this._binary) {
        const err = new Error(
          'Claude Code CLI não encontrado. Instale com:\n' +
          '  npm install -g @anthropic-ai/claude-code\n' +
          'e autentique com:\n  claude'
        );
        opts.onError && opts.onError(err);
        return;
      }
    }

    return new Promise((resolve, reject) => {
      // Watchdog: se o processo ficar mudo (API 529 em retry silencioso, hang),
      // avisa a UI a cada verificação e mata depois de 10 min sem NENHUM output.
      let lastActivity = Date.now();
      let watchdogKilled = false;
      const STALL_WARN_MS = 45 * 1000;
      const STALL_KILL_MS = 10 * 60 * 1000;
      const watchdog = setInterval(() => {
        const silent = Date.now() - lastActivity;
        if (silent > STALL_KILL_MS) {
          clearInterval(watchdog);
          console.warn('[claude-cli] 10min sem output — matando processo travado');
          watchdogKilled = true;
          this._aborted = false; // não é abort do usuário: queremos o erro na UI
          if (this._activeProc === proc) {
            proc.kill().catch(() => {});
          }
        } else if (silent > STALL_WARN_MS && opts.onStatus) {
          const s = Math.round(silent / 1000);
          opts.onStatus(`Aguardando resposta da API há ${s}s… (servidor pode estar sobrecarregado)`);
        }
      }, 15 * 1000);

      const finish = () => { clearInterval(watchdog); };

      const parser = new ClaudeCliParser({
        onSessionId: (id)   => { this._sessionId = id; },
        onConnected: ()     => {},
        onChunk:     (t)    => opts.onChunk    && opts.onChunk(t),
        onThinking:  (t)    => opts.onThinking && opts.onThinking(t),
        onToolStart: (info) => opts.onToolStart && opts.onToolStart(info),
        onToolDone:  (info) => opts.onToolDone && opts.onToolDone(info),
        onFileTool:  (info) => opts.onFileTool && opts.onFileTool(info),
        onTokenUpdate: (info) => { lastActivity = Date.now(); opts.onTokenUpdate && opts.onTokenUpdate(info); },
        onRateLimit:   (info) => { lastActivity = Date.now(); opts.onRateLimit   && opts.onRateLimit(info); },
        onDone: ({ text, cost, sessionId, usage }) => {
          if (sessionId) this._sessionId = sessionId;
          finish();
          this._activeProc = null;
          opts.onDone && opts.onDone({ text, cost, usage });
          resolve({ text, cost, usage });
        },
        onError: (err) => {
          finish();
          this._activeProc = null;
          opts.onError && opts.onError(err);
          reject(err);
        },
      });

      const proc = new ClaudeCliProcess();
      this._activeProc = proc;

      proc.onData((chunk) => { lastActivity = Date.now(); parser.feed(chunk); });
      proc.onStderr((line) => {
        lastActivity = Date.now();
        // Retries da API (529 overloaded, 5xx) aparecem no stderr — mostra na UI
        // em vez de deixar a tela estática por minutos.
        if (opts.onStatus && /retry|overloaded|529|rate.?limit|attempt/i.test(line)) {
          opts.onStatus(`API instável — tentando novamente… (${line.slice(0, 100)})`);
        }
      });
      proc.onClose((code) => {
        finish();
        parser.flush();
        if (proc.alive === false && this._activeProc === proc) {
          this._activeProc = null;
          // Abort do usuário (SIGTERM=143, SIGKILL=137): resolve silenciosamente.
          if (this._aborted) {
            this._aborted = false;
            opts.onDone && opts.onDone({ text: '', cost: 0 });
            resolve({ text: '' });
            return;
          }
          const errMsg = watchdogKilled
            ? 'Claude CLI ficou 10 minutos sem responder (servidor sobrecarregado?). Tente novamente.'
            : code !== 0
              ? `Claude CLI encerrou com código ${code}. Se não estiver autenticado: claude auth login`
              : 'Claude CLI encerrou sem resposta.';
          const err = new Error(errMsg);
          opts.onError && opts.onError(err);
          reject(err);
        }
      });

      proc.start({
        cwd:       this._projectPath,
        model:     opts.model,
        sessionId: this._sessionId,   // null on first turn → new session
        prompt,
        binary:    this._binary,
      }).catch((startErr) => {
        finish();
        this._activeProc = null;
        opts.onError && opts.onError(startErr);
        reject(startErr);
      });
    });
  }

  // Abort any in-progress send (user-initiated — won't show error in UI).
  async abort() {
    if (this._activeProc) {
      this._aborted = true;
      await this._activeProc.kill().catch(() => {});
      this._activeProc = null;
    }
  }

  // Full reset: kill process + clear session ID.
  async stop() {
    await this.abort();
    this._sessionId = null;
    this._binary    = null;
  }
}

module.exports = ClaudeCliSession;
