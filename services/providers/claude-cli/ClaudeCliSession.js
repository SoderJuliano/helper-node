// Manages the conversation session for a given project directory.
// Each send() spawns a fresh `claude --print` process; conversation continuity
// is maintained by the CLI itself via --resume <session_id>.

const path = require('path');
const fs = require('fs');
const { ClaudeCliProcess } = require('./ClaudeCliProcess');
const { ClaudeCliParser }  = require('./ClaudeCliParser');

function getSessionStatePath() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'claude-cli-sessions.json');
}

function loadSessions() {
  try {
    const file = getSessionStatePath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('[claude-cli] failed to load sessions:', e.message);
  }
  return {};
}

function saveSessions(sessions) {
  try {
    const file = getSessionStatePath();
    fs.writeFileSync(file, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (e) {
    console.error('[claude-cli] failed to save sessions:', e.message);
  }
}

class ClaudeCliSession {
  constructor(projectPath) {
    this._projectPath        = projectPath;
    this._appSessionId       = null;  // ID da sessão da UI (Electron)
    this._claudeSessionId    = null;  // UUID retornado pelo Claude CLI p/ --resume
    this._lastHistoryLength = 0;     // Qtd de msgs vistas por esta sessão CLI
    this._binary             = null;
    this._activeProc         = null;
    this._aborted            = false;
  }

  setSessionId(appSessionId) {
    if (this._appSessionId !== appSessionId) {
      console.log(`[claude-cli][${this._projectPath}] appSessionId mudou de ${this._appSessionId} para ${appSessionId}`);
      this._appSessionId = appSessionId;
      
      const sessions = loadSessions();
      const saved = sessions[this._projectPath];
      
      if (saved && saved.appSessionId === appSessionId) {
        console.log(`[claude-cli][${this._projectPath}] sessão salva encontrada: ${saved.claudeSessionId}`);
        this._claudeSessionId = saved.claudeSessionId || null;
        this._lastHistoryLength = saved.lastHistoryLength || 0;
      } else {
        console.log(`[claude-cli][${this._projectPath}] nova sessão appSessionId. Resetando estado do Claude CLI.`);
        this._claudeSessionId = null;
        this._lastHistoryLength = 0;
      }

      if (this._activeProc) {
        this.abort().catch(() => {});
      }
    }
  }

  getProjectPath() { return this._projectPath; }
  getSessionId()   { return this._claudeSessionId; }
  isActive()       { return !!(this._activeProc && this._activeProc.alive); }

  // Send a prompt and stream the response.
  // opts: { model, history, onChunk, onThinking, onToolStart, onToolDone, onFileTool,
  //         onStatus, onTokenUpdate, onRateLimit, onDone, onError }
  async send(prompt, opts = {}) {
    if (this._activeProc && this._activeProc.alive) {
      console.warn('[claude-cli] envio anterior ainda ativo — abortando antes do novo');
      await this.abort().catch(() => {});
    }

    const history = opts.history || [];
    // Só faz continuação nativa (--resume) se temos UUID do Claude E o tamanho do histórico
    // bate com as mensagens que o Claude acompanhou. Se o usuário alternou pro Gemini/OpenAI
    // no meio, history.length será maior do que _lastHistoryLength → força reidratação!
    let isContinue = !!this._claudeSessionId && (history.length === this._lastHistoryLength);
    let finalPrompt = prompt;

    if (!isContinue) {
      if (this._claudeSessionId) {
        console.log(`[claude-cli] modelo alternado ou histórico divergiu (${history.length} vs ${this._lastHistoryLength}). Reiniciando sessão Claude CLI com contexto reidratado.`);
        this._claudeSessionId = null;
      }
      if (history.length > 0) {
        const historyLimit = 30;
        let historyContext = "=== RECONSTRUÇÃO DO CONTEXTO DA CONVERSA ===\n";
        const messagesToInclude = history.slice(-historyLimit);
        const omittedCount = history.length - messagesToInclude.length;
        if (omittedCount > 0) {
          historyContext += `[Mensagens anteriores omitidas para economizar contexto: ${omittedCount}]\n\n`;
        }
        for (const msg of messagesToInclude) {
          const roleName = msg.role === 'user' ? 'Usuário' : 'IA';
          let cleanContent = typeof msg.content === 'string' ? msg.content : String(msg.content || '');
          if (cleanContent.includes("═══ DIRETIVA DE SISTEMA")) {
            cleanContent = cleanContent.replace(/═══ DIRETIVA DE SISTEMA[\s\S]*?═════════════════════════════════════════════════════════════\s*/g, "");
            cleanContent = cleanContent.replace(/═══ DIRETIVA DE SISTEMA[\s\S]*?Lembre-se: Toda a sua resposta deve ser um JSON válido e parseável\.\s*/g, "");
          }
          if (cleanContent.trim().startsWith("{") && cleanContent.includes('"response"')) {
            try {
              const parsed = JSON.parse(cleanContent);
              if (parsed && typeof parsed.response === "string") {
                cleanContent = parsed.response;
              }
            } catch (_) {}
          }
          cleanContent = cleanContent.trim();
          if (cleanContent) {
            historyContext += `[${roleName}]: ${cleanContent}\n\n`;
          }
        }
        historyContext += "=== FIM DO CONTEXTO ===\n\nUse o contexto acima como base para a instrução atual. Não responda ao histórico, apenas siga a instrução atual.\n\nInstrução atual: ";
        finalPrompt = historyContext + prompt;
      }
    }

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
      let lastActivity = Date.now();
      let watchdogKilled = false;
      let activeTools = 0;
      const STALL_WARN_MS = 25 * 1000;
      const STALL_KILL_MS = 150 * 1000;
      const TOOL_WARN_MS  = 5 * 60 * 1000;
      const TOOL_KILL_MS  = 15 * 60 * 1000;
      const watchdog = setInterval(() => {
        const silent = Date.now() - lastActivity;
        const killMs = activeTools > 0 ? TOOL_KILL_MS : STALL_KILL_MS;
        const warnMs = activeTools > 0 ? TOOL_WARN_MS : STALL_WARN_MS;
        if (silent > killMs) {
          clearInterval(watchdog);
          console.warn('[claude-cli] sem output além do limite — encerrando processo travado');
          watchdogKilled = true;
          this._aborted = false;
          if (this._activeProc === proc) {
            proc.kill().catch(() => {});
          }
        } else if (silent > warnMs && opts.onStatus) {
          const s = Math.round(silent / 1000);
          const left = Math.max(0, Math.round((killMs - silent) / 1000));
          const msg = activeTools > 0
            ? `Executando ferramenta há ${s}s… encerro em ${left}s se não voltar.`
            : `⚠️ Claude sem responder há ${s}s — parado, NÃO está trabalhando. Encerro em ${left}s se não voltar.`;
          opts.onStatus(msg);
        }
      }, 5 * 1000);

      const finish = () => { clearInterval(watchdog); };

      const parser = new ClaudeCliParser({
        onSessionId: (id)   => { this._claudeSessionId = id; },
        onConnected: ()     => {},
        onChunk:     (t)    => opts.onChunk    && opts.onChunk(t),
        onThinking:  (t)    => opts.onThinking && opts.onThinking(t),
        onToolStart: (info) => { activeTools++; lastActivity = Date.now(); opts.onToolStart && opts.onToolStart(info); },
        onToolDone:  (info) => { activeTools = Math.max(0, activeTools - 1); lastActivity = Date.now(); opts.onToolDone && opts.onToolDone(info); },
        onFileTool:  (info) => opts.onFileTool && opts.onFileTool(info),
        onTokenUpdate: (info) => { lastActivity = Date.now(); opts.onTokenUpdate && opts.onTokenUpdate(info); },
        onRateLimit:   (info) => { lastActivity = Date.now(); opts.onRateLimit   && opts.onRateLimit(info); },
        onDone: ({ text, cost, sessionId, usage }) => {
          if (sessionId) this._claudeSessionId = sessionId;
          this._lastHistoryLength = history.length + 2; // +1 user msg, +1 IA msg

          if (this._appSessionId) {
            const sessions = loadSessions();
            sessions[this._projectPath] = {
              appSessionId: this._appSessionId,
              claudeSessionId: this._claudeSessionId,
              lastHistoryLength: this._lastHistoryLength,
              lastUsed: Date.now()
            };
            saveSessions(sessions);
          }

          finish();
          this._activeProc = null;
          opts.onDone && opts.onDone({ text, cost, usage });
          resolve({ text, cost, usage });
        },
        onError: (err) => {
          finish();
          this._activeProc = null;
          if (this._aborted) {
            this._aborted = false;
            opts.onDone && opts.onDone({ text: '', cost: 0 });
            resolve({ text: '' });
            return;
          }
          opts.onError && opts.onError(err);
          reject(err);
        },
      });

      const proc = new ClaudeCliProcess();
      this._activeProc = proc;

      proc.onData((chunk) => { lastActivity = Date.now(); parser.feed(chunk); });
      proc.onStderr((line) => {
        lastActivity = Date.now();
        if (opts.onStatus && /retry|overloaded|529|rate.?limit|attempt/i.test(line)) {
          opts.onStatus(`API instável — tentando novamente… (${line.slice(0, 100)})`);
        }
      });
      proc.onClose((code) => {
        finish();
        parser.flush();
        if (proc.alive === false && this._activeProc === proc) {
          this._activeProc = null;
          if (this._aborted) {
            this._aborted = false;
            opts.onDone && opts.onDone({ text: '', cost: 0 });
            resolve({ text: '' });
            return;
          }
          const errMsg = watchdogKilled
            ? 'O Claude parou de responder e a tarefa foi encerrada. Reenvie a mensagem para continuar de onde parou, ou troque para o Gemini CLI.'
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
        sessionId: this._claudeSessionId,
        prompt:    finalPrompt,
        binary:    this._binary,
      }).catch((startErr) => {
        finish();
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
    this._appSessionId    = null;
    this._claudeSessionId = null;
    this._binary          = null;
  }
}

module.exports = ClaudeCliSession;
