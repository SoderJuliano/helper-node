// services/ollamaLocalService.js
// Cliente HTTP do Ollama rodando LOCALMENTE no PC do user (porta 11434).
// Sem fallback automático: se Ollama não estiver instalado/rodando ou se o
// modelo escolhido não estiver baixado, devolvemos erro AMIGÁVEL com o
// comando que o user precisa rodar.

const axios = require('axios');
const configService = require('./configService');
const {
  buildOllamaToolsAddon,
  parseOllamaToolCalls,
  stripToolCallBlocks,
  stripThinkingBlock,
} = require('./ollamaLocalParsing');

const DEFAULT_HOST = 'http://localhost:11434';

const OLLAMA_WRITE_TOOLS_BLOCKED = new Set(['writeFile', 'appendToFile', 'deleteFile', 'patchFile']);

// ─── Janela de contexto (num_ctx) ────────────────────────────────────────────
// O Ollama NÃO cresce a janela sozinho. Com um num_ctx fixo, tudo que passar
// dele é descartado EM SILÊNCIO — e o descarte conta prompt + o que o modelo
// está gerando. Era isso que fazia a resposta "começar e parar do nada": o
// modelo enchia a janela raciocinando, o Ollama mandava done e o app tratava
// como fim normal.
//
// Mesma estratégia que o pikachu já usa no servidor (OllamaClientAdapter.
// resolveNumCtx): dimensiona por request, então pergunta curta continua barata
// e prompt de agente recebe a janela de que precisa, até um teto.
//
// O PISO fica em 4096 de propósito, e não subi: o comentário que estava aqui
// registra que 8192 estourou a VRAM com modelo grande (35B) NESTA máquina. Não
// vou trocar um bug silencioso por um OOM silencioso. Então:
//   - a janela cresce sozinha com o TAMANHO DO PROMPT (aí truncar é sempre erro);
//   - se ainda assim o modelo encher a janela GERANDO, isso agora aparece na
//     tela (done_reason) em vez de sumir, e o usuário sobe o piso conscientemente
//     com HELPER_OLLAMA_MIN_CTX — que é o botão certo pra modelo que raciocina
//     muito. HELPER_OLLAMA_MAX_CTX mexe no teto.
const DEFAULT_MIN_NUM_CTX = 4096;
const DEFAULT_MAX_NUM_CTX = 32768;
const CHARS_PER_TOKEN = 3.0;      // conservador (código + PT-BR)
const OUTPUT_HEADROOM_TOKENS = 2048;

