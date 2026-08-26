// services/backendService.js
const configService = require("./configService");
const {
  pickOllamaEndpoint,
  buildOllamaToolsAddon,
  stripToolCallBlocks,
  stripThinkingBlock,
} = require('./ollamaToolHelper');
const { streamOnce } = require('./backendSseClient');
const { capPrompt } = require('./toolLoop');
const { buildIdeAgentPrompt } = require('./idePrompt');
const { createUrlDiscovery } = require('./backendUrlDiscovery');
const { runStreamLoop } = require('./backendStreamLoop');

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

  async getLastEnvUrl() {
    apiUrl = (await urlDiscovery.discover()) || "";
    return apiUrl || null;
  }

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

      const { router, rawBody } = await streamOnce({
        endpoint: `${apiUrl}${effectiveEndpoint}`,
        fallbackEndpoint: effectiveEndpoint !== '/llama3' ? `${apiUrl}/llama3` : null,
        headers,
        payload,
        onChunk: null,
        hasTools: false,
      });

      const pareceSse = /^\s*(event|data):\s/m.test(rawBody);
      let resposta = router.answer;
      if (!resposta.trim() && rawBody.trim() && !pareceSse) resposta = rawBody.trim();

      if (!resposta.trim()) {
        const thinkingChars = (router.thinking || '').trim().length;
        console.warn(`[backend] resposta vazia (thinking=${thinkingChars} chars, sse=${pareceSse})`);
        if (thinkingChars > 0) {
          return 'O modelo raciocinou mas não emitiu resposta final. Se o servidor ' +
            'estiver com o pikachu desatualizado, a resposta chega rotulada como ' +
            'raciocínio e se perde — atualize e reinicie o backend. Alternativa ' +
            'imediata: use um modelo sem raciocínio.';
        }
        throw new Error('Backend encerrou sem enviar resposta.');
      }

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
        if (customInstruction) {
          const wsHeader = wsPaths.length
            ? `DIRETÓRIOS LIBERADOS (paths absolutos):\n${wsPaths.map(p => `  - ${p}`).join('\n')}\n\n`
            : '';
          promptInstruction = `${wsHeader}${promptInstruction}\n\n${buildOllamaToolsAddon(tools, wsPaths)}`;
        } else {
          promptInstruction = buildIdeAgentPrompt({ toolsSchema: tools, wsPaths });
        }
      }

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

      const maxIters = Number(process.env.HELPER_TOOL_LOOP_MAX_ITERS || 30);
      const lembretePedido = opts.userText
        ? `\n\n═══ PEDIDO DO USUÁRIO (é ISTO que você tem que entregar) ═══\n${opts.userText}\n`
        : '';

      await runStreamLoop({
        endpoint,
        baseEndpoint,
        apiUrl,
        headers,
        currentWorkingPrompt: promptWithContext,
        lembretePedido,
        mappedLang,
        opts,
        effectiveTools,
        onToolCall,
        onChunk,
        signal,
        maxIters,
        addAssistantResponse: (sid, msg) => this.addAssistantResponse(sid, msg),
        sessionId,
      });

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
