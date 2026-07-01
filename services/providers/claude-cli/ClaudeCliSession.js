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
  // opts: { model, onChunk, onThinking, onToolStart, onToolDone, onFileTool, onDone, onError }
  async send(prompt, opts = {}) {
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
      const parser = new ClaudeCliParser({
        onSessionId: (id)   => { this._sessionId = id; },
        onConnected: ()     => {},
        onChunk:     (t)    => opts.onChunk    && opts.onChunk(t),
        onThinking:  (t)    => opts.onThinking && opts.onThinking(t),
        onToolStart: (info) => opts.onToolStart && opts.onToolStart(info),
        onToolDone:  (info) => opts.onToolDone && opts.onToolDone(info),
        onFileTool:  (info) => opts.onFileTool && opts.onFileTool(info),
        onDone: ({ text, cost, sessionId }) => {
          if (sessionId) this._sessionId = sessionId;
          this._activeProc = null;
          opts.onDone && opts.onDone({ text, cost });
          resolve({ text, cost });
        },
        onError: (err) => {
          this._activeProc = null;
          opts.onError && opts.onError(err);
          reject(err);
        },
      });

      const proc = new ClaudeCliProcess();
      this._activeProc = proc;

      proc.onData((chunk) => parser.feed(chunk));
      proc.onClose((code) => {
        parser.flush();
        // If process closed without emitting result (e.g. crash/auth error)
        if (proc.alive === false && this._activeProc === proc) {
          this._activeProc = null;
          const errMsg = code !== 0
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
        this._activeProc = null;
        opts.onError && opts.onError(startErr);
        reject(startErr);
      });
    });
  }

  // Abort any in-progress send.
  async abort() {
    if (this._activeProc) {
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
