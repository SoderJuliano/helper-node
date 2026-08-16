// services/realtimeBatchFallback.js
//
// Caminho BATCH do assistente em tempo real: o VAD local fecha o segmento, grava
// um WAV e manda pro /audio/transcriptions.
//
// Quando roda:
//   - sempre pro 'mic' (sua fala nao gera sugestao, so' alimenta o banco de
//     respostas — nao vale o custo de uma segunda sessao de streaming);
//   - pro 'sys' SO' quando a sessao de streaming nao esta de pe (falha de rede,
//     API fora, ou `realtimeStreamingStt: false` no config).
//
// E' o plano B: mais lento (~1,9-2,6s da ultima silaba ate' a resposta, contra
// ~1s do streaming), mas garante que a entrevista nunca fica muda.

const fs = require('fs');
const path = require('path');
const { buildTranscriptionPrompt } = require('./techGlossary');

const TRANSCRIBE_MODEL = 'gpt-4o-transcribe';
// Se o proximo segmento (mesma fonte: mic ou sys) fechar dentro desta janela apos
// o anterior, tratamos como continuacao da MESMA pergunta (pausa pra respirar) —
// juntamos os textos e reprocessamos a pergunta inteira.
const CONTINUATION_WINDOW_MS = 3000;

function isAcousticEcho(text, otherClosed) {
  if (!text || !otherClosed || !otherClosed.text) return false;
  if (Date.now() - otherClosed.closedAt > 5000) return false;
  const cleanA = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const cleanB = otherClosed.text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    const minLen = Math.min(cleanA.length, cleanB.length);
    const maxLen = Math.max(cleanA.length, cleanB.length);
    if (minLen >= 8 && (minLen / maxLen) > 0.7) return true;
  }
  return false;
}

// Transcrição própria (NÃO importa nada do Assistente de Tradução — totalmente
// independente). Envia o WAV pro endpoint de transcrição da OpenAI.
// `glossaryPrompt` enviesa o decoder pros termos técnicos da entrevista
// (SOLID, Spring, Kafka...) — custo de rede zero, é o mesmo request.
async function transcribeAudio(audioPath, apiKey, model, glossaryPrompt) {
  const fileBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  form.append('file', blob, path.basename(audioPath));
  form.append('model', model || 'gpt-4o-transcribe');
  if (glossaryPrompt) form.append('prompt', glossaryPrompt);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error?.message || 'Transcription failed');
    e.response = { status: res.status, data };
    throw e;
  }
  return data.text;
}


