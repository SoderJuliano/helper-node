// Uma requisição ao backend + consumo do SSE, com retry e watchdog.
//
// Vive separado do backendService por dois motivos: a regra das 500 linhas do
// instructions.md, e porque o tratamento de falha de rede aqui tem lógica
// própria que não tem nada a ver com o tool loop.
//
// O que era ruim antes:
//   - Erro de rede subia cru pro usuário como "Erro: terminated" (é o texto que
//     o undici usa quando o servidor fecha o socket no meio da resposta). Não
//     dizia nada e não tentava de novo.
//   - Se o backend abrisse o stream e nunca mandasse nada, o await reader.read()
//     ficava pendurado para sempre — o app "carregando" até o usuário cancelar.

const { createStreamRouter } = require('./backendStreamRouter');

// Sem um único byte por este tempo, o stream está travado. Generoso de
// propósito: modelo pesado com raciocínio pode demorar pra emitir o 1º token.
const STALL_TIMEOUT_MS = 240000;

// O fetch() inicial (antes de qualquer header de resposta chegar) não tinha
// NENHUM guard — só o abort manual do usuário. Se o servidor aceita a conexão
// TCP mas nunca manda a resposta (ex.: pikachu preso atrás de uma request
// zumbi, fila do Ollama travada), esse await ficava pendurado pra sempre: sem
// log, sem erro, sem NADA na tela — silêncio total mesmo pra um "oi". Generoso
// (3min) porque um modelo pesado ainda não carregado pode legitimamente
// demorar pra sequer abrir a resposta.
const CONNECT_TIMEOUT_MS = 180000;

// Erros de conexão que valem uma segunda tentativa (o servidor caiu no meio, o
// túnel reciclou, o socket morreu). Erro de aplicação (400/500) não entra aqui.
const RETRYABLE = /terminated|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up|EPIPE|premature close|other side closed/i;

function isRetryable(err) {
  const msg = String((err && err.message) || err || '');
  const cause = String((err && err.cause && err.cause.message) || (err && err.cause && err.cause.code) || '');
  return RETRYABLE.test(msg) || RETRYABLE.test(cause);
}

// Traduz o erro opaco da camada de rede em algo que diz o que fazer.
function friendlyError(err) {
  if (isRetryable(err)) {
    return new Error(
      'A conexão com o backend caiu no meio da resposta. Normalmente é o ' +
      'servidor cortando o stream — confira se o pikachu do server está ' +
      'atualizado (o /chat morria em 120s no TimeoutFilter).'
    );
  }
  if (String((err && err.message) || '') === '__STALL__') {
    return new Error(
      `O backend abriu o stream e não mandou nada por ${Math.round(STALL_TIMEOUT_MS / 1000)}s. ` +
      'O modelo pode não estar carregado no Ollama do server, ou o prompt é ' +
      'grande demais para a VRAM disponível.'
    );
  }
  if (String((err && err.message) || '') === '__CONNECT_STALL__') {
    return new Error(
      `O backend não respondeu nada em ${Math.round(CONNECT_TIMEOUT_MS / 1000)}s (nem os ` +
      'headers da resposta). Provavelmente uma requisição anterior travou o servidor ' +
      '(fila do Ollama presa) — tente de novo em instantes ou reinicie o pikachu no server.'
    );
  }
  return err;
}

async function readWithStallGuard(reader) {
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('__STALL__')), STALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Faz o fetch() com um teto de tempo próprio, abortando a conexão (não só
// desistindo de esperar) se o servidor não responder nada. Sem abortar de
// verdade, o socket ficaria pendurado em segundo plano mesmo após desistirmos.
async function fetchWithConnectGuard(endpoint, init, externalSignal) {
  const guardController = new AbortController();
  const forwardAbort = () => guardController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) guardController.abort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }
  let timer;
  try {
    // fetchPromise recebe um catch vazio à parte: se o timeout vencer a
    // corrida, essa promise ainda rejeita mais tarde (AbortError) e, sem
    // handler nenhum, o Node reclama de unhandledRejection.
    const fetchPromise = fetch(endpoint, { ...init, signal: guardController.signal });
    fetchPromise.catch(() => {});
    return await Promise.race([
      fetchPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          guardController.abort();
          reject(new Error('__CONNECT_STALL__'));
        }, CONNECT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', forwardAbort);
  }
}

/**
 * Consome um stream SSE do pikachu, roteando tokens pro router.
 * Devolve o corpo bruto (pro fallback de resposta não-SSE).
 */
