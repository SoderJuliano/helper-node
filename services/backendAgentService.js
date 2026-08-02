// Modo AGENTE — conversa estruturada com tool calling NATIVO (/agent do pikachu).
//
// Substitui o laço de texto do backendService para o modo IDE. A diferença não
// é de estilo, é de natureza:
//
//   protocolo por TEXTO (backendService.responderStream)
//     - a conversa inteira vira UMA string concatenada; o modelo tem que
//       reinferir de quem é cada pedaço a cada rodada
//     - a chamada de ferramenta é TEXTO que o modelo escreve, então "planejei a
//       chamada" e "emiti a chamada" são a mesma coisa pra ele. Medido no fio:
//       escrevia TOOL_CALL 13x dentro do próprio raciocínio, se convencia de que
//       tinha executado, e a rodada terminava sem emitir nada
//     - ~759 linhas existem só pra consertar isso (marca picada em tokens, JSON
//       com barra solta, path remontado, cobrança de reemissão)
//
//   protocolo NATIVO (aqui)
//     - messages[] com papéis: system / user / assistant / tool
//     - a chamada volta como OBJETO TIPADO; malformada é impossível
//     - medido no mesmo servidor: 18s por rodada contra 47-110s, e 87 tokens de
//       raciocínio contra 4546 — ele não precisa mais ensaiar
//
// O caminho de texto continua existindo para quem não tem /agent no servidor.

const configService = require('./configService');
const { buildIdeAgentPrompt } = require('./idePrompt');
const { createUrlDiscovery } = require('./backendUrlDiscovery');
const { capToolResult } = require('./toolLoop');

const urlDiscovery = createUrlDiscovery();

// Turno em andamento, pra o botão "Parar IA" (cancel-ia-request) alcançar
// também o caminho nativo. Sem isto o usuário fica sem como interromper.
let abortAtual = null;

function abortCurrentRequest() {
  if (abortAtual) {
    try { abortAtual.abort(); console.log('[agent] turno cancelado pelo usuário.'); } catch (_) {}
    abortAtual = null;
  }
}

// Sem um byte por este tempo o stream está travado. Generoso: o modelo pode
// demorar pra emitir o 1º token quando o contexto está grande.
const STALL_MS = Number(process.env.HELPER_AGENT_STALL_MS || 240000);

/**
 * Uma rodada: manda a conversa, devolve o que o modelo produziu.
 * @returns {Promise<{thinking: string, content: string, toolCalls: Array}>}
 */
