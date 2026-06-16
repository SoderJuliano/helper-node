// vadEngine.js — Captura microfone via pw-record e detecta fim de fala por
// energia RMS. Substitui @ricky0123/vad-web (browser-only) por implementação
// Node.js pura, compatível com o processo main do Electron.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;             // s16le
const BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE; // 32000 bytes/s
const CHUNK_SIZE = BYTES_PER_SEC / 10;  // 100ms por janela de análise

// Silêncio abaixo desse RMS = sem fala
const SILENCE_RMS = 300;

// Silêncio contínuo necessário para fechar o segmento (ms)
// 'mic' = microfone do candidato, 'sys' = áudio do sistema (entrevistador)
const SILENCE_DURATION = { mic: 2500, sys: 1200 };

// Fala mínima para considerar o segmento válido (evita enviar só ruído)
const MIN_SPEECH_MS = 400;

// Limite máximo de duração de um segmento
const MAX_SEGMENT_MS = 60000;

const pwProcs = { mic: null, sys: null };
let active = false;
let onSpeechEndCb = null;

// Estado independente por stream
function makeStreamState() {
  return {
    pcmRemainder: Buffer.alloc(0),
    speechBuf: Buffer.alloc(0),
    hasSpeech: false,
    silenceMs: 0,
    speechMs: 0,
  };
}

