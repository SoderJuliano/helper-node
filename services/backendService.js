const configService = require("./configService");
const {
  pickOllamaEndpoint,
  buildDeepAnalysisAddon,
  buildOllamaToolsAddon,
  parseOllamaToolCalls,
  stripToolCallBlocks,
  stripThinkingBlock,
  looksLikeToolCallAttempt
} = require('./ollamaToolHelper');
const { streamOnce } = require('./backendSseClient');
const { runToolCalls, capPrompt } = require('./toolLoop');
const { buildIdeAgentPrompt } = require('./idePrompt');
const { createUrlDiscovery } = require('./backendUrlDiscovery');

let apiUrl = "";
const urlDiscovery = createUrlDiscovery();

class BackendService {
  constructor() {
    this.sessions = {};
    this.activeAbortController = null;
  }

  abortCurrentRequest() {
    if (this.activeAbortController) {
      try {
        this.activeAbortController.abort();
        console.log('[backendService] Request cancelada com sucesso via AbortController.');
      } catch (_) {}
      this.activeAbortController = null;
    }
  }

  manageSessionContext(sessionId, userMessage) {
    if (!this.sessions[sessionId]) this.sessions[sessionId] = [];
    this.sessions[sessionId].push({ role: 'user', content: userMessage });
    const maxHistory = 6;
    if (this.sessions[sessionId].length > maxHistory * 2) {
      this.sessions[sessionId] = this.sessions[sessionId].slice(-maxHistory * 2);
    }
    return this.sessions[sessionId].map(msg => `${msg.role}: ${msg.content}`).join('\n');
  }

  addAssistantResponse(sessionId, assistantMessage) {
    if (!this.sessions[sessionId]) this.sessions[sessionId] = [];
    this.sessions[sessionId].push({ role: 'assistant', content: assistantMessage });
  }

  removeLastUserMessage(sessionId) {
    if (this.sessions[sessionId] && this.sessions[sessionId].length > 0) {
      if (this.sessions[sessionId][this.sessions[sessionId].length - 1].role === 'user') {
        this.sessions[sessionId].pop();
      }
    }
  }

  clearSessions() {
    this.sessions = {};
  }

  async getApiUrl() {
    return await this.getLastEnvUrl();
  }

  // Descoberta da URL: ver services/backendUrlDiscovery.js (localhost, tunel,
  // e a ultima URL boa preservada em falha transitoria).
  async getLastEnvUrl() {
    apiUrl = (await urlDiscovery.discover()) || "";
    return apiUrl || null;
  }

  // Compatibilidade com os testes/probe, que mexem no cache direto.
  get _cachedApiUrl() { return urlDiscovery.cached; }
  set _cachedApiUrl(v) { urlDiscovery.cached = v; }
  get _lastUrlFetch() { return urlDiscovery.lastFetch; }
  set _lastUrlFetch(v) { urlDiscovery.lastFetch = v; }

