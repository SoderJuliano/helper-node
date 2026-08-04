// services/ollamaLocalCaps.js
// O que ESTE modelo local sabe fazer — perguntado ao Ollama, não adivinhado.
//
// Duas decisões do modo offline dependem disso, e as duas estavam erradas:
//
//  1. TOOL CALLING NATIVO. O caminho local só falava o protocolo de TEXTO
//     ("TOOL_CALL: {...}"). É justamente esse protocolo que faz um modelo com
//     raciocínio visível ENSAIAR a chamada dentro do monólogo, se convencer de
//     que já executou, e terminar a rodada sem emitir nada. O Ollama aceita
//     tools[] em /api/chat e devolve message.tool_calls como OBJETO TIPADO —
//     que é o mesmo ganho já medido no backend (/agent do pikachu).
//     /api/show diz se o modelo suporta: "capabilities" contém "tools".
//     Ollama antigo não manda esse campo — aí a resposta é "não sei", e quem
//     não sabe fica no protocolo de texto, que sempre funcionou.
//
//  2. ESCRITA EM DISCO. A regra registrada é: modelo abaixo de ~10B não
//     escreve (ele apaga arquivo achando que está editando). Só que o bloqueio
//     estava em TODO modelo local, sem olhar o tamanho — então qwen3.6:35b, que
//     é MAIOR que o modelo do backend, também ficava sem writeFile/patchFile e
//     o modo offline só sabia ler. O gate agora é o tamanho de verdade.
//
// Tudo aqui é cacheado por (host, modelo): é uma pergunta sobre o modelo
// carregado, não sobre o turno, e o tool loop chamaria isso a cada rodada.

const axios = require('axios');

const TIMEOUT_MS = 4000;

// Piso de parâmetros pra liberar escrita. 10B é a regra que já estava escrita
// no código do backend ("não se usa mais modelo abaixo de ~10B pra escrever").
const MIN_WRITE_B = Number(process.env.HELPER_OLLAMA_MIN_WRITE_B || 10);
// Escapes conscientes: liberar escrita num modelo pequeno, ou forçar o
// protocolo de texto pra comparar com o nativo sem mexer no código.
const FORCE_WRITE = process.env.HELPER_OLLAMA_ALLOW_WRITE === '1';
const FORCE_TEXT_TOOLS = process.env.HELPER_OLLAMA_TEXT_TOOLS === '1';

const cache = new Map();

/** Parâmetros (em bilhões) a partir do que o /api/show devolve. */
function paramsFromShow(data) {
  const info = (data && data.model_info) || {};
  const count = info['general.parameter_count'];
  if (Number.isFinite(count) && count > 0) return count / 1e9;
  const size = data && data.details && data.details.parameter_size;
  const m = /([\d.]+)\s*([BM])/i.exec(String(size || ''));
  if (m) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n)) return /m/i.test(m[2]) ? n / 1000 : n;
  }
  return null;
}

/** Último recurso: o tamanho está na tag do modelo ("qwen3.6:35b" → 35). */
function paramsFromName(model) {
  const tag = String(model || '').split(':').pop() || '';
  const m = /(\d+(?:\.\d+)?)\s*b(?:\b|[-_.])/i.exec(tag);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * @returns {Promise<{nativeTools: boolean|null, thinking: boolean|null,
 *                    paramsB: number|null, canWrite: boolean, fonte: string}>}
 *   nativeTools === null significa "o Ollama não informou" → use o protocolo
 *   de texto. Nunca chute que suporta: um 400 no meio do turno custa a rodada.
 */
async function getCaps(host, model) {
  const chave = `${host}|${model}`;
  if (cache.has(chave)) return cache.get(chave);

  let caps = {
    nativeTools: null,
    thinking: null,
    paramsB: paramsFromName(model),
    fonte: 'nome do modelo',
  };

  try {
    // `model` é o campo atual; `name` é o antigo. Mandar os dois evita um
    // 400 em Ollama velho só por causa do nome da chave.
    const r = await axios.post(`${host}/api/show`, { model, name: model }, { timeout: TIMEOUT_MS });
    const data = r.data || {};
    const lista = Array.isArray(data.capabilities) ? data.capabilities.map(String) : null;
    caps = {
      nativeTools: lista ? lista.includes('tools') : null,
      thinking: lista ? lista.includes('thinking') : null,
      paramsB: paramsFromShow(data) || paramsFromName(model),
      fonte: lista ? '/api/show' : '/api/show (sem capabilities)',
    };
  } catch (e) {
    console.warn(`[ollamaCaps] /api/show falhou para ${model}: ${(e && e.message) || e} — usando o nome do modelo.`);
  }

  if (FORCE_TEXT_TOOLS) caps.nativeTools = false;
  caps.canWrite = FORCE_WRITE || (Number.isFinite(caps.paramsB) && caps.paramsB >= MIN_WRITE_B);

  console.log(
    `[ollamaCaps] ${model}: toolsNativas=${caps.nativeTools === null ? 'desconhecido' : caps.nativeTools}` +
    ` params=${caps.paramsB == null ? '?' : caps.paramsB}B escrita=${caps.canWrite ? 'LIBERADA' : 'bloqueada'}` +
    ` (${caps.fonte})`
  );

  cache.set(chave, caps);
  return caps;
}

/** O usuário trocou de modelo / o teste quer re-sondar. */
function invalidate(host, model) {
  if (host && model) cache.delete(`${host}|${model}`);
  else cache.clear();
}

/** Por que a escrita está bloqueada — vai pro modelo como TOOL_RESULT. */
function motivoBloqueioEscrita(caps, model) {
  const tam = caps && caps.paramsB != null ? `${caps.paramsB}B` : 'desconhecido';
  return (
    `Ferramentas de escrita estão desligadas para "${model}" (tamanho: ${tam}; ` +
    `mínimo ${MIN_WRITE_B}B). Modelo pequeno reescreve arquivo inteiro achando ` +
    `que está editando e apaga o trabalho do usuário. Descreva a alteração em ` +
    `texto, ou peça pro usuário trocar por um modelo maior (ou ligar ` +
    `HELPER_OLLAMA_ALLOW_WRITE=1 se ele aceitar o risco).`
  );
}

module.exports = { getCaps, invalidate, motivoBloqueioEscrita, MIN_WRITE_B };
