// services/ollamaLocalService.js
// Cliente HTTP do Ollama rodando LOCALMENTE no PC do user (porta 11434).
// Sem fallback automático: se Ollama não estiver instalado/rodando ou se o
// modelo escolhido não estiver baixado, devolvemos erro AMIGÁVEL com o
// comando que o user precisa rodar.

const axios = require('axios');
const configService = require('./configService');

const DEFAULT_HOST = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 120000; // 2 min — modelos locais podem ser lentos no primeiro token

const OLLAMA_WRITE_TOOLS_BLOCKED = new Set(['writeFile', 'appendToFile', 'deleteFile', 'patchFile']);

function buildOllamaToolsAddon(toolsSchema, wsPaths = []) {
  if (!Array.isArray(toolsSchema) || toolsSchema.length === 0) return '';
  const ws0 = wsPaths[0] || '/abs/path';
  const lines = ['', '═══ TOOL CALLING (modo Ollama) ═══', ''];
  lines.push('Voce tem acesso a estas ferramentas. Para chamar uma, emita NA RESPOSTA');
  lines.push('um bloco EXATO no formato (uma linha, JSON puro, sem markdown ao redor):');
  lines.push('');
  lines.push('TOOL_CALL: {"name":"<nome>","args":{...}}');
  lines.push('');
  lines.push('Pode emitir VARIOS TOOL_CALL na mesma resposta. O sistema executa cada um');
  lines.push('e devolve TOOL_RESULT: <name> <json> na proxima mensagem. Iterate ate ter');
  lines.push('todas as informacoes que precisa, dai escreva a RESPOSTA FINAL ao usuario');
  lines.push('SEM nenhum TOOL_CALL (resposta normal em texto/markdown).');
  lines.push('');
  lines.push('FERRAMENTAS DISPONIVEIS:');
  for (const t of toolsSchema) {
    const fn = t.function || t;
    const name = fn.name;
    const desc = (fn.description || '').replace(/\n/g, ' ').slice(0, 200);
    const params = fn.parameters && fn.parameters.properties
      ? Object.entries(fn.parameters.properties)
          .map(([k, v]) => `${k}:${v.type || '?'}`)
          .join(', ')
      : '';
    lines.push(`- ${name}(${params}) — ${desc}`);
  }
  lines.push('');
  lines.push('REGRAS:');
  lines.push('- TOOL_CALL deve ser JSON valido EXATO. Nada de comentarios, sem ``` ao redor.');
  lines.push('- Tools mutates (writeFile, deleteFile, patchFile, appendToFile, systemPowerAction)');
  lines.push('  abrem confirmacao visual pro usuario — chame quando faz sentido, sem medo.');
  lines.push('- Quando terminar (resposta final ao usuario), NAO inclua TOOL_CALL nenhum.');
  lines.push('- Para LER: use listDir + readFile.');
  lines.push('- Para EDITAR (adicionar linha, mudar trecho): use patchFile — NAO writeFile.');
  lines.push('  writeFile APAGA O ARQUIVO INTEIRO e reescreve do zero. So use writeFile para CRIAR arquivo novo.');
  lines.push('  patchFile substitui apenas o trecho exato — use para qualquer edicao em arquivo existente.');
  lines.push('');
  lines.push('EXEMPLOS CONCRETOS (siga EXATAMENTE este formato):');
  lines.push('');
  lines.push('User: "cria um readme pro projeto"');
  lines.push('Resposta correta (UMA linha, sem markdown, sem texto antes):');
  lines.push(`TOOL_CALL: {"name":"writeFile","args":{"path":"${ws0}/README.md","content":"# Titulo\\n\\nDescricao...","reason":"Criar README"}}`);
  lines.push('');
  lines.push('User: "o que tem no arquivo de config?"');
  lines.push('Resposta correta:');
  lines.push(`TOOL_CALL: {"name":"readFile","args":{"path":"${ws0}/package.json"}}`);
  lines.push('');
  lines.push('ERRADO (NAO FACA): explicar o que vai fazer, usar ```markdown ao redor,');
  lines.push('inventar texto tipo "Texto explicativo:" ou "Vou criar...". Apenas EMITA o TOOL_CALL.');
  lines.push('');
  return lines.join('\n');
}

