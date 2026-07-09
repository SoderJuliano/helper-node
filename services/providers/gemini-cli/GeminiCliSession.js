// Manages the conversation session for a given project directory using Antigravity CLI.
// Each send() spawns a fresh `agy --print` process; conversation continuity
// is maintained by the CLI itself via --continue.

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const { GeminiCliProcess } = require('./GeminiCliProcess');
const { GeminiCliParser } = require('./GeminiCliParser');
const E = require('./GeminiCliEvents');

function getSessionStatePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'gemini-cli-sessions.json');
}

function loadSessions() {
  try {
    const file = getSessionStatePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('[gemini-cli] failed to load sessions:', e.message);
  }
  return {};
}

function saveSessions(sessions) {
  try {
    const file = getSessionStatePath();
    fs.writeFileSync(file, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[gemini-cli] failed to save sessions:', e.message);
  }
}

class GeminiCliSession extends EventEmitter {
  constructor(projectPath, model) {
    super();
    this._projectPath = projectPath;
    this._model       = model;
    this._sessionId   = null;
    this._hasStarted  = false;
    this._activeProc  = null;
    this._aborted     = false;
    this._state       = 'idle';
  }

  setSessionId(sessionId) {
    if (this._sessionId !== sessionId) {
      console.log(`[gemini-cli][${this._projectPath}] sessionId changed from ${this._sessionId} to ${sessionId}. Re-evaluating CLI session state.`);
      this._sessionId = sessionId;
      
      const sessions = loadSessions();
      const saved = sessions[this._projectPath];
      
      if (saved && saved.sessionId === sessionId) {
        console.log(`[gemini-cli][${this._projectPath}] sessionId matches last saved session. Restoring CLI continuation state.`);
        this._hasStarted = true;
      } else {
        console.log(`[gemini-cli][${this._projectPath}] sessionId is new/mismatched. Resetting CLI continuation state (will rehydrate).`);
        this._hasStarted = false;
      }
      
      if (this._activeProc) {
        this.abort().catch(() => {});
      }
    }
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

    const history = opts.history || [];
    const isContinue = this._hasStarted;
    
    let finalPrompt = prompt;
    if (!isContinue && history.length > 0) {
      // Reidratação inteligente do contexto: últimas 6 mensagens
      const historyLimit = 6;
      let historyContext = "=== RECONSTRUÇÃO DO CONTEXTO DA CONVERSA ===\n";
      const messagesToInclude = history.slice(-historyLimit);
      const omittedCount = history.length - messagesToInclude.length;
      
      if (omittedCount > 0) {
        historyContext += `[Mensagens anteriores omitidas para economizar contexto: ${omittedCount} mensagens]\n\n`;
      }
      
      for (const msg of messagesToInclude) {
        const roleName = msg.role === 'user' ? 'Usuário' : 'IA';
        historyContext += `[${roleName}]: ${msg.content}\n\n`;
      }
      
      historyContext += "=== FIM DO CONTEXTO ===\n\nUse as informações acima como contexto para a próxima instrução. Não responda ao histórico, apenas use-o como base para a instrução atual.\n\nInstrução atual: ";
      finalPrompt = historyContext + prompt;
    }

    return new Promise((resolve, reject) => {
      let completed = false;

      const parser = new GeminiCliParser({
        onConnected: ()     => {},
        onChunk:     (t)    => {
          this._transition('streaming');
          opts.onChunk && opts.onChunk(t);
        },
        onThinking:  (t)    => opts.onThinking && opts.onThinking(t),
        onThinkingChunk: (t) => opts.onThinking && opts.onThinking(t),
        onToolStart: (info) => opts.onToolStart && opts.onToolStart(info),
        onToolDone:  (info) => opts.onToolDone && opts.onToolDone(info),
        onFileTool:  (info) => opts.onFileTool && opts.onFileTool(info),
        onTokenUpdate: (info) => opts.onTokenUpdate && opts.onTokenUpdate(info),
        onDone: ({ text, thinking }) => {
          if (completed) return;
          completed = true;

          this._hasStarted = true;
          if (this._sessionId) {
            const sessions = loadSessions();
            sessions[this._projectPath] = {
              sessionId: this._sessionId,
              lastUsed: Date.now()
            };
            saveSessions(sessions);
          }

          this._transition('waiting');
          opts.onDone && opts.onDone({ text, thinking });
          resolve({ text, thinking });
        },
        onError: (err) => {
          if (completed) return;
          completed = true;

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
      proc.onStderr((chunk) => { parser.feedStderr(chunk); });
      proc.onStdoutEnd(() => {
        console.log('[gemini-cli] stdout end - flushing parser');
        parser.flush();
      });
      proc.onError((msg) => { console.warn('[gemini-cli] proc error:', msg); });
      proc.onClose((code, signal) => {
        parser.flush();
        this._activeProc = null;
        if (this._aborted) {
          if (completed) return;
          completed = true;
          this._transition('waiting');
          opts.onDone && opts.onDone({ text: '', thinking: '' });
          resolve({ text: '', thinking: '' });
          return;
        }
        if (code !== 0 && code !== null) {
          if (completed) return;
          completed = true;
          this._transition('error');
          const errMsg = `Antigravity CLI encerrou com código ${code}.`;
          const err = new Error(errMsg);
          opts.onError && opts.onError(err);
          reject(err);
        } else {
          if (completed) return;
          completed = true;

          // Process exited successfully
          this._hasStarted = true;
          if (this._sessionId) {
            const sessions = loadSessions();
            sessions[this._projectPath] = {
              sessionId: this._sessionId,
              lastUsed: Date.now()
            };
            saveSessions(sessions);
          }

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
        prompt: finalPrompt,
        isContinue,
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
    const sessions = loadSessions();
    delete sessions[this._projectPath];
    saveSessions(sessions);
    this._transition('idle');
  }
}

module.exports = GeminiCliSession;
