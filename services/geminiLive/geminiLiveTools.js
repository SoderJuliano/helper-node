/**
 * services/geminiLive/geminiLiveTools.js
 * 
 * Declaração e execução de ferramentas (Function Calling) para a Gemini Multimodal Live API.
 * Integração direta com Antigravity CLI (AGY), terminal local, inspeção de arquivos do workspace,
 * Google Search nativo e consultas rápidas na web.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const DEFAULT_LIVE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'execute_code_task',
        description: 'Executa uma tarefa de codificação, refatoração, edição de código, testes, investigação ou tarefas complexas no projeto utilizando o Gemini CLI (AGY / Antigravity). Invoque IMEDIATAMENTE para realizar alterações ou análises solicitadas pelo usuário.',
        parameters: {
          type: 'OBJECT',
          properties: {
            instruction: {
              type: 'STRING',
              description: 'Instrução clara e detalhada da tarefa a ser executada no projeto pelo Gemini CLI.'
            }
          },
          required: ['instruction']
        }
      },
      {
        name: 'run_terminal_command',
        description: 'Executa um comando no terminal do sistema operacional na raiz do projeto (ex: git status, git log, git branch, git diff, npm test, mvn test).',
        parameters: {
          type: 'OBJECT',
          properties: {
            command: {
              type: 'STRING',
              description: 'Comando bash/cmd/powershell exato a executar.'
            }
          },
          required: ['command']
        }
      },
      {
        name: 'read_workspace_file',
        description: 'Lê o conteúdo de um arquivo do workspace do projeto local.',
        parameters: {
          type: 'OBJECT',
          properties: {
            filePath: {
              type: 'STRING',
              description: 'Caminho relativo ou absoluto do arquivo no projeto.'
            }
          },
          required: ['filePath']
        }
      },
      {
        name: 'get_screen_context',
        description: 'Captura a tela ou janela atual do usuário para inspecionar erros, código ou conteúdo visual exibido.',
        parameters: {
          type: 'OBJECT',
          properties: {
            targetApp: {
              type: 'STRING',
              description: 'Opcional: nome da janela/app específico (ex: "vscode", "chrome", "brave", "browser").'
            }
          }
        }
      },
      {
        name: 'get_recent_chat_history',
        description: 'Recupera as últimas mensagens e histórico recente de conversa do chat do Helper Node.',
        parameters: {
          type: 'OBJECT',
          properties: {
            limit: {
              type: 'INTEGER',
              description: 'Quantidade de mensagens recentes a recuperar (padrão 8).'
            }
          }
        }
      },
      {
        name: 'get_agent_status',
        description: 'Verifica o status atual do Antigravity (AGY), tarefas em execução, progresso da IA ou alterações recentes no workspace. Invoque sempre que o usuário pedir atualizações, status ou perguntar o que a IA está fazendo.',
        parameters: {
          type: 'OBJECT',
          properties: {}
        }
      }
    ]
  }
];

function getProjectCwd() {
  try {
    const workspace = require('../workspace');
    if (workspace && typeof workspace.getProjectPath === 'function') {
      const p = workspace.getProjectPath();
      if (p && fs.existsSync(p)) return p;
    }
  } catch (_) {}
  return process.cwd();
}

/**
 * Executa uma chamada de ferramenta invocada pela Gemini Live API.
 * @param {Object} functionCall - { id, name, args }
 * @param {Object} context - contexto da sessão e emissores
 * @returns {Promise<Object>} Resposta formatada para functionResponse
 */
async function executeToolCall(functionCall, context = {}) {
  const { id, name, args } = functionCall;
  const cwd = getProjectCwd();

  console.log(`[GeminiLiveTools] Executando tool '${name}' (id: ${id}) em cwd: ${cwd}`, args);

  try {
    let outputResult = null;

    if (name === 'execute_code_task') {
      outputResult = await _handleAgyCodeTask(id, args, cwd, context);
    } else if (name === 'run_terminal_command') {
      outputResult = await _handleTerminalCommand(id, args, cwd, context);
    } else if (name === 'read_workspace_file') {
      outputResult = await _handleReadFile(id, args, cwd, context);
    } else if (name === 'get_screen_context') {
      outputResult = await _handleScreenContext(id, args, cwd, context);
    } else if (name === 'get_recent_chat_history') {
      outputResult = await _handleChatHistory(id, args, cwd, context);
    } else if (name === 'get_agent_status') {
      outputResult = await _handleAgentStatus(id, args, cwd, context);
    } else {
      outputResult = { error: `Ferramenta desconhecida: ${name}` };
    }

    return {
      id: id,
      response: {
        output: outputResult
      }
    };
  } catch (err) {
    console.error(`[GeminiLiveTools] Erro ao executar tool '${name}':`, err);
    _notifyToolActivity(id || ('err_' + Date.now()), 'error', `Falha: ${err.message}`, 'tool', name);
    return {
      id: id,
      response: {
        output: {
          status: 'error',
          error: err.message || String(err)
        }
      }
    };
  }
}