function parseOllamaToolCalls(text) {
  if (!text) return [];
  const calls = [];
  const re = /TOOL[_\s-]*CALL\s*:?\s*/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const jsonStart = text.indexOf('{', start);
    if (jsonStart === -1 || jsonStart - start > 120) continue;
    const objStr = extractFirstJsonObject(text.slice(jsonStart));
    if (!objStr) continue;
    try {
      const obj = JSON.parse(objStr);
      if (obj && obj.name) {
        calls.push({ raw: text.slice(m.index, jsonStart + objStr.length), obj });
        re.lastIndex = jsonStart + objStr.length;
      }
    } catch (_) {}
  }
  if (calls.length === 0) {
    const shellRe = /TOOL[_\s-]*CALL\s*:?\s*([a-z][^\n`{]+)/gi;
    let sm;
    while ((sm = shellRe.exec(text)) !== null) {
      const raw = sm[1].trim().replace(/^`+|`+$/g, '').trim();
      if (!raw || raw.startsWith('{')) continue;
      const parts = raw.split(/\s+/);
      const cmd = parts[0];
      const knownCmds = ['git','npm','ls','cat','find','grep','echo','node','python','pip','curl','wget','mkdir','cp','mv','rm'];
      if (!knownCmds.includes(cmd)) continue;
      const obj = { name: 'runCommand', args: { cmd, args: parts.slice(1) } };
      calls.push({ raw: sm[0], obj });
    }
  }
  if (calls.length === 0) {
    const fenceRe = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
    let fm;
    while ((fm = fenceRe.exec(text)) !== null) {
      try {
        const obj = JSON.parse(fm[1]);
        if (obj && obj.name && typeof obj.name === 'string') {
          calls.push({ raw: fm[0], obj });
        }
      } catch (_) {}
    }
    if (calls.length === 0) {
      const knownNames = new Set(
        ['listDir','fileInfo','readFile','readFileChunk','searchInFiles','findFiles',
         'detectShellConfig','listPackages','listDesktopApps','systemPowerAction',
         'writeFile','appendToFile','deleteFile','patchFile','runCommand','runShellAdvanced']
      );
      let i = 0;
      while (i < text.length) {
        const open = text.indexOf('{', i);
        if (open === -1) break;
        const objStr = extractFirstJsonObject(text.slice(open));
        if (!objStr) break;
        try {
          const obj = JSON.parse(objStr);
          if (obj && obj.name && knownNames.has(obj.name)) {
            calls.push({ raw: objStr, obj });
          }
        } catch (_) {}
        i = open + (objStr ? objStr.length : 1);
      }
    }
  }
  return calls;
}

function extractFirstJsonObject(s) {
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function stripToolCallBlocks(text) {
  if (!text) return text;
  const calls = parseOllamaToolCalls(text);
  let out = text;
  for (const c of calls) {
    out = out.split(c.raw).join('');
  }
  out = stripDanglingToolCallFragments(out);
  out = out.replace(/```\s*\n\s*```/g, '').trim();
  return out;
}

function stripDanglingToolCallFragments(text) {
  if (!text) return text;
  let out = text.replace(/```[\s\S]*?TOOL_CALL[\s\S]*?```/gi, '');
  const re = /TOOL_CALL\s*:?\s*/gi;
  let m;
  let cursor = 0;
  let cleaned = '';
  while ((m = re.exec(out)) !== null) {
    cleaned += out.slice(cursor, m.index);
    const afterMarker = m.index + m[0].length;
    const jsonStart = out.indexOf('{', afterMarker);
    if (jsonStart === -1 || jsonStart - afterMarker > 12) {
      const nextNl = out.indexOf('\n', afterMarker);
      cursor = nextNl === -1 ? out.length : nextNl + 1;
      re.lastIndex = cursor;
      continue;
    }
    const objStr = extractFirstJsonObject(out.slice(jsonStart));
    if (objStr) {
      cursor = jsonStart + objStr.length;
      re.lastIndex = cursor;
      continue;
    }
    const nextNl = out.indexOf('\n', jsonStart);
    cursor = nextNl === -1 ? out.length : nextNl + 1;
    re.lastIndex = cursor;
  }
  cleaned += out.slice(cursor);
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function stripThinkingBlock(text) {
  if (!text) return text;
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

class OllamaLocalService {
    constructor() {
        this.sessions = {};
    }

    _host() {
        const h = configService.getOllamaLocalHost && configService.getOllamaLocalHost();
        return (h || DEFAULT_HOST).replace(/\/$/, '');
    }

    _model() {
        return (configService.getOllamaLocalModel && configService.getOllamaLocalModel())
            || 'qwen2.5-coder:7b';
    }

    async ping() {
        try {
            const r = await axios.get(`${this._host()}/api/tags`, { timeout: 3000 });
            return Array.isArray(r.data && r.data.models);
        } catch (_) {
            return false;
        }
    }

    async listInstalledModels() {
        try {
            const r = await axios.get(`${this._host()}/api/tags`, { timeout: 3000 });
            return (r.data && r.data.models || []).map(m => m.name || m.model).filter(Boolean);
        } catch (_) {
            return null;
        }
    }

    _classifyError(err, model) {
        const code = err && err.code;
        const status = err && err.response && err.response.status;
        const body = err && err.response && err.response.data;
        if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
            return [
                '⚠️ **Ollama Local não está rodando.**',
                '',
                'Verifique se você instalou e iniciou o Ollama:',
                '',
                '```bash',
                '# Instalar (Linux):',
                'curl -fsSL https://ollama.com/install.sh | sh',
                '',
                '# Iniciar serviço:',
                'ollama serve',
                '',
                '# Ou em outro terminal, baixar o modelo selecionado:',
                `ollama pull ${model}`,
                '```',
                '',
                'Mais detalhes em: https://ollama.com/download',
                '',
                'Depois, volte e tente novamente. Se preferir, troque o provider em **Configurações** pra ChatGPT.',
            ].join('\n');
        }
        const msg = (body && (body.error || body.message)) || '';
        if (status === 404 || /not found|no such model|pull/i.test(String(msg))) {
            return [
                `⚠️ **Modelo \`${model}\` não está baixado localmente.**`,
                '',
                'Rode no terminal:',
                '',
                '```bash',
                `ollama pull ${model}`,
                '```',
                '',
                'O download pode demorar alguns minutos (4–9 GB dependendo do modelo).',
                'Você pode acompanhar o progresso no terminal.',
            ].join('\n');
        }
        if (code === 'ECONNABORTED' || /timeout/i.test(String(err && err.message))) {
            return [
                `⚠️ **Ollama Local demorou demais pra responder (${REQUEST_TIMEOUT_MS / 1000}s).**`,
                '',
                'Possíveis causas:',
                `- Modelo \`${model}\` muito pesado pra sua GPU/CPU`,
                '- Primeira execução (Ollama está carregando o modelo na RAM)',
                '',
                'Tente um modelo menor nas Configurações ou aguarde e refaça a pergunta.',
            ].join('\n');
        }
        return [
            '⚠️ **Erro ao chamar Ollama Local.**',
            '',
            `Detalhe: ${(err && err.message) || 'desconhecido'}${msg ? ` — ${msg}` : ''}`,
            '',
            'Verifique se `ollama serve` está rodando e tente novamente.',
        ].join('\n');
    }

    async responder(texto, opts = {}) {
        if (!texto) throw new Error('Não entendi');
        const model = this._model();
        const host = this._host();
        const sessionId = opts.sessionId || 'default';
        const now = Date.now();
        const twoHours = 2 * 60 * 60 * 1000;

        if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
            delete this.sessions[sessionId];
            console.log('[ollamaLocal] sessão expirou');
        }

        const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
        const onToolCall = typeof opts.onToolCall === 'function' ? opts.onToolCall : null;
        const maxToolCalls = Number.isInteger(opts.maxToolCalls) ? opts.maxToolCalls : 50;

        let wsPaths = [];
        try {
            const workspace = require('./workspace');
            const wsEnabled = !!(configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled());
            if (wsEnabled && workspace.list().length > 0) {
                wsPaths = workspace.list().map(a => a.path).filter(Boolean);
            }
        } catch (_) {}

        let effectiveTools = tools;
        if (tools) {
            effectiveTools = tools.filter(t => {
                const name = (t.function || t).name;
                return !OLLAMA_WRITE_TOOLS_BLOCKED.has(name);
            });
        }

        const baseSystemPrompt = opts.instruction || configService.getPromptInstruction() || 'You are a helpful assistant.';
        let systemPromptContent = baseSystemPrompt;
        if (effectiveTools && onToolCall) {
            systemPromptContent = `${systemPromptContent}\n\n${buildOllamaToolsAddon(effectiveTools, wsPaths)}`;
        }

        if (!this.sessions[sessionId]) {
            this.sessions[sessionId] = {
                messages: [
                    { role: 'system', content: systemPromptContent },
                ],
                lastActivity: now,
            };
        } else {
            this.sessions[sessionId].messages[0].content = systemPromptContent;
        }

        this.sessions[sessionId].messages.push({ role: 'user', content: texto });
        this.sessions[sessionId].lastActivity = now;

        if (this.sessions[sessionId].messages.length > 13) {
            const sys = this.sessions[sessionId].messages[0];
            this.sessions[sessionId].messages = [sys, ...this.sessions[sessionId].messages.slice(-12)];
        }

        let iter = 0;
        let lastResponseText = '';
        let toolsExecutedOk = 0;
        const ranSummary = [];

        try {
            while (iter < maxToolCalls) {
                console.log(`[ollamaLocal] → ${model} @ ${host} (msgs=${this.sessions[sessionId].messages.length}, iter=${iter + 1}/${maxToolCalls})`);
                const r = await axios.post(
                    `${host}/api/chat`,
                    {
                        model,
                        messages: this.sessions[sessionId].messages,
                        stream: false,
                        options: {
                            temperature: 0.7,
                            num_ctx: 8192,
                        },
                    },
                    { timeout: REQUEST_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } }
                );
                
                let content = (r.data && r.data.message && r.data.message.content) || '';
                if (!content) {
                    throw new Error('Resposta vazia do Ollama');
                }
                
                content = stripThinkingBlock(content);
                lastResponseText = content;

                if (!effectiveTools || !onToolCall) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    return content;
                }

                const calls = parseOllamaToolCalls(content);
                if (!calls.length) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    break;
                }

                console.log(`[ollamaLocal][tools] iter=${iter + 1}/${maxToolCalls} — ${calls.length} tool_call(s) detectada(s)`);
                this.sessions[sessionId].messages.push({ role: 'assistant', content });

                const results = [];
                for (const c of calls) {
                    const name = c.obj.name;
                    const rawArgs = c.obj.args || c.obj.arguments || {};
                    let args = rawArgs;
                    if (args && args.command && !args.cmd) {
                        const parts = String(args.command).trim().split(/\s+/);
                        args = { ...args, cmd: parts[0], args: parts.slice(1) };
                        delete args.command;
                        c.obj.args = args;
                    }
                    console.log(`[ollamaLocal][tools] → ${name}(${JSON.stringify(args).slice(0, 120)})`);
                    
                    let toolResult;
                    const knownToolNames = new Set([
                        'listDir','fileInfo','readFile','readFileChunk','searchInFiles','findFiles',
                        'detectShellConfig','listPackages','listDesktopApps','systemPowerAction',
                        'writeFile','appendToFile','deleteFile','patchFile','runCommand','runShellAdvanced'
                    ]);

                    if (!knownToolNames.has(name)) {
                        console.warn(`[ollamaLocal][tools] ⚠️ tool desconhecida ignorada: "${name}"`);
                        toolResult = { error: `Ferramenta "${name}" não existe. Use apenas as ferramentas listadas. Escreva a RESPOSTA FINAL ao usuário agora.` };
                    } else {
                        try {
                            toolResult = await onToolCall(name, args, { source: 'ollama-tool-loop' });
                        } catch (e) {
                            toolResult = { error: String(e && e.message || e) };
                        }
                        if (toolResult && toolResult.ok !== false) {
                            toolsExecutedOk++;
                            if (name === 'runCommand') {
                                const cmdline = `${args.cmd || ''} ${(Array.isArray(args.args) ? args.args : []).join(' ')}`.trim();
                                const exit = toolResult.result && typeof toolResult.result.exitCode === 'number' ? toolResult.result.exitCode : '?';
                                ranSummary.push(`✓ \`${cmdline}\` (exit=${exit})`);
                            } else {
                                ranSummary.push(`✓ ${name}`);
                            }
                        }
                    }

                    let serialized;
                    try { serialized = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult); }
                    catch (_) { serialized = String(toolResult); }
                    if (serialized.length > 8 * 1024) serialized = serialized.slice(0, 8 * 1024) + '\n…[truncated]';
                    results.push(`TOOL_RESULT: ${name}\n${serialized}`);
                }

                const followupSuffix = `\n\nCom base nos TOOL_RESULT acima, ou emita novos TOOL_CALL se precisar de mais info, ou escreva a RESPOSTA FINAL ao usuario (sem nenhum TOOL_CALL).`;
                const userFollowup = `${results.join('\n\n')}${followupSuffix}`;
                
                this.sessions[sessionId].messages.push({ role: 'user', content: userFollowup });
                iter++;
            }

            if (effectiveTools && onToolCall) {
                const stripped = stripToolCallBlocks(lastResponseText);
                if (stripped && stripped.trim()) {
                    return stripped;
                } else if (toolsExecutedOk > 0 && ranSummary.length) {
                    return `Pronto! Comandos executados:\n\n${ranSummary.join('\n')}`;
                } else {
                    return 'Não consegui concluir essa tarefa com ferramentas. Tente reformular a pergunta.';
                }
            }

            return lastResponseText;

        } catch (err) {
            this.sessions[sessionId].messages.pop();
            const friendly = this._classifyError(err, model);
            console.error('[ollamaLocal] erro:', err && err.message);
            return friendly;
        }
    }

    async preloadModel(oldModel, newModel) {
        const os = require('os');
        const host = this._host();
        
        // Verifica se há pelo menos 4GB de RAM livre antes de tentar fazer preload (evitar travar pc com pouca memoria)
        const freeRamGB = os.freemem() / (1024 ** 3);
        const hasEnoughRam = freeRamGB > 4.0;
        
        if (oldModel && oldModel !== newModel) {
            try {
                console.log(`[ollamaLocal] Descarregando modelo anterior: ${oldModel}`);
                await axios.post(`${host}/api/generate`, {
                    model: oldModel,
                    keep_alive: 0
                }, { timeout: 10000 });
            } catch (err) {
                console.log(`[ollamaLocal] Erro ao descarregar modelo anterior (${oldModel}):`, err && err.message);
            }
        }

        if (newModel) {
            if (!hasEnoughRam) {
                console.log(`[ollamaLocal] RAM livre insuficiente (${freeRamGB.toFixed(1)}GB) para pre-load seguro do modelo ${newModel}. O Ollama o carregará sob demanda.`);
                return;
            }
            try {
                console.log(`[ollamaLocal] Carregando novo modelo antecipadamente: ${newModel} (keep_alive: 30m). RAM livre: ${freeRamGB.toFixed(1)}GB`);
                // Envia prompt vazio só pra forçar o carregamento do modelo na memória
                await axios.post(`${host}/api/generate`, {
                    model: newModel,
                    keep_alive: "30m"
                }, { timeout: 120000 }); // Permite até 2 min para carregar
                console.log(`[ollamaLocal] Modelo ${newModel} carregado com sucesso.`);
            } catch (err) {
                console.log(`[ollamaLocal] Erro ao carregar novo modelo (${newModel}):`, err && err.message);
            }
        }
    }

    resetSession() {
        delete this.sessions['default'];
    }
}

module.exports = new OllamaLocalService();