async function handleBatchSegment(svc, audioPath, source) {
  if (!svc.active) {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
    return;
  }

  // O motor de captura abre DOIS streams: 'mic' (você) e 'sys' (áudio do sistema —
  // interlocutor/vídeo/reunião). Com parec separando as fontes corretamente,
  // são conteúdos DIFERENTES (sem duplicação), então por padrão ouvimos OS
  // DOIS — o copiloto responde tanto ao que o outro fala quanto ao que você
  // fala. Override opcional via config.json "realtimeAudioMode":
  //   'both' (default) → ambos | 'system' → só sistema | 'mic' → só você.
  const cfg = svc.configService.getConfig ? svc.configService.getConfig() : {};
  const mode = cfg.realtimeAudioMode || 'both';
  const wanted = mode === 'mic' ? 'mic' : (mode === 'system' ? 'sys' : null);
  if (wanted && source !== wanted) {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
    return;
  }

  // No modo 'both', a SUA fala (mic) serve só pra transcrição + banco de respostas —
  // NÃO gera sugestão. Senão, quando você LÊ a sugestão em voz alta, o mic re-dispara
  // a IA e ela repete a mesma coisa (loop). A sugestão é pro que o OUTRO (sys) fala.
  // No modo 'mic' (você é a fonte do conteúdo), aí sim respondemos ao mic.
  const respondToSegment = (source === 'sys') || (mode === 'mic');

  // Com a sessao de streaming de pe, o 'sys' ja esta sendo transcrito ao vivo.
  // Transcrever o WAV de novo aqui seria pagar (e esperar) duas vezes pelo
  // mesmo audio — e ainda duplicaria a bolha na tela.
  if (svc._streaming && source === 'sys') {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
    return;
  }

  const token = svc.configService.getOpenIaToken();
  const id = 'seg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  svc.iterationCount += 1;
  const iteration = svc.iterationCount;
  svc.emitUpdate({ type: 'segment_start', id, iteration, timestamp: new Date().toISOString() });

  try {
    if (!token) throw new Error('Token da OpenAI não configurado.');

    const transcript = (await transcribeAudio(audioPath, token, TRANSCRIBE_MODEL, svc._glossaryPrompt()) || '').trim();
    if (!transcript || transcript.length < 3) {
      // Ruído/silêncio: descarta a bolha sem incomodar.
      svc.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: transcript || '(sem fala)', source: 'openai', timestamp: new Date().toISOString() });
      svc.emitUpdate({ type: 'segment_response', id, iteration, response: '(trecho sem conteúdo relevante)', source: 'openai', timestamp: new Date().toISOString() });
      return;
    }

    // Eco acústico: se a outra fonte acabou de fechar o MESMO texto nos últimos 5s, descarta duplicata.
    const otherSource = source === 'mic' ? 'sys' : 'mic';
    const otherClosed = svc.lastClosedBySource[otherSource];
    if (isAcousticEcho(transcript, otherClosed)) {
      console.log(`[realtime-batch] Eco acústico detectado em ${source} duplicando ${otherSource}: "${transcript}" - descartando`);
      return;
    }

    // Texto definitivo (UI mostra "transcrito" + "pensando…"). noSuggestion=true
    // quando é a sua fala em modo both → a UI esconde a bolha do assistente.
    svc.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: transcript, audioSource: source, source: 'openai', noSuggestion: !respondToSegment, timestamp: new Date().toISOString() });

    // Banco de respostas: rastreia a pergunta do interlocutor (sys) e, quando VOCÊ
    // (mic) responde, avalia/guarda o par em background (não trava o pipeline).
    if (source === 'mic') {
      if (svc._lastInterviewerQuestion) {
        svc._scoreAndStore(svc._lastInterviewerQuestion, transcript, token);
        svc._lastInterviewerQuestion = '';
      }
    } else {
      svc._lastInterviewerQuestion = transcript;
    }

    // Sua fala em modo both: já transcreveu e alimentou o banco — não gera sugestão.
    if (!respondToSegment) return;

    const effectiveTranscript = transcript;

    // Continuacao de fala: se o ultimo segmento DESSA MESMA fonte fechou ha pouco
    // tempo (pausa pra respirar, nao fim de pergunta), junta os textos e reprocessa
    // a pergunta INTEIRA — em vez de responder so o pedaco novo fragmentado.
    const prevClosed = svc.lastClosedBySource[source];
    const isContinuation = !!(prevClosed && (Date.now() - prevClosed.closedAt) <= CONTINUATION_WINDOW_MS);
    const askText = isContinuation ? `${prevClosed.text} ${effectiveTranscript}`.trim() : effectiveTranscript;
    if (isContinuation) {
      // Mostra a pergunta completa (com o trecho anterior) na bolha de transcricao.
      svc.emitUpdate({ type: 'segment_whisper_correction', id, iteration, text: askText, audioSource: source, source: 'openai', timestamp: new Date().toISOString() });
    }

    // Streaming: emite segment_response parcial com o MESMO id; a UI atualiza a
    // bolha no lugar (rtSegments.get(payload.id)). Throttle já é feito no _askAI.
    const response = await svc._askAI(askText, token, (partial) => {
      svc.emitUpdate({ type: 'segment_response', id, iteration, response: partial, audioSource: source, source: 'openai', timestamp: new Date().toISOString() });
    });
    if (isContinuation) {
      // Marca a resposta do trecho anterior como superada — a pergunta continuava.
      svc.emitUpdate({ type: 'segment_response', id: prevClosed.id, response: '↳ pergunta continuou no trecho seguinte — veja a resposta completa abaixo.', audioSource: source, timestamp: new Date().toISOString() });
    }
    // Emite o texto final completo (garante o conteúdo inteiro mesmo se o último delta foi throttled).
    svc.emitUpdate({ type: 'segment_response', id, iteration, response, audioSource: source, source: 'openai', timestamp: new Date().toISOString() });
    await svc._writeHistory(askText, response);
    svc.lastClosedBySource[source] = { id, text: askText, closedAt: Date.now() };
  } catch (err) {
    svc._handleError(err, id, iteration);
  } finally {
    try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
  }
}


module.exports = { handleBatchSegment, TRANSCRIBE_MODEL };