async function _handleAgyCodeTask(id, args, cwd, context) {
  const instruction = (args && args.instruction) ? String(args.instruction) : '';
  if (!instruction.trim()) {
    return { status: 'error', message: 'Nenhuma instrução informada para a tarefa de código.' };
  }

  const { configService, state } = require('../../main/globals');
  const aiModel = (configService && typeof configService.getAiModel === 'function')
    ? configService.getAiModel()
    : 'geminiCli';

  const providerLabel = aiModel === 'claudeCli' ? 'Claude CLI' : (aiModel === 'copilotCli' ? 'Copilot CLI' : 'Gemini CLI');
  const actId = id || ('code_' + Date.now());
  const label = `${providerLabel}: ` + (instruction.length > 50 ? instruction.slice(0, 50) + '...' : instruction);
  _notifyToolActivity(actId, 'start', label, 'edit', 'execute_code_task');
  _notifyProgress(`Executando tarefa com ${providerLabel}...`, { instruction, cwd });

  const targets = [];
  if (state.mainWindow && !state.mainWindow.isDestroyed()) targets.push(state.mainWindow.webContents);
  if (state.nexaWindow && !state.nexaWindow.isDestroyed()) targets.push(state.nexaWindow.webContents);

  const sender = {
    send: (channel, ...args) => {
      for (const t of targets) {
        try { t.send(channel, ...args); } catch (_) {}
      }

      // Feedback em tempo real durante as execuções do Anti-gravity (AGY)
      if (channel === 'agentic-phase-update') {
        const payload = args[0] || {};
        if (payload.status) {
          _notifyProgress(`Antigravity: ${payload.status}`, { phase: payload.phase, cwd });
        }
      } else if (channel === 'gemini-stream-chunk') {
        const chunk = args[0];
        if (typeof chunk === 'string' && chunk.trim()) {
          const shortChunk = chunk.trim().replace(/\s+/g, ' ').slice(0, 60);
          if (shortChunk.length > 3) {
            _notifyProgress(`Antigravity: ${shortChunk}...`, { cwd });
          }
        }
      }
    }
  };

  try {
    if (aiModel === 'claudeCli') {
      const ClaudeCliProvider = require('../providers/claude-cli/ClaudeCliProvider');
      if (ClaudeCliProvider && typeof ClaudeCliProvider.send === 'function') {
        const result = await ClaudeCliProvider.send(instruction, cwd, sender, null, []);
        _notifyToolActivity(actId, 'done', label, 'edit', 'execute_code_task');
        _notifyProgress(`Claude CLI: Tarefa concluída com sucesso.`, { cwd });
        return {
          status: 'success',
          summary: (result && result.text) ? result.text : 'Tarefa concluída pelo Claude CLI.'
        };
      }
    } else if (aiModel === 'copilotCli') {
      const CopilotCliProvider = require('../providers/copilot-cli/CopilotCliProvider');
      if (CopilotCliProvider && typeof CopilotCliProvider.send === 'function') {
        const { helpers } = require('../../main/globals');
        const attachments = helpers && helpers.getAttachableFilePaths ? helpers.getAttachableFilePaths() : [];
        const result = await CopilotCliProvider.send(instruction, cwd, sender, { attachments });
        _notifyToolActivity(actId, 'done', label, 'edit', 'execute_code_task');
        _notifyProgress(`Copilot CLI: Tarefa concluída com sucesso.`, { cwd });
        return {
          status: 'success',
          summary: (result && result.text) ? result.text : 'Tarefa concluída pelo Copilot CLI.'
        };
      }
    } else {
      const GeminiCliProvider = require('../providers/gemini-cli/GeminiCliProvider');
      if (GeminiCliProvider && typeof GeminiCliProvider.send === 'function') {
        let activeSessionId = 'default';
        try {
          const historyService = require('../historyService');
          const currentSession = historyService ? historyService.getCurrentSession() : null;
          if (currentSession && currentSession.id) {
            activeSessionId = currentSession.id;
          } else if (state && state.activeSessionId) {
            activeSessionId = state.activeSessionId;
          }
        } catch (_) {}
        const result = await GeminiCliProvider.send(
          instruction,
          cwd,
          sender,
          activeSessionId,
          []
        );

        _notifyToolActivity(actId, 'done', label, 'edit', 'execute_code_task');
        _notifyProgress(`Antigravity: Tarefa concluída com sucesso!`, { cwd });
        return {
          status: 'success',
          summary: (result && result.text) ? result.text : 'Tarefa concluída pelo Gemini CLI.',
          thinking: (result && result.thinking) ? result.thinking : null
        };
      }
    }
  } catch (e) {
    console.warn(`[GeminiLiveTools] Falha no provedor ${providerLabel}:`, e.message);
    _notifyProgress(`Antigravity falhou: ${e.message}`, { cwd, error: true });
  }

  // Fallback: Execução direta do comando agy --print
  _notifyProgress(`Antigravity: Executando diretamente no workspace...`, { cwd });
  const safeInstruction = instruction.replace(/"/g, '\\"');
  const cmd = `agy --mode accept-edits --dangerously-skip-permissions --print "${safeInstruction}"`;
  
  const { stdout, stderr } = await execAsync(cmd, {
    cwd,
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
    shell: true
  });

  _notifyToolActivity(actId, 'done', label, 'edit', 'execute_code_task');
  _notifyProgress(`Antigravity: Alterações concluídas.`, { cwd });
  return {
    status: 'success',
    summary: stdout.slice(-2000) || 'Tarefa concluída no workspace.',
    details: stderr.slice(-500)
  };
}

async function _handleTerminalCommand(id, args, cwd, context) {
  const command = (args && args.command) ? String(args.command) : '';
  if (!command.trim()) {
    return { status: 'error', message: 'Comando de terminal vazio.' };
  }

  const actId = id || ('cmd_' + Date.now());
  _notifyToolActivity(actId, 'start', command, 'cmd', 'run_terminal_command');
  _notifyProgress(`Executando comando: ${command}`, { cwd });

  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
    shell: true
  });

  _notifyToolActivity(actId, 'done', command, 'cmd', 'run_terminal_command');
  return {
    status: 'success',
    stdout: stdout.slice(-3000),
    stderr: stderr.slice(-1000)
  };
}

