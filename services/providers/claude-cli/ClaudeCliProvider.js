// Public facade for the Claude Code CLI provider.
// main.js talks exclusively to this module.
//
// Architecture:
//   - One ClaudeCliSession per project directory (keyed by path)
//   - File edits detected via onFileTool → backup taken → diff emitted after edit
//   - Stream events forwarded to renderer via event.sender IPC

const path = require('path');
const fs   = require('fs');
const ClaudeCliSession = require('./ClaudeCliSession');
const { ClaudeCliProcess } = require('./ClaudeCliProcess');
const { getModels, getDefaultModel } = require('./ClaudeCliModels');

let _backupDir = null;

function ensureBackupDir() {
  if (_backupDir) return _backupDir;
  const { app } = require('electron');
  _backupDir = path.join(app.getPath('userData'), 'claude-cli-backups');
  if (!fs.existsSync(_backupDir)) fs.mkdirSync(_backupDir, { recursive: true });
  return _backupDir;
}

function makeBackupPath(filePath) {
  const safe = filePath.replace(/[/\\:]/g, '_');
  return path.join(ensureBackupDir(), `${safe}.${Date.now()}.bak`);
}

function friendlyError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/not found|ENOENT|no such/i.test(msg))
    return 'Claude Code CLI não instalado. Execute: npm install -g @anthropic-ai/claude-code';
  // Match auth errors but not the generic "se não estiver autenticado" message from onClose
  if (/\b(401|unauthorized|ANTHROPIC_API_KEY)\b|claude auth login$|authentication required/i.test(msg))
    return 'Autenticação necessária. Execute: claude auth login';
  if (/rate.?limit|429|quota/i.test(msg))
    return 'Rate limit atingido. Aguarde e tente novamente.';
  if (/model.*not.*(found|available)|invalid.*model/i.test(msg))
    return 'Modelo Claude indisponível. Verifique nas configurações.';
  if (/timeout/i.test(msg))
    return 'Tempo esgotado aguardando o Claude CLI.';
  return `Claude CLI: ${msg}`;
}

class ClaudeCliProvider {
  constructor() {
    this._sessions = new Map(); // projectPath → ClaudeCliSession
    this._model    = getDefaultModel();
    // In-flight file backups: tool_use_id → { filePath, backupPath }
    this._pendingBackups = new Map();
  }

  setModel(model) { this._model = model || getDefaultModel(); }
  getModel()      { return this._model; }
  getModels()     { return getModels(); }

  // Main entry point called from main.js.
  async send(prompt, projectPath, sender) {
    const cwd = projectPath || process.cwd();
    const session = this._getOrCreateSession(cwd);

    this._emitStatus(sender, { state: 'busy', projectPath: cwd });

    let activityId = 0;

    return new Promise((resolve, reject) => {
      session.send(prompt, {
        model: this._model,

        onChunk: (chunk) => {
          sender.send('gemini-stream-chunk', chunk);
          this._emitStatus(sender, { state: 'streaming' });
        },

        onThinking: (text) => {
          if (!this._thinkingEmitted) {
            this._thinkingEmitted = true;
            // UI espera { phase, status } — emite só uma vez como indicador
            sender.send('agentic-phase-update', { phase: 'thinking', status: '🧠 Pensando…' });
          }
        },

        onToolStart: ({ id, name, label }) => {
          activityId++;
          const actId = `ccli-${activityId}`;
          if (!this._activityIds) this._activityIds = new Map();
          this._activityIds.set(id, actId);
          // UI verifica data.phase (não data.state)
          sender.send('ai-tool-activity', { id: actId, phase: 'start', label });
        },

        onToolDone: ({ id, label, isError }) => {
          const actId = this._activityIds && this._activityIds.get(id);
          if (actId) {
            sender.send('ai-tool-activity', { id: actId, phase: isError ? 'error' : 'done', label });
            this._activityIds.delete(id);
          }
        },

        // Called BEFORE (phase:'before') and AFTER (phase:'after') a file edit tool.
        onFileTool: ({ id, name, filePath, phase }) => {
          const absPath = path.isAbsolute(filePath)
            ? filePath
            : path.join(cwd, filePath);

          if (phase === 'before') {
            // Read current file content as backup
            try {
              const backupPath = makeBackupPath(absPath);
              const content = fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf8') : '';
              fs.writeFileSync(backupPath, content, 'utf8');
              this._pendingBackups.set(id, { filePath: absPath, backupPath });
            } catch (e) {
              console.warn('[claude-cli] backup falhou para', absPath, e.message);
            }
          } else if (phase === 'after') {
            const backup = this._pendingBackups.get(id);
            if (backup) {
              this._pendingBackups.delete(id);
              // Emit workspace-file-written so the diff viewer in index.html opens on click
              sender.send('workspace-file-written', {
                path:       backup.filePath,
                backupPath: backup.backupPath,
                backup:     true,
              });
            }
          }
        },

        onDone: ({ text, cost }) => {
          // Fecha o indicador de thinking se foi aberto
          if (this._thinkingEmitted) {
            this._thinkingEmitted = false;
            sender.send('agentic-phase-update', { phase: 'completed', status: 'Concluído' });
          }
          sender.send('gemini-stream-complete');
          this._emitStatus(sender, { state: 'done', projectPath: cwd });
          if (cost > 0) console.log(`[claude-cli] custo: $${cost.toFixed(6)}`);
          resolve({ text });
        },

        onError: (err) => {
          const msg = friendlyError(err);
          sender.send('transcription-error', msg);
          this._emitStatus(sender, { state: 'error', error: msg });
          reject(new Error(msg));
        },
      }).catch(reject);
    });
  }

  // Aborta o processo em curso para um projeto (chamado pelo botão interromper).
  async abortCurrent(projectPath) {
    const session = this._sessions.get(projectPath);
    if (session) {
      await session.abort().catch(() => {});
      console.log(`[claude-cli] abortado: ${projectPath}`);
    }
  }

  // Called when the user changes project.
  async changeProject(oldPath, newPath) {
    if (oldPath && this._sessions.has(oldPath)) {
      await this._sessions.get(oldPath).stop().catch(() => {});
      this._sessions.delete(oldPath);
      console.log(`[claude-cli] session closed: ${oldPath}`);
    }
    console.log(`[claude-cli] ready for: ${newPath}`);
  }

  // Called on app quit.
  async shutdown() {
    const tasks = [];
    for (const [, session] of this._sessions) {
      tasks.push(session.stop().catch(() => {}));
    }
    await Promise.all(tasks);
    this._sessions.clear();
    console.log('[claude-cli] all sessions closed');
  }

  async checkInstalled() {
    return ClaudeCliProcess.checkInstalled();
  }

  // ── internal ─────────────────────────────────────────────────────────────

  _getOrCreateSession(cwd) {
    if (!this._sessions.has(cwd)) {
      // Close any session for other directories
      for (const [p, s] of this._sessions) {
        if (p !== cwd) { s.stop().catch(() => {}); this._sessions.delete(p); }
      }
      this._sessions.set(cwd, new ClaudeCliSession(cwd));
    }
    return this._sessions.get(cwd);
  }

  _emitStatus(sender, payload) {
    try { sender.send('claude-cli-status', payload); } catch (_) {}
  }
}

module.exports = new ClaudeCliProvider();
