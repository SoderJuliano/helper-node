// Execução das TOOL_CALL emitidas pelo modelo e montagem do TOOL_RESULT que
// volta pra ele na próxima iteração.
//
// Vive separado do backendService porque o protocolo é o mesmo nos dois
// caminhos (stream e síncrono) e a regra das 500 linhas do instructions.md
// não deixa isso crescer dentro do service.

// Tetos de tamanho. Sem eles, um readFile de arquivo grande entra INTEIRO no
// prompt — e como o prompt da próxima iteração é o anterior + o novo
// TOOL_RESULT, o mesmo conteúdo é reenviado em toda iteração seguinte. Com 15
// iterações isso passa de qualquer janela de contexto, e o Ollama trunca em
// silêncio: o modelo perde justamente o começo do prompt (onde estão as
// ferramentas e o pedido) e começa a raciocinar que não tem acesso a nada.
const MAX_TOOL_RESULT_CHARS = 12000;
const MAX_PROMPT_CHARS = 90000;

function capToolResult(str) {
  const s = String(str == null ? '' : str);
  if (s.length <= MAX_TOOL_RESULT_CHARS) return s;
  const head = s.slice(0, MAX_TOOL_RESULT_CHARS);
  const cut = s.length - MAX_TOOL_RESULT_CHARS;
  return `${head}\n[...truncado: ${cut} caracteres. Use readFileChunk ou ` +
    `searchInFiles para ver um trecho específico em vez do arquivo inteiro.]`;
}

/**
 * Mantém o prompt acumulado dentro de um teto, preservando o COMEÇO (instruções
 * de sistema + pedido do usuário) e o FIM (os TOOL_RESULT recentes). O que sai é
 * o miolo — resultados antigos, que já foram usados.
 */
function capPrompt(prompt) {
  const s = String(prompt == null ? '' : prompt);
  if (s.length <= MAX_PROMPT_CHARS) return s;
  const headSize = Math.floor(MAX_PROMPT_CHARS * 0.45);
  const tailSize = MAX_PROMPT_CHARS - headSize;
  const removed = s.length - MAX_PROMPT_CHARS;
  return s.slice(0, headSize) +
    `\n\n[...${removed} caracteres de resultados de ferramenta antigos omitidos ` +
    `para caber no contexto. Se precisar de algo que estava aqui, chame a ` +
    `ferramenta de novo.]\n\n` +
    s.slice(s.length - tailSize);
}

// A IA às vezes manda {command: "git status"} em vez de {cmd, args}.
// Normaliza pro formato que o executor espera.
function normalizeArgs(rawArgs) {
  let args = rawArgs || {};
  if (args && args.command && !args.cmd) {
    const parts = String(args.command).trim().split(/\s+/);
    args = { ...args, cmd: parts[0], args: parts.slice(1) };
    delete args.command;
  }
  return args;
}

/**
 * Executa as tool calls em ordem e devolve o bloco de texto com os resultados
 * pra ser concatenado no prompt da próxima iteração.
 *
 * @param {Array}    calls      saída do parseOllamaToolCalls
 * @param {Function} onToolCall (name, args, meta) => resultado
 * @param {Object}   o          { onChunk, signal, source }
 * @returns {Promise<string>}   texto dos TOOL_RESULT
 */
async function runToolCalls(calls, onToolCall, { onChunk, signal, source } = {}) {
  let appended = '';
  for (const c of calls) {
    if (signal && signal.aborted) throw new Error('Request cancelled');

    const name = c.obj.name;
    const args = normalizeArgs(c.obj.args || c.obj.arguments);

    // Vai como "thinking" pra aparecer na caixa de raciocínio da UI, e não
    // como resposta — o usuário precisa ver que o modelo está agindo.
    if (onChunk) onChunk({ type: 'thinking', text: `\n⚙️ Executando ${name}...\n` });

    let toolResult;
    try {
      toolResult = await onToolCall(name, args, { source: source || 'tool-loop' });
    } catch (e) {
      toolResult = { error: String((e && e.message) || e) };
    }

    const resStr = capToolResult(
      typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
    );
    appended += `\n\nTOOL_RESULT: ${name} ${resStr}\n` +
      'Continue a tarefa. Se precisar de mais ferramentas, emita TOOL_CALL. ' +
      'Se terminou, responda em texto normal ao usuário.';
  }
  return appended;
}

module.exports = {
  runToolCalls,
  normalizeArgs,
  capToolResult,
  capPrompt,
  MAX_TOOL_RESULT_CHARS,
  MAX_PROMPT_CHARS,
};
