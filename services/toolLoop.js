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

const fs = require('fs');

// Ferramentas que ALTERAM arquivo. Depois de uma delas dar certo, o turno
// normalmente acabou — ver o texto de próximo passo em runToolCalls.
const ESCRITA = new Set(['writeFile', 'appendToFile', 'patchFile', 'deleteFile']);

/**
 * Conserta path que veio picado em tokens pelo modelo.
 *
 * Nos bytes reais do stream o modelo escreve "ARCH IT ECT URE.md" e
 * "/C:/Users/x" — o arquivo não existe com esse nome e a ferramenta falhava com
 * "não encontrado", sem ninguém entender por quê.
 *
 * A ordem importa: o valor ORIGINAL é testado primeiro, e uma variante só é
 * aceita se ela EXISTIR no disco. Assim "C:/Program Files/x" (espaço legítimo)
 * nunca é estragado — se o original existe, é ele que vale.
 */
function repairPath(value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const original = value.trim();

  const candidatos = [
    original,
    original.replace(/^\/([A-Za-z]:)/, '$1'),        // "/C:/x" → "C:/x"
    original.replace(/\s+/g, ''),                    // "ARCH IT ECT URE.md" → junta
    original.replace(/^\/([A-Za-z]:)/, '$1').replace(/\s+/g, ''),
  ];

  for (const c of candidatos) {
    if (!c) continue;
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  // Nada existe: devolve com o "/C:" corrigido, que é sempre errado, e deixa a
  // ferramenta reportar o erro de verdade com o nome que o modelo pediu.
  return candidatos[1] || original;
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
  // Path tokenizado pelo modelo ("ARCH IT ECT URE.md", "/C:/Users/x").
  for (const k of ['path', 'cwd', 'file', 'dir']) {
    if (typeof args[k] === 'string') {
      const fixed = repairPath(args[k]);
      if (fixed !== args[k]) args = { ...args, [k]: fixed };
    }
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

    // Escrita que DEU CERTO encerra o trabalho na esmagadora maioria dos casos.
    // Com o "Continue a tarefa" genérico, o modelo com raciocínio gastava mais
    // uma geração inteira (minutos, sobre um prompt já enorme) relendo o arquivo
    // pra "conferir" o que ele mesmo acabou de escrever — e às vezes reabria o
    // ciclo de análise. Aqui a instrução é explícita: aplicou, agora responda.
    const escreveu = ESCRITA.has(name) && toolResult && toolResult.ok !== false;
    const proximoPasso = escreveu
      ? 'A EDIÇÃO JÁ FOI APLICADA no arquivo, com sucesso. NÃO releia o arquivo ' +
        'pra conferir e NÃO refaça a edição. Se era isso que o usuário pediu, ' +
        'RESPONDA AGORA em texto normal (sem nenhum TOOL_CALL) dizendo o que mudou. ' +
        'Só emita outro TOOL_CALL se ainda faltar um passo DIFERENTE.'
      : 'Continue a tarefa. Se precisar de mais ferramentas, emita TOOL_CALL. ' +
        'Se terminou, responda em texto normal ao usuário.';

    appended += `\n\nTOOL_RESULT: ${name} ${resStr}\n${proximoPasso}`;
  }
  return appended;
}

module.exports = {
  runToolCalls,
  normalizeArgs,
  repairPath,
  capToolResult,
  capPrompt,
  MAX_TOOL_RESULT_CHARS,
  MAX_PROMPT_CHARS,
};
