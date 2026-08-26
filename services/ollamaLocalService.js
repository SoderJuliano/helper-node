// services/ollamaLocalService.js
// Cliente HTTP do Ollama rodando LOCALMENTE no PC do user (porta 11434).

const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const configService = require('./configService');
const {
  parseOllamaToolCalls,
  stripThinkingBlock,
} = require('./ollamaLocalParsing');
const { prepareTurn, executeCalls, trimSession } = require('./ollamaLocalTurn');
const caps = require('./ollamaLocalCaps');
const {
  DEFAULT_HOST,
  SEM_TOOLS_NATIVAS,
  SUFIXO_FOLLOWUP,
  resolveNumCtx,
  promptCharsOf,
  normalizarChamadasNativas,
  normalizarChamadasTexto,
  limparProtocolo,
  cobrancaRepeticao,
  classifyOllamaError,
} = require('./ollamaLocalHelpers');

class OllamaLocalService {
  constructor() {
    this.sessions = {};
    this.activeAbortController = null;
    this._noThinking = new Set();
    this._noNativeTools = new Set();
  }

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
      timeout: 0,
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
    return (configService.getOllamaLocalModel && configService.getOllamaLocalModel()) || 'qwen2.5-coder:7b';
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
    return classifyOllamaError(err, model);
  }

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
        let chamadas = nativeTools
          ? normalizarChamadasNativas(msg.tool_calls)
          : (modoIde ? normalizarChamadasTexto(parseOllamaToolCalls(content)) : []);
        if (nativeTools && !chamadas.length && modoIde) {
          chamadas = normalizarChamadasTexto(parseOllamaToolCalls(content));
        }

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
        const router = createStreamRouter({ onChunk, hasTools: modoIde });

        const { res: r } = await this._postChat(
          host, model, this.sessions[sessionId].messages,
          { stream: true, signal, responseType: 'stream', tools: nativeTools ? effectiveTools : null }
        );

        const nativas = [];
        const doneReason = await this._consumirStream(r.data, { router, signal, logDebug, nativas });

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
        let chamadas = nativeTools
          ? normalizarChamadasNativas(nativas)
          : (modoIde ? normalizarChamadasTexto(parseOllamaToolCalls(content)) : []);
        if (nativeTools && !chamadas.length && modoIde) {
          chamadas = normalizarChamadasTexto(parseOllamaToolCalls(content));
        }

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

      this.activeAbortController = null;
      const limpo = limparProtocolo(ultimaResposta, nativeTools);
      if (ultimaJaFoiPraTela) {
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
    } catch (_) {}

    if (!carregado && onChunk) {
      onChunk({
        type: 'thinking',
        text: `⚙️ [Ollama: Carregando o modelo \`${model}\` na memória/VRAM (isso pode levar de 10 a 60 segundos)...]\n`,
        event: 'thinking',
      });
    }
  }

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
    const host = this._host();
    caps.invalidate();
    this._noNativeTools.delete(newModel);

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
