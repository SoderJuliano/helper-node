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
  { google_search: {} },
  {
    functionDeclarations: [
      {
        name: 'execute_code_task',
        description: 'Executa uma tarefa de codificação, refatoração, edição de código, comandos no terminal, testes, previsão do tempo ou buscas técnicas utilizando o Gemini CLI (AGY) instalado localmente. IMPORTANTE: Fale brevemente em voz alta com o usuário antes de invocar esta ferramenta para avisar que está iniciando a ação.',
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
        description: 'Executa um comando no terminal do sistema operacional na raiz do projeto (ex: git status, git diff, npm test, mvn test). Fale em voz alta antes de executar comandos longos.',
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
              description: 'Caminho relativo do arquivo no projeto.'
            }
          },
          required: ['filePath']
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

  const actId = id || ('agy_' + Date.now());
  const label = 'Gemini CLI: ' + (instruction.length > 50 ? instruction.slice(0, 50) + '...' : instruction);
  _notifyToolActivity(actId, 'start', label, 'edit', 'execute_code_task');
  _notifyProgress('Executando tarefa com Gemini CLI instalado...', { instruction, cwd });

  try {
    const GeminiCliProvider = require('../providers/gemini-cli/GeminiCliProvider');
    if (GeminiCliProvider && typeof GeminiCliProvider.send === 'function') {
      const { state } = require('../../main/globals');
      const sender = (state.mainWindow && !state.mainWindow.isDestroyed())
        ? state.mainWindow.webContents
        : { send: () => {} };

      const result = await GeminiCliProvider.send(
        instruction,
        cwd,
        sender,
        null,
        []
      );

      _notifyToolActivity(actId, 'done', label, 'edit', 'execute_code_task');
      return {
        status: 'success',
        summary: (result && result.text) ? result.text : 'Tarefa concluída pelo Gemini CLI.',
        thinking: (result && result.thinking) ? result.thinking : null
      };
    }
  } catch (e) {
    console.warn('[GeminiLiveTools] Falha ao invocar GeminiCliProvider:', e.message);
  }

  // Fallback: Execução direta do comando agy --print
  const safeInstruction = instruction.replace(/"/g, '\\"');
  const cmd = `agy --mode accept-edits --dangerously-skip-permissions --print "${safeInstruction}"`;
  
  const { stdout, stderr } = await execAsync(cmd, {
    cwd,
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
    shell: true
  });

  _notifyToolActivity(actId, 'done', label, 'edit', 'execute_code_task');
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

function _notifyToolActivity(id, phase, label, kind = 'cmd', name = '') {
  try {
    const { state } = require('../../main/globals');
    const payload = { id, phase, label, kind, name };
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('ai-tool-activity', payload);
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
