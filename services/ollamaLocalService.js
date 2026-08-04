// services/ollamaLocalService.js
// Cliente HTTP do Ollama rodando LOCALMENTE no PC do user (porta 11434).
// Sem fallback automático: se Ollama não estiver instalado/rodando ou se o
// modelo escolhido não estiver baixado, devolvemos erro AMIGÁVEL com o
// comando que o user precisa rodar.
//
// Dois protocolos de ferramenta convivem aqui, e a escolha é do Ollama:
//   - NATIVO  (tools[] em /api/chat, message.tool_calls tipado) quando
//     /api/show diz que o modelo suporta. É o caminho bom.
//   - TEXTO   ("TOOL_CALL: {...}" parseado da resposta) pro resto.
// Ver services/ollamaLocalCaps.js pra por que a decisão é sondada e não chutada.

const axios = require('axios');
const configService = require('./configService');
const {
  parseOllamaToolCalls,
  stripToolCallBlocks,
  stripThinkingBlock,
} = require('./ollamaLocalParsing');
const { prepareTurn, executeCalls, trimSession } = require('./ollamaLocalTurn');
const caps = require('./ollamaLocalCaps');

const DEFAULT_HOST = 'http://localhost:11434';

// O Ollama recusou tools[] no meio do turno: refaz em protocolo de texto.
const SEM_TOOLS_NATIVAS = '__OLLAMA_SEM_TOOLS_NATIVAS__';

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

/** message.tool_calls do Ollama → [{name, args}]. */
function normalizarChamadasNativas(toolCalls) {
  const out = [];
  for (const tc of toolCalls || []) {
    const fn = (tc && tc.function) || tc;
    if (!fn || !fn.name) continue;
    let args = fn.arguments != null ? fn.arguments : fn.args;
    // A API devolve objeto; alguns builds mandam a string JSON.
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch (_) { args = {}; }
    }
    out.push({ name: fn.name, args: args || {} });
  }
  return out;
}

/** Saída do parseOllamaToolCalls → mesmo formato. */
function normalizarChamadasTexto(calls) {
  return calls.map((c) => ({ name: c.obj.name, args: c.obj.args || c.obj.arguments || {} }));
}

/**
 * Tira do texto final o que sobrou do protocolo — SÓ quando o protocolo é o de
 * texto. No modo nativo a resposta é prosa comum, e o parser tem um fallback que
 * varre qualquer {...} procurando nome de ferramenta: um exemplo de JSON dentro
 * da resposta ("o package.json ficou assim: {...}") seria apagado da tela.
 */
function limparProtocolo(texto, nativeTools) {
  return nativeTools ? String(texto || '') : stripToolCallBlocks(texto);
}

const SUFIXO_FOLLOWUP =
  '\n\nCom base nos TOOL_RESULT acima, ou emita novos TOOL_CALL se precisar de ' +
  'mais info, ou escreva a RESPOSTA FINAL ao usuario (sem nenhum TOOL_CALL).';

/** Cobrança quando o modelo repete a MESMA chamada — sintoma de estar preso. */
function cobrancaRepeticao(chamadas, contagens) {
  let texto = '';
  for (const c of chamadas) {
    const assinatura = `${c.name}:${JSON.stringify(c.args || {})}`;
    const n = (contagens.get(assinatura) || 0) + 1;
    contagens.set(assinatura, n);
    if (n >= 3) {
      texto = `\n\nPARE. Você já chamou ${c.name} com esses mesmos argumentos ${n} vezes ` +
        `e o resultado está acima. NÃO repita essa chamada. Responda AGORA em texto ` +
        `normal, com o que você já descobriu.`;
    } else if (n === 2) {
      texto = '\n\nATENÇÃO: essa chamada é repetida — o resultado já está no histórico ' +
        'acima. Use o que já tem e dê o PRÓXIMO passo (outra ferramenta, outro path) ' +
        'ou responda em texto.';
    }
  }
  return texto;
}

