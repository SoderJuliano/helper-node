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

  setSessionId(sessionId) {
    if (this._sessionId !== sessionId) {
      console.log(`[claude-cli][${this._projectPath}] sessionId changed to ${sessionId}`);
      this._sessionId = sessionId || null;
      if (this._activeProc) {
        this.abort().catch(() => {});
      }
    }
  }

  getProjectPath() { return this._projectPath; }
  getSessionId()   { return this._sessionId;   }
  isActive()       { return !!(this._activeProc && this._activeProc.alive); }

  // Send a prompt and stream the response.
  // opts: { model, history, onChunk, onThinking, onToolStart, onToolDone, onFileTool,
  //         onStatus, onTokenUpdate, onRateLimit, onDone, onError }
  async send(prompt, opts = {}) {
    // Nunca deixa dois processos disputarem a sessão: se um envio anterior
    // ficou preso (API retry, hang), mata antes de começar o novo.
    if (this._activeProc && this._activeProc.alive) {
      console.warn('[claude-cli] envio anterior ainda ativo — abortando antes do novo');
      await this.abort().catch(() => {});
    }

    const history = opts.history || [];
    let isContinue = !!this._sessionId;
    let finalPrompt = prompt;

    if (!isContinue && history.length > 0) {
      const historyLimit = 30;
      let historyContext = "=== HISTÓRICO DA CONVERSA ANTERIOR ===\n";
      const messagesToInclude = history.slice(-historyLimit);
      const omittedCount = history.length - messagesToInclude.length;
      if (omittedCount > 0) {
        historyContext += `[Mensagens anteriores omitidas para economizar contexto: ${omittedCount}]\n\n`;
      }
      for (const msg of messagesToInclude) {
        const roleName = msg.role === 'user' ? 'Usuário' : 'IA';
        historyContext += `[${roleName}]: ${msg.content}\n\n`;
      }
      historyContext += "=== FIM DO HISTÓRICO ===\n\nInstrução atual: ";
      finalPrompt = historyContext + prompt;
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
      // avisa a UI a cada verificação e mata se passar do limite sem NENHUM output.
      let lastActivity = Date.now();
      let watchdogKilled = false;
      // Enquanto uma ferramenta (Bash, build, script longo) está rodando, o CLI
      // fica em silêncio total no stdout até ela terminar — isso é esperado, não
      // é travamento. Só aplicamos o timeout curto quando NADA está em execução
      // (--include-partial-messages garante que texto/thinking streama continuamente
      // enquanto o modelo gera; silêncio aí sim é sinal real de travamento).
      let activeTools = 0;
      const STALL_WARN_MS = 25 * 1000;        // sem ferramenta ativa: avisa em 25s
      const STALL_KILL_MS = 150 * 1000;       // sem ferramenta ativa: mata em 2,5min
      const TOOL_WARN_MS  = 5 * 60 * 1000;    // ferramenta rodando: avisa em 5min
      const TOOL_KILL_MS  = 15 * 60 * 1000;   // ferramenta rodando: mata em 15min
      const watchdog = setInterval(() => {
        const silent = Date.now() - lastActivity;
        const killMs = activeTools > 0 ? TOOL_KILL_MS : STALL_KILL_MS;
        const warnMs = activeTools > 0 ? TOOL_WARN_MS : STALL_WARN_MS;
        if (silent > killMs) {
          clearInterval(watchdog);
          console.warn('[claude-cli] sem output além do limite — encerrando processo travado');
          watchdogKilled = true;
          this._aborted = false; // não é abort do usuário: queremos o erro na UI
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
        onSessionId: (id)   => { this._sessionId = id; },
        onConnected: ()     => {},
        onChunk:     (t)    => opts.onChunk    && opts.onChunk(t),
        onThinking:  (t)    => opts.onThinking && opts.onThinking(t),
        onToolStart: (info) => { activeTools++; lastActivity = Date.now(); opts.onToolStart && opts.onToolStart(info); },
        onToolDone:  (info) => { activeTools = Math.max(0, activeTools - 1); lastActivity = Date.now(); opts.onToolDone && opts.onToolDone(info); },
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
          // SIGINT (Ctrl+C) faz o próprio CLI reportar um result/error gracioso
          // pelo protocolo dele — chega aqui ANTES do processo fechar de fato,
          // sem passar pelo onClose. Se foi abort pedido pelo usuário, trata
          // igual: silencioso, sem mostrar "erro" pra quem só queria parar.
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
        sessionId: this._sessionId,   // null on first turn → new session
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