async function _handleReadFile(id, args, cwd, context) {
  const relPath = (args && args.filePath) ? String(args.filePath) : '';
  if (!relPath.trim()) {
    return { status: 'error', message: 'Caminho de arquivo não informado.' };
  }

  const actId = id || ('read_' + Date.now());
  _notifyToolActivity(actId, 'start', 'Lendo: ' + relPath, 'read', 'read_workspace_file');

  const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
  if (!fs.existsSync(absPath)) {
    _notifyToolActivity(actId, 'error', 'Não encontrado: ' + relPath, 'read', 'read_workspace_file');
    return { status: 'error', message: `Arquivo não encontrado: ${relPath}` };
  }

  const stats = fs.statSync(absPath);
  if (stats.size > 200 * 1024) {
    _notifyToolActivity(actId, 'error', 'Muito grande: ' + relPath, 'read', 'read_workspace_file');
    return { status: 'error', message: `Arquivo muito grande (${Math.round(stats.size / 1024)} KB). Máximo suportado: 200 KB.` };
  }

  const content = fs.readFileSync(absPath, 'utf8');
  _notifyToolActivity(actId, 'done', 'Lido: ' + relPath, 'read', 'read_workspace_file');
  return {
    status: 'success',
    filePath: relPath,
    content: content.slice(0, 15000)
  };
}

