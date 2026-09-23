/**
 * services/geminiLive/geminiLiveTools.js
 * 
 * Declaração e execução de ferramentas (Function Calling) para a Gemini Multimodal Live API.
 * Integração direta com Antigravity CLI (AGY), terminal local e inspeção de arquivos do workspace.
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
        description: 'Executa uma tarefa de codificação, refatoração, edição de código ou execução de testes no projeto local utilizando o Antigravity CLI (AGY). IMPORTANTE: Fale brevemente em voz alta com o usuário antes de invocar esta ferramenta para avisar que está iniciando a ação.',
        parameters: {
          type: 'OBJECT',
          properties: {
            instruction: {
              type: 'STRING',
              description: 'Instrução clara e detalhada da tarefa a ser executada no projeto.'
            },
            targetFiles: {
              type: 'ARRAY',
              items: { type: 'STRING' },
              description: 'Arquivos alvo principais da tarefa, se conhecidos.'
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
      outputResult = await _handleAgyCodeTask(args, cwd, context);
    } else if (name === 'run_terminal_command') {
      outputResult = await _handleTerminalCommand(args, cwd, context);
    } else if (name === 'read_workspace_file') {
      outputResult = await _handleReadFile(args, cwd, context);
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

async function _handleAgyCodeTask(args, cwd, context) {
  const instruction = (args && args.instruction) ? String(args.instruction) : '';
  if (!instruction.trim()) {
    return { status: 'error', message: 'Nenhuma instrução informada para a tarefa de código.' };
  }

  // Notifica janelas da interface sobre a tarefa em andamento
  _notifyProgress('Iniciando tarefa com Antigravity CLI...', { instruction, cwd });

  try {
    const GeminiCliProvider = require('../providers/gemini-cli/GeminiCliProvider');
    if (GeminiCliProvider && typeof GeminiCliProvider.send === 'function') {
      const mockSender = {
        send: (channel, data) => {
          _notifyProgress(`AGY: ${channel}`, data);
        }
      };

      const result = await GeminiCliProvider.send({
        userPrompt: instruction,
        projectPath: cwd,
        sender: mockSender,
        isContinue: false
      });

      return {
        status: 'success',
        summary: result.text || 'Tarefa executada pelo AGY.',
        thinking: result.thinking || null
      };
    }
  } catch (e) {
    console.warn('[GeminiLiveTools] Falha ao invocar GeminiCliProvider diretamente, tentando subprocesso agy CLI:', e.message);
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

  return {
    status: 'success',
    summary: stdout.slice(-2000) || 'Tarefa concluída no workspace.',
    details: stderr.slice(-500)
  };
}

async function _handleTerminalCommand(args, cwd, context) {
  const command = (args && args.command) ? String(args.command) : '';
  if (!command.trim()) {
    return { status: 'error', message: 'Comando de terminal vazio.' };
  }

  _notifyProgress(`Executando comando: ${command}`, { cwd });

  const { stdout, stderr } = await execAsync(command, {
    cwd,
    timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
    shell: true
  });

  return {
    status: 'success',
    stdout: stdout.slice(-3000),
    stderr: stderr.slice(-1000)
  };
}

async function _handleReadFile(args, cwd, context) {
  const relPath = (args && args.filePath) ? String(args.filePath) : '';
  if (!relPath.trim()) {
    return { status: 'error', message: 'Caminho de arquivo não informado.' };
  }

  const absPath = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
  if (!fs.existsSync(absPath)) {
    return { status: 'error', message: `Arquivo não encontrado: ${relPath}` };
  }

  const stats = fs.statSync(absPath);
  if (stats.size > 200 * 1024) {
    return { status: 'error', message: `Arquivo muito grande (${Math.round(stats.size / 1024)} KB). Máximo suportado: 200 KB.` };
  }

  const content = fs.readFileSync(absPath, 'utf8');
  return {
    status: 'success',
    filePath: relPath,
    content: content.slice(0, 15000)
  };
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
