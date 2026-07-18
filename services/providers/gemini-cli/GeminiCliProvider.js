// Public facade for the Gemini CLI provider.
// main.js talks exclusively to this module.
//
// Responsibilities:
//   - One session per project directory
//   - Session lifecycle: start on first use, stop on project change, stop on app quit
//   - Route send() calls to the active session
//   - Translate session events to Electron IPC events (eventSender)
//   - Return friendly errors for "not installed" / "auth" / "rate limit"

const path = require('path');
const fs = require('fs');
const GeminiCliSession = require('./GeminiCliSession');
const { GeminiCliProcess } = require('./GeminiCliProcess');
const { getModels, getDefaultModel } = require('./GeminiCliModels');
const E = require('./GeminiCliEvents');

let _backupDir = null;

function ensureBackupDir() {
  if (_backupDir) return _backupDir;
  const { app } = require('electron');
  _backupDir = path.join(app.getPath('userData'), 'gemini-cli-backups');
  if (!fs.existsSync(_backupDir)) fs.mkdirSync(_backupDir, { recursive: true });
  return _backupDir;
}

function makeBackupPath(filePath) {
  const safe = filePath.replace(/[/\\:]/g, '_');
  return path.join(ensureBackupDir(), `${safe}.${Date.now()}.bak`);
}

// Translates tool-start activity to a human readable label for the UI.
function summarizeTool({ label, detail }) {
  return detail ? `${label}: ${detail}` : label;
}

// Friendly error messages for common failure patterns.
function friendlyError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/not found|no such file|ENOENT/i.test(msg)) {
    return 'Antigravity CLI (agy) não está instalado. Instale com: npm install -g @google/antigravity-cli';
  }
  if (/auth|login|credential|token|unauthenticated/i.test(msg)) {
    return 'Autenticação/Configuração necessária. Execute no terminal: agy install';
  }
  if (/rate.?limit|quota|429/i.test(msg)) {
    return 'Limite de requisições atingido. Aguarde e tente novamente.';
  }
  if (/model.*(unavailable|not found)/i.test(msg)) {
    return 'Modelo Antigravity indisponível. Verifique o modelo nas configurações.';
  }
  if (/timeout/i.test(msg)) {
    return 'Tempo esgotado aguardando o Antigravity CLI. Tente novamente.';
  }
  return `Antigravity CLI: ${msg}`;
}

