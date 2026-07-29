// Execução das TOOL_CALL emitidas pelo modelo e montagem do TOOL_RESULT que
// volta pra ele na próxima iteração.
//
// Vive separado do backendService porque o protocolo é o mesmo nos dois
// caminhos (stream e síncrono) e a regra das 500 linhas do instructions.md
// não deixa isso crescer dentro do service.

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

    const resStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
    appended += `\n\nTOOL_RESULT: ${name} ${resStr}\n` +
      'Continue a tarefa. Se precisar de mais ferramentas, emita TOOL_CALL. ' +
      'Se terminou, responda em texto normal ao usuário.';
  }
  return appended;
}

module.exports = { runToolCalls, normalizeArgs };