function calcRms(buf) {
  let sum = 0;
  const samples = Math.floor(buf.length / 2);
  for (let i = 0; i < samples; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  return samples > 0 ? Math.sqrt(sum / samples) : 0;
}

function pcmToWav(pcmBuf) {
  const wav = Buffer.alloc(44 + pcmBuf.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcmBuf.length, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);    // PCM
  wav.writeUInt16LE(1, 22);    // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(BYTES_PER_SEC, 28);
  wav.writeUInt16LE(BYTES_PER_SAMPLE, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(pcmBuf.length, 40);
  pcmBuf.copy(wav, 44);
  return wav;
}

function resetState(st) {
  st.speechBuf = Buffer.alloc(0);
  st.hasSpeech = false;
  st.silenceMs = 0;
  st.speechMs = 0;
}

function flushSegment(st, source) {
  if (!st.hasSpeech || st.speechMs < MIN_SPEECH_MS) {
    resetState(st);
    return;
  }
  const buf = st.speechBuf;
  resetState(st);
  try {
    const tmpPath = path.join(os.tmpdir(), `ta_vad_${source}_${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, pcmToWav(buf));
    if (onSpeechEndCb) onSpeechEndCb(tmpPath, source);
  } catch (e) {
    console.error('[TranslationAssistant] erro ao salvar segmento VAD:', e.message);
  }
}

function processChunk(pcm, st, source) {
  const rms = calcRms(pcm);
  const chunkMs = (pcm.length / BYTES_PER_SEC) * 1000;
  const silenceLimit = SILENCE_DURATION[source] || 1200;

  if (rms > SILENCE_RMS) {
    st.hasSpeech = true;
    st.silenceMs = 0;
    st.speechMs += chunkMs;
    st.speechBuf = Buffer.concat([st.speechBuf, pcm]);
    if (st.speechMs > MAX_SEGMENT_MS) flushSegment(st, source);
  } else {
    if (st.hasSpeech) {
      st.silenceMs += chunkMs;
      st.speechBuf = Buffer.concat([st.speechBuf, pcm]);
      if (st.silenceMs >= silenceLimit) flushSegment(st, source);
    }
  }
}

function startStream(target, source, st) {
  const proc = spawn('pw-record', [
    '--target', target,
    '--format=s16',
    '--rate=16000',
    '--channels=1',
    '-',
  ]);

  proc.stdout.on('data', (chunk) => {
    if (!active) return;
    st.pcmRemainder = Buffer.concat([st.pcmRemainder, chunk]);
    while (st.pcmRemainder.length >= CHUNK_SIZE) {
      processChunk(st.pcmRemainder.slice(0, CHUNK_SIZE), st, source);
      st.pcmRemainder = st.pcmRemainder.slice(CHUNK_SIZE);
    }
  });

  proc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg && !msg.includes('pw.conf')) {
      console.log(`[TranslationAssistant] pw-record (${source}):`, msg);
    }
  });

  proc.on('error', (err) => {
    console.error(`[TranslationAssistant] pw-record (${source}) falhou:`, err.message);
  });

  proc.on('exit', (code) => {
    if (active) console.warn(`[TranslationAssistant] pw-record (${source}) saiu (code=${code})`);
  });

  return proc;
}

/**
 * Inicia dois streams simultâneos:
 *   'mic'  → microfone/headset do candidato (ignorado no processamento)
 *   'sys'  → monitor do sistema (Teams, browser, HDMI) = entrevistador
 *
 * @param {object} opts
 * @param {function} opts.onSpeechEnd - callback(filePath: string, source: 'mic'|'sys')
 */
async function startVAD({ onSpeechEnd }) {
  if (active) return;
  active = true;
  onSpeechEndCb = onSpeechEnd;

  const micSt = makeStreamState();
  const sysSt = makeStreamState();

  // Microfone: candidato
  pwProcs.mic = startStream('@DEFAULT_SOURCE@', 'mic', micSt);

  // Monitor do sistema: entrevistador (áudio do Teams, browser, HDMI)
  pwProcs.sys = startStream('@DEFAULT_SINK_MONITOR@', 'sys', sysSt);

  console.log('[TranslationAssistant] VAD iniciado — mic (candidato) + sys monitor (entrevistador)');
}

/**
 * Para ambos os streams e libera recursos.
 */
async function stopVAD() {
  active = false;
  for (const key of ['mic', 'sys']) {
    if (pwProcs[key]) {
      try { pwProcs[key].kill('SIGTERM'); } catch (_) {}
      pwProcs[key] = null;
    }
  }
  console.log('[TranslationAssistant] VAD parado.');
}

/**
 * Captura exatamente UM segmento de fala do microfone e retorna o caminho do WAV.
 * Resolve com null se o timeout expirar sem fala suficiente.
 * @param {object} opts
 * @param {number} opts.timeoutMs   - timeout total (default 25s)
 * @param {number} opts.silenceMs   - silêncio pós-fala pra fechar segmento (default 2000ms)
 */
function captureOneAnswer({ timeoutMs = 25000, silenceMs: silenceLimit = 2000 } = {}) {
  return new Promise((resolve) => {
    let localActive = true;
    let localProc = null;
    let localRemainder = Buffer.alloc(0);
    let localSpeechBuf = Buffer.alloc(0);
    let localHasSpeech = false;
    let localSilenceMs = 0;
    let localSpeechMs = 0;

    const done = (wavPath) => {
      if (!localActive) return;
      localActive = false;
      clearTimeout(timeoutHandle);
      if (localProc) { try { localProc.kill('SIGTERM'); } catch (_) {} }
      resolve(wavPath);
    };

    // Timeout: resolve com o que tiver (ou null)
    const timeoutHandle = setTimeout(() => {
      if (localHasSpeech && localSpeechMs >= MIN_SPEECH_MS) {
        const tmpPath = path.join(os.tmpdir(), `ta_ans_${Date.now()}.wav`);
        try {
          fs.writeFileSync(tmpPath, pcmToWav(localSpeechBuf));
          done(tmpPath);
        } catch (_) { done(null); }
      } else {
        done(null);
      }
    }, timeoutMs);

    localProc = spawn('pw-record', [
      '--target', '@DEFAULT_SOURCE@',
      '--format=s16',
      '--rate=16000',
      '--channels=1',
      '-',
    ]);

    localProc.stdout.on('data', (chunk) => {
      if (!localActive) return;
      localRemainder = Buffer.concat([localRemainder, chunk]);
      while (localRemainder.length >= CHUNK_SIZE) {
        const pcm = localRemainder.slice(0, CHUNK_SIZE);
        localRemainder = localRemainder.slice(CHUNK_SIZE);

        const rms = calcRms(pcm);
        const chunkMs = (pcm.length / BYTES_PER_SEC) * 1000;

        if (rms > SILENCE_RMS) {
          localHasSpeech = true;
          localSilenceMs = 0;
          localSpeechMs += chunkMs;
          localSpeechBuf = Buffer.concat([localSpeechBuf, pcm]);
          if (localSpeechMs > MAX_SEGMENT_MS) {
            const tmpPath = path.join(os.tmpdir(), `ta_ans_${Date.now()}.wav`);
            try { fs.writeFileSync(tmpPath, pcmToWav(localSpeechBuf)); done(tmpPath); }
            catch (_) { done(null); }
          }
        } else if (localHasSpeech) {
          localSilenceMs += chunkMs;
          localSpeechBuf = Buffer.concat([localSpeechBuf, pcm]);
          if (localSilenceMs >= silenceLimit) {
            if (localSpeechMs >= MIN_SPEECH_MS) {
              const tmpPath = path.join(os.tmpdir(), `ta_ans_${Date.now()}.wav`);
              try { fs.writeFileSync(tmpPath, pcmToWav(localSpeechBuf)); done(tmpPath); }
              catch (_) { done(null); }
            } else {
              // Ruído curto — reseta e continua ouvindo
              localSpeechBuf = Buffer.alloc(0);
              localHasSpeech = false;
              localSilenceMs = 0;
              localSpeechMs = 0;
            }
          }
        }
      }
    });

    localProc.on('error', (err) => {
      console.error('[TranslationAssistant] captureOneAnswer pw-record error:', err.message);
      done(null);
    });

    localProc.on('exit', () => { if (localActive) done(null); });
  });
}

module.exports = { startVAD, stopVAD, captureOneAnswer };
