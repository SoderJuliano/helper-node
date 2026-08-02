// Roteia os tokens de um stream SSE entre RACIOCÍNIO e RESPOSTA.
//
// Por que os dois precisam ficar separados: o raciocínio vai pra tela (o
// usuário quer ver o modelo trabalhando), mas NUNCA pode chegar no parser de
// TOOL_CALL. Com um acumulador só, uma ferramenta que o modelo apenas COGITOU
// e descartou durante o raciocínio acabava executada de verdade. Com modelo
// que pensa (qwen3.6) isso deixa de ser raro e vira o caso comum.
//
// Coberto por scripts/test-backend-stream.js (npm run test:stream).

const { looksLikeToolCallAttempt } = require('./ollamaToolHelper');

// Menção em prosa ("pode emitir TOOL_CALL se precisar") NÃO conta — cortar o
// stream nela truncava a resposta final do usuário. Exige ":" ou "{" na sequência.
const pareceChamada = (t) => looksLikeToolCallAttempt(t, { requireJson: false });

// Marcador que abre uma chamada de ferramenta. Usado pra reter na saída
// qualquer sufixo que ainda possa estar no meio de ser escrito.
const MARCA = 'TOOL_CALL';

function createStreamRouter({ onChunk, hasTools }) {
  let thinkingBuffer = '';
  let answerBuffer = '';
  let inInlineThink = false;   // <think> vindo dentro do próprio campo response
  let streamDecided = false;   // já dá pra saber se a resposta é uma tool call?
  let answerIsToolCall = false;
  let streamedAnything = false;

  function emitThinking(t) {
    if (!t) return;
    thinkingBuffer += t;
    if (onChunk) onChunk({ type: 'thinking', text: t, event: 'thinking' });
  }

  // Segura os primeiros caracteres da RESPOSTA até dar pra decidir se ela é uma
  // tool call (aí não vai pra tela) ou texto (aí streama). O gate antigo era
  // `length > 80` + uma regex que casava a expressão "tool call" escrita em
  // prosa — qualquer resposta que mencionasse ferramentas sumia da tela.
  // Quanto do answerBuffer já foi pra tela.
  let emitidoAte = 0;

  // Maior sufixo do buffer que ainda PODE virar "TOOL_CALL". Fica retido até se
  // provar que não é: sem isso o começo do marcador aparecia na tela ("...Falta:
  // conferir os selects.\nTOOL") antes do router perceber que era uma chamada.
  // Agora que o prompt manda escrever um relatório de progresso ANTES de cada
  // TOOL_CALL, isso apareceria em toda rodada.
  function tamanhoRetido(buf) {
    const max = Math.min(MARCA.length - 1, buf.length);
    for (let n = max; n > 0; n--) {
      if (buf.slice(-n).toUpperCase() === MARCA.slice(0, n)) return n;
    }
    return 0;
  }

  function emitirPendente(reterMarca = true) {
    if (answerIsToolCall || !onChunk) return;
    const limite = reterMarca
      ? answerBuffer.length - tamanhoRetido(answerBuffer)
      : answerBuffer.length;
    if (limite <= emitidoAte) return;
    const trecho = answerBuffer.slice(emitidoAte, limite);
    emitidoAte = limite;
    if (trecho) { onChunk(trecho); streamedAnything = true; }
  }

  function pushAnswer(chunk) {
    if (!chunk) return;
    answerBuffer += chunk;
    if (!hasTools) {
      if (onChunk) { onChunk(chunk); streamedAnything = true; }
      return;
    }
    if (!streamDecided) {
      const head = answerBuffer.trimStart();
      if (head.length < 10) return;
      streamDecided = true;
      // Sem espaço na comparação: o modelo emite a marca picada em tokens
      // ("TO OL _CALL"), e a regex antiga exigia "TOOL" colado — resultado, o
      // JSON do tool call era classificado como texto e ia inteiro pra tela.
      answerIsToolCall = pareceChamada(head.slice(0, 60)) || /^\{/.test(head);
      if (!answerIsToolCall) emitirPendente();
      return;
    }
    // O modelo costuma escrever prosa ANTES do tool call ("Primeiramente, vou
    // investigar... vou emitir o seguinte TOOL_CALL:"). Nesse caso a decisão
    // acima já saiu como "texto", e sem este corte o JSON cru era despejado na
    // tela do usuário. Ao ver a marca aparecer, para de emitir daqui pra frente.
    if (!answerIsToolCall && pareceChamada(answerBuffer)) {
      answerIsToolCall = true;
      return;
    }
    emitirPendente();
  }

  // Alguns modelos emitem o raciocínio como <think>…</think> dentro do próprio
  // campo "response", sem evento SSE separado. Aqui isso é desmembrado.
  function routeToken(token) {
    let rest = token;
    while (rest) {
      if (inInlineThink) {
        const end = rest.search(/<\/think>/i);
        if (end === -1) { emitThinking(rest); rest = ''; }
        else { emitThinking(rest.slice(0, end)); rest = rest.slice(end + 8); inInlineThink = false; }
      } else {
        const start = rest.search(/<think>/i);
        if (start === -1) { pushAnswer(rest); rest = ''; }
        else { pushAnswer(rest.slice(0, start)); rest = rest.slice(start + 7); inInlineThink = true; }
      }
    }
  }

  return {
    emitThinking,
    routeToken,
    get answer() { return answerBuffer; },
    get thinking() { return thinkingBuffer; },
    get streamedAnything() { return streamedAnything; },
    get answerIsToolCall() { return answerIsToolCall; },
    markStreamed() { streamedAnything = true; },
    // Fim do turno: solta o sufixo que estava retido por poder ser o começo de
    // "TOOL_CALL". Sem isso, uma resposta final que terminasse nessas letras
    // perderia os últimos caracteres na tela.
    flushAnswer() { emitirPendente(false); },
  };
}

module.exports = { createStreamRouter };
