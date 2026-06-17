// index.js — Orquestrador do Assistente de Tradução.
// Fluxo: VAD (pw-record + RMS) detecta fim de fala → salva WAV → transcrição → tradução + sugestão → callback.

const { startVAD, stopVAD } = require('./vadEngine');
const { transcribeAudio, getTranslationAndSuggestion } = require('./openaiClient');
const fs = require('fs');

let running = false;
let resultCallback = null;
let levelCallback = null;
let loadingCallback = null;
let inFlight = 0;
let config = {};

/**
 * Registra o callback que recebe os resultados.
 * @param {function} cb - cb({ transcript, response, mode })
 */
function onResult(cb) {
  resultCallback = cb;
}

/**
 * Registra o callback que recebe o nível de áudio em tempo real (barra de volume).
 * @param {function} cb - cb(source: 'mic'|'sys', rms: number)
 */
function onLevel(cb) {
  levelCallback = cb;
}

/**
 * Registra o callback de "processando" (loading): cb(true) quando há requisição
 * em voo pra IA, cb(false) quando todas terminaram.
 */
function onLoading(cb) {
  loadingCallback = cb;
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

  await startVAD({
    // Mic escolhido pelo usuário nas Configurações (vazio = auto). O sys (áudio
    // do sistema) continua automático (sink ativo).
    micTarget: config.micDevice || undefined,
    // Nível de áudio em tempo real → barra de volume na UI.
    onLevel: (source, rms) => { if (levelCallback) levelCallback(source, rms); },
    // source: 'mic' = microfone do candidato, 'sys' = monitor do sistema (entrevistador)
    onSpeechEnd: async (audioPath, source) => {
      // "Processando" = tem requisição em voo (transcrição/tradução na OpenAI).
      // Liga o loading na UI enquanto a resposta daquele trecho não chega.
      inFlight++;
      if (loadingCallback) loadingCallback(inFlight > 0);
      try {
        // MIC = você: transcreve e MOSTRA na tela (feedback do que você falou),
        // mas NÃO traduz/sugere — tradução é só pro entrevistador (design).
        if (source === 'mic') {
          const myText = await transcribeAudio(audioPath, config.apiKey);
          if (myText && myText.trim().length >= 3 && resultCallback) {
            resultCallback({ transcript: myText, response: '', mode: 'candidate' });
          }
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

        // response === null → saída de filler já descartada no openaiClient. Não
        // renderiza nada: o usuário decide quando responder, sem poluir o chat.
        if (response && resultCallback) {
          resultCallback({ transcript, response, mode: 'interviewer' });
        }
      } catch (err) {
        console.error('[TranslationAssistant] erro no processamento:', err.message);
      } finally {
        inFlight = Math.max(0, inFlight - 1);
        if (loadingCallback) loadingCallback(inFlight > 0);
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
  inFlight = 0;
  if (loadingCallback) loadingCallback(false);
  await stopVAD();
  console.log('[TranslationAssistant] parado.');
}

function isActive() {
  return running;
}

module.exports = { start, stop, onResult, onLevel, onLoading, isActive };