async function consumeSse(response, router, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawBody = '';

  // "thinking-start" ABRE a fase de raciocínio e "thinking-end" FECHA. Não dá
  // pra olhar só o nome do último evento: depois do thinking-end as linhas
  // seguintes continuam com esse nome, e a resposta inteira (com a tool call)
  // acabava classificada como raciocínio.
  let inThinkingPhase = false;

  // O backend manda "[DONE]" mas NÃO fecha a conexão. Sem sair do laço nesse
  // marcador, o read() fica pendurado pra sempre e a resposta nunca volta.
  let sawDoneMarker = false;

  // FORA do laço de leitura de propósito: o nome do evento vale para as linhas
  // "data:" que vêm DEPOIS dele, e esse par pode ser partido entre dois pedaços
  // da rede ("event: end" no fim de um, "data: done" no começo do outro).
  // Resetando por pedaço, o marcador de fim era perdido nesse caso e o laço
  // seguia esperando um close que o servidor nunca manda — 4 minutos de tela
  // travada até o watchdog de stall.
  let currentEvent = 'message';

  try {
    while (true) {
      if (signal && signal.aborted) throw new Error('Request cancelled');

      const { done, value } = await readWithStallGuard(reader);
      if (done) break;

      const decoded = decoder.decode(value, { stream: true });
      rawBody += decoded;
      buffer += decoded;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
          if (currentEvent === 'thinking-start') inThinkingPhase = true;
          else if (currentEvent === 'thinking-end') inThinkingPhase = false;
          continue;
        }
        if (!line.startsWith('data: ')) continue;

        const data = line.slice(6).trim();
        // CUIDADO: "data: done" aparece DUAS vezes no protocolo do pikachu —
        // depois de "event: thinking-end" (fim do raciocínio, o stream continua)
        // e depois de "event: end" (fim de verdade). Tratar os dois como fim
        // corta a resposta logo após o thinking, que é onde a tool call vem.
        const isRealEnd = data === '[DONE]' ||
          (currentEvent === 'end' && data.toLowerCase() === 'done');
        if (isRealEnd) { sawDoneMarker = true; break; }
        if (data.toLowerCase() === 'done' || data.toLowerCase() === 'start') continue;

        try {
          const parsed = JSON.parse(data);
          // O raciocínio vem no campo "thinking" e a resposta no "response"
          // (ver genericStream no pikachu). Cada um vai pro seu buffer.
          if (typeof parsed.thinking === 'string' && parsed.thinking) {
            router.emitThinking(parsed.thinking);
          }
          const token = parsed.response || parsed.message ||
            (typeof parsed.thinking === 'string' ? '' : data);
          if (typeof token === 'string' && token) {
            if (inThinkingPhase) router.emitThinking(token);
            else router.routeToken(token);
          }
        } catch (_) {
          if (data && data.toLowerCase() !== 'done') {
            if (inThinkingPhase) router.emitThinking(data);
            else router.routeToken(data);
          }
        }
      }

      if (sawDoneMarker) break;
    }
  } finally {
    // Libera o socket: o servidor não fecha sozinho depois do marcador de fim.
    try { reader.cancel(); } catch (_) {}
  }

  return rawBody;
}

/**
 * Faz UMA rodada: POST + consumo do stream, com uma segunda tentativa quando a
 * conexão cai ANTES de qualquer token chegar (retentar depois de já ter mandado
 * texto pra tela duplicaria a resposta).
 *
 * @returns {Promise<{router: Object, rawBody: string}>}
 */
async function streamOnce({
  endpoint, fallbackEndpoint, headers, payload, signal, onChunk, hasTools,
}) {
  const router = createStreamRouter({ onChunk, hasTools });
  const body = JSON.stringify(payload);
  const maxAttempts = 2;
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const emittedBefore = router.answer.length + router.thinking.length;
    try {
      let response = await fetchWithConnectGuard(endpoint, { method: 'POST', headers, body }, signal);

      if (response.status === 404 && fallbackEndpoint) {
        console.log(`[backend-stream] 404 em ${endpoint} — caindo pro fallback`);
        response = await fetchWithConnectGuard(fallbackEndpoint, { method: 'POST', headers, body }, signal);
      }

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(
          `Backend respondeu ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`
        );
      }

      const rawBody = await consumeSse(response, router, signal);
      return { router, rawBody };
    } catch (err) {
      lastErr = err;
      if (err.name === 'AbortError' || err.message === 'Request cancelled' ||
          (signal && signal.aborted)) {
        throw new Error('Request cancelled');
      }
      const emittedNow = router.answer.length + router.thinking.length;
      const canRetry = attempt < maxAttempts && isRetryable(err) && emittedNow === emittedBefore;
      if (!canRetry) break;
      console.warn(`[backend-stream] tentativa ${attempt} falhou (${err.message}); repetindo.`);
    }
  }

  throw friendlyError(lastErr);
}

module.exports = { streamOnce, isRetryable, friendlyError, STALL_TIMEOUT_MS };
