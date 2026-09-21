// index.js — Orquestrador do Assistente de Tradução.
// Fluxo: VAD (pw-record + RMS) detecta fim de fala → salva WAV → transcrição → tradução + sugestão → callback.

const { startVAD, stopVAD } = require('./vadEngine');
const { transcribeAudio, getTranslationAndSuggestion, evaluateUserResponse } = require('./openaiClient');
const { cleanTranscription } = require('../audioTranscriptionCleaner');
const configService = require('../configService');
const answerBank = require('../answerBank');
const fs = require('fs');

let running = false;
let isStarting = false;
let isStopping = false;
let resultCallback = null;
let levelCallback = null;
let loadingCallback = null;
let inFlight = 0;
let config = {};
let currentAbortController = null;
// Última pergunta do entrevistador (sys), pra parear com a SUA resposta (mic) e
// alimentar o banco de respostas em background.
let lastInterviewerQuestion = '';
// Fusao de fala fragmentada por pausa (só o entrevistador/sys — o mic não gera sugestão).
let lastClosedSys = null; // { turnId, text, closedAt }
// Se o proximo segmento sys fechar dentro desta janela apos o anterior, tratamos
// como continuacao da MESMA pergunta (pausa pra respirar) em vez de fala nova.
const CONTINUATION_WINDOW_MS = 3500;

// Avalia a SUA resposta em background (sem travar a sessão) e, se a nota for boa,
// guarda o par pergunta→resposta no banco. Silencioso: nada vai pra tela.
async function scoreAndStore(question, answer) {
  try {
    const abCfg = configService.getAnswerBankConfig();
    if (!abCfg.enabled || !question || !answer) return;
    const evalText = await evaluateUserResponse(
      question, answer,
      { userName: config.userName, userBackground: config.userBackground },
      config.apiKey
    );
    const m = String(evalText).match(/(\d)\s*\/\s*5/) || String(evalText).match(/⭐\s*(\d)/);
    const score = m ? parseInt(m[1], 10) : 0;
    await answerBank.record({
      question, answer, score, lang: config.targetLanguage,
      token: config.apiKey, minScore: abCfg.minScore,
    });
  } catch (e) {
    console.warn('[TranslationAssistant] score/store (banco) falhou:', e.message);
  }
}

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
 * Atualiza a configuração em tempo de execução sem reiniciar o áudio.
 * @param {object} newCfg
 */
function updateConfig(newCfg = {}) {
  config = { ...config, ...newCfg };
  console.log('[TranslationAssistant] configuração atualizada em tempo de execução.');
}

/**
 * Inicia o assistente de tradução com proteção contra concorrência.
 * @param {object} cfg
 */
async function start(cfg) {
  if (running || isStarting) {
    console.log('[TranslationAssistant] já está rodando ou iniciando, atualizando configurações.');
    updateConfig(cfg);
    return;
  }
  isStarting = true;
  config = { ...config, ...cfg };
  lastClosedSys = null;

  console.log('[TranslationAssistant] iniciando...');

  try {
    await startVAD({
      micTarget: config.micDevice || undefined,
      onLevel: (source, rms) => { if (levelCallback) levelCallback(source, rms); },
      onSpeechEnd: async (audioPath, source, metadata = {}) => {
        inFlight++;
        if (loadingCallback) loadingCallback(inFlight > 0);
        try {
          if (source === 'mic') {
            const rawMic = await transcribeAudio(audioPath, config.apiKey);
            const myText = cleanTranscription(rawMic || '');
            if (myText && myText.trim().length >= 3) {
              if (resultCallback) resultCallback({ transcript: myText, response: '', mode: 'candidate' });
              if (lastInterviewerQuestion) {
                scoreAndStore(lastInterviewerQuestion, myText.trim());
                lastInterviewerQuestion = '';
              }
            }
            return;
          }

          const rawTranscript = await transcribeAudio(audioPath, config.apiKey);
          const cleanedSys = cleanTranscription(rawTranscript || '');

          if (!cleanedSys || cleanedSys.trim().length < 3) return;
          const trimmed = cleanedSys.trim();
          lastInterviewerQuestion = trimmed;

          const prevClosed = lastClosedSys;
          const isContinuation = !!(
            prevClosed &&
            (metadata.forceCut || prevClosed.forceCut || (Date.now() - prevClosed.closedAt) <= CONTINUATION_WINDOW_MS)
          );
          const transcript = isContinuation ? `${prevClosed.text} ${trimmed}`.trim() : trimmed;

          console.log(`[TranslationAssistant] sys (entrevistador): ${transcript.substring(0, 80)}...`);

          const turnId = isContinuation && prevClosed ? prevClosed.turnId : `ta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

          // Cancela qualquer streaming do GPT em voo anterior para evitar sobreposição de deltas na tela
          if (currentAbortController) {
            try { currentAbortController.abort(); } catch (_) {}
          }
          currentAbortController = new AbortController();
          const signal = currentAbortController.signal;

          // Emite o transcrito imediatamente
          if (resultCallback) {
            resultCallback({ id: turnId, transcript, response: '', mode: 'interviewer', streaming: true });
          }

          const response = await getTranslationAndSuggestion(
            transcript,
            {
              userName: config.userName,
              userBackground: config.userBackground,
              userBehavioral: config.userBehavioral,
              targetLanguage: config.targetLanguage,
            },
            config.apiKey,
            {
              signal,
              onDelta: (partial) => {
                if (!signal.aborted && resultCallback) {
                  resultCallback({ id: turnId, transcript, response: partial, mode: 'interviewer', streaming: true });
                }
              },
            }
          );

          if (response && !signal.aborted && resultCallback) {
            resultCallback({ id: turnId, transcript, response, mode: 'interviewer', streaming: false });
          }
          lastClosedSys = { turnId, text: transcript, closedAt: Date.now(), forceCut: !!metadata.forceCut };
        } catch (err) {
          if (!err.name || err.name !== 'AbortError') {
            console.error('[TranslationAssistant] erro no processamento:', err.message);
          }
        } finally {
          inFlight = Math.max(0, inFlight - 1);
          if (loadingCallback) loadingCallback(inFlight > 0);
          try { if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
        }
      },
    });
    running = true;
  } finally {
    isStarting = false;
  }
}

/**
 * Para o assistente e libera recursos de forma segura.
 */
async function stop() {
  if (!running && !isStarting) return;
  if (isStopping) return;
  isStopping = true;
  running = false;
  inFlight = 0;
  if (currentAbortController) {
    try { currentAbortController.abort(); } catch (_) {}
    currentAbortController = null;
  }
  if (loadingCallback) loadingCallback(false);
  try {
    await stopVAD();
  } finally {
    isStopping = false;
  }
  console.log('[TranslationAssistant] parado.');
}

function isActive() {
  return running;
}

module.exports = { start, stop, updateConfig, onResult, onLevel, onLoading, isActive };