class OllamaLocalService {
    constructor() {
        this.sessions = {};
        this.activeAbortController = null;
        // Modelos que o Ollama recusou com think=true (400). Guardado pra não
        // pagar uma request perdida a cada iteração do tool loop.
        this._noThinking = new Set();
        // Modelos que recusaram tools[] apesar do /api/show — mesma ideia.
        this._noNativeTools = new Set();
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
    async _postChat(host, model, messages, { stream, signal, responseType, tools }) {
        const wantThinking = !this._noThinking.has(model);
        const numCtx = resolveNumCtx(promptCharsOf(messages));
        console.log(`[ollamaLocal] num_ctx=${numCtx} think=${wantThinking} tools=${tools ? tools.length : 0} (${promptCharsOf(messages)} chars de prompt)`);

        const body = {
            model,
            messages,
            stream: !!stream,
            options: { temperature: 0.7, num_ctx: numCtx },
        };
        if (wantThinking) body.think = true;
        if (tools && tools.length) body.tools = tools;

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
            const detalhe = String(
              (err && err.response && err.response.data && (err.response.data.error || err.response.data.message)) || ''
            );

            // Recusou as ferramentas: o /api/show mentiu (ou é Ollama antigo).
            // Quem chamou refaz o turno inteiro no protocolo de texto — não dá
            // pra só remover tools[], porque o prompt de sistema seria o do
            // modo nativo, sem o formato do TOOL_CALL.
            if (status === 400 && tools && tools.length && /tool/i.test(detalhe)) {
                console.warn(`[ollamaLocal] ${model} recusou tools nativas ("${detalhe.slice(0, 120)}") — refazendo em protocolo de texto.`);
                this._noNativeTools.add(model);
                throw new Error(SEM_TOOLS_NATIVAS);
            }

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

    /** Empilha o resultado das ferramentas no formato de cada protocolo. */
    _empilharResultados(sessionId, { nativeTools, content, chamadas, results, cobranca }) {
        const msgs = this.sessions[sessionId].messages;
        if (nativeTools) {
            msgs.push({
                role: 'assistant',
                content: content || '',
                tool_calls: chamadas.map((c) => ({ function: { name: c.name, arguments: c.args } })),
            });
            for (const r of results) {
                msgs.push({ role: 'tool', tool_name: r.name, content: r.serialized });
            }
            if (cobranca) msgs.push({ role: 'user', content: cobranca.trim() });
        } else {
            msgs.push({ role: 'assistant', content });
            const blocos = results.map((r) => `TOOL_RESULT: ${r.name}\n${r.serialized}`).join('\n\n');
            msgs.push({ role: 'user', content: `${blocos}${SUFIXO_FOLLOWUP}${cobranca}` });
        }
        this.sessions[sessionId].messages = trimSession(msgs);
    }

    async responder(texto, opts = {}) {
        if (!texto) throw new Error('Não entendi');
        const model = this._model();
        const host = this._host();

        const turno = await prepareTurn({
            host, model, texto, sessions: this.sessions,
            opts: { ...opts, textToolsOnly: opts.textToolsOnly || this._noNativeTools.has(model) },
        });
        const { sessionId, maxToolCalls, modoIde, nativeTools, effectiveTools } = turno;
        turno.model = model;
        turno.source = 'ollama-tool-loop';

        this.abortCurrentRequest();
        this.activeAbortController = new AbortController();
        const signal = this.activeAbortController.signal;

        let iter = 0;
        let ultimaResposta = '';
        let executadasOk = 0;
        const resumo = [];
        const contagens = new Map();

        try {
            while (iter < maxToolCalls) {
                if (signal.aborted) throw new Error('Request cancelled');
                console.log(`[ollamaLocal] → ${model} @ ${host} (msgs=${this.sessions[sessionId].messages.length}, iter=${iter + 1}/${maxToolCalls})`);
                const { res: r } = await this._postChat(
                    host, model, this.sessions[sessionId].messages,
                    { stream: false, signal, tools: nativeTools ? effectiveTools : null }
                );

                const doneReason = String((r.data && r.data.done_reason) || '');
                if (doneReason && doneReason !== 'stop') {
                    console.warn(`[ollamaLocal] done_reason=${doneReason} — resposta possivelmente truncada.`);
                }

                const msg = (r.data && r.data.message) || {};
                let content = stripThinkingBlock(msg.content || '');
                const chamadas = nativeTools
                    ? normalizarChamadasNativas(msg.tool_calls)
                    : (modoIde ? normalizarChamadasTexto(parseOllamaToolCalls(content)) : []);

                if (!content && !chamadas.length) throw new Error('Resposta vazia do Ollama');
                ultimaResposta = content;

                if (!modoIde || !chamadas.length) {
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    this.activeAbortController = null;
                    return modoIde ? (limparProtocolo(content, nativeTools) || content) : content;
                }

                console.log(`[ollamaLocal][tools] iter=${iter + 1}/${maxToolCalls} — ${chamadas.length} chamada(s) (${nativeTools ? 'nativa' : 'texto'})`);
                const exec = await executeCalls(chamadas, turno, { signal });
                executadasOk += exec.executadasOk;
                resumo.push(...exec.resumo);

                this._empilharResultados(sessionId, {
                    nativeTools, content, chamadas,
                    results: exec.results,
                    cobranca: cobrancaRepeticao(chamadas, contagens),
                });
                iter++;
            }

            this.activeAbortController = null;
            const limpo = limparProtocolo(ultimaResposta, nativeTools);
            if (limpo && limpo.trim()) return limpo;
            if (executadasOk > 0 && resumo.length) return `Pronto! Comandos executados:\n\n${resumo.join('\n')}`;
            return 'Não consegui concluir essa tarefa com ferramentas. Tente reformular a pergunta.';

        } catch (err) {
            this.activeAbortController = null;
            if (err && err.message === SEM_TOOLS_NATIVAS && !opts.textToolsOnly) {
                delete this.sessions[sessionId];
                return await this.responder(texto, { ...opts, textToolsOnly: true });
            }
            try { this.sessions[sessionId].messages.pop(); } catch (_) {}
            console.error('[ollamaLocal] erro:', err && err.message);
            return this._classifyError(err, model);
        }
    }

    async responderStream(texto, onChunk, onComplete, onError, opts = {}) {
        const fs = require('fs');
        const path = require('path');
        const isTesting = process.env.TESTING === 'true';
        const debugLogPath = path.join(__dirname, '..', isTesting ? 'ollama-debug-test.log' : 'ollama-debug.log');
        const logDebug = (msg) => {
            try { fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] ${msg}\n`); } catch (_) {}
        };
        if (!opts.textToolsOnly) { try { fs.writeFileSync(debugLogPath, ''); } catch (_) {} }
        logDebug(`responderStream chamado com texto: "${texto}"`);

        if (!texto) {
            if (onError) onError(new Error('Não entendi'));
            return;
        }
        const model = this._model();
        const host = this._host();

        const turno = await prepareTurn({
            host, model, texto, sessions: this.sessions,
            opts: { ...opts, textToolsOnly: opts.textToolsOnly || this._noNativeTools.has(model) },
        });
        const { sessionId, maxToolCalls, modoIde, nativeTools, effectiveTools } = turno;
        turno.model = model;
        turno.source = 'ollama-tool-loop';

        this.abortCurrentRequest();
        this.activeAbortController = new AbortController();
        const signal = this.activeAbortController.signal;

        // Carregar um 35B na VRAM leva de 10s a 1min sem emitir um byte. Sem este
        // aviso a janela fica parada e parece travamento.
        await this._avisarCarregamento(host, model, onChunk);

        let iter = 0;
        let ultimaResposta = '';
        let ultimaJaFoiPraTela = false;
        let executadasOk = 0;
        const resumo = [];
        const contagens = new Map();

        try {
            while (iter < maxToolCalls) {
                if (signal.aborted) throw new Error('Request cancelled');
                if (iter > 0 && onChunk) {
                    onChunk({ type: 'thinking', text: `\n⚙️ [Ollama: Processando o resultado da(s) ferramenta(s)...]\n`, event: 'thinking' });
                }

                logDebug(`\n--- ITERATION ${iter + 1} (nativas=${nativeTools}) ---`);
                console.log(`[ollamaLocal-stream] → ${model} @ ${host} (msgs=${this.sessions[sessionId].messages.length}, iter=${iter + 1}/${maxToolCalls})`);

                const { createStreamRouter } = require('./backendStreamRouter');
                // No protocolo nativo NÃO existe TOOL_CALL em texto pra esconder:
                // segurar o começo da resposta só atrasaria o que o usuário vê.
                const router = createStreamRouter({ onChunk, hasTools: modoIde && !nativeTools });

                const { res: r } = await this._postChat(
                    host, model, this.sessions[sessionId].messages,
                    { stream: true, signal, responseType: 'stream', tools: nativeTools ? effectiveTools : null }
                );

                const nativas = [];
                const doneReason = await this._consumirStream(r.data, { router, signal, logDebug, nativas });

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
                    console.warn(`[ollamaLocal-stream] done_reason=${doneReason} — resposta possivelmente truncada.`);
                    if (onChunk) onChunk(aviso);
                }

                const content = stripThinkingBlock(router.answer || '');
                const chamadas = nativeTools
                    ? normalizarChamadasNativas(nativas)
                    : (modoIde ? normalizarChamadasTexto(parseOllamaToolCalls(content)) : []);

                logDebug(`Fim da iteração ${iter + 1}. Content: "${content.slice(0, 200)}" | chamadas: ${chamadas.length}`);
                if (!content && !router.thinking && !chamadas.length) throw new Error('Resposta vazia do Ollama');
                ultimaResposta = content;
                ultimaJaFoiPraTela = router.streamedAnything;

                if (!modoIde || !chamadas.length) {
                    router.flushAnswer();
                    this.sessions[sessionId].messages.push({ role: 'assistant', content });
                    const limpo = limparProtocolo(content, nativeTools).trim();
                    if (!router.streamedAnything && onChunk && limpo) onChunk(limpo);
                    this.activeAbortController = null;
                    if (onComplete) onComplete();
                    return;
                }

                console.log(`[ollamaLocal-stream][tools] iter=${iter + 1}/${maxToolCalls} — ${chamadas.length} chamada(s) (${nativeTools ? 'nativa' : 'texto'})`);
                const exec = await executeCalls(chamadas, turno, { onChunk, signal });
                executadasOk += exec.executadasOk;
                resumo.push(...exec.resumo);

                const cobranca = cobrancaRepeticao(chamadas, contagens);
                if (cobranca && onChunk) {
                    onChunk({ type: 'thinking', text: '\n⚠️ Chamada repetida — cobrando o próximo passo.\n', event: 'thinking' });
                }
                this._empilharResultados(sessionId, { nativeTools, content, chamadas, results: exec.results, cobranca });
                iter++;
            }

            // Estourou o teto de rodadas sem o modelo dar a resposta final.
            this.activeAbortController = null;
            const limpo = limparProtocolo(ultimaResposta, nativeTools);
            if (ultimaJaFoiPraTela) {
                // Protocolo nativo: o texto da última rodada JÁ foi pra tela
                // enquanto era gerado. Reemitir duplicaria a resposta inteira —
                // aqui só se explica por que o turno parou.
                if (onChunk) onChunk(`\n\n_⚠️ Parei após ${maxToolCalls} rodadas de ferramenta. O que foi executado está acima._`);
            } else if (limpo && limpo.trim()) {
                if (onChunk) onChunk(limpo);
            } else if (executadasOk > 0 && resumo.length) {
                if (onChunk) onChunk(`Pronto! Comandos executados:\n\n${resumo.join('\n')}`);
            } else if (onChunk) {
                onChunk('Não consegui concluir essa tarefa com ferramentas. Tente reformular a pergunta.');
            }
            if (onComplete) onComplete();

        } catch (err) {
            this.activeAbortController = null;
            if (err && err.message === SEM_TOOLS_NATIVAS && !opts.textToolsOnly) {
                delete this.sessions[sessionId];
                return await this.responderStream(texto, onChunk, onComplete, onError, { ...opts, textToolsOnly: true });
            }
            try { this.sessions[sessionId].messages.pop(); } catch (_) {}
            console.error('[ollamaLocal-stream] erro:', err && err.message);
            if (onError) onError(new Error(this._classifyError(err, model)));
        }
    }

    /** Avisa na tela quando o modelo ainda não está na VRAM (/api/ps). */
    async _avisarCarregamento(host, model, onChunk) {
        let carregado = true;
        try {
            const psRes = await axios.get(`${host}/api/ps`, {
                timeout: 1500,
                signal: AbortSignal.timeout(1500),
                headers: { Connection: 'close' },
            });
            const lista = psRes.data && psRes.data.models;
            if (Array.isArray(lista)) {
                const nomes = lista.map((m) => m.name || m.model).filter(Boolean);
                const semTag = (s) => String(s).replace(/:latest$/, '');
                carregado = nomes.some((n) => n === model || semTag(n) === semTag(model) ||
                    model.startsWith(n) || n.startsWith(model));
            }
        } catch (_) { /* /api/ps é opcional — na dúvida não avisa nada */ }

        if (!carregado && onChunk) {
            onChunk({
                type: 'thinking',
                text: `⚙️ [Ollama: Carregando o modelo \`${model}\` na memória/VRAM (isso pode levar de 10 a 60 segundos)...]\n`,
                event: 'thinking',
            });
        }
    }

    /**
     * Lê o NDJSON do /api/chat até done, roteando raciocínio/resposta e
     * recolhendo as tool_calls nativas.
     * @returns {Promise<string>} done_reason
     */
    _consumirStream(stream, { router, signal, logDebug, nativas }) {
        return new Promise((resolve, reject) => {
            let buffer = '';
            let doneReason = '';

            const processLine = (line) => {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.error) {
                        cleanup();
                        try { stream.destroy(); } catch (_) {}
                        reject(new Error(parsed.error));
                        return true;
                    }
                    const msg = parsed.message || {};
                    // Raciocínio vem em campo PRÓPRIO (message.thinking) quando
                    // think=true. Antes só se lia .content, então a fase inteira
                    // de raciocínio — que num modelo pensante é a maior parte do
                    // tempo — não aparecia na janela: o usuário via o cursor
                    // parado e nada acontecendo.
                    if (msg.thinking) router.emitThinking(msg.thinking);
                    if (msg.content) router.routeToken(msg.content);
                    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
                        nativas.push(...msg.tool_calls);
                    }
                    if (parsed.done) {
                        doneReason = String(parsed.done_reason || '');
                        cleanup();
                        try { stream.destroy(); } catch (_) {}
                        resolve(doneReason);
                        return true;
                    }
                } catch (err) {
                    logDebug(`Erro ao parsear linha do stream: ${err.message}`);
                }
                return false;
            };

            const onData = (chunk) => {
                buffer += chunk.toString('utf8');
                let fim;
                while ((fim = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, fim).trim();
                    buffer = buffer.slice(fim + 1);
                    if (line && processLine(line)) return;
                }
            };
            const onEnd = () => {
                if (buffer.trim()) processLine(buffer.trim());
                cleanup();
                resolve(doneReason);
            };
            const onErr = (err) => { cleanup(); reject(err); };
            const onAbort = () => { cleanup(); reject(new Error('Request cancelled')); };
            const cleanup = () => {
                stream.removeListener('data', onData);
                stream.removeListener('end', onEnd);
                stream.removeListener('error', onErr);
                signal.removeEventListener('abort', onAbort);
            };

            stream.on('data', onData);
            stream.on('end', onEnd);
            stream.on('error', onErr);
            signal.addEventListener('abort', onAbort);
        });
    }

    async preloadModel(oldModel, newModel) {
        const os = require('os');
        const host = this._host();

        // Trocou de modelo: as capacidades sondadas eram do modelo antigo.
        caps.invalidate();
        this._noNativeTools.delete(newModel);

        // Verifica se há pelo menos 4GB de RAM livre antes de tentar fazer preload (evitar travar pc com pouca memoria)
        const freeRamGB = os.freemem() / (1024 ** 3);
        const hasEnoughRam = freeRamGB > 4.0;

        if (oldModel && oldModel !== newModel) {
            try {
                console.log(`[ollamaLocal] Descarregando modelo anterior: ${oldModel}`);
                await axios.post(`${host}/api/generate`, { model: oldModel, keep_alive: 0 }, { timeout: 10000 });
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
                await axios.post(`${host}/api/generate`, { model: newModel, keep_alive: '30m' }, { timeout: 120000 });
                console.log(`[ollamaLocal] Modelo ${newModel} carregado com sucesso.`);
            } catch (err) {
                console.log(`[ollamaLocal] Erro ao carregar novo modelo (${newModel}):`, err && err.message);
            }
        }
    }

    resetSession() {
        this.sessions = {};
    }
}

module.exports = new OllamaLocalService();
