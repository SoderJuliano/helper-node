// Public facade for the GitHub Copilot CLI provider.
// main/ipc/chat.js talks exclusively to this module.
//
// Diferente do Claude/Gemini CLI, aqui NÃO há streaming JSON confirmado: a
// doc oficial cita `--output-format json` (JSONL) mas nenhuma fonte consultada
// mostrou o schema real dos eventos. Em vez de arriscar um parser adivinhado
// (foi exatamente isso que quebrou o ClaudeCliModels.js antes), este módulo
// roda em modo texto puro (stdout completo capturado no fechamento do
// processo) — sem tool-activity granular, sem thinking real, só um heartbeat
// de "ainda processando" pra tela não parecer travada. Trocar por streaming
// de verdade fica pra quando houver uma amostra real de `--output-format json`
// rodando contra o binário instalado.
//
// Também não há sessão persistente/--resume confirmado: cada send() é um
// spawn novo e independente (sem memória de turnos anteriores no CLI — o
// histórico de conversa, se precisar, tem que ir embutido no prompt, igual
// já é feito pra Claude via `promptWithHistory` em chat.js).

const { CopilotCliProcess, resolveBinary } = require('./CopilotCliProcess');
const { getModels, getDefaultModel } = require('./CopilotCliModels');
const modelAccess = require('./CopilotCliModelAccess');

const HEARTBEAT_MS = 2500;

function friendlyError(err) {
  const msg = err && err.message ? err.message : String(err);
  if (/not.?found|ENOENT|no such/i.test(msg))
    return 'GitHub Copilot CLI não instalado. Rode (sem precisar de admin): npm install -g @github/copilot (requer Node.js 22+).';
  if (/not.?authenticated|unauthoriz|login|401|please.*sign.?in/i.test(msg))
    return 'GitHub Copilot CLI não autenticado. Rode `copilot` no terminal e digite /login.';
  if (/enterprise polic|not authorized to use this copilot feature/i.test(msg))
    return 'Copilot CLI bloqueado por política da organização. Peça pro admin habilitar "Copilot in the CLI".';
  if (/rate.?limit|429|quota/i.test(msg))
    return 'Rate limit do Copilot atingido. Aguarde e tente novamente.';
  if (/model.*not.*(found|available)|invalid.*model/i.test(msg))
    return 'Modelo do Copilot indisponível. Verifique nas configurações.';
  if (/timeout/i.test(msg))
    return 'Tempo esgotado aguardando o Copilot CLI.';
  return `Copilot CLI: ${msg}`;
}

class CopilotCliProvider {
  constructor() {
    this._model = getDefaultModel();
    this._effort = 'medium';
    // Interrupção pedida pelo usuário. Sem isto, matar o processo caía no
    // branch de erro do onClose (código de saída ≠ 0) e o app mostrava um erro
    // vermelho na tela como se a CLI tivesse quebrado — quando na verdade ela
    // fez exatamente o que foi mandado. O Claude e o Gemini já tinham esse
    // flag nas sessões deles; o copilot era o único sem.
    this._aborted = false;
  }

  setModel(model) { this._model = model || getDefaultModel(); }
  getModel()      { return this._model; }
  getModels(force = false) { return getModels(force); }

  setEffort(effort) { this._effort = effort || 'medium'; }
  getEffort()      { return this._effort; }

  // Main entry point called from main/ipc/chat.js.
  // opts.attachments = caminhos de imagem/PDF anexados no workspace; vão como
  // `--attachment` (o CLI lê o arquivo), nunca transcritos dentro do prompt.
  async send(prompt, projectPath, sender, opts = {}) {
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const { exec, execSync } = require('child_process');
    let cwd = projectPath;
    if (!cwd || cwd === '/' || !fs.existsSync(cwd)) {
      cwd = (process.cwd() && process.cwd() !== '/') ? process.cwd() : os.homedir();
    }

    // Turno novo: o abort do turno anterior não pode silenciar este.
    this._aborted = false;

    this._emitStatus(sender, { state: 'busy', projectPath: cwd });

    // Snapshot do estado git inicial para detectar arquivos modificados pela IA
    const filesBefore = new Map();
    const emittedFiles = new Set();
    try {
      const out = execSync('git --no-optional-locks status --porcelain', { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2000 });
      out.split(/\r?\n/).forEach(line => {
        if (!line) return;
        const st = line.slice(0, 2);
        const file = line.slice(3).trim();
        if (file && !file.startsWith('.copilot_prompt_')) filesBefore.set(file, st);
      });
    } catch (_) {}

    let diffCheckTimeout = null;
    let isCheckingDiffs = false;

    const checkFileChangesAsync = () => {
      if (isCheckingDiffs || this._aborted) return;
      isCheckingDiffs = true;
      exec('git --no-optional-locks status --porcelain', { cwd, encoding: 'utf8', timeout: 4000 }, (err, stdout) => {
        isCheckingDiffs = false;
        if (err || !stdout || this._aborted) return;
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          if (!line) continue;
          const st = line.slice(0, 2);
          const file = line.slice(3).trim();
          if (!file || file.startsWith('.copilot_prompt_')) continue;
          if (!filesBefore.has(file) || filesBefore.get(file) !== st) {
            if (!emittedFiles.has(file)) {
              emittedFiles.add(file);
              const absPath = path.resolve(cwd, file);
              this._createBackupAndEmitDiff(absPath, cwd, sender);
            }
          }
        }
      });
    };

