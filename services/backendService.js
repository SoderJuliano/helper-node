const axios = require("axios");
const configService = require("./configService");
const { getIp } = require("./configService");
const https = require('https');
const http = require('http');
const {
  pickOllamaEndpoint,
  buildDeepAnalysisAddon,
  buildOllamaToolsAddon,
  parseOllamaToolCalls,
  stripToolCallBlocks,
  stripThinkingBlock
} = require('./ollamaToolHelper');
const { createStreamRouter } = require('./backendStreamRouter');
const { runToolCalls } = require('./toolLoop');

// Configurar agentes HTTP/HTTPS com keepAlive
const httpAgent = new http.Agent({ keepAlive: true, keepAliveMsecs: 60000, maxSockets: 50, maxFreeSockets: 10, timeout: 360000 });
const httpsAgent = new https.Agent({ keepAlive: true, keepAliveMsecs: 60000, maxSockets: 50, maxFreeSockets: 10, timeout: 360000 });
let apiUrl = "";

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

  async getLastEnvUrl() {
    const now = Date.now();
    if (this._cachedApiUrl && (now - (this._lastUrlFetch || 0) < 60000)) {
      apiUrl = this._cachedApiUrl;
      return apiUrl;
    }
    try {
      const res = await axios.get("https://abra-api.top/notifications/retrieve?key=ngrockurl", {
        timeout: 5000,
        headers: { 'Cache-Control': 'no-cache' }
      });
      const data = res.data;
      if (Array.isArray(data) && data.length > 0) {
        const lastNotification = data[data.length - 1];
        if (lastNotification && lastNotification.content) {
          const fetchedUrl = String(lastNotification.content).trim().replace(/\/+$/, '');
          if (fetchedUrl && fetchedUrl.startsWith('http')) {
            apiUrl = fetchedUrl;
            this._cachedApiUrl = fetchedUrl;
            this._lastUrlFetch = now;
            return apiUrl;
          }
        }
      }
    } catch (e) {
      console.warn("[backendService] Erro ao buscar URL do abra-api:", e && e.message);
    }

    try {
      const ip = await configService.getIp();
      if (ip) {
        apiUrl = `http://${ip}:8080`;
        this._cachedApiUrl = apiUrl;
        this._lastUrlFetch = now;
        return apiUrl;
      }
    } catch (_) {}

    console.log("[backendService] Nenhuma URL de backend disponível.");
    apiUrl = "";
    return null;
  }

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

      let response;
      try {
        response = await axios.post(`${apiUrl}${effectiveEndpoint}`, payload, {
          headers, timeout: 360000, httpAgent, httpsAgent
        });
      } catch (errFirst) {
        const is404 = errFirst.response && errFirst.response.status === 404;
        if (is404 && effectiveEndpoint !== '/llama3') {
          response = await axios.post(`${apiUrl}/llama3`, payload, {
            headers, timeout: 360000, httpAgent, httpsAgent
          });
          effectiveEndpoint = '/llama3';
        } else {
          throw errFirst;
        }
      }

      if (!response.data) throw new Error("Empty response from backend");

      let resposta = response.data.response || response.data;
      if (typeof resposta !== 'string') resposta = String(resposta);

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
        const wsPathsLine = wsPaths.length
          ? `WORKSPACE ANEXADO — use EXATAMENTE estes paths absolutos:\n${wsPaths.map(p => `  - ${p}`).join('\n')}`
          : '';
        const analysisAddon = customInstruction ? '' : buildDeepAnalysisAddon({
          toolsEnabled: true, wsEnabled, attCount, texto
        });
        const wsHeader = wsPathsLine ? `${wsPathsLine}\n\n` : '';
        promptInstruction = `${wsHeader}${promptInstruction}\n\n${buildOllamaToolsAddon(tools, wsPaths)}${analysisAddon}`;
      }

      let promptWithContext = conversationContext
        ? `${promptInstruction}\n\nConversation context:\n${conversationContext}\nPlease respond to the latest human message.`
        : `${promptInstruction}${texto}`;

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

      while (iter < maxIters) {
        if (signal.aborted) throw new Error("Request cancelled");

        const payload = { prompt: currentWorkingPrompt, language: mappedLang };
        if (opts.imageBase64) {
          payload.imageBase64 = opts.imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
        }

        let response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal
        });

        if (response.status === 404 && baseEndpoint !== '/llama3') {
          response = await fetch(`${apiUrl}/llama3-stream`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal
          });
        }

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // Separa raciocínio de resposta — ver services/backendStreamRouter.js
        // para o porquê (tool call cogitada no thinking não pode ser executada).
        const router = createStreamRouter({
          onChunk,
          hasTools: !!(effectiveTools && onToolCall),
        });
        const emitThinking = router.emitThinking;
        const routeToken = router.routeToken;

        let rawBody = '';           // tudo que chegou, pro fallback não-SSE
        // "thinking-start" ABRE a fase de raciocínio e "thinking-end" FECHA.
        // Não dá pra olhar só o nome do último evento: depois do thinking-end
        // as linhas seguintes continuam com esse nome, e a resposta inteira
        // (com a tool call) acabava classificada como raciocínio.
        let inThinkingPhase = false;

        // O backend manda "[DONE]" mas NÃO fecha a conexão. Sem sair do laço
        // do reader nesse marcador, o await reader.read() abaixo fica pendurado
        // pra sempre e a resposta nunca volta. (No master isso era um `return`
        // direto; virou `break` na refatoração e o break só saía do `for` das
        // linhas.) Aqui o flag quebra os DOIS laços e o fluxo segue para a
        // avaliação de tool calls, que o master não tinha neste caminho.
        let sawDoneMarker = false;

        while (true) {
          if (signal.aborted) {
            try { reader.cancel(); } catch (_) {}
            throw new Error("Request cancelled");
          }

          const { done, value } = await reader.read();
          if (done) break;

          const decoded = decoder.decode(value, { stream: true });
          rawBody += decoded;
          buffer += decoded;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          let currentEvent = 'message';

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim();
              if (currentEvent === 'thinking-start') inThinkingPhase = true;
              else if (currentEvent === 'thinking-end') inThinkingPhase = false;
              continue;
            }
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              // CUIDADO: "data: done" aparece DUAS vezes no protocolo do
              // pikachu — depois de "event: thinking-end" (fim do raciocínio,
              // o stream continua) e depois de "event: end" (fim de verdade).
              // Tratar os dois como fim corta a resposta logo após o thinking,
              // que é justamente onde a tool call vem.
              const isRealEnd = data === '[DONE]' ||
                (currentEvent === 'end' && data.toLowerCase() === 'done');
              if (isRealEnd) { sawDoneMarker = true; break; }
              if (data.toLowerCase() === 'done' || data.toLowerCase() === 'start') continue;

              try {
                const parsed = JSON.parse(data);
                // O backend manda o raciocínio no campo "thinking" e a resposta
                // no campo "response" (ver qwen36ThinkingStreamResponse no
                // pikachu). Cada um vai pro seu buffer.
                if (typeof parsed.thinking === 'string' && parsed.thinking) {
                  emitThinking(parsed.thinking);
                }
                const token = parsed.response || parsed.message ||
                  (typeof parsed.thinking === 'string' ? '' : data);
                if (typeof token === 'string' && token) {
                  if (inThinkingPhase) emitThinking(token);
                  else routeToken(token);
                }
              } catch (_) {
                const token = data;
                if (typeof token === 'string' && token && token.toLowerCase() !== 'done') {
                  if (inThinkingPhase) emitThinking(token);
                  else routeToken(token);
                }
              }
            }
          }

          if (sawDoneMarker) {
            // Libera o socket: o servidor não vai fechar sozinho.
            try { reader.cancel(); } catch (_) {}
            break;
          }
        }

        // Fallback: se o endpoint respondeu com corpo simples (ResponseEntity
        // <String>) em vez de SSE, nenhuma linha "data: " apareceu e o texto
        // inteiro ficou no buffer bruto. Aproveita ele em vez de descartar —
        // assim funciona com o /chat streamando OU síncrono, sem depender de
        // qual versão do pikachu está no ar.
        if (!router.answer && !router.thinking && rawBody.trim()) {
          console.log('[backend-stream] resposta não-SSE detectada — usando corpo bruto');
          routeToken(rawBody.trim());
          if (!router.streamedAnything && !router.answerIsToolCall && onChunk && router.answer) {
            onChunk(router.answer);
            router.markStreamed();
          }
        }

        const calls = (effectiveTools && onToolCall) ? parseOllamaToolCalls(router.answer) : [];

        if (calls.length > 0 && effectiveTools && onToolCall) {
          console.log(`[backend-stream][tools] ${calls.length} tool call(s) detectada(s) na iter ${iter + 1}`);
          currentWorkingPrompt += await runToolCalls(calls, onToolCall, {
            onChunk, signal, source: 'ollama-stream-tool-loop',
          });
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
