// testMode.js — Fluxo real de entrevista:
//   1. Reproduz o áudio pelo alto-falante (entrevistador fala)
//   2. Transcreve + traduz a pergunta (em paralelo com o playback)
//   3. Mostra tradução + resposta sugerida
//   4. Captura resposta do candidato via mic (VAD one-shot)
//   5. Avalia a resposta em PT-BR
//   6. Próxima pergunta

const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');
const { transcribeAudio, getTranslationAndSuggestion, evaluateUserResponse } = require('./openaiClient');
const { captureOneAnswer } = require('./vadEngine');

// typo intencional no arquivo 5 — é o nome real
const TEST_AUDIOS = [
  'pergunta1.ogg',
  'pergunta2.ogg',
  'pergunta3.ogg',
  'pergunta4.ogg',
  'pergutna5.ogg',
];

/**
 * Tenta reproduzir o áudio pelo alto-falante.
 * Tenta pw-play → paplay → ffplay em cascata (sistema PipeWire/PulseAudio).
 * Resolve sempre (sem crash se nenhum player estiver disponível).
 */
function playAudio(filePath) {
  return new Promise((resolve) => {
    const tryPlayer = (players) => {
      if (!players.length) return resolve();
      const [cmd, ...args] = players[0];
      execFile(cmd, [...args, filePath], (err) => {
        if (err) tryPlayer(players.slice(1));
        else resolve();
      });
    };
    tryPlayer([
      ['pw-play'],
      ['paplay'],
      ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'],
    ]);
  });
}

/**
 * Fluxo completo de entrevista simulada.
 *
 * Eventos emitidos via onResult({ status, ... }):
 *   'question'   → { index, total }          — anuncia início da pergunta
 *   'done'       → { transcript, response }  — mostra tradução + sugestão
 *   'listening'  → { index }                 — avisa que está ouvindo
 *   'evaluating' → { index }                 — transcrição pronta, avaliando
 *   'evaluated'  → { userTranscript, evaluation } — mostra avaliação
 *   'no_answer'  → { index }                 — sem voz detectada
 *   'error'      → { index, error }          — erro no processamento
 *   'complete'   → { message }               — fim de todas as perguntas
 */
async function runTestMode({ apiKey, userName, userBackground, targetLanguage, onResult, onDone }) {
  const baseDir = path.join(__dirname, '..', '..', 'test-audios');

  for (let i = 0; i < TEST_AUDIOS.length; i++) {
    const audioPath = path.join(baseDir, TEST_AUDIOS[i]);

    try {
      // 1. Anuncia a pergunta
      onResult({ status: 'question', index: i + 1, total: TEST_AUDIOS.length });

      // 2. Play + transcrição em paralelo (usuário ouve enquanto a API trabalha)
      const [transcript] = await Promise.all([
        transcribeAudio(audioPath, apiKey),
        playAudio(audioPath),
      ]);

      if (!transcript || transcript.trim().length < 3) {
        onResult({ status: 'no_answer', index: i + 1 });
        continue;
      }

      // 3. Traduz e sugere resposta
      const response = await getTranslationAndSuggestion(
        transcript,
        { userName, userBackground, targetLanguage },
        apiKey
      );

      // 4. Mostra pergunta + tradução + sugestão
      onResult({ status: 'done', index: i + 1, total: TEST_AUDIOS.length, transcript, response });

      // 5. Pausa para o usuário ler a sugestão e se preparar (8s)
      await new Promise(r => setTimeout(r, 8000));

      // 6. Avisa que está ouvindo
      onResult({ status: 'listening', index: i + 1 });

      // 7. Captura a resposta do candidato (timeout 40s, silêncio 3.5s)
      const answerPath = await captureOneAnswer({ timeoutMs: 40000, silenceMs: 3500 });

      if (!answerPath) {
        onResult({ status: 'no_answer', index: i + 1 });
        continue;
      }

      // 8. Avalia (transcreve + avalia em PT-BR)
      onResult({ status: 'evaluating', index: i + 1 });
      const userTranscript = await transcribeAudio(answerPath, apiKey);
      try { if (fs.existsSync(answerPath)) fs.unlinkSync(answerPath); } catch (_) {}

      if (!userTranscript || userTranscript.trim().length < 3) {
        onResult({ status: 'no_answer', index: i + 1 });
        continue;
      }

      const evaluation = await evaluateUserResponse(
        transcript,
        userTranscript,
        { userName, userBackground },
        apiKey
      );

      // 9. Mostra avaliação
      onResult({ status: 'evaluated', index: i + 1, userTranscript, evaluation });

      // 10. Pausa antes da próxima pergunta
      if (i < TEST_AUDIOS.length - 1) {
        await new Promise(r => setTimeout(r, 5000));
      }

    } catch (err) {
      console.error(`[TranslationAssistant] testMode erro no áudio ${i + 1}:`, err.message);
      onResult({ status: 'error', index: i + 1, error: err.message });
    }
  }

  onDone();
}

module.exports = { runTestMode };
