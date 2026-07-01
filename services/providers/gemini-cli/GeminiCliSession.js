// One session = one `gemini` CLI process tied to one project directory.
// Owns the process lifecycle and state machine.
//
// States:
//   idle       → initial, process not started
//   starting   → process spawning
//   connected  → process ready (initial prompt seen)
//   waiting    → ready for next input
//   busy       → prompt sent, waiting for response to start
//   streaming  → receiving response chunks
//   error      → unrecoverable error (caller should check getError())
//   restarting → crashed, trying to bring back up
//   closed     → permanently terminated (do not reuse)

const EventEmitter = require('events');
const { GeminiCliProcess } = require('./GeminiCliProcess');
const { GeminiCliParser } = require('./GeminiCliParser');
const E = require('./GeminiCliEvents');

const STATES = ['idle', 'starting', 'connected', 'waiting', 'busy', 'streaming', 'error', 'restarting', 'closed'];
const MAX_RESTART_ATTEMPTS = 2;
const CONNECT_TIMEOUT_MS = 15_000; // wait up to 15s for initial prompt

class GeminiCliSession extends EventEmitter {
  constructor(projectPath, model) {
    super();
    this._projectPath = projectPath;
    this._model       = model;
    this._state       = 'idle';
    this._proc        = null;
    this._parser      = null;
    this._lastError   = null;
    this._restartCount = 0;
    // Queue of pending sends while not yet connected
    this._pendingSend = null;
    this._connectResolve = null;
    this._connectReject  = null;
    this._connectTimer   = null;
  }

  // ── public API ──────────────────────────────────────────────────────────────

  getState()       { return this._state; }
  getProjectPath() { return this._projectPath; }
  getError()       { return this._lastError; }

  // Starts the process if not already running. Returns once connected.
  async start() {
    if (this._state === 'closed') throw new Error('Session is closed');
    if (this._state !== 'idle')  return; // already starting/started

    this._transition('starting');
    await this._boot();
  }

  // Sends a prompt and streams the response.
  // opts: { onChunk, onThinking, onToolStart, onToolDone, onDone, onError }
  async send(prompt, opts = {}) {
    if (this._state === 'closed') {
      opts.onError && opts.onError(new Error('Session is closed'));
      return;
    }
    if (this._state === 'idle') {
      await this.start();
    }
    if (this._state === 'starting' || this._state === 'restarting') {
      await this._waitConnected();
    }
    if (this._state === 'error') {
      opts.onError && opts.onError(this._lastError || new Error('Session in error state'));
      return;
    }

    this._transition('busy');
    this._wireParserCallbacks(opts);
    this._proc.send(prompt);
  }

  // Gracefully terminate this session.
  async stop() {
    if (this._state === 'closed') return;
    this._transition('closed');
    this._clearConnectTimer();
    if (this._proc) {
      await this._proc.kill();
      this._proc = null;
    }
  }

  // ── internal ────────────────────────────────────────────────────────────────

  _transition(newState) {
    if (!STATES.includes(newState)) throw new Error(`Unknown state: ${newState}`);
    this._state = newState;
    this.emit('state', newState);
    this.emit(E[newState.toUpperCase()] || newState);
  }

  async _boot() {
    this._proc   = new GeminiCliProcess();
    this._parser = new GeminiCliParser({
      onConnected:    () => this._onConnected(),
      onChunk:        (t) => this.emit(E.CHUNK, t),
      onThinkingChunk:(t) => this.emit(E.THINKING, t),
      onToolStart:    (d) => this.emit(E.TOOL_START, d),
      onDone:         (d) => this._onResponseDone(d),
    });

    this._proc.onData((chunk) => this._parser.feed(chunk));
    this._proc.onError((msg)  => console.warn('[gemini-cli] stderr:', msg));
    this._proc.onClose((code, signal) => this._onProcClose(code, signal));

    try {
      await this._proc.start(this._projectPath, this._model);
    } catch (err) {
      this._lastError = err;
      this._transition('error');
      this._rejectConnect(err);
      throw err;
    }

    // Start timeout for initial connection
    this._connectTimer = setTimeout(() => {
      if (this._state === 'starting') {
        // Treat timeout as "connected" — the CLI may not show a standard prompt
        console.warn('[gemini-cli] connect timeout — assuming connected');
        this._onConnected();
      }
    }, CONNECT_TIMEOUT_MS);
  }

  _onConnected() {
    this._clearConnectTimer();
    this._restartCount = 0;
    this._transition('waiting');
    this._resolveConnect();
  }

  _onResponseDone({ text, thinking }) {
    this._transition('waiting');
    this.emit(E.RESPONSE, { text, thinking });
    this.emit(E.WAITING);
  }

  _onProcClose(code, signal) {
    this._parser && this._parser.flush();

    if (this._state === 'closed') return; // intentional shutdown
    if (this._state === 'error')  return; // already handled

    const msg = `Gemini CLI encerrou inesperadamente (code=${code}, signal=${signal})`;
    console.error('[gemini-cli]', msg);
    this._lastError = new Error(msg);
    this._transition('error');
    this._rejectConnect(this._lastError);
  }

  _wireParserCallbacks(opts) {
    // Temporarily redirect parser output to the caller's callbacks.
    // We reassign once per send() and the parser calls them per-response.
    if (!this._parser) return;
    if (opts.onChunk)     this._parser._cb.onChunk     = (t) => { opts.onChunk(t); };
    if (opts.onThinking)  this._parser._cb.onThinkingChunk = (t) => { opts.onThinking(t); };
    if (opts.onToolStart) this._parser._cb.onToolStart = (d) => { opts.onToolStart(d); };

    this._parser._cb.onDone = ({ text, thinking }) => {
      this._transition('waiting');
      opts.onDone && opts.onDone({ text, thinking });
    };
  }

  // Returns a promise that resolves when the session reaches 'waiting'
  _waitConnected() {
    if (this._state === 'waiting') return Promise.resolve();
    return new Promise((resolve, reject) => {
      this._connectResolve = resolve;
      this._connectReject  = reject;
    });
  }

  _resolveConnect() {
    if (this._connectResolve) { this._connectResolve(); this._connectResolve = null; this._connectReject = null; }
  }

  _rejectConnect(err) {
    if (this._connectReject) { this._connectReject(err); this._connectResolve = null; this._connectReject = null; }
  }

  _clearConnectTimer() {
    if (this._connectTimer) { clearTimeout(this._connectTimer); this._connectTimer = null; }
  }
}

module.exports = GeminiCliSession;
