// index.js — Orquestrador do Assistente de Tradução.
// Fluxo: VAD (pw-record + RMS) detecta fim de fala → salva WAV → transcrição → tradução + sugestão → callback.

const { startVAD, stopVAD } = require('./vadEngine');
const { transcribeAudio, getTranslationAndSuggestion, evaluateUserResponse } = require('./openaiClient');
const configService = require('../configService');
const answerBank = require('../answerBank');
const fs = require('fs');

let running = false;
let resultCallback = null;
let levelCallback = null;
let loadingCallback = null;
let inFlight = 0;
let config = {};
// Última pergunta do entrevistador (sys), pra parear com a SUA resposta (mic) e
// alimentar o banco de respostas em background.
let lastInterviewerQuestion = '';

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
          if (myText && myText.trim().length >= 3) {
            if (resultCallback) resultCallback({ transcript: myText, response: '', mode: 'candidate' });
            // Banco de respostas: pareia a SUA resposta com a última pergunta do
            // entrevistador e avalia/guarda em background (fire-and-forget, não trava).
            if (lastInterviewerQuestion) {
              scoreAndStore(lastInterviewerQuestion, myText.trim());
              lastInterviewerQuestion = '';
            }
          }
          return;
        }

        const transcript = await transcribeAudio(audioPath, config.apiKey);

        // Ignora transcrições vazias ou ruído
        if (!transcript || transcript.trim().length < 3) return;
        lastInterviewerQuestion = transcript.trim();

        console.log(`[TranslationAssistant] sys (entrevistador): ${transcript.substring(0, 80)}...`);

        // id estável do turno: o streaming manda vários resultados com o MESMO id
        // (texto acumulado) e a UI atualiza o bloco no lugar em vez de criar outro.
        const turnId = `ta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const response = await getTranslationAndSuggestion(
          transcript,
          {
            userName: config.userName,
            userBackground: config.userBackground,
            targetLanguage: config.targetLanguage,
          },
          config.apiKey,
          {
            // Streaming: emite o texto acumulado a cada pedaço (sensação "bate pronto").
            onDelta: (partial) => {
              if (resultCallback) resultCallback({ id: turnId, transcript, response: partial, mode: 'interviewer', streaming: true });
            },
          }
        );

        // response === null → filler já descartado no openaiClient (nada renderizado).
        // Senão, manda o resultado FINAL (streaming:false) pra fechar o bloco.
        if (response && resultCallback) {
          resultCallback({ id: turnId, transcript, response, mode: 'interviewer', streaming: false });
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
