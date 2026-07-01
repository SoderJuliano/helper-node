// Public facade for the Gemini CLI provider.
// main.js talks exclusively to this module.
//
// Responsibilities:
//   - One session per project directory
//   - Session lifecycle: start on first use, stop on project change, stop on app quit
//   - Route send() calls to the active session
//   - Translate session events to Electron IPC events (eventSender)
//   - Return friendly errors for "not installed" / "auth" / "rate limit"

const GeminiCliSession = require('./GeminiCliSession');
const { GeminiCliProcess } = require('./GeminiCliProcess');
const { getModels, getDefaultModel } = require('./GeminiCliModels');
const E = require('./GeminiCliEvents');

// Translates tool-start activity to a human readable label for the UI.
function summarizeTool({ label, detail }) {
  return detail ? `${label}: ${detail}` : label;
}

// Friendly error messages for common failure patterns.
function friendlyError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/not found|no such file|ENOENT/i.test(msg)) {
    return 'Gemini CLI não está instalado. Execute: npm install -g @google/gemini-cli';
  }
  if (/auth|login|credential|token|unauthenticated/i.test(msg)) {
    return 'Autenticação necessária. Execute no terminal: gemini auth login';
  }
  if (/rate.?limit|quota|429/i.test(msg)) {
    return 'Limite de requisições atingido. Aguarde e tente novamente.';
  }
  if (/model.*(unavailable|not found)/i.test(msg)) {
    return 'Modelo Gemini indisponível. Verifique o modelo nas configurações.';
  }
  if (/timeout/i.test(msg)) {
    return 'Tempo esgotado aguardando o Gemini CLI. Tente novamente.';
  }
  return `Gemini CLI: ${msg}`;
}

class GeminiCliProvider {
  constructor() {
    // projectPath → GeminiCliSession
    this._sessions = new Map();
    this._model = getDefaultModel();
  }

  setModel(model) {
    this._model = model || getDefaultModel();
  }

  getModel() {
    return this._model;
  }

  getModels() {
    return getModels();
  }

  // Main entry point called by main.js.
  // prompt:      string
  // projectPath: absolute directory the CLI should run in
  // sender:      Electron webContents (event.sender) — we emit IPC events through it
  async send(prompt, projectPath, sender) {
    const cwd = projectPath || process.cwd();

    // If project changed, stop old session
    await this._ensureSessionForProject(cwd);

    const session = this._sessions.get(cwd);

    // Emit "busy" to UI
    this._emitStatus(sender, { state: 'busy', projectPath: cwd });

    return new Promise((resolve, reject) => {
      let accumulated = '';
      let thinkingAccumulated = '';
      let activityId = 0;

      session.send(prompt, {
        onChunk: (chunk) => {
          accumulated += chunk;
          sender.send('gemini-stream-chunk', chunk);
          this._emitStatus(sender, { state: 'streaming' });
        },

        onThinking: (text) => {
          thinkingAccumulated += text + '\n';
          if (!this._thinkingEmitted) {
            this._thinkingEmitted = true;
            // Mostra indicador de thinking — UI espera { phase, status }
            sender.send('agentic-phase-update', { phase: 'thinking', status: '🧠 Pensando…' });
          }
        },

        onToolStart: (toolInfo) => {
          activityId++;
          // UI verifica data.phase (não data.state)
          sender.send('ai-tool-activity', {
            id: `gcli-${activityId}`,
            phase: 'start',
            label: summarizeTool(toolInfo),
          });
        },

        onDone: ({ text, thinking }) => {
          // Fecha o indicador de thinking se foi aberto
          if (this._thinkingEmitted) {
            this._thinkingEmitted = false;
            sender.send('agentic-phase-update', { phase: 'completed', status: 'Concluído' });
          }
          sender.send('gemini-stream-complete');
          this._emitStatus(sender, { state: 'waiting', projectPath: cwd });
          resolve({ text: text || accumulated, thinking: thinking || thinkingAccumulated });
        },

        onError: (err) => {
          const msg = friendlyError(err);
          sender.send('transcription-error', msg);
          this._emitStatus(sender, { state: 'error', error: msg });
          reject(new Error(msg));
        },
      });
    });
  }

  // Aborta o processo em curso para um projeto (chamado pelo botão interromper).
  async abortCurrent(projectPath) {
    const session = this._sessions.get(projectPath);
    if (session) {
      await session.stop().catch(() => {});
      console.log(`[gemini-cli] abortado: ${projectPath}`);
    }
  }

  // Change active project: stop old session and prepare for new one.
  async changeProject(oldPath, newPath) {
    if (oldPath && this._sessions.has(oldPath)) {
      console.log(`[gemini-cli] closing session for ${oldPath}`);
      await this._sessions.get(oldPath).stop();
      this._sessions.delete(oldPath);
    }
    // New session will start lazily on first send()
    console.log(`[gemini-cli] ready for new project: ${newPath}`);
  }

  // Terminate all active sessions (called on app quit).
  async shutdown() {
    const pending = [];
    for (const [, session] of this._sessions) {
      pending.push(session.stop().catch(() => {}));
    }
    await Promise.all(pending);
    this._sessions.clear();
    console.log('[gemini-cli] all sessions closed');
  }

  // Check if the binary is available (called by config UI).
  async checkInstalled() {
    return GeminiCliProcess.checkInstalled();
  }

  // ── internal ─────────────────────────────────────────────────────────────

  async _ensureSessionForProject(cwd) {
    if (this._sessions.has(cwd)) return;

    // Shutdown any sessions for OTHER directories (one at a time)
    for (const [path, session] of this._sessions) {
      if (path !== cwd) {
        await session.stop().catch(() => {});
        this._sessions.delete(path);
      }
    }

    const session = new GeminiCliSession(cwd, this._model);
    this._sessions.set(cwd, session);

    // Propagate session errors to console (UI errors are handled per-send)
    session.on('state', (s) => {
      console.log(`[gemini-cli][${cwd}] state → ${s}`);
    });
  }

  _emitStatus(sender, payload) {
    try {
      sender.send('gemini-cli-status', payload);
    } catch (_) { /* renderer may be gone */ }
  }
}

// Singleton — main.js uses one instance for the lifetime of the app.
module.exports = new GeminiCliProvider();
