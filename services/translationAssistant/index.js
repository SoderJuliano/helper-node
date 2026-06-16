// index.js — Orquestrador do Assistente de Tradução.
// Fluxo: VAD (pw-record + RMS) detecta fim de fala → salva WAV → transcrição → tradução + sugestão → callback.

// Modo AO VIVO usa o motor de captura confiável (parec + sink real). O vadEngine
// (pw-record) só é usado pelo modo TESTE (captureOneAnswer), via testMode.js.
// Motivo: `pw-record --target <monitor>` é instável no PipeWire e cai no mic —
// por isso o tradutor ao vivo só pegava o microfone. parec resolve.
const { startCapture, stopCapture } = require('../realtimeAudioCapture');
const { transcribeAudio, getTranslationAndSuggestion } = require('./openaiClient');
const fs = require('fs');

let running = false;
let resultCallback = null;
let config = {};

/**
 * Registra o callback que recebe os resultados.
 * @param {function} cb - cb({ transcript, response, mode })
 */
function onResult(cb) {
  resultCallback = cb;
}

/**
 * Inicia o assistente de tradução.
 * @param {object} cfg
 * @param {string} cfg.apiKey
 * @param {string} cfg.userName
 * @param {string} cfg.userBackground
 * @param {string} cfg.targetLanguage
 */
async function start(cfg) {
  if (running) {
    console.log('[TranslationAssistant] já está rodando, ignorando start().');
    return;
  }
  config = cfg;
  running = true;

  console.log('[TranslationAssistant] iniciando...');

  await stopCapture().catch(() => {}); // garante estado limpo (motor compartilhado, modos exclusivos)
  await startCapture({
    // source: 'mic' = microfone do candidato, 'sys' = monitor do sistema (entrevistador)
    onSpeechEnd: async (audioPath, source) => {
      try {
        // Áudio do microfone = candidato — não processa
        if (source === 'mic') {
          console.log('[TranslationAssistant] mic (candidato) — sem output.');
          return;
        }

        const transcript = await transcribeAudio(audioPath, config.apiKey);

        // Ignora transcrições vazias ou ruído
        if (!transcript || transcript.trim().length < 3) return;

        console.log(`[TranslationAssistant] sys (entrevistador): ${transcript.substring(0, 80)}...`);

        const response = await getTranslationAndSuggestion(
          transcript,
          {
            userName: config.userName,
            userBackground: config.userBackground,
            targetLanguage: config.targetLanguage,
          },
          config.apiKey
        );

        if (resultCallback) {
          resultCallback({ transcript, response, mode: 'interviewer' });
        }
      } catch (err) {
        console.error('[TranslationAssistant] erro no processamento:', err.message);
      } finally {
        // Limpa o WAV temporário criado pelo VAD
        try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
      }
    },
  });
}

/**
 * Para o assistente e libera recursos.
 */
async function stop() {
  running = false;
  await stopCapture();
  console.log('[TranslationAssistant] parado.');
}

function isActive() {
  return running;
}

module.exports = { start, stop, onResult, isActive };