    const scheduleFileCheck = () => {
      if (diffCheckTimeout || this._aborted) return;
      diffCheckTimeout = setTimeout(() => {
        diffCheckTimeout = null;
        checkFileChangesAsync();
      }, 1500);
    };

    const proc = new CopilotCliProcess();
    let buf = '';
    let errBuf = '';
    let startedAt = Date.now();
    let heartbeat = null;

    const emitHeartbeat = () => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      try {
        sender.send('agentic-phase-update', {
          phase: 'thinking',
          status: `Copilot processando… (${secs}s)`,
          sessionId: cwd,
        });
      } catch (_) {}
    };

    const safeClose = (isError, extraStatus) => {
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      if (diffCheckTimeout) { clearTimeout(diffCheckTimeout); diffCheckTimeout = null; }
      const status = isError ? 'Erro' : (extraStatus || 'Concluído');
      try { sender.send('agentic-phase-update', { phase: isError ? 'error' : 'completed', status, sessionId: cwd }); } catch (_) {}
      try { sender.send('gemini-stream-complete'); } catch (_) {}
    };

    let streamedBytes = 0;
    return new Promise((resolve, reject) => {
      proc.onData((chunk) => {
        // Depois do "Parar IA", NADA mais vai pra tela.
        if (this._aborted) return;
        buf += chunk;
        streamedBytes += chunk.length;
        try { sender.send('gemini-stream-chunk', chunk); } catch (_) {}
        // Agenda checagem assíncrona não-bloqueante de arquivos modificados
        scheduleFileCheck();
      });
      proc.onStderr((line) => { if (!this._aborted) errBuf += line + '\n'; });

      proc.onClose((code) => {
        if (diffCheckTimeout) { clearTimeout(diffCheckTimeout); diffCheckTimeout = null; }

        // Interrompido pelo usuário: encerra QUIETO sem erro vermelho
        if (this._aborted) {
          safeClose(false, 'Interrompido');
          this._emitStatus(sender, { state: 'done', projectPath: cwd });
          resolve({ text: buf.trim() });
          return;
        }

        // Checagem final de diffs
        checkFileChangesAsync();

        // Aprende restrições de modelo se emitidas pelo CLI
        this._aprenderAcessoDeModelo(buf + '\n' + errBuf, sender);

        if (code === 0) {
          const text = buf.trim();
          safeClose(false, undefined);
          this._emitStatus(sender, { state: 'done', projectPath: cwd });
          if (streamedBytes === 0 && text) {
            try { sender.send('gemini-stream-chunk', text); } catch (_) {}
          }
          resolve({ text });
        } else {
          // Se o processo encerrou com código diferente de 0 mas já havia transmitido conteúdo útil
          if (streamedBytes > 0 && buf.trim()) {
            console.warn(`[copilot-cli] Processo encerrou com código ${code} após transmitir ${streamedBytes} bytes.`);
            safeClose(false, 'Concluído');
            this._emitStatus(sender, { state: 'done', projectPath: cwd });
            resolve({ text: buf.trim() });
          } else {
            const errText = errBuf.trim() || buf.trim() || `processo finalizado com código ${code}`;
            safeClose(true);
            const msg = friendlyError(new Error(errText));
            try { sender.send('transcription-error', msg); } catch (_) {}
            this._emitStatus(sender, { state: 'error', error: msg });
            reject(new Error(msg));
          }
        }
      });

      proc.onError((err) => {
        if (this._aborted) {
          safeClose(false, 'Interrompido');
          resolve({ text: buf.trim() });
          return;
        }
        safeClose(true);
        const msg = friendlyError(err);
        try { sender.send('transcription-error', msg); } catch (_) {}
        this._emitStatus(sender, { state: 'error', error: msg });
        reject(new Error(msg));
      });

      const configService = require('../../configService');
      const eff = opts.effort || this._effort || configService.getCopilotCliReasoningEffort() || 'medium';

      proc.start({ cwd, model: this._model, effort: eff, prompt, attachments: opts.attachments }).then(() => {
        heartbeat = setInterval(emitHeartbeat, HEARTBEAT_MS);
        emitHeartbeat();
      }).catch((err) => {
        safeClose(true);
        const msg = friendlyError(err);
        try { sender.send('transcription-error', msg); } catch (_) {}
        this._emitStatus(sender, { state: 'error', error: msg });
        reject(new Error(msg));
      });

      this._currentProc = proc;
    });
  }

  _createBackupAndEmitDiff(absPath, cwd, sender) {
    try {
      const fs = require('fs');
      const path = require('path');
      const os = require('os');
      const { execSync } = require('child_process');

      const backupDir = path.join(os.homedir(), '.config', 'helper-node', 'backups', new Date().toISOString().slice(0, 10));
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, `${Date.now()}_${path.basename(absPath)}`);
      let content = '';
      const existed = fs.existsSync(absPath);

      try {
        const fileDir = path.dirname(absPath);
        const rawGitRoot = execSync('git --no-optional-locks rev-parse --show-toplevel', { cwd: fileDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        const gitRoot = path.normalize(rawGitRoot);
        const relPath = path.relative(gitRoot, absPath).replace(/\\/g, '/');
        content = execSync(`git --no-optional-locks show :"${relPath}"`, { cwd: gitRoot, stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).toString('utf8');
      } catch (_) {
        content = '';
      }

      fs.writeFileSync(backupPath, content, 'utf8');
      sender.send('workspace-file-written', {
        action: existed && content ? 'edit' : 'create',
        path: absPath,
        backupAt: backupPath,
      });
      try { sender.send('file-mutated', { path: absPath, origin: 'copilot-cli' }); } catch (_) {}
    } catch (e) {
      console.warn('[copilot-cli] Falha ao criar backup/diff para', absPath, e.message);
    }
  }

  // Registra o "Model X is not available" que o CLI emite quando a conta/org
  // não libera o modelo, tira X do seletor e move a seleção pro modelo em que
  // o próprio CLI caiu — sem isso o usuário continuaria com um modelo morto
  // escolhido nas configurações e levaria o aviso a cada envio.
  _aprenderAcessoDeModelo(saida, sender) {
    let info;
    try { info = modelAccess.learnFromOutput(saida); } catch (_) { return; }
    if (!info || !info.blocked) return;

    const novo = info.fallback || getDefaultModel();
    if (this._model === info.blocked) this._model = novo;

    try {
      const configService = require('../../configService');
      if (configService.getCopilotCliModel() === info.blocked) {
        configService.setCopilotCliModel(novo);
      }
    } catch (_) {}

    // A lista do seletor é buscada sob demanda; sem avisar, ela só se atualiza
    // quando o usuário reabre as configurações.
    try {
      sender.send('copilot-cli-status', {
        state: 'model-blocked', blocked: info.blocked, fallback: novo,
      });
    } catch (_) {}
    try {
      const { BrowserWindow } = require('electron');
      BrowserWindow.getAllWindows().forEach((w) => {
        if (w && !w.isDestroyed()) w.webContents.send('ai-model-changed', { provider: 'copilotCli', model: novo });
      });
    } catch (_) {}
  }

  // Aborta o processo em curso (chamado pelo botão interromper).
  // O flag é levantado ANTES do kill: kill() leva até 800ms (SIGINT, espera,
  // taskkill) e sem isso os chunks desse intervalo ainda iam pra tela.
  async abortCurrent() {
    this._aborted = true;
    if (this._currentProc) {
      await this._currentProc.kill().catch(() => {});
      console.log('[copilot-cli] abortado');
    }
  }

  // Sem sessão persistente por projeto ainda — no-op mantido só pra manter a
  // mesma interface pública do ClaudeCliProvider/GeminiCliProvider.
  async changeProject() {}

  async shutdown() {
    await this.abortCurrent().catch(() => {});
  }

  async checkInstalled() {
    return CopilotCliProcess.checkInstalled();
  }

  _emitStatus(sender, payload) {
    try { sender.send('copilot-cli-status', payload); } catch (_) {}
  }
}

module.exports = new CopilotCliProvider();
