// Teste de integracao do STT em streaming.
//
// Exercita o caminho REAL: alimenta a sessao com PCM 16 kHz (exatamente o que o
// realtimeAudioCapture produz), em chunks de 100ms e em tempo real. Valida de
// uma vez o reamostrador 16->24 kHz, o cliente WebSocket e o turn detection.
//
//   node scripts/test-realtime-stt.js [arquivo.ogg|wav|mp3]
//
// Precisa de ffmpeg no PATH e da chave da OpenAI configurada no app.

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const RealtimeTranscriptionSession = require('../services/realtimeTranscriptionSession');
const { buildTranscriptionPrompt } = require('../services/techGlossary');

const cfgPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), '.config'),
  'meu-electron-app', 'config.json'
);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const TOKEN = cfg.openIaToken || cfg.openAiToken;
if (!TOKEN) { console.error('Sem chave da OpenAI em', cfgPath); process.exit(1); }

const input = process.argv[2] || 'test-audios/pergunta1.ogg';
const raw = path.join(os.tmpdir(), 'helper-rt-test-16k.raw');

console.log('convertendo', input, '-> PCM s16le 16k mono (formato do motor de captura)');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ar', '16000', '-ac', '1', '-f', 's16le', raw]);

const pcm = fs.readFileSync(raw);
const CHUNK = 16000 * 2 / 10; // 100ms, igual ao CHUNK_SIZE do realtimeAudioCapture
console.log(`audio: ${(pcm.length / 32000).toFixed(2)}s em chunks de 100ms\n`);

const t0 = Date.now();
const el = () => ((Date.now() - t0) / 1000).toFixed(2).padStart(5) + 's';

let audioDoneAt = null, firstDeltaAt = null, speechStoppedAt = null;

const session = new RealtimeTranscriptionSession({
  token: TOKEN,
  prompt: buildTranscriptionPrompt({ background: cfg.translationAssistant?.userBackground || '' }),
  onSpeechStarted: () => console.log(el(), 'speech_started'),
  onSpeechStopped: () => { speechStoppedAt = Date.now(); console.log(el(), 'speech_stopped'); },
  onDelta: (acc) => {
    if (!firstDeltaAt) { firstDeltaAt = Date.now(); console.log(el(), 'primeiro delta'); }
    process.stdout.write(`\r        parcial: ${acc.slice(-70)}`);
  },
  onCompleted: (final) => {
    const done = Date.now();
    console.log(`\n${el()} COMPLETED: "${final}"`);
    console.log('\n=== LATENCIA ===');
    if (speechStoppedAt) console.log(`  speech_stopped -> transcript: ${((done - speechStoppedAt) / 1000).toFixed(2)}s`);
    if (audioDoneAt) console.log(`  fim do audio   -> transcript: ${((done - audioDoneAt) / 1000).toFixed(2)}s`);
    console.log('\n(batch, p/ comparar: ~1,2s de silencio + 0,7-1,4s de upload/transcricao)');
    session.close();
    try { fs.unlinkSync(raw); } catch (_) {}
    process.exit(0);
  },
  onFatal: (e) => { console.error('FATAL:', e.message); process.exit(1); },
});

session.connect();

// Espera a sessao ficar pronta e entao bombeia o audio em tempo real.
const waitReady = setInterval(() => {
  if (!session.isReady()) return;
  clearInterval(waitReady);
  console.log(el(), 'sessao pronta — enviando audio\n');
  let off = 0;
  let silenceChunks = 0;
  const silence = Buffer.alloc(CHUNK); // zeros
  const pump = setInterval(() => {
    if (off < pcm.length) {
      session.sendPcm16k(pcm.subarray(off, off + CHUNK));
      off += CHUNK;
      if (off >= pcm.length) { audioDoneAt = Date.now(); console.log(`\n${el()} >> fim da fala (seguindo com silencio, como o motor de captura faz ao vivo)`); }
      return;
    }
    // Ao vivo o motor de captura NUNCA para de emitir — ele segue mandando
    // silencio. O turn detection do servidor depende disso pra fechar o turno.
    session.sendPcm16k(silence);
    if (++silenceChunks > 50) { clearInterval(pump); console.log(el(), 'sem turno apos 5s de silencio'); }
  }, 100);
}, 50);

setTimeout(() => { console.error('timeout 60s'); process.exit(1); }, 60000);