class GeminiCliProvider {
  constructor() {
    // projectPath → GeminiCliSession
    this._sessions = new Map();
    this._model = getDefaultModel();
    this._pendingBackups = new Map();
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
  async send(prompt, projectPath, sender, sessionId, history = []) {
    const cwd = projectPath || process.cwd();

    // If project changed, stop old session
    await this._ensureSessionForProject(cwd);

    const session = this._sessions.get(cwd);
    
    // Set the sessionId so it can coordinate continuation/history
    if (session.setSessionId) {
      session.setSessionId(sessionId);
    }

    // Emit "busy" to UI
    this._emitStatus(sender, { state: 'busy', projectPath: cwd });

    // Reseta estado de turno anterior que pode ter ficado preso por abort
    this._thinkingEmitted = false;

    // Toda emissão de agentic-phase-update carrega sessionId:cwd — o botão
    // "Interromper" da UI só chama stopAgenticWorkflow se `activeAgenticSession`
    // (setado a partir desse campo) for truthy. Sem ele, o clique não fazia
    // NADA (o handler nem chegava a mandar o abort pro processo do CLI).
    const safeClose = (isError) => {
      if (this._thinkingEmitted) {
        this._thinkingEmitted = false;
        try { sender.send('agentic-phase-update', { phase: isError ? 'error' : 'completed', status: isError ? 'Erro' : 'Concluído', thinking: thinkingAccumulated, sessionId: cwd }); } catch (_) {}
      }
      try { sender.send('gemini-stream-complete'); } catch (_) {}
    };

    return new Promise((resolve, reject) => {
      let accumulated = '';
      let thinkingAccumulated = '';
      let activityId = 0;
      let tokenInfo = { thinking: 0, outputChars: 0 };

      // Emit an initial thinking state immediately so the screen doesn't stay blank
      try {
        this._thinkingEmitted = true;
        sender.send('agentic-phase-update', { phase: 'thinking', status: 'Iniciando agente…', thinking: '', sessionId: cwd });
      } catch (_) {}

      const emitProgress = (force) => {
        const now = Date.now();
        if (!force && this._lastThinkingUpdate && now - this._lastThinkingUpdate < 400) return;
        this._lastThinkingUpdate = now;
        this._thinkingEmitted = true;
        
        const outputEstimate = Math.round((tokenInfo.outputChars || 0) / 4);
        const totalTok = (tokenInfo.thinking || 0) + outputEstimate;
        const snippet = thinkingAccumulated ? thinkingAccumulated.replace(/\s+/g, ' ').trim().slice(-140) : '';
        const tokenPart = totalTok > 0 ? ` (~${totalTok} tokens)` : '';
        const status = (snippet || 'Pensando…') + tokenPart;
        try {
          sender.send('agentic-phase-update', { phase: 'thinking', status, thinking: thinkingAccumulated, sessionId: cwd });
        } catch (_) {}
      };

      session.send(prompt, {
        history,
        onChunk: (chunk) => {
          accumulated += chunk;
          tokenInfo.outputChars = accumulated.length;
          sender.send('gemini-stream-chunk', chunk);
          this._emitStatus(sender, { state: 'streaming' });
          emitProgress();
        },

        onThinking: (text) => {
          thinkingAccumulated += text + '\n';
          this._thinkingEmitted = true;
          emitProgress();
        },

        onToolStart: (toolInfo) => {
          const id = toolInfo.id || `gcli-${++activityId}`;
          // UI verifica data.phase (não data.state)
          sender.send('ai-tool-activity', {
            id,
            phase: 'start',
            label: summarizeTool(toolInfo),
          });
        },

        onToolDone: (toolInfo) => {
          const id = toolInfo.id;
          if (id) {
            sender.send('ai-tool-activity', {
              id,
              phase: 'done',
              label: summarizeTool(toolInfo),
            });
          }
        },

        onFileTool: ({ id, name, filePath, phase }) => {
          const absPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(cwd, filePath);

          if (phase === 'before') {
            try {
              const backupPath = makeBackupPath(absPath);
              const existed = fs.existsSync(absPath);
              let content = '';
              
              if (existed) {
                // Tenta obter o conteúdo original do git (estado do index/staged)
                // para evitar backups idênticos se o CLI já tiver modificado o arquivo
                // antes da nossa leitura periódica do transcript.
                try {
                  const execSync = require('child_process').execSync;
                  const relPath = path.relative(cwd, absPath);
                  content = execSync(`git show :"${relPath}"`, { cwd, stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).toString('utf8');
                } catch (_) {
                  // Fallback para leitura direta do disco
                  content = fs.readFileSync(absPath, 'utf8');
                }
              }
              
              fs.writeFileSync(backupPath, content, 'utf8');
              this._pendingBackups.set(id, { filePath: absPath, backupPath, existed });
            } catch (e) {
              console.warn('[gemini-cli] backup falhou para', absPath, e.message);
            }
          } else if (phase === 'after') {
            const backup = this._pendingBackups.get(id);
            if (backup) {
              this._pendingBackups.delete(id);
              sender.send('workspace-file-written', {
                action:   backup.existed ? 'edit' : 'create',
                path:     backup.filePath,
                backupAt: backup.backupPath,
              });
              try { sender.send('file-mutated', { path: backup.filePath, origin: 'gemini-cli' }); } catch (_) {}
            }
          }
        },

        onTokenUpdate: (info) => {
          tokenInfo.thinking = info.thinking;
          tokenInfo.outputChars = accumulated.length;
          emitProgress();
        },

        onDone: ({ text, thinking }) => {
          safeClose(false);
          this._emitStatus(sender, { state: 'waiting', projectPath: cwd });
          resolve({ text: text || accumulated, thinking: thinking || thinkingAccumulated });
        },

        onError: (err) => {
          safeClose(true);
          const msg = friendlyError(err);
          try { sender.send('transcription-error', msg); } catch (_) {}
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