async function rodada({ endpoint, headers, model, messages, tools, signal, onChunk }) {
  const body = JSON.stringify({ messages, tools, language: 'PORTUGUESE' });
  const res = await fetch(`${endpoint}?model=${encodeURIComponent(model)}`, {
    method: 'POST', headers, body, signal,
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    throw new Error(`Backend respondeu ${res.status}${detalhe ? `: ${detalhe.slice(0, 300)}` : ''}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '';
  let thinking = '';
  let content = '';
  const toolCalls = [];
  let evento = 'message';
  let fim = false;

  const lerComGuarda = async () => {
    let timer;
    try {
      return await Promise.race([
        reader.read(),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('__STALL__')), STALL_MS); }),
      ]);
    } finally { clearTimeout(timer); }
  };

  try {
    while (!fim) {
      if (signal && signal.aborted) throw new Error('Request cancelled');
      const { done, value } = await lerComGuarda();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const linhas = buffer.split('\n');
      buffer = linhas.pop() || '';

      for (const linha of linhas) {
        if (linha.startsWith('event: ')) { evento = linha.slice(7).trim(); continue; }
        if (!linha.startsWith('data: ')) continue;
        const dado = linha.slice(6).trim();

        if (evento === 'end' && dado.toLowerCase() === 'done') { fim = true; break; }
        if (dado.toLowerCase() === 'done' || dado.toLowerCase() === 'start') continue;

        // CHAMADA TIPADA — o ganho todo está aqui: nada de parsear texto.
        if (evento === 'tool_call') {
          try {
            const tc = JSON.parse(dado);
            if (tc && tc.name) toolCalls.push({ name: tc.name, args: tc.arguments || {} });
          } catch (e) {
            console.warn('[agent] tool_call ilegível:', dado.slice(0, 120));
          }
          continue;
        }

        try {
          const p = JSON.parse(dado);
          if (typeof p.thinking === 'string' && p.thinking) {
            thinking += p.thinking;
            if (onChunk) onChunk({ type: 'thinking', text: p.thinking, event: 'thinking' });
          }
          if (typeof p.response === 'string' && p.response) {
            content += p.response;
            if (onChunk) onChunk(p.response);
          }
        } catch (_) { /* linha não-JSON: ignora */ }
      }
    }
  } finally {
    try { reader.cancel(); } catch (_) {}
  }

  return { thinking, content, toolCalls };
}

/**
 * Turno completo do agente: conversa até o modelo parar de pedir ferramenta.
 *
 * opts: { tools, onToolCall, model, maxToolCalls, signal }
 */
async function agentStream(texto, onChunk, onComplete, onError, opts = {}) {
  const apiUrl = await urlDiscovery.discover();
  if (!apiUrl) { if (onError) onError(new Error('Could not retrieve backend URL.')); return; }

  const model = opts.model || (configService.getBackendModel && configService.getBackendModel()) || 'qwen3.6:35b';
  const endpoint = `${apiUrl}/agent`;
  const headers = {
    'Authorization': 'Bearer Y3VzdG9tY3ZvbmxpbmU=',
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  const apiKey = configService.getBackendApiKey ? configService.getBackendApiKey() : '';
  if (apiKey) { headers['apikey'] = apiKey; headers['x-api-key'] = apiKey; }

  let wsPaths = [];
  try {
    const workspace = require('./workspace');
    wsPaths = workspace.list().map((a) => a.path).filter(Boolean);
  } catch (_) {}

  const messages = [
    { role: 'system', content: buildIdeAgentPrompt({ toolsSchema: opts.tools, wsPaths, nativeTools: true }) },
    { role: 'user', content: texto },
  ];

  // TRAVA DO LAÇO DE VERIFICAÇÃO (mesma do caminho de texto, ver backendService).
  // Depois de escrever, o modelo relê o arquivo pra "conferir" — não consegue
  // ver a tela renderizada, não se convence, e empilha patch em cima de patch.
  // Medido no modo nativo: 5 patchFile seguidos e depois volta a ler.
  const LEITURA = new Set(['readFile', 'readFileChunk', 'searchInFiles', 'fileInfo']);
  const ESCRITA = new Set(['writeFile', 'appendToFile', 'patchFile', 'deleteFile']);
  const escritos = new Set();
  const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();
  const onToolCallBruto = opts.onToolCall;
  const executar = async (nome, args, meta) => {
    const alvo = norm(args && (args.path || args.file));
    if (LEITURA.has(nome) && alvo && escritos.has(alvo)) {
      console.warn(`[agent] ${nome} em arquivo já editado neste turno — cobrando o encerramento.`);
      return {
        ok: true,
        result: {
          skipped: true,
          note: 'Você JÁ editou este arquivo neste turno e a ferramenta confirmou sucesso. ' +
            'Reler não traz informação nova e você não vê a tela renderizada, então outra ' +
            'tentativa não valida nada — só empilha regras conflitantes. Se a tarefa acabou, ' +
            'RESPONDA em texto agora. Só continue se faltar um passo DIFERENTE, em OUTRO arquivo.',
        },
      };
    }
    const r = await onToolCallBruto(nome, args, meta);
    if (ESCRITA.has(nome) && alvo && r && r.ok !== false) escritos.add(alvo);
    return r;
  };

  const maxIters = Number(process.env.HELPER_AGENT_MAX_ITERS || 30);
  const inicio = Date.now();
  const TETO_MS = Number(process.env.HELPER_AGENT_MAX_MS || 25 * 60 * 1000);

  // Um turno por vez: se sobrou algo pendurado, aborta antes de começar.
  abortCurrentRequest();
  abortAtual = new AbortController();
  const signal = opts.signal || abortAtual.signal;

  try {
    for (let iter = 0; iter < maxIters; iter++) {
      if (signal && signal.aborted) throw new Error('Request cancelled');
      if (iter > 0 && Date.now() - inicio > TETO_MS) {
        if (onChunk) onChunk(`\n\n_Parei após ${Math.round((Date.now() - inicio) / 1000)}s. As edições aplicadas estão salvas._`);
        break;
      }
      if (iter > 0 && onChunk) {
        onChunk({ type: 'thinking', text: `\n⏳ Rodada ${iter + 1} (${messages.length} mensagens)…\n` });
      }

      const { content, toolCalls } = await rodada({
        endpoint, headers, model, messages, tools: opts.tools, signal, onChunk,
      });

      if (!toolCalls.length) {
        // Sem ferramenta = resposta final.
        if (onComplete) onComplete();
        return;
      }

      // O que o modelo disse antes de chamar entra como assistant, pra ele
      // lembrar do próprio raciocínio na rodada seguinte.
      messages.push({
        role: 'assistant',
        content: content || '',
        tool_calls: toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.args } })),
      });

      for (const tc of toolCalls) {
        if (signal && signal.aborted) throw new Error('Request cancelled');
        if (onChunk) onChunk({ type: 'thinking', text: `\n⚙️ ${tc.name}…\n` });
        let resultado;
        try {
          resultado = await executar(tc.name, tc.args, { source: 'agent-nativo' });
        } catch (e) {
          resultado = { ok: false, error: String((e && e.message) || e) };
        }
        messages.push({
          role: 'tool',
          tool_name: tc.name,
          content: capToolResult(typeof resultado === 'string' ? resultado : JSON.stringify(resultado)),
        });
      }
    }

    if (onComplete) onComplete();
  } catch (e) {
    if (e.name === 'AbortError' || e.message === 'Request cancelled' || (signal && signal.aborted)) {
      if (onError) onError(new Error('Request cancelled'));
      return;
    }
    console.error('[agent] erro:', e.message);
    if (onError) onError(e);
  }
}

/** O servidor tem /agent? Decide entre o caminho nativo e o de texto. */
async function suportaAgente() {
  try {
    const apiUrl = await urlDiscovery.discover();
    if (!apiUrl) return false;
    const res = await fetch(`${apiUrl}/agent?model=probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ messages: [], tools: [], language: 'PORTUGUESE' }),
      signal: AbortSignal.timeout(8000),
    });
    return res.status !== 404;
  } catch (_) {
    return false;
  }
}

module.exports = { agentStream, suportaAgente, abortCurrentRequest };