function envCtx(nome, padrao) {
  const raw = parseInt(process.env[nome] || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : padrao;
}

function resolveNumCtx(promptChars) {
  const floor = envCtx('HELPER_OLLAMA_MIN_CTX', DEFAULT_MIN_NUM_CTX);
  const cap = Math.max(envCtx('HELPER_OLLAMA_MAX_CTX', DEFAULT_MAX_NUM_CTX), floor);
  const estimated = Math.ceil((promptChars || 0) / CHARS_PER_TOKEN) + OUTPUT_HEADROOM_TOKENS;
  let ctx = floor;
  while (ctx < estimated && ctx < cap) ctx *= 2;
  return Math.min(ctx, cap);
}

function promptCharsOf(messages) {
  if (!Array.isArray(messages)) return 0;
  return messages.reduce((n, m) => n + String((m && m.content) || '').length, 0);
}


class OllamaLocalService {
    constructor() {
        this.sessions = {};
        this.activeAbortController = null;
        // Modelos que o Ollama recusou com think=true (400). Guardado pra não
        // pagar uma request perdida a cada iteração do tool loop.
        this._noThinking = new Set();
    }

    /**
     * POST /api/chat pedindo raciocínio visível.
     *
     * Modelo sem suporte a raciocínio faz o Ollama devolver 400 quando
     * think=true. Em vez de estourar isso na cara do usuário, repete sem o
     * parâmetro e anota o modelo — mesmo tratamento que o pikachu já faz no
     * servidor (OllamaClientAdapter.callGenerate).
     *
     * @returns {Promise<{res: Object, thinking: boolean}>}
     */
    async _postChat(host, model, messages, { stream, signal, responseType }) {
        const wantThinking = !this._noThinking.has(model);
        const numCtx = resolveNumCtx(promptCharsOf(messages));
        console.log(`[ollamaLocal] num_ctx=${numCtx} think=${wantThinking} (${promptCharsOf(messages)} chars de prompt)`);

        const body = {
            model,
            messages,
            stream: !!stream,
            options: { temperature: 0.7, num_ctx: numCtx },
        };
        if (wantThinking) body.think = true;

        const axiosOpts = {
            timeout: 0, // sem timeout de cliente: quem manda no fim é o Ollama
            signal,
            headers: { 'Content-Type': 'application/json' },
        };
        if (responseType) axiosOpts.responseType = responseType;
        if (stream) axiosOpts.headers.Connection = 'keep-alive';

        try {
            const res = await axios.post(`${host}/api/chat`, body, axiosOpts);
            return { res, thinking: wantThinking };
        } catch (err) {
            const status = err && err.response && err.response.status;
            if (status === 400 && wantThinking) {
                console.warn(`[ollamaLocal] ${model} recusou think=true; repetindo sem raciocínio.`);
                this._noThinking.add(model);
                const retry = { ...body };
                delete retry.think;
                retry.options = { ...retry.options, num_ctx: numCtx };
                const res = await axios.post(`${host}/api/chat`, retry, axiosOpts);
                return { res, thinking: false };
            }
            throw err;
        }
    }

    abortCurrentRequest() {
        if (this.activeAbortController) {
            this.activeAbortController.abort();
            this.activeAbortController = null;
        }
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
                `⚠️ **Ollama Local demorou demais pra responder.**`,
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

        let userMsg = { role: 'user', content: texto };
        if (opts.imageBase64) {
            const base64Data = opts.imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
            userMsg.images = [base64Data];
        }
        this.sessions[sessionId].messages.push(userMsg);
        this.sessions[sessionId].lastActivity = now;

        if (this.sessions[sessionId].messages.length > 13) {
            const sys = this.sessions[sessionId].messages[0];
            this.sessions[sessionId].messages = [sys, ...this.sessions[sessionId].messages.slice(-12)];
        }

        this.abortCurrentRequest();
        this.activeAbortController = new AbortController();
        const signal = this.activeAbortController.signal;

        let iter = 0;
        let lastResponseText = '';
        let toolsExecutedOk = 0;
        const ranSummary = [];

        try {
            while (iter < maxToolCalls) {
                if (signal.aborted) throw new Error("Request cancelled");
                console.log(`[ollamaLocal] → ${model} @ ${host} (msgs=${this.sessions[sessionId].messages.length}, iter=${iter + 1}/${maxToolCalls})`);
                const { res: r } = await this._postChat(
                    host, model, this.sessions[sessionId].messages,
                    { stream: false, signal }
                );

                const doneReason = String((r.data && r.data.done_reason) || '');
                if (doneReason && doneReason !== 'stop') {
                    console.warn(`[ollamaLocal] done_reason=${doneReason} — resposta possivelmente truncada.`);
                }

                let content = (r.data && r.data.message && r.data.message.content) || '';
                if (!content) {
                    throw new Error('Resposta vazia do Ollama');
                }

                content = stripThinkingBlock(content);
                lastResponseText = content;

                if (!effectiveTools || !onToolCall) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    this.activeAbortController = null;
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

            this.activeAbortController = null;
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
            this.activeAbortController = null;
            this.sessions[sessionId].messages.pop();
            const friendly = this._classifyError(err, model);
            console.error('[ollamaLocal] erro:', err && err.message);
            return friendly;
        }
    }

    async responderStream(texto, onChunk, onComplete, onError, opts = {}) {
        const fs = require('fs');
        const path = require('path');
        const isTesting = process.env.TESTING === 'true';
        const debugLogPath = path.join(__dirname, '..', isTesting ? 'ollama-debug-test.log' : 'ollama-debug.log');
        const logDebug = (msg) => {
            try {
                fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] ${msg}\n`);
            } catch (_) {}
        };
        
        try { fs.writeFileSync(debugLogPath, ''); } catch (_) {}
        logDebug(`responderStream chamado com texto: "${texto}"`);

        if (!texto) {
            logDebug(`Texto vazio. Chamando onError.`);
            if (onError) onError(new Error('Não entendi'));
            return;
        }
        const model = this._model();
        const host = this._host();
        const sessionId = opts.sessionId || 'default';
        const now = Date.now();
        const twoHours = 2 * 60 * 60 * 1000;

        if (this.sessions[sessionId] && (now - this.sessions[sessionId].lastActivity > twoHours)) {
            delete this.sessions[sessionId];
            logDebug('[ollamaLocal] sessão expirou');
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

        let userMsg = { role: 'user', content: texto };
        if (opts.imageBase64) {
            const base64Data = opts.imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
            userMsg.images = [base64Data];
        }
        this.sessions[sessionId].messages.push(userMsg);
        this.sessions[sessionId].lastActivity = now;

        if (this.sessions[sessionId].messages.length > 13) {
            const sys = this.sessions[sessionId].messages[0];
            this.sessions[sessionId].messages = [sys, ...this.sessions[sessionId].messages.slice(-12)];
        }

        this.abortCurrentRequest();
        this.activeAbortController = new AbortController();
        const signal = this.activeAbortController.signal;

        let modelLoaded = true;
        const psController = new AbortController();
        const psTimeout = setTimeout(() => {
            try { psController.abort(); } catch (_) {}
        }, 1500);

        try {
            const psRes = await axios.get(`${host}/api/ps`, {
                timeout: 1500,
                signal: psController.signal,
                headers: { 'Connection': 'close' }
            });
            clearTimeout(psTimeout);
            const loadedModels = psRes.data && psRes.data.models;
            if (Array.isArray(loadedModels)) {
                const loadedNames = loadedModels.map(m => m.name || m.model).filter(Boolean);
                modelLoaded = loadedNames.some(name => 
                    name === model || 
                    name.replace(/:latest$/, '') === model.replace(/:latest$/, '') ||
                    model.startsWith(name) ||
                    name.startsWith(model)
                );
            }
        } catch (_) {
            clearTimeout(psTimeout);
            // ignore failure
        }

        if (!modelLoaded && onChunk) {
            onChunk({
                type: 'thinking',
                text: `⚙️ [Ollama: Carregando o modelo \`${model}\` na memória/VRAM (isso pode levar de 10 a 60 segundos)...]\n`,
                event: 'thinking'
            });
        }

        let iter = 0;
        let lastResponseText = '';
        let toolsExecutedOk = 0;
        const ranSummary = [];
        const callCounts = new Map();

        try {
            while (iter < maxToolCalls) {
                if (signal.aborted) throw new Error("Request cancelled");
                if (iter > 0 && onChunk) {
                    onChunk({
                        type: 'thinking',
                        text: `\n⚙️ [Ollama: Processando o resultado da(s) ferramenta(s)...]\n`,
                        event: 'thinking'
                    });
                }
                
                logDebug(`\n--- ITERATION ${iter + 1} ---`);
                logDebug(`Messages sent: ${JSON.stringify(this.sessions[sessionId].messages, null, 2)}`);

                console.log(`[ollamaLocal-stream] → ${model} @ ${host} (msgs=${this.sessions[sessionId].messages.length}, iter=${iter + 1}/${maxToolCalls})`);
                
                const { createStreamRouter } = require('./backendStreamRouter');
                const router = createStreamRouter({ onChunk, hasTools: !!(effectiveTools && onToolCall) });

                const { res: r } = await this._postChat(
                    host, model, this.sessions[sessionId].messages,
                    { stream: true, signal, responseType: 'stream' }
                );

                // Por que o Ollama parou. Só "stop" é fim natural — "length"
                // (encheu a janela de contexto) e o resto precisam aparecer pro
                // usuário, senão uma resposta cortada no meio é indistinguível
                // de uma resposta que acabou.
                let doneReason = '';

                await new Promise((resolve, reject) => {
                    const stream = r.data;
                    let buffer = '';

                    const processLine = (line) => {
                        logDebug(`Line read: "${line}"`);
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.error) {
                                logDebug(`Ollama parsed error: ${parsed.error}`);
                                cleanup();
                                try { stream.destroy(); } catch (_) {}
                                reject(new Error(parsed.error));
                                return true;
                            }
                            // Raciocínio vem em campo PRÓPRIO (message.thinking)
                            // quando think=true. Antes só se lia .content, então
                            // a fase inteira de raciocínio — que num modelo
                            // pensante é a maior parte do tempo — não aparecia
                            // na janela: o usuário via o cursor parado e nada
                            // acontecendo.
                            const reasoning = parsed.message && parsed.message.thinking;
                            if (reasoning) {
                                router.emitThinking(reasoning);
                            }
                            const token = parsed.message && parsed.message.content;
                            if (token) {
                                router.routeToken(token);
                            }
                            if (parsed.done) {
                                doneReason = String(parsed.done_reason || '');
                                logDebug(`Ollama done flag received (done_reason=${doneReason || 'n/a'}). Resolving early.`);
                                cleanup();
                                try { stream.destroy(); } catch (_) {}
                                resolve();
                                return true;
                            }
                        } catch (err) {
                            logDebug(`Error parsing JSON: ${err.message}`);
                            console.error('Error parsing Ollama stream line:', err);
                        }
                        return false;
                    };
                    
                    const onStreamData = (chunk) => {
                        const chunkStr = chunk.toString('utf8');
                        logDebug(`Chunk data: ${chunkStr}`);
                        buffer += chunkStr;
                        let lineEndIndex;
                        while ((lineEndIndex = buffer.indexOf('\n')) !== -1) {
                            const line = buffer.slice(0, lineEndIndex).trim();
                            buffer = buffer.slice(lineEndIndex + 1);
                            if (line) {
                                const isError = processLine(line);
                                if (isError) return;
                            }
                        }
                    };

                    const onStreamEnd = () => {
                        logDebug(`Stream end event. Buffer: "${buffer}"`);
                        if (buffer.trim()) {
                            processLine(buffer.trim());
                        }
                        cleanup();
                        resolve();
                    };

                    const onStreamError = (err) => {
                        logDebug(`Stream error event: ${err.message}`);
                        cleanup();
                        reject(err);
                    };

                    const cleanup = () => {
                        stream.removeListener('data', onStreamData);
                        stream.removeListener('end', onStreamEnd);
                        stream.removeListener('error', onStreamError);
                        signal.removeEventListener('abort', onAbort);
                    };

                    const onAbort = () => {
                        cleanup();
                        reject(new Error("Request cancelled"));
                    };

                    stream.on('data', onStreamData);
                    stream.on('end', onStreamEnd);
                    stream.on('error', onStreamError);
                    signal.addEventListener('abort', onAbort);
                });

                // Fim que NÃO é "stop" precisa ser dito. O caso que morde é
                // done_reason="length": o Ollama encheu num_ctx e parou no meio
                // da frase, mas manda done=true igual a um fim normal — pro app
                // era indistinguível, e a resposta simplesmente sumia no meio.
                if (doneReason && doneReason !== 'stop') {
                    const aviso = doneReason === 'length'
                        ? `\n\n_⚠️ O modelo parou por falta de contexto (num_ctx cheio), não por ter terminado. ` +
                          `Se repetir, suba o piso da janela com \`HELPER_OLLAMA_MIN_CTX\` (ex.: 8192) — ` +
                          `custa VRAM, então se der erro de memória volte pro padrão e use um modelo menor._`
                        : `\n\n_⚠️ O Ollama encerrou com \`done_reason=${doneReason}\` — a resposta pode estar incompleta._`;
                    logDebug(`done_reason anormal: ${doneReason}`);
                    console.warn(`[ollamaLocal-stream] done_reason=${doneReason} — resposta possivelmente truncada.`);
                    if (onChunk) onChunk(aviso);
                }

                let content = router.answer || '';
                content = stripThinkingBlock(content);

                logDebug(`End of iteration ${iter + 1}. Content: "${content}" | Thinking: "${router.thinking}"`);
                
                if (!content && !router.thinking) {
                    logDebug(`Error: Empty response from Ollama`);
                    throw new Error('Resposta vazia do Ollama');
                }

                lastResponseText = content;

                if (!effectiveTools || !onToolCall) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    this.activeAbortController = null;
                    if (onComplete) onComplete();
                    return;
                }

                const calls = parseOllamaToolCalls(content);
                if (!calls.length) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    const cleanText = stripToolCallBlocks(content).trim();
                    if (!router.streamedAnything && onChunk && cleanText) {
                        onChunk(cleanText);
                    }
                    this.activeAbortController = null;
                    if (onComplete) onComplete();
                    return;
                }

                console.log(`[ollamaLocal-stream][tools] iter=${iter + 1}/${maxToolCalls} — ${calls.length} tool_call(s) detectada(s)`);
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
                    console.log(`[ollamaLocal-stream][tools] → ${name}(${JSON.stringify(args).slice(0, 120)})`);
                    
                    let toolResult;
                    const knownToolNames = new Set([
                        'listDir','fileInfo','readFile','readFileChunk','searchInFiles','findFiles',
                        'detectShellConfig','listPackages','listDesktopApps','systemPowerAction',
                        'writeFile','appendToFile','deleteFile','patchFile','runCommand','runShellAdvanced'
                    ]);

                    if (!knownToolNames.has(name)) {
                        console.warn(`[ollamaLocal-stream][tools] ⚠️ tool desconhecida ignorada: "${name}"`);
                        toolResult = { error: `Ferramenta "${name}" não existe. Use apenas as ferramentas listadas. Escreva a RESPOSTA FINAL ao usuário agora.` };
                    } else {
                        if (onChunk) {
                            onChunk({ type: 'thinking', text: `\n⚙️ Executando ${name}...\n` });
                        }
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

                let repeticao = '';
                for (const c of calls) {
                    const sig = `${c.obj.name}:${JSON.stringify(c.obj.args || {})}`;
                    const n = (callCounts.get(sig) || 0) + 1;
                    callCounts.set(sig, n);
                    if (n >= 3) {
                        repeticao = '\n\nPARE. Você já chamou ' + c.obj.name + ' com esses ' +
                            'mesmos argumentos ' + n + ' vezes e o resultado está acima. ' +
                            'NÃO repita essa chamada. Responda AGORA em texto normal, sem ' +
                            'nenhum TOOL_CALL, com o que você já descobriu.';
                    } else if (n === 2) {
                        repeticao = '\n\nATENÇÃO: essa chamada é repetida — o resultado já ' +
                            'está no histórico acima. Use o que já tem e dê o PRÓXIMO passo ' +
                            '(outra ferramenta, outro path) ou responda em texto.';
                    }
                }
                if (repeticao && onChunk) {
                    onChunk({ type: 'thinking', text: '\n⚠️ Chamada repetida — cobrando o próximo passo.\n' });
                }

                const followupSuffix = `\n\nCom base nos TOOL_RESULT acima, ou emita novos TOOL_CALL se precisar de mais info, ou escreva a RESPOSTA FINAL ao usuario (sem nenhum TOOL_CALL).`;
                const userFollowup = `${results.join('\n\n')}${followupSuffix}${repeticao}`;
                
                this.sessions[sessionId].messages.push({ role: 'user', content: userFollowup });
                iter++;
            }

            this.activeAbortController = null;
            if (effectiveTools && onToolCall) {
                const stripped = stripToolCallBlocks(lastResponseText);
                if (stripped && stripped.trim()) {
                    if (onChunk) onChunk(stripped);
                } else if (toolsExecutedOk > 0 && ranSummary.length) {
                    if (onChunk) onChunk(`Pronto! Comandos executados:\n\n${ranSummary.join('\n')}`);
                } else {
                    if (onChunk) onChunk('Não consegui concluir essa tarefa com ferramentas. Tente reformular a pergunta.');
                }
            }

            if (onComplete) onComplete();

        } catch (err) {
            this.activeAbortController = null;
            this.sessions[sessionId].messages.pop();
            console.error('[ollamaLocal-stream] erro:', err && err.message);
            const friendly = this._classifyError(err, model);
            if (onError) onError(new Error(friendly));
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