  async testConnection() {
    try {
      const url = await this.getLastEnvUrl();
      if (!url) return { ok: false, error: 'URL do backend não configurada' };
      const res = await fetch(`${url}/models`, {
        method: 'GET',
        headers: { 'ngrok-skip-browser-warning': 'true' },
        signal: AbortSignal.timeout(5000)
      });
      return { ok: res.ok, status: res.status };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async ping() {
    try {
      const conn = await this.testConnection();
      return !!conn.ok;
    } catch (_) {
      return false;
    }
  }

  async responder(texto, opts = {}) {
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      throw new Error("Texto inválido para o backend");
    }

    if (!apiUrl) await this.getLastEnvUrl();
    if (!apiUrl) throw new Error("Could not retrieve backend URL.");

    const sessionId = opts.sessionId || 'default';
    const customInstruction = opts.instruction;
    const conversationContext = this.manageSessionContext(sessionId, texto);

    const lang = configService.getLanguage();
    const langMap = { 'pt-br': 'PORTUGUESE', 'us-en': 'ENGLISH' };
    const mappedLang = langMap[lang] || 'PORTUGUESE';

    try {
      let aiModelConf = configService.getAiModel();
      let backendModel = (configService.getBackendModel ? configService.getBackendModel() : '') || 'qwen2.5-coder:7b';
      let baseEndpoint = pickOllamaEndpoint(texto);
      let effectiveEndpoint = (aiModelConf === 'qwen-stream' || aiModelConf === 'qwen')
        ? `/chat?model=qwen3.6:35b`
        : baseEndpoint;

      if (aiModelConf === 'llama' || aiModelConf === 'llama-stream') {
        effectiveEndpoint = `/chat?model=${encodeURIComponent(backendModel)}`;
      }

      let workspace = null;
      let wsEnabled = false;
      let attCount = 0;
      let wsPaths = [];
      try {
        workspace = require('./workspace');
        wsEnabled = !!(configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled());
        attCount = wsEnabled ? workspace.list().length : 0;
        if (wsEnabled && attCount > 0) {
          wsPaths = workspace.list().map(a => a.path).filter(Boolean);
        }
      } catch (e) {
        console.warn('[backend] falha ao verificar anexos de workspace:', e.message);
      }

      let promptInstruction = customInstruction || configService.getPromptInstruction();

      let promptWithContext = conversationContext
        ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
        : `${promptInstruction}${texto}`;

      let payload = { prompt: promptWithContext, language: mappedLang };
      if (opts.imageBase64) {
        payload.imageBase64 = opts.imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
      }

      const headers = {
        'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      };
      const apiKey = configService.getBackendApiKey ? configService.getBackendApiKey() : '';
      if (apiKey) {
        headers['apikey'] = apiKey;
        headers['x-api-key'] = apiKey;
      }

      // ATENÇÃO: /chat do pikachu é SSE (produces = TEXT_EVENT_STREAM_VALUE) e o
      // servidor NÃO fecha a conexão no fim — o controller chama startAsync()
      // com timeout de 10min e nunca chama asyncContext.complete(). Um cliente
      // HTTP comum (era axios aqui) escreve a resposta inteira no buffer, fica
      // esperando o close que não vem e só desiste no PRÓPRIO timeout: eram
      // 360s de espera morta por chamada, com o texto já pronto em ~20s.
      //
      // Por isso usa o mesmo leitor de SSE do responderStream, que sai no
      // marcador de fim ("event: end") e cancela o reader. Sem onChunk: só
      // acumula e devolve de uma vez. O raciocínio cai no buffer de thinking do
      // router e naturalmente não entra na resposta.
      const { router, rawBody } = await streamOnce({
        endpoint: `${apiUrl}${effectiveEndpoint}`,
        fallbackEndpoint: effectiveEndpoint !== '/llama3' ? `${apiUrl}/llama3` : null,
        headers,
        payload,
        onChunk: null,
        hasTools: false,
      });

      // Corpo simples (ResponseEntity<String>) em vez de SSE: nenhuma linha
      // "data: " apareceu e o texto ficou só no buffer bruto.
      let resposta = router.answer;
      if (!resposta.trim() && rawBody.trim()) resposta = rawBody.trim();
      if (!resposta.trim()) throw new Error("Empty response from backend");

      resposta = stripThinkingBlock(resposta);
      resposta = stripToolCallBlocks(resposta);
      this.addAssistantResponse(sessionId, resposta);
      return resposta;
    } catch (error) {
      console.error("Erro ao chamar o backend:", error.message);
      this.removeLastUserMessage(sessionId);
      throw error;
    }
  }

  async responderStream(texto, onChunk, onComplete, onError, opts = {}) {
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      if (onError) onError(new Error("Texto inválido ou vazio"));
      return;
    }
    if (!apiUrl) await this.getLastEnvUrl();
    if (!apiUrl) {
      if (onError) onError(new Error("Could not retrieve backend URL."));
      return;
    }

    this.abortCurrentRequest();
    this.activeAbortController = new AbortController();
    const signal = this.activeAbortController.signal;

    const sessionId = opts.sessionId || 'default';
    const customInstruction = opts.instruction;
    const conversationContext = this.manageSessionContext(sessionId, texto);

    const lang = configService.getLanguage();
    const langMap = { 'pt-br': 'PORTUGUESE', 'us-en': 'ENGLISH' };
    const mappedLang = langMap[lang] || 'PORTUGUESE';

    try {
      let aiModelConf = configService.getAiModel();
      let backendModel = (configService.getBackendModel ? configService.getBackendModel() : '') || 'qwen2.5-coder:7b';
      let baseEndpoint = pickOllamaEndpoint(texto);
      let endpoint = aiModelConf === 'qwen-stream'
        ? `${apiUrl}/chat?model=qwen3.6:35b`
        : `${apiUrl}${baseEndpoint}-stream`;

      if (aiModelConf === 'llama' || aiModelConf === 'llama-stream') {
        endpoint = `${apiUrl}/chat?model=${encodeURIComponent(backendModel)}`;
      }

      console.log(`[backend-stream] roteado para: ${endpoint}`);

      let workspace = null;
      let wsEnabled = false;
      let attCount = 0;
      let wsPaths = [];
      try {
        workspace = require('./workspace');
        wsEnabled = !!(configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled());
        attCount = wsEnabled ? workspace.list().length : 0;
        if (wsEnabled && attCount > 0) {
          wsPaths = workspace.list().map(a => a.path).filter(Boolean);
        }
      } catch (e) {
        console.warn('[backend-stream] falha ao verificar workspace:', e.message);
      }

      let tools = opts.tools;
      let onToolCall = opts.onToolCall;
      let effectiveTools = tools;
      let promptInstruction = customInstruction || configService.getPromptInstruction();

      if (effectiveTools && onToolCall) {
        const analysisAddon = customInstruction ? '' : buildDeepAnalysisAddon({
          toolsEnabled: true, wsEnabled, attCount, texto
        });
        if (customInstruction) {
          // Fluxo agêntico multi-fase: a instrução vem pronta de quem chamou
          // (ollamaAgenticWorkflowService), então aqui só entra o protocolo de
          // TOOL_CALL. Não sobrescreve a instrução de fase.
          const wsHeader = wsPaths.length
            ? `DIRETÓRIOS LIBERADOS (paths absolutos):\n${wsPaths.map(p => `  - ${p}`).join('\n')}\n\n`
            : '';
          promptInstruction = `${wsHeader}${promptInstruction}\n\n${buildOllamaToolsAddon(tools, wsPaths)}`;
        } else {
          // MODO IDE: prompt de agente, coerente e único. NÃO empilha o prompt de
          // copiloto de tela (65 palavras / OCR / entrevista) — essa pilha de
          // instruções conflitantes é o que fazia o modelo com raciocínio visível
          // gastar o turno debatendo contradições em vez de ler o projeto.
          // Ver services/idePrompt.js.
          promptInstruction = buildIdeAgentPrompt({ toolsSchema: tools, wsPaths }) + analysisAddon;
        }
      }

      // capPrompt já na 1ª iteração: o histórico da sessão guarda a árvore do
      // projeto injetada no 1º turno e a reenvia em todos os seguintes, então dá
      // pra estourar o contexto antes de existir qualquer tool result.
      let promptWithContext = capPrompt(conversationContext
        ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
        : `${promptInstruction}${texto}`);

      const headers = {
        'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      };
      const apiKey = configService.getBackendApiKey ? configService.getBackendApiKey() : '';
      if (apiKey) {
        headers['apikey'] = apiKey;
        headers['x-api-key'] = apiKey;
      }

      let iter = 0;
      const maxIters = opts.maxToolCalls || 15;
      let currentWorkingPrompt = promptWithContext;
      // Quantas vezes já pedi pro modelo reemitir um TOOL_CALL que veio quebrado.
      let malformedNudges = 0;
      // Assinatura de cada tool call já executado, pra detectar o modelo preso
      // repetindo a MESMA chamada. Sem isso ele consome as 15 iterações fazendo
      // o mesmo listDir e o turno acaba sem nenhuma resposta na tela — que é o
      // "rodou 10 minutos e nunca veio resposta".
      const callCounts = new Map();
      // Melhor texto que o modelo produziu no caminho, e se algo já foi pra
      // tela. Se o limite de iterações estourar, isso é entregue em vez de
      // descartar a análise e mostrar só "parei" — era assim que o usuário
      // ficava sem resposta depois de esperar todas as rodadas.
      let ultimoTexto = '';
      let algoNaTela = false;

      while (iter < maxIters) {
        if (signal.aborted) throw new Error("Request cancelled");

        const payload = { prompt: currentWorkingPrompt, language: mappedLang };
        if (opts.imageBase64) {
          payload.imageBase64 = opts.imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        }

        // POST + leitura do SSE (com retry e watchdog) — ver backendSseClient.js.
        const { router, rawBody } = await streamOnce({
          endpoint,
          fallbackEndpoint: baseEndpoint !== '/llama3' ? `${apiUrl}/llama3-stream` : null,
          headers,
          payload,
          signal,
          onChunk,
          hasTools: !!(effectiveTools && onToolCall),
        });

        // Fallback: se o endpoint respondeu com corpo simples (ResponseEntity
        // <String>) em vez de SSE, nenhuma linha "data: " apareceu e o texto
        // inteiro ficou no buffer bruto. Aproveita ele em vez de descartar —
        // assim funciona com o /chat streamando OU síncrono, sem depender de
        // qual versão do pikachu está no ar.
        if (!router.answer && !router.thinking && rawBody.trim()) {
          console.log('[backend-stream] resposta não-SSE detectada — usando corpo bruto');
          router.routeToken(rawBody.trim());
          if (!router.streamedAnything && !router.answerIsToolCall && onChunk && router.answer) {
            onChunk(router.answer);
            router.markStreamed();
          }
        }

        algoNaTela = algoNaTela || router.streamedAnything;
        const textoDaVez = stripToolCallBlocks(router.answer).trim();
        if (textoDaVez.length > 40) ultimoTexto = textoDaVez;

        const calls = (effectiveTools && onToolCall) ? parseOllamaToolCalls(router.answer) : [];

        if (calls.length > 0 && effectiveTools && onToolCall) {
          console.log(`[backend-stream][tools] ${calls.length} tool call(s) detectada(s) na iter ${iter + 1}`);
          const results = await runToolCalls(calls, onToolCall, {
            onChunk, signal, source: 'ollama-stream-tool-loop',
          });
          // capPrompt: o prompt da próxima iteração é este + os resultados. Sem
          // teto, um readFile grande é reenviado em TODA iteração seguinte até
          // estourar a janela de contexto — e aí o Ollama trunca o COMEÇO, que é
          // onde estão as ferramentas e o pedido do usuário.
          // Preso na mesma chamada? Cobra o próximo passo em vez de deixar o
          // modelo gastar as 15 iterações repetindo o mesmo listDir.
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
          currentWorkingPrompt = capPrompt(currentWorkingPrompt + results + repeticao);
          iter++;
          continue;
        } else if (
          // requireJson: só é tentativa de chamada se vier "{" depois da marca.
          // Sem isso, uma resposta boa terminando em "pode emitir TOOL_CALL se
          // precisar" era tratada como chamada quebrada: gastava iteração e o
          // texto final do usuário ia pro lixo.
          effectiveTools && onToolCall && malformedNudges < 2 &&
          looksLikeToolCallAttempt(router.answer, { requireJson: true })
        ) {
          // O modelo TENTOU chamar ferramenta mas o bloco não parseou (JSON com
          // barra invertida solta, aspas tortas, chave truncada). Antes isso
          // encerrava o turno em silêncio — a ferramenta nunca rodava e o
          // usuário ficava olhando pra tela vazia. Agora mostra o formato exato
          // e dá outra chance, sem gastar o turno.
          malformedNudges++;
          console.warn(`[backend-stream][tools] TOOL_CALL malformado (tentativa ${malformedNudges}) — pedindo reemissão.`);
          if (onChunk) onChunk({ type: 'thinking', text: '\n⚠️ TOOL_CALL malformado, pedindo reemissão...\n' });
          currentWorkingPrompt = capPrompt(
            currentWorkingPrompt +
            `\n\n${router.answer}\n\n` +
            'ERRO: o TOOL_CALL acima não pôde ser lido. Reemita AGORA em UMA linha, ' +
            'exatamente neste formato, sem espaço dentro das chaves nem dentro do nome:\n' +
            'TOOL_CALL: {"name":"listDir","args":{"path":"/caminho/absoluto"}}\n' +
            'Em path do Windows use barra normal ("C:/Users/x") ou barra invertida ' +
            'dupla ("C:\\\\Users\\\\x"). Não escreva nada além dessa linha.'
          );
          iter++;
          continue;
        } else {
          // router.answer já não tem thinking (foi separado no routeToken).
          let cleanText = stripToolCallBlocks(router.answer).trim();

          // Se nada foi streamado (era tool call, ou o modelo respondeu em
          // bloco único), manda o texto final de uma vez.
          if (!router.streamedAnything && onChunk && cleanText) {
            onChunk(cleanText);
          }

          this.addAssistantResponse(sessionId, cleanText);
          if (onComplete) onComplete();
          return;
        }
      }

      // Estourou o limite de iterações sem uma resposta final em texto. Antes
      // isso fechava o loading em silêncio e o usuário ficava sem nada na tela.
      console.warn(`[backend-stream] limite de ${maxIters} iterações atingido sem resposta final.`);
      if (onChunk) {
        // Entrega o que o modelo já tinha escrito antes de avisar do limite.
        if (!algoNaTela && ultimoTexto) onChunk(ultimoTexto);
        onChunk(
          `\n\n_Parei após ${maxIters} rodadas de ferramenta sem concluir. ` +
          `Peça em passos menores ou diga qual arquivo atacar primeiro._`
        );
      }
      if (ultimoTexto) this.addAssistantResponse(sessionId, ultimoTexto);
      if (onComplete) onComplete();

    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'Request cancelled' || signal.aborted) {
        console.log('[backend-stream] Request cancelada pelo usuário');
        this.removeLastUserMessage(sessionId);
        if (onError) onError(new Error("Request cancelled"));
        return;
      }
      console.error("Erro no backend stream:", error.message);
      this.removeLastUserMessage(sessionId);
      if (onError) onError(error);
    } finally {
      this.activeAbortController = null;
    }
  }
}

module.exports = new BackendService();
