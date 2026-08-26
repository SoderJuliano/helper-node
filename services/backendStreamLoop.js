// services/backendStreamLoop.js
const {
  parseOllamaToolCalls,
  stripToolCallBlocks,
  looksLikeToolCallAttempt,
} = require('./ollamaToolHelper');
const { streamOnce } = require('./backendSseClient');
const { runToolCalls, capPrompt } = require('./toolLoop');

async function runStreamLoop({
  endpoint,
  baseEndpoint,
  apiUrl,
  headers,
  currentWorkingPrompt,
  lembretePedido,
  mappedLang,
  opts,
  effectiveTools,
  onToolCall,
  onChunk,
  signal,
  maxIters,
  addAssistantResponse,
  sessionId,
}) {
  const LEITURA = new Set(['readFile', 'readFileChunk', 'searchInFiles', 'fileInfo']);
  const ESCRITA_TOOLS = new Set(['writeFile', 'appendToFile', 'patchFile', 'deleteFile']);
  const arquivosEscritos = new Set();
  const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

  let effectiveOnToolCall = onToolCall;
  if (effectiveOnToolCall) {
    effectiveOnToolCall = async (name, args, meta) => {
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
      const r = await onToolCall(name, args, meta);
      if (ESCRITA_TOOLS.has(name) && alvo && r && r.ok !== false) arquivosEscritos.add(alvo);
      return r;
    };
  }

  const ORCAMENTO_SEM_PROGRESSO_MS = Number(process.env.HELPER_TOOL_LOOP_BUDGET_MS || 7 * 60 * 1000);
  const TETO_ABSOLUTO_MS = Number(process.env.HELPER_TOOL_LOOP_MAX_MS || 25 * 60 * 1000);
  const inicioTurno = Date.now();
  let ultimoProgresso = Date.now();
  let estourouTempo = false;
  let motivoTempo = '';

  let promptState = currentWorkingPrompt;
  let malformedNudges = 0;
  let mudoNudges = 0;
  const callCounts = new Map();
  let ultimoTexto = '';
  let algoNaTela = false;
  let iter = 0;

  while (iter < maxIters) {
    if (signal.aborted) throw new Error("Request cancelled");

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

    if (iter > 0 && onChunk) {
      onChunk({
        type: 'thinking',
        text: `\n⏳ Rodada ${iter + 1} — enviando ao modelo (prompt ${Math.round(promptState.length / 1000)}k chars)…\n`,
      });
    }

    const payload = {
      prompt: iter === 0 ? promptState : promptState + lembretePedido,
      language: mappedLang,
    };
    if (opts.imageBase64) {
      payload.imageBase64 = opts.imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');
    }

    const { router, rawBody } = await streamOnce({
      endpoint,
      fallbackEndpoint: baseEndpoint !== '/llama3' ? `${apiUrl}/llama3-stream` : null,
      headers,
      payload,
      signal,
      onChunk,
      hasTools: !!(effectiveTools && effectiveOnToolCall),
    });

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

    const calls = (effectiveTools && effectiveOnToolCall) ? parseOllamaToolCalls(router.answer) : [];

    if (calls.length > 0 && effectiveTools && effectiveOnToolCall) {
      console.log(`[backend-stream][tools] ${calls.length} tool call(s) detectada(s) na iter ${iter + 1}`);
      const results = await runToolCalls(calls, effectiveOnToolCall, {
        onChunk, signal, source: 'ollama-stream-tool-loop',
      });

      let repeticao = '';
      let houveChamadaNova = false;
      for (const c of calls) {
        const sig = `${c.obj.name}:${JSON.stringify(c.obj.args || {})}`;
        const n = (callCounts.get(sig) || 0) + 1;
        callCounts.set(sig, n);
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
      if (houveChamadaNova) ultimoProgresso = Date.now();

      const escritoPeloModelo = stripToolCallBlocks(router.answer).trim();
      const memoria = escritoPeloModelo ? `\n\n[VOCÊ ESCREVEU]\n${escritoPeloModelo}` : '';

      promptState = capPrompt(promptState + memoria + results + repeticao);
      iter++;
      continue;
    } else if (
      effectiveTools && effectiveOnToolCall && malformedNudges < 2 &&
      looksLikeToolCallAttempt(router.answer, { requireJson: true })
    ) {
      malformedNudges++;
      console.warn(`[backend-stream][tools] TOOL_CALL malformado (tentativa ${malformedNudges}) — pedindo reemissão.`);
      if (onChunk) onChunk({ type: 'thinking', text: '\n⚠️ TOOL_CALL malformado, pedindo reemissão...\n' });
      promptState = capPrompt(
        promptState +
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
      if (router.flushAnswer) router.flushAnswer();
      let cleanText = stripToolCallBlocks(router.answer).trim();

      if (!router.streamedAnything && onChunk && cleanText) {
        onChunk(cleanText);
      }

      if (!router.streamedAnything && !cleanText &&
          (router.thinking || '').trim().length > 0 && mudoNudges < 3) {
        mudoNudges++;
        const raciocinouChamada = /TOOL_?CALL/i.test(router.thinking || '');
        console.warn(`[backend-stream] rodada muda (só raciocínio, ${(router.thinking || '').length} chars, ensaiou chamada=${raciocinouChamada}) — cobrança ${mudoNudges}/3.`);
        if (onChunk) onChunk({ type: 'thinking', text: '\n⚠️ Rodada sem saída — cobrando a ação.\n' });
        promptState = capPrompt(
          promptState +
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

      addAssistantResponse(sessionId, cleanText);
      return { completed: true };
    }
  }

  const decorridoS = Math.round((Date.now() - inicioTurno) / 1000);
  console.warn(
    estourouTempo
      ? `[backend-stream] turno encerrado (${decorridoS}s, ${iter} rodada(s)): ${motivoTempo}.`
      : `[backend-stream] limite de ${maxIters} iterações atingido sem resposta final.`
  );
  if (onChunk) {
    if (!algoNaTela && ultimoTexto) onChunk(ultimoTexto);
    onChunk(
      estourouTempo
        ? `\n\n_Parei após ${decorridoS}s e ${iter} rodada(s) de ferramenta — ${motivoTempo}. ` +
          `As edições já aplicadas estão salvas. Peça a continuação de onde parou._`
        : `\n\n_Parei após ${maxIters} rodadas de ferramenta sem concluir. ` +
          `Peça em passos menores ou diga qual arquivo atacar primeiro._`
    );
  }
  if (ultimoTexto) addAssistantResponse(sessionId, ultimoTexto);
  return { completed: true };
}

module.exports = {
  runStreamLoop,
};
