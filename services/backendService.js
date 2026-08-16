const configService = require("./configService");
const {
  pickOllamaEndpoint,
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
      //
      // O comentário acima sempre disse "nenhuma linha data: apareceu", mas o
      // código NUNCA checava isso: bastava answer ficar vazio pra despejar o
      // buffer bruto na tela. Quando o backend manda um SSE legítimo cujo texto
      // veio todo rotulado como "thinking" (answer vazio), o usuário recebia o
      // PROTOCOLO SSE INTEIRO na cara — centenas de linhas `data: {"thinking":…}`.
      const pareceSse = /^\s*(event|data):\s/m.test(rawBody);
      let resposta = router.answer;
      if (!resposta.trim() && rawBody.trim() && !pareceSse) resposta = rawBody.trim();

      // Sem uma letra de resposta. Explica o que houve em vez de estourar um
      // "Empty response" genérico que a camada de cima transforma em
      // "Failed to process IA response" — mensagem que não ajuda ninguém.
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
        // O "MODO ANÁLISE DE PROJETO (OBRIGATÓRIO)" foi REMOVIDO daqui.
        // Ele existia pra forçar modelo fraco a ler o código antes de escrever,
        // mas a premissa mudou: não se usa mais modelo abaixo de ~10B pra
        // escrever, e o modelo capaz decide sozinho quando precisa ler.
        // Além disso o gatilho estava quebrado — recebia o prompt JÁ montado,
        // que carrega a linha "Estrutura de diretórios:" do contexto de
        // workspace, e a palavra "estrutura" está na regex. Com uma pasta
        // anexada, QUALQUER mensagem virava análise obrigatória com no mínimo
        // 3 TOOL_CALL e 300-900 palavras: um "oi" mandava o modelo com
        // raciocínio para minutos de deliberação. Ver idePrompt.js, que é a
        // fonte única do prompt no modo IDE.
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
          promptInstruction = buildIdeAgentPrompt({ toolsSchema: tools, wsPaths });
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
      // Teto de rodadas. Folgado de propósito: tarefa real pode precisar de
      // muitas edições, e cortar por contagem puniria justamente quem está
      // trabalhando. Quem segura o turno travado é o orçamento SEM PROGRESSO,
      // abaixo. Ajustável por HELPER_TOOL_LOOP_MAX_ITERS.
      const maxIters = Number(process.env.HELPER_TOOL_LOOP_MAX_ITERS || 30);

      // Orçamento medido a partir do ÚLTIMO PROGRESSO, não do início do turno.
      // Progresso = uma tool call INÉDITA executada (repetir a mesma chamada é
      // justamente o sintoma de estar preso, então não renova nada).
      // Assim: 30 edições distintas seguem rodando o tempo que precisarem, mas
      // o turno que fica só deliberando — ou repetindo a mesma chamada — é
      // encerrado e entrega o que já tem. Era esse o caso dos 10+ minutos
      // parados depois do patchFile.
      // O PEDIDO DO USUÁRIO É REINJETADO A CADA RODADA, no fim do prompt.
      //
      // capPrompt preserva a cabeça (instruções) e a cauda (resultados recentes)
      // e corta o MIOLO — e o pedido do usuário fica exatamente no miolo, logo
      // depois do contexto de workspace. Com o teto em 24000, sistema (6374) +
      // workspace (4196) enchem a cabeça de 10800 e sobram 230 chars: o pedido
      // (~360) era CORTADO a partir da 2ª rodada. O modelo ficava órfão de
      // tarefa, via só o "Continue de onde parou" do TOOL_RESULT e saía
      // chutando arquivo — pediram layout de configurações e ele foi ler o chat.
      //
      // Vai no payload, não no prompt acumulado: assim não empilha a cada
      // rodada, fica sempre por último (é o que o modelo lê por fim) e nenhum
      // corte futuro consegue removê-lo.
      const lembretePedido = opts.userText
        ? `\n\n═══ PEDIDO DO USUÁRIO (é ISTO que você tem que entregar) ═══\n${opts.userText}\n`
        : '';

      // TRAVA DO LAÇO DE VERIFICAÇÃO. Medido num turno real: o modelo aplicou a
      // solução CORRETA aos 630s e depois gastou mais 18 MINUTOS relendo o
      // arquivo que acabou de editar e empilhando outras duas abordagens de CSS
      // com !important — que quebrariam a primeira. Ele não consegue ver a tela,
      // então "confere" relendo, não se convence, e tenta de novo.
      //
      // Reler um arquivo que este turno acabou de escrever não traz informação
      // nova: o TOOL_RESULT da escrita já confirmou. Aqui a leitura é
      // curto-circuitada com a instrução de encerrar.
      const LEITURA = new Set(['readFile', 'readFileChunk', 'searchInFiles', 'fileInfo']);
      const ESCRITA_TOOLS = new Set(['writeFile', 'appendToFile', 'patchFile', 'deleteFile']);
      const arquivosEscritos = new Set();
      const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

      const onToolCallOriginal = onToolCall;
      if (onToolCallOriginal) {
        onToolCall = async (name, args, meta) => {
          const alvo = normPath(args && (args.path || args.file));
          if (LEITURA.has(name) && alvo && arquivosEscritos.has(alvo)) {
            console.warn(`[backend-stream][tools] ${name} em arquivo já editado neste turno — cobrando o encerramento.`);
            return {
              ok: true,
              result: {
                skipped: true,
                note: 'Você JÁ editou este arquivo neste turno e o TOOL_RESULT confirmou ' +
                  'que deu certo. Reler não traz informação nova e você não consegue ver a ' +
                  'tela renderizada, então mais uma tentativa não valida nada — só empilha ' +
                  'regras conflitantes. Se a tarefa acabou, RESPONDA AGORA em texto normal, ' +
                  'sem nenhum TOOL_CALL, dizendo o que mudou. Só continue se faltar um passo ' +
                  'DIFERENTE, em OUTRO arquivo.',
              },
            };
          }
          const r = await onToolCallOriginal(name, args, meta);
          if (ESCRITA_TOOLS.has(name) && alvo && r && r.ok !== false) arquivosEscritos.add(alvo);
          return r;
        };
      }

      const ORCAMENTO_SEM_PROGRESSO_MS = Number(process.env.HELPER_TOOL_LOOP_BUDGET_MS || 7 * 60 * 1000);
      // Rede final: mesmo progredindo, nenhum turno passa disto.
      const TETO_ABSOLUTO_MS = Number(process.env.HELPER_TOOL_LOOP_MAX_MS || 25 * 60 * 1000);
      const inicioTurno = Date.now();
      let ultimoProgresso = Date.now();
      let estourouTempo = false;
      let motivoTempo = '';

      let currentWorkingPrompt = promptWithContext;
      // Quantas vezes já pedi pro modelo reemitir um TOOL_CALL que veio quebrado.
      let malformedNudges = 0;
      // Quantas vezes cobrei uma rodada que veio sem resposta e sem ferramenta.
      let mudoNudges = 0;
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

        // Só entra em NOVA rodada se ainda há orçamento. Não interrompe uma
        // geração em andamento — corta o encadeamento de rodadas, que é o que
        // faz o turno se arrastar sem fim.
        if (iter > 0) {
          const paradoMs = Date.now() - ultimoProgresso;
          const totalMs = Date.now() - inicioTurno;
          if (paradoMs > ORCAMENTO_SEM_PROGRESSO_MS) {
            estourouTempo = true;
            motivoTempo = `${Math.round(paradoMs / 1000)}s sem nenhuma ferramenta nova`;
          } else if (totalMs > TETO_ABSOLUTO_MS) {
            estourouTempo = true;
            motivoTempo = `teto absoluto de ${Math.round(TETO_ABSOLUTO_MS / 60000)}min`;
          }
          if (estourouTempo) {
            console.warn(`[backend-stream] encerrando na iter ${iter + 1}: ${motivoTempo}.`);
            break;
          }
        }

        // SINAL DE VIDA entre rodadas. Depois de executar uma ferramenta, o
        // modelo pode levar minutos até o primeiro token da rodada seguinte —
        // e nesse intervalo a tela fica exatamente igual a uma resposta que
        // morreu. Sem isto o usuário não tem como distinguir "processando" de
        // "parou abruptamente", e acaba matando um turno que estava vivo.
        if (iter > 0 && onChunk) {
          onChunk({
            type: 'thinking',
            text: `\n⏳ Rodada ${iter + 1} — enviando ao modelo (prompt ${Math.round(currentWorkingPrompt.length / 1000)}k chars)…\n`,
          });
        }

        // iter 0 já tem o pedido no corpo do prompt; a partir da 2ª rodada ele
        // pode ter sido cortado pelo capPrompt, então volta no fim.
        const payload = {
          prompt: iter === 0 ? currentWorkingPrompt : currentWorkingPrompt + lembretePedido,
          language: mappedLang,
        };
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
          let houveChamadaNova = false;
          for (const c of calls) {
            const sig = `${c.obj.name}:${JSON.stringify(c.obj.args || {})}`;
            const n = (callCounts.get(sig) || 0) + 1;
            callCounts.set(sig, n);
            // Chamada INÉDITA = o turno avançou de verdade. Repetir a mesma
            // chamada não conta como progresso (é justamente o sintoma de estar
            // preso), e por isso não renova o orçamento.
            if (n === 1) houveChamadaNova = true;
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
          // Avançou: renova o orçamento. Tarefa que legitimamente precisa de
          // muitas edições segue rodando o quanto for necessário — o que o
          // orçamento corta é o turno PARADO, não o turno longo.
          if (houveChamadaNova) ultimoProgresso = Date.now();

          // O QUE O MODELO ESCREVEU VOLTA PRO PROMPT. Sem isto, a única coisa
          // que se acumulava entre rodadas eram os TOOL_RESULT: o plano e o
          // relatório de progresso que ele acabou de escrever eram DESCARTADOS.
          // Na rodada seguinte ele recebia o pedido original + resultados, sem
          // nenhuma lembrança do próprio raciocínio — e replanejava do zero,
          // relia os mesmos arquivos e nunca convergia. Era esse o "ela reinicia
          // a tarefa" e os 12 minutos sem escrever nada.
          // (O ramo de TOOL_CALL malformado, abaixo, já reinjetava a resposta —
          // o esquecimento aqui era descuido, não intenção.)
          const escritoPeloModelo = stripToolCallBlocks(router.answer).trim();
          const memoria = escritoPeloModelo
            ? `\n\n[VOCÊ ESCREVEU]\n${escritoPeloModelo}`
            : '';

          currentWorkingPrompt = capPrompt(currentWorkingPrompt + memoria + results + repeticao);
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
          // Turno acabou em texto: solta o que estava retido por poder ser o
          // começo de um "TOOL_CALL" que nunca veio.
          if (router.flushAnswer) router.flushAnswer();

          // router.answer já não tem thinking (foi separado no routeToken).
          let cleanText = stripToolCallBlocks(router.answer).trim();

          // Se nada foi streamado (era tool call, ou o modelo respondeu em
          // bloco único), manda o texto final de uma vez.
          if (!router.streamedAnything && onChunk && cleanText) {
            onChunk(cleanText);
          }

          // RODADA MUDA: o modelo raciocinou e fechou sem resposta E sem
          // ferramenta. Medido: acontece de verdade e mata o turno inteiro
          // (rodada 5 do harness — 2 rodadas, 286s, zero escrita, com 18 mil
          // tokens de espaço de geração sobrando, então não é falta de espaço).
          // Antes isso encerrava o turno; agora cobra uma vez e segue. Uma
          // rodada perdida é muito mais barata que o turno inteiro.
          if (!router.streamedAnything && !cleanText &&
              (router.thinking || '').trim().length > 0 && mudoNudges < 3) {
            mudoNudges++;
            const raciocinouChamada = /TOOL_?CALL/i.test(router.thinking || '');
            console.warn(`[backend-stream] rodada muda (só raciocínio, ${(router.thinking || '').length} chars, ensaiou chamada=${raciocinouChamada}) — cobrança ${mudoNudges}/3.`);
            if (onChunk) onChunk({ type: 'thinking', text: '\n⚠️ Rodada sem saída — cobrando a ação.\n' });
            // MEDIDO: o modelo escreve "TOOL_CALL" DENTRO do raciocínio (13x num
            // turno capturado do fio). Ele ensaia a chamada no pensamento, se
            // convence de que executou, e não emite nada na resposta. Pro modelo
            // "planejei" e "emiti" são a mesma coisa — as duas são texto que ele
            // escreveu. Por isso a cobrança separa explicitamente os dois canais.
            currentWorkingPrompt = capPrompt(
              currentWorkingPrompt +
              (raciocinouChamada
                ? '\n\nVocê escreveu o TOOL_CALL DENTRO do seu raciocínio. O raciocínio ' +
                  'NÃO é executado — é só pensamento, ninguém lê. Só a RESPOSTA é lida e ' +
                  'executada. Emita AGORA, na resposta, a MESMA linha TOOL_CALL que você ' +
                  'já formulou. Não pense de novo, não replaneje: copie e emita.'
                : '\n\nVocê raciocinou mas NÃO emitiu nada: nem texto, nem TOOL_CALL. ' +
                  'Raciocinar não executa nada. AGORA, sem pensar de novo: se ainda ' +
                  'falta um passo, emita o TOOL_CALL dele. Se o trabalho acabou, ' +
                  'escreva a resposta final em texto normal.')
            );
            iter++;
            continue;
          }

          // REDE DE SEGURANÇA: o stream terminou "com sucesso" mas sem UMA LETRA
          // de resposta. Era daqui que saía a tela em branco absoluta — chamava
          // onComplete(), o spinner sumia e o usuário ficava olhando pro nada,
          // sem texto e sem erro, sem like de que algo aconteceu. Nunca mais:
          // se o modelo só raciocinou, diz isso na cara do usuário.
          if (!router.streamedAnything && !cleanText) {
            const raciocinou = (router.thinking || '').trim().length > 0;
            console.warn(`[backend-stream] stream terminou SEM resposta (thinking=${(router.thinking || '').length} chars)`);
            if (onChunk) {
              onChunk(raciocinou
                ? '_O modelo gastou o turno inteiro raciocinando e não emitiu resposta. ' +
                  'Reenvie a mensagem, ou troque para um modelo menor/sem raciocínio._'
                : '_O backend encerrou o stream sem enviar nenhuma resposta._');
            }
          }

          this.addAssistantResponse(sessionId, cleanText);
          if (onComplete) onComplete();
          return;
        }
      }

      // Saiu do laço sem uma resposta final em texto — por tempo ou por rodadas.
      // Antes isso fechava o loading em silêncio e o usuário ficava sem nada.
      const decorridoS = Math.round((Date.now() - inicioTurno) / 1000);
      console.warn(
        estourouTempo
          ? `[backend-stream] turno encerrado (${decorridoS}s, ${iter} rodada(s)): ${motivoTempo}.`
          : `[backend-stream] limite de ${maxIters} iterações atingido sem resposta final.`
      );
      if (onChunk) {
        // Entrega o que o modelo já tinha escrito antes de avisar do limite.
        if (!algoNaTela && ultimoTexto) onChunk(ultimoTexto);
        onChunk(
          estourouTempo
            ? `\n\n_Parei após ${decorridoS}s e ${iter} rodada(s) de ferramenta — ${motivoTempo}. ` +
              `As edições já aplicadas estão salvas. Peça a continuação de onde parou._`
            : `\n\n_Parei após ${maxIters} rodadas de ferramenta sem concluir. ` +
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