async function _handleScreenContext(id, args, cwd, context) {
  const actId = id || ('screen_' + Date.now());
  _notifyToolActivity(actId, 'start', 'Inspecionando tela...', 'read', 'get_screen_context');
  try {
    const platformScreenCapture = require('../platform/screenCapture');
    const imageAttachments = require('../imageAttachments');
    const dir = imageAttachments.ensureDir();
    const screenshotPath = path.join(dir, `screen-live-${Date.now()}.png`);
    const captureResult = await platformScreenCapture.captureFullScreenToFile(screenshotPath, {
      targetApp: args && args.targetApp ? String(args.targetApp) : undefined
    });
    const sourceName = captureResult && captureResult.sourceName ? captureResult.sourceName : 'Tela / Janela Principal';
    
    _notifyToolActivity(actId, 'done', `Tela inspecionada: ${sourceName}`, 'read', 'get_screen_context');
    return {
      status: 'success',
      sourceName,
      screenshotPath,
      availableWindows: (captureResult && captureResult.availableWindows) ? captureResult.availableWindows.slice(0, 10) : []
    };
  } catch (err) {
    _notifyToolActivity(actId, 'error', `Falha na captura: ${err.message}`, 'read', 'get_screen_context');
    return { status: 'error', message: `Erro ao capturar tela: ${err.message}` };
  }
}

async function _handleChatHistory(id, args, cwd, context) {
  const actId = id || ('hist_' + Date.now());
  _notifyToolActivity(actId, 'start', 'Lendo histórico de chat...', 'read', 'get_recent_chat_history');
  try {
    const historyService = require('../historyService');
    const currentSession = historyService.getCurrentSession ? historyService.getCurrentSession() : null;
    let messages = [];
    if (currentSession && Array.isArray(currentSession.conversations)) {
      messages = currentSession.conversations;
    } else if (historyService.getLastThreeSessions) {
      const recent = historyService.getLastThreeSessions();
      if (recent && recent.length > 0 && recent[0].conversations) {
        messages = recent[0].conversations;
      }
    }
    const limit = (args && args.limit && Number.isInteger(args.limit)) ? args.limit : 8;
    const slice = messages.slice(-limit).map(m => ({
      role: m.role || 'user',
      text: (m.text || m.content || '').slice(0, 500)
    }));

    _notifyToolActivity(actId, 'done', `${slice.length} mensagens recuperadas`, 'read', 'get_recent_chat_history');
    return {
      status: 'success',
      count: slice.length,
      recentMessages: slice
    };
  } catch (err) {
    _notifyToolActivity(actId, 'error', `Falha ao ler histórico: ${err.message}`, 'read', 'get_recent_chat_history');
    return { status: 'error', message: `Erro ao recuperar histórico: ${err.message}` };
  }
}

async function _handleAgentStatus(id, args, cwd, context) {
  const actId = id || ('status_' + Date.now());
  _notifyToolActivity(actId, 'start', 'Verificando status do AGY...', 'read', 'get_agent_status');
  try {
    const GeminiCliProvider = require('../providers/gemini-cli/GeminiCliProvider');
    const model = GeminiCliProvider ? GeminiCliProvider.getModel() : 'gemini';
    const isBusy = GeminiCliProvider && typeof GeminiCliProvider.isActive === 'function'
      ? GeminiCliProvider.isActive(cwd)
      : false;

    let gitStatus = '';
    try {
      const { stdout } = await execAsync('git status --short', { cwd, timeout: 5000 });
      gitStatus = stdout.trim();
    } catch (_) {}

    _notifyToolActivity(actId, 'done', 'Status verificado', 'read', 'get_agent_status');
    return {
      status: 'success',
      activeModel: model,
      workspace: cwd,
      isAgentExecuting: isBusy,
      gitChanges: gitStatus || 'Workspace limpo, sem arquivos pendentes de commit.',
      summary: isBusy
        ? `O Antigravity (AGY) está executando uma tarefa ativa no workspace agora.`
        : `O Antigravity (AGY) está ocioso e pronto. Modificações recentes: ${gitStatus || 'nenhuma pendência'}.`
    };
  } catch (err) {
    _notifyToolActivity(actId, 'error', `Falha ao obter status: ${err.message}`, 'read', 'get_agent_status');
    return { status: 'error', message: err.message };
  }
}

function _notifyToolActivity(id, phase, label, kind = 'cmd', name = '') {
  try {
    const { state } = require('../../main/globals');
    const payload = { id, phase, label, kind, name };
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('ai-tool-activity', payload);
    }
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      state.nexaWindow.webContents.send('ai-tool-activity', payload);
    }
  } catch (_) {}
}

function _notifyProgress(message, meta = {}) {
  try {
    const { state } = require('../../main/globals');
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('gemini-live:tool-progress', { message, meta });
    }
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      state.nexaWindow.webContents.send('gemini-live:tool-progress', { message, meta });
    }
  } catch (_) {}
}

module.exports = {
  DEFAULT_LIVE_TOOLS,
  executeToolCall,
  getProjectCwd
};
