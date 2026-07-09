// Manages the conversation session for a given project directory using Antigravity CLI.
// Each send() spawns a fresh `agy --print` process; conversation continuity
// is maintained by the CLI itself via --continue.

const EventEmitter = require('events');
const { GeminiCliProcess } = require('./GeminiCliProcess');
const { GeminiCliParser } = require('./GeminiCliParser');
const E = require('./GeminiCliEvents');

class GeminiCliSession extends EventEmitter {
  constructor(projectPath, model) {
    super();
    this._projectPath = projectPath;
    this._model       = model;
    this._hasStarted  = false;
    this._activeProc  = null;
    this._aborted     = false;
    this._state       = 'idle';
  }

  getProjectPath() { return this._projectPath; }
  isActive()       { return !!(this._activeProc && this._activeProc.alive); }
  getState()       { return this._state; }

  _transition(newState) {
    this._state = newState;
    this.emit('state', newState);
    this.emit(E[newState.toUpperCase()] || newState);
  }

  async send(prompt, opts = {}) {
    if (this._activeProc && this._activeProc.alive) {
      console.warn('[gemini-cli] envio anterior ainda ativo — abortando antes do novo');
      await this.abort().catch(() => {});
    }

    this._aborted = false;
    this._transition('busy');

    return new Promise((resolve, reject) => {
      const parser = new GeminiCliParser({
        onConnected: ()     => {},
        onChunk:     (t)    => {
          this._transition('streaming');
          opts.onChunk && opts.onChunk(t);
        },
        onThinking:  (t)    => opts.onThinking && opts.onThinking(t),
        onToolStart: (info) => opts.onToolStart && opts.onToolStart(info),
        onDone: ({ text, thinking }) => {
          this._hasStarted = true;
          this._transition('waiting');
          opts.onDone && opts.onDone({ text, thinking });
          resolve({ text, thinking });
        },
        onError: (err) => {
          this._transition('error');
          if (this._aborted) {
            opts.onDone && opts.onDone({ text: '', thinking: '' });
            resolve({ text: '', thinking: '' });
            return;
          }
          opts.onError && opts.onError(err);
          reject(err);
        },
      });

      const proc = new GeminiCliProcess();
      this._activeProc = proc;

      proc.onData((chunk) => { parser.feed(chunk); });
      proc.onError((msg) => { console.warn('[gemini-cli] stderr:', msg); });
      proc.onClose((code, signal) => {
        parser.flush();
        this._activeProc = null;
        if (this._aborted) {
          this._transition('waiting');
          opts.onDone && opts.onDone({ text: '', thinking: '' });
          resolve({ text: '', thinking: '' });
          return;
        }
        if (code !== 0 && code !== null) {
          this._transition('error');
          const errMsg = `Antigravity CLI encerrou com código ${code}.`;
          const err = new Error(errMsg);
          opts.onError && opts.onError(err);
          reject(err);
        } else {
          // Process exited successfully
          this._hasStarted = true;
          this._transition('waiting');
          const text = parser._responseLines.join('\n').trim();
          const thinking = parser._thinkingLines.join('\n').trim();
          opts.onDone && opts.onDone({ text, thinking });
          resolve({ text, thinking });
        }
      });

      proc.start({
        cwd: this._projectPath,
        model: this._model,
        prompt,
        isContinue: this._hasStarted,
      }).catch((startErr) => {
        this._transition('error');
        this._activeProc = null;
        opts.onError && opts.onError(startErr);
        reject(startErr);
      });
    });
  }

  async abort() {
    if (this._activeProc) {
      this._aborted = true;
      await this._activeProc.kill().catch(() => {});
      this._activeProc = null;
    }
  }

  async stop() {
    await this.abort();
    this._hasStarted = false;
    this._transition('idle');
  }
}

module.exports = GeminiCliSession;
