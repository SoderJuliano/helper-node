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
  }

  setModel(model) { this._model = model || getDefaultModel(); }
  getModel()      { return this._model; }
  getModels()     { return getModels(); }

  // Main entry point called from main/ipc/chat.js.
  async send(prompt, projectPath, sender) {
    const os = require('os');
    const fs = require('fs');
    let cwd = projectPath;
    if (!cwd || cwd === '/' || !fs.existsSync(cwd)) {
      cwd = (process.cwd() && process.cwd() !== '/') ? process.cwd() : os.homedir();
    }

    this._emitStatus(sender, { state: 'busy', projectPath: cwd });

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
      const status = isError ? 'Erro' : (extraStatus || 'Concluído');
      try { sender.send('agentic-phase-update', { phase: isError ? 'error' : 'completed', status, sessionId: cwd }); } catch (_) {}
      try { sender.send('gemini-stream-complete'); } catch (_) {}
    };

    let streamedBytes = 0;
    return new Promise((resolve, reject) => {
      proc.onData((chunk) => {
        buf += chunk;
        streamedBytes += chunk.length;
        try { sender.send('gemini-stream-chunk', chunk); } catch (_) {}
      });
      proc.onStderr((line) => { errBuf += line + '\n'; });

      proc.onClose((code) => {
        if (code === 0) {
          const text = buf.trim();
          safeClose(false, undefined);
          this._emitStatus(sender, { state: 'done', projectPath: cwd });
          if (streamedBytes === 0 && text) {
            try { sender.send('gemini-stream-chunk', text); } catch (_) {}
          }
          resolve({ text });
        } else {
          const errText = errBuf.trim() || buf.trim() || `exited with code ${code}`;
          safeClose(true);
          const msg = friendlyError(new Error(errText));
          try { sender.send('transcription-error', msg); } catch (_) {}
          this._emitStatus(sender, { state: 'error', error: msg });
          reject(new Error(msg));
        }
      });

      proc.onError((err) => {
        safeClose(true);
        const msg = friendlyError(err);
        try { sender.send('transcription-error', msg); } catch (_) {}
        this._emitStatus(sender, { state: 'error', error: msg });
        reject(new Error(msg));
      });

      proc.start({ cwd, model: this._model, prompt }).then(() => {
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

  // Aborta o processo em curso (chamado pelo botão interromper).
  async abortCurrent() {
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
