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
    const os = require('os');
    const fs = require('fs');
    let cwd = projectPath;
    if (!cwd || cwd === '/' || !fs.existsSync(cwd)) {
      cwd = (process.cwd() && process.cwd() !== '/') ? process.cwd() : os.homedir();
    }
    const session = this._getOrCreateSession(cwd);

    this._emitStatus(sender, { state: 'busy', projectPath: cwd });

    // Reseta estado de turno anterior que pode ter ficado preso por abort
    this._thinkingEmitted = false;
    this._thinkingBuf = '';
    this._lastProgressUpdate = 0;
    this._tokenInfo = { thinking: 0, outputChars: 0 };
    this._activityIds = new Map();

    let activityId = 0;

    // Toda emissão de agentic-phase-update carrega sessionId:cwd — o botão
    // "Interromper" da UI só chama stopAgenticWorkflow se `activeAgenticSession`
    // (setado a partir desse campo) for truthy. Sem ele, o clique não fazia
    // NADA (o handler nem chegava a mandar o abort pro processo do CLI).
    const safeClose = (isError, extraStatus) => {
      // Garante que o loading sempre fecha, mesmo em erros inesperados
      if (this._thinkingEmitted) {
        this._thinkingEmitted = false;
        const status = isError ? 'Erro' : (extraStatus || 'Concluído');
        try { sender.send('agentic-phase-update', { phase: 'completed', status, sessionId: cwd }); } catch (_) {}
      }
      try { sender.send('gemini-stream-complete'); } catch (_) {}
    };

    // Emissor único (throttle 400ms) que combina o trecho de raciocínio (se
    // houver) com a contagem de tokens ao vivo — assim a tela nunca fica
    // estática: mesmo sem thinking visível, o contador de tokens sobe durante
    // a geração de texto, provando que o processo está vivo.
    const emitProgress = (force) => {
      const now = Date.now();
      if (!force && this._lastProgressUpdate && now - this._lastProgressUpdate < 400) return;
      this._lastProgressUpdate = now;
      this._thinkingEmitted = true;
      const outputEstimate = Math.round((this._tokenInfo.outputChars || 0) / 4);
      const totalTok = (this._tokenInfo.thinking || 0) + outputEstimate;
      const snippet = this._thinkingBuf ? this._thinkingBuf.replace(/\s+/g, ' ').trim().slice(-140) : '';
      const tokenPart = totalTok > 0 ? ` (~${totalTok} tokens)` : '';
      const status = (snippet || 'Gerando resposta…') + tokenPart;
      try { sender.send('agentic-phase-update', { phase: 'thinking', status, sessionId: cwd }); } catch (_) {}
    };

    return new Promise((resolve, reject) => {
      session.send(prompt, {
        model: this._model,

        onChunk: (chunk) => {
          sender.send('gemini-stream-chunk', chunk);
          this._emitStatus(sender, { state: 'streaming' });
        },

        // Status de espera/retry (API sobrecarregada, watchdog) → visível na UI
        // no mesmo canal do thinking, pra tela nunca ficar estática sem explicação.
        onStatus: (msg) => {
          this._thinkingEmitted = true;
          try { sender.send('agentic-phase-update', { phase: 'thinking', status: msg, sessionId: cwd }); } catch (_) {}
        },

        // Limite de uso/créditos (rate_limit_event do CLI). status !== 'allowed'
        // é a causa real de travamentos silenciosos "sem erro nenhum" — a API
        // simplesmente pausa até o limite liberar. Mostra isso na hora, sem
        // esperar o watchdog de 45s do stall detector.
        onRateLimit: (info) => {
          if (info && info.status && info.status !== 'allowed') {
            const kind = info.rateLimitType ? ` (${info.rateLimitType})` : '';
            emitProgress(true);
            this._thinkingEmitted = true;
            try {
              sender.send('agentic-phase-update', {
                phase: 'thinking',
                status: `Limite de uso atingido${kind}: ${info.status} — aguardando liberação…`,
                sessionId: cwd,
              });
            } catch (_) {}
          }
        },

        // Contagem de tokens ao vivo: thinking = número real reportado pelo
        // CLI; outputChars = tamanho acumulado do texto de resposta (estimado
        // em tokens ~chars/4). Não é token a token, mas dá amostras visíveis.
        onTokenUpdate: ({ thinking, outputChars }) => {
          this._tokenInfo = { thinking, outputChars };
          emitProgress();
        },

        onThinking: (text) => {
          this._thinkingBuf = (this._thinkingBuf || '') + text;
          emitProgress();
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
              const existed = fs.existsSync(absPath);
              const content = existed ? fs.readFileSync(absPath, 'utf8') : '';
              fs.writeFileSync(backupPath, content, 'utf8');
              this._pendingBackups.set(id, { filePath: absPath, backupPath, existed });
            } catch (e) {
              console.warn('[claude-cli] backup falhou para', absPath, e.message);
            }
          } else if (phase === 'after') {
            const backup = this._pendingBackups.get(id);
            if (backup) {
              this._pendingBackups.delete(id);
              // Emit workspace-file-written so the diff viewer in index.html opens on click.
              // Campo é `backupAt` (convenção usada em writeFile.js/patchFile.js) — chamar
              // de `backupPath` aqui fazia o diff comparar contra "" (tudo virava "add").
              sender.send('workspace-file-written', {
                action:   backup.existed ? 'edit' : 'create',
                path:     backup.filePath,
                backupAt: backup.backupPath,
              });
              // Canal genérico do editor: se o humano tiver esse arquivo aberto
              // agora, vê o indicativo de concorrência em tempo real.
              try { sender.send('file-mutated', { path: backup.filePath, origin: 'claude-cli' }); } catch (_) {}
            }
          }
        },

        onDone: ({ text, cost, usage }) => {
          let extra;
          if (usage) {
            const outTok = usage.output_tokens || 0;
            extra = outTok > 0 ? `Concluído · ${outTok} tokens gerados` : undefined;
            if (extra && cost > 0) extra += ` · $${cost.toFixed(4)}`;
          }
          safeClose(false, extra);
          this._emitStatus(sender, { state: 'done', projectPath: cwd });
          if (cost > 0) console.log(`[claude-cli] custo: $${cost.toFixed(6)}`);
          resolve({ text });
        },

        onError: (err) => {
          safeClose(true);
          const msg = friendlyError(err);
          try { sender.send('transcription-error', msg); } catch (_) {}
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
