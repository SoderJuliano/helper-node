// services/ollamaLocalTurn.js
// Montagem e execução de um turno do Ollama LOCAL — a parte que responder() e
// responderStream() faziam duas vezes, cada uma divergindo um pouco da outra.
//
// Extraído porque as duas cópias já tinham desandado: só uma cobrava chamada
// repetida, só uma avisava "Executando X..." na tela, e as DUAS truncavam o
// resultado de ferramenta em 8 KB — um teto que o caminho do backend já tinha
// abandonado (services/toolLoop.js documenta o porquê: com pedaço pequeno o
// modelo gasta 8 rodadas só navegando o arquivo). Agora existe um lugar só.

const configService = require('./configService');
const { buildIdeAgentPrompt } = require('./idePrompt');
const { buildOllamaToolsAddon } = require('./ollamaLocalParsing');
const { normalizeArgs, capToolResult } = require('./toolLoop');
const caps = require('./ollamaLocalCaps');

const WRITE_TOOLS = new Set(['writeFile', 'appendToFile', 'deleteFile', 'patchFile']);

/** Pastas que o usuário anexou no painel (e autorizou nas configurações). */
function workspacePaths() {
  try {
    const workspace = require('./workspace');
    const ligado = !!(configService.getWorkspaceAccessEnabled && configService.getWorkspaceAccessEnabled());
    if (!ligado) return [];
    return workspace.list().map((a) => a.path).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/**
 * Corta o histórico sem deixar mensagem órfã.
 *
 * Uma mensagem role:"tool" só faz sentido logo depois do assistant que pediu a
 * ferramenta. Cortando pelo número bruto de mensagens, o corte cai no meio de
 * um par e o Ollama recebe um resultado de ferramenta que ninguém pediu.
 */
function trimSession(messages, manter = 12) {
  if (messages.length <= manter + 1) return messages;
  const sistema = messages[0];
  let resto = messages.slice(-manter);
  while (resto.length && resto[0].role === 'tool') resto = resto.slice(1);
  return [sistema, ...resto];
}

/**
 * Prepara o turno: filtra ferramentas, escolhe o prompt de sistema, cria/atualiza
 * a sessão e empilha a mensagem do usuário.
 *
 * @returns {Promise<Object>} tudo que o laço precisa saber sobre este turno
 */
async function prepareTurn({ host, model, texto, opts = {}, sessions }) {
  const sessionId = opts.sessionId || 'default';
  const agora = Date.now();
  const duasHoras = 2 * 60 * 60 * 1000;

  if (sessions[sessionId] && agora - sessions[sessionId].lastActivity > duasHoras) {
    delete sessions[sessionId];
    console.log('[ollamaLocal] sessão expirou');
  }

  const tools = Array.isArray(opts.tools) && opts.tools.length ? opts.tools : null;
  const onToolCall = typeof opts.onToolCall === 'function' ? opts.onToolCall : null;
  const maxToolCalls = Number.isInteger(opts.maxToolCalls) ? opts.maxToolCalls : 50;
  const modoIde = !!(tools && onToolCall);

  // Sondar as capacidades custa uma request local; só vale quando há ferramentas
  // em jogo. Conversa simples continua indo direto pro /api/chat.
  const cap = modoIde
    ? await caps.getCaps(host, model)
    : { nativeTools: false, paramsB: null, canWrite: false };

  // opts.textToolsOnly = este turno já tentou o nativo e o Ollama recusou.
  const nativeTools = modoIde && cap.nativeTools === true && !opts.textToolsOnly;
  const bloqueiaEscrita = modoIde && !cap.canWrite;

  let effectiveTools = tools;
  if (tools && bloqueiaEscrita) {
    effectiveTools = tools.filter((t) => !WRITE_TOOLS.has((t.function || t).name));
    console.log(
      `[ollamaLocal] escrita bloqueada (${cap.paramsB == null ? 'tamanho desconhecido' : cap.paramsB + 'B'}) — ` +
      `${tools.length - effectiveTools.length} ferramenta(s) de escrita fora do schema.`
    );
  }

  const wsPaths = workspacePaths();

  // O PROMPT. Em modo IDE o modelo recebe UM prompt de agente e nada mais.
  // Antes daqui saía a PILHA — prompt de copiloto de tela (65 palavras / OCR /
  // entrevista) + addon de ferramentas — que é exatamente o que fazia o modelo
  // com raciocínio visível gastar o turno debatendo contradições consigo mesmo
  // em vez de ler o projeto. O caminho do backend já tinha migrado pro
  // idePrompt.js; o local tinha ficado pra trás. Ver services/idePrompt.js.
  let systemPrompt;
  if (modoIde && !opts.instruction) {
    systemPrompt = buildIdeAgentPrompt({ toolsSchema: effectiveTools, wsPaths, nativeTools });
  } else if (modoIde) {
    // Instrução vinda de fora (fluxo agêntico multi-fase): respeita e só anexa o
    // protocolo, igual ao backendService.
    const cabecalho = wsPaths.length
      ? `DIRETÓRIOS LIBERADOS (paths absolutos):\n${wsPaths.map((p) => `  - ${p}`).join('\n')}\n\n`
      : '';
    systemPrompt = nativeTools
      ? `${cabecalho}${opts.instruction}`
      : `${cabecalho}${opts.instruction}\n\n${buildOllamaToolsAddon(effectiveTools, wsPaths)}`;
  } else {
    systemPrompt = opts.instruction || configService.getPromptInstruction() || 'You are a helpful assistant.';
  }

  if (!sessions[sessionId]) {
    sessions[sessionId] = { messages: [{ role: 'system', content: systemPrompt }], lastActivity: agora };
  } else {
    sessions[sessionId].messages[0].content = systemPrompt;
  }

  const userMsg = { role: 'user', content: texto };
  if (opts.imageBase64) {
    userMsg.images = [String(opts.imageBase64).replace(/^data:image\/[a-z]+;base64,/, '')];
  }
  sessions[sessionId].messages.push(userMsg);
  sessions[sessionId].lastActivity = agora;
  sessions[sessionId].messages = trimSession(sessions[sessionId].messages);

  const validNames = new Set((effectiveTools || []).map((t) => (t.function || t).name));

  console.log(
    `[ollamaLocal] turno: modoIde=${modoIde} toolsNativas=${nativeTools} ` +
    `tools=${effectiveTools ? effectiveTools.length : 0} escrita=${bloqueiaEscrita ? 'OFF' : 'ON'}`
  );

  return {
    sessionId, onToolCall, maxToolCalls, modoIde, nativeTools,
    effectiveTools, validNames, bloqueiaEscrita, cap, wsPaths,
  };
}

/**
 * Executa as chamadas de uma rodada.
 *
 * @param {Array} calls  [{ name, args }]  — já normalizado pelos dois protocolos
 * @returns {Promise<{results: Array, executadasOk: number, resumo: string[]}>}
 */
async function executeCalls(calls, ctx, { onChunk, signal } = {}) {
  const { onToolCall, validNames, bloqueiaEscrita, cap, model, source } = ctx;
  const results = [];
  const resumo = [];
  let executadasOk = 0;

  for (const c of calls) {
    if (signal && signal.aborted) throw new Error('Request cancelled');

    const name = c.name;
    const args = normalizeArgs(c.args);
    console.log(`[ollamaLocal][tools] → ${name}(${JSON.stringify(args).slice(0, 120)})`);

    let toolResult;
    if (bloqueiaEscrita && WRITE_TOOLS.has(name)) {
      // Sai do schema, mas o modelo pode chamar de memória. Explica em vez de
      // dizer "não existe" — senão ele fica tentando variações do nome.
      toolResult = { ok: false, error: caps.motivoBloqueioEscrita(cap, model) };
    } else if (!validNames.has(name)) {
      console.warn(`[ollamaLocal][tools] ⚠️ ferramenta desconhecida: "${name}"`);
      toolResult = {
        ok: false,
        error: `Ferramenta "${name}" não existe. Use apenas as ferramentas disponíveis. ` +
          `Se já tem a informação, escreva a RESPOSTA FINAL agora.`,
      };
    } else {
      if (onChunk) onChunk({ type: 'thinking', text: `\n⚙️ Executando ${name}...\n`, event: 'thinking' });
      try {
        toolResult = await onToolCall(name, args, { source: source || 'ollama-tool-loop' });
      } catch (e) {
        toolResult = { ok: false, error: String((e && e.message) || e) };
      }
      if (toolResult && toolResult.ok !== false) {
        executadasOk++;
        if (name === 'runCommand') {
          const linha = `${args.cmd || ''} ${(Array.isArray(args.args) ? args.args : []).join(' ')}`.trim();
          const exit = toolResult.result && typeof toolResult.result.exitCode === 'number'
            ? toolResult.result.exitCode : '?';
          resumo.push(`✓ \`${linha}\` (exit=${exit})`);
        } else {
          resumo.push(`✓ ${name}`);
        }
      }
    }

    let serialized;
    try { serialized = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult); }
    catch (_) { serialized = String(toolResult); }
    results.push({ name, serialized: capToolResult(serialized) });
  }

  return { results, executadasOk, resumo };
}

module.exports = { prepareTurn, executeCalls, trimSession, workspacePaths, WRITE_TOOLS };
