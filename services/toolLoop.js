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
// Estes dois números definem o CUSTO DE CADA RODADA, porque o backend é
// stateless: a cada iteração o prompt inteiro é reenviado e reprocessado.
//
// O servidor dimensiona o num_ctx pelo tamanho do prompt (~3 chars/token +
// folga). Com o teto antigo de 90k chars o num_ctx batia em 32768 — o MÁXIMO —
// e o 35B passava a reprocessar 32k de contexto a cada rodada, gerando ainda
// milhares de tokens de raciocínio por cima. Era isso que transformava 4
// rodadas em 10+ minutos com pouca coisa feita.
//
//   42k chars -> num_ctx 16384 (limite: chars/3 + 2048 <= 16384)
//   90k chars -> num_ctx 32768 (teto, o dobro do trabalho por rodada)
//
// CUIDADO COM O TETO DO RESULTADO: ele foi 6000 por um tempo, mirando rodadas
// mais baratas, e o efeito foi o oposto. Num arquivo de 44KB o modelo passava a
// enxergar 14% por leitura e precisava de 8 RODADAS só pra ler o arquivo —
// otimizei a rodada e quebrei a tarefa. O teto tem que caber um pedaço de
// arquivo que dê pra trabalhar (~280 linhas), mesmo custando mais por rodada.
// ORÇAMENTO DO TURNO — três restrições ao mesmo tempo, e apertar uma quebra
// as outras. Já quebrei todas as três nesta ordem, uma de cada vez:
//
//   1. Espaço pra GERAR = num_ctx − prompt. O raciocínio sozinho gasta ~4700
//      tokens antes de a resposta começar. Faltando espaço, o turno termina
//      sem UMA letra de resposta.
//   2. Espaço pra ENXERGAR o arquivo. Teto de resultado pequeno faz o modelo
//      ler 14% do arquivo por vez e gastar rodadas só navegando.
//   3. Espaço pra LEMBRAR. Com o teto em 24000, o custo fixo (prompt de
//      sistema 6374 + contexto de workspace 4196 = 10570, ou 44% do teto)
//      deixava 13430, e UMA leitura de 10000 já enchia: a 2ª leitura expulsava
//      a 1ª e o modelo relia o mesmo arquivo pra sempre. Laço infinito.
//
// A janela de 16384 não comporta as três. Então o turno assume 32768:
//   60000 chars / 3 = 20000 tokens + 8192 de folga = 28192 -> num_ctx 32768
//   sobra pra gerar = 32768 − 20000 = 12768 tokens (raciocínio 4700 + resposta)
//   cabem 4 leituras de 12000 simultâneas + histórico, sem expulsar nada
//
// Rodada mais lenta que em 16384, e é o preço certo: turno lento que TERMINA
// vale mais que turno rápido que relê o arquivo pra sempre.
// MEDIDO (mesmo prompt, agente completo contra o backend real):
//   resultado 12000 -> 5 rodadas / 765s, sendo 3 rodadas (377s) SÓ navegando o
//   arquivo: readFile truncava em 27% do config.html, então ele lia, faltava,
//   buscava, lia pedaço, lia outro pedaço, e só então editava.
// Com 32000 o arquivo cabe em ~1 leitura útil e as rodadas de navegação caem.
//   70000/3 = 23333 tok + 8192 de folga = 31525 -> num_ctx 32768
//   sobra pra gerar = 32768 − 23333 = 9435 tok (raciocínio medido: ~2400/rodada)
const MAX_TOOL_RESULT_CHARS = Number(process.env.HELPER_MAX_TOOL_RESULT_CHARS || 32000);
const MAX_PROMPT_CHARS = Number(process.env.HELPER_MAX_PROMPT_CHARS || 70000);

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
      ? 'A EDIÇÃO JÁ FOI APLICADA no arquivo, com sucesso — este resultado é a ' +
        'confirmação. NÃO releia o arquivo pra conferir e NÃO refaça a edição. ' +
        'Se ainda falta algo, escreva o relatório (Feito/Agora/Falta) e emita o ' +
        'próximo TOOL_CALL para o passo DIFERENTE que falta. Se não falta nada, ' +
        'RESPONDA AGORA em texto normal, sem nenhum TOOL_CALL, dizendo o que mudou.'
      : 'Continue de onde parou — não recomece a tarefa. Escreva o relatório ' +
        '(Feito/Agora/Falta) e emita o próximo TOOL_CALL, ou responda em texto ' +
        'normal se já terminou.';

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
