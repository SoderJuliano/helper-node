// vadEngine.js — Captura mic + áudio do sistema (monitor) via parec e detecta
// fim de fala por energia RMS. Substitui @ricky0123/vad-web (browser-only) por
// implementação Node.js pura, compatível com o processo main do Electron.
// Usa parec (camada PulseAudio) — mesmo método do voskStreamService — porque
// captura de monitor via `pw-record --target` é instável no PipeWire.

const { spawn, exec } = require('child_process');
const nativeAudio = require('../platform/nativeAudio'); // fonte PCM Win/Mac (não-Linux)
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

// Detecta o monitor do sink que está TOCANDO agora (estado RUNNING) — é a saída
// realmente em uso (Meet/Brave), mesmo que não seja o default. Retorna o nome do
// monitor (<sink>.monitor) ou null se nada estiver tocando no momento.
async function detectRunningSinkMonitor() {
  try {
    const { stdout } = await execPromise('pactl list short sinks');
    const rows = stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
    const running = rows.find((c) => (c[c.length - 1] || '').trim().toUpperCase() === 'RUNNING');
    if (running && running[1]) return running[1] + '.monitor';
  } catch (_) {}
  return null;
}

// Monitor do sink padrão resolvido na hora (fallback quando nada está tocando).
async function defaultSinkMonitor() {
  try {
    const { stdout } = await execPromise('pactl get-default-sink');
    const sink = stdout.trim();
    if (sink) return sink + '.monitor';
  } catch (_) {}
  return '@DEFAULT_MONITOR@';
}

// Resolve o alvo de captura do ÁUDIO DO SISTEMA em runtime. NÃO usar o token
// literal '@DEFAULT_SINK_MONITOR@' — pw-record não o entende e cai no microfone.
async function resolveSysTarget() {
  return (await detectRunningSinkMonitor()) || (await defaultSinkMonitor());
}

// Microfone: nome real do default source (evita tokens não-expandidos).
async function resolveMicTarget() {
  try {
    const { stdout } = await execPromise('pactl get-default-source');
    const name = stdout.trim();
    // Se o "source" padrão for um .monitor, não serve como mic.
    if (name && !name.endsWith('.monitor')) return name;
  } catch (_) {}
  return '@DEFAULT_SOURCE@';
}

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;             // s16le
const BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE; // 32000 bytes/s
const CHUNK_SIZE = BYTES_PER_SEC / 10;  // 100ms por janela de análise

// Silêncio abaixo desse RMS = sem fala
const SILENCE_RMS = 300;

// Silêncio contínuo necessário para fechar o segmento (ms)
// 'mic' = microfone do candidato, 'sys' = áudio do sistema (entrevistador)
const SILENCE_DURATION = { mic: 1500, sys: 800 };

// Fala mínima para considerar o segmento válido (evita enviar só ruído)
const MIN_SPEECH_MS = 400;

// Limite máximo de duração de um segmento
const MAX_SEGMENT_MS = 60000;

const pwProcs = { mic: null, sys: null };
let active = false;
let onSpeechEndCb = null;
let onLevelCb = null; // callback(source, rms) — alimenta a barra de volume na UI

// Follower da saída ativa: re-checa a cada SYS_FOLLOW_MS qual sink está tocando
// e migra a captura do áudio do sistema pra ele (ex: trocou monitor → fone com
// o app já aberto). Fica null quando o chamador fixa um sysTarget manual.
let sysFollowInterval = null;
let currentSysTarget = null;
let sysStateRef = null;
const SYS_FOLLOW_MS = 2000;

async function followActiveSink() {
  if (!active || !sysStateRef) return;
  const running = await detectRunningSinkMonitor();
  // Só migra quando há uma saída TOCANDO e é diferente da atual — evita ficar
  // oscilando pro default nos silêncios entre falas.
  if (!running || running === currentSysTarget) return;
  if (pwProcs.sys) { try { pwProcs.sys.kill('SIGTERM'); } catch (_) {} }
  resetState(sysStateRef);
  sysStateRef.pcmRemainder = Buffer.alloc(0);
  currentSysTarget = running;
  pwProcs.sys = startStream(running, 'sys', sysStateRef);
  console.log(`[TranslationAssistant] saída ativa mudou → capturando ${running}`);
}

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
  if (onLevelCb) onLevelCb(source, rms); // barra de volume em tempo real (~10x/s)
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
  // Win/Mac: PCM vem do bridge de renderer (nativeAudio), não do parec.
  // Mesmo formato (s16le/16k/mono) → o pipeline de VAD abaixo é idêntico.
  if (process.platform !== 'linux') {
    const onChunk = (chunk) => {
      if (!active) return;
      st.pcmRemainder = Buffer.concat([st.pcmRemainder, chunk]);
      while (st.pcmRemainder.length >= CHUNK_SIZE) {
        processChunk(st.pcmRemainder.slice(0, CHUNK_SIZE), st, source);
        st.pcmRemainder = st.pcmRemainder.slice(CHUNK_SIZE);
      }
    };
    nativeAudio.subscribe(source, onChunk).catch((e) =>
      console.error(`[TranslationAssistant] nativeAudio.subscribe(${source}) falhou:`, e.message));
    return { kill: () => nativeAudio.unsubscribe(source, onChunk) };
  }

  // Usa parec (camada PulseAudio), NÃO pw-record. Captura de MONITOR via
  // `pw-record --target` é instável no PipeWire (cai no mic / capta picotado);
  // parec --device=<monitor> capta o áudio do sistema de forma confiável — é o
  // mesmo método do voskStreamService (pipeline que sempre funcionou).
  const proc = spawn('parec', [
    '--device=' + target,
    '--rate=16000',
    '--channels=1',
    '--format=s16le',
    '--raw',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

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
    if (msg) console.log(`[TranslationAssistant] parec (${source}):`, msg);
  });

  proc.on('error', (err) => {
    console.error(`[TranslationAssistant] parec (${source}) falhou:`, err.message);
  });

  proc.on('exit', (code) => {
    if (active) console.warn(`[TranslationAssistant] parec (${source}) saiu (code=${code})`);
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
async function startVAD({ onSpeechEnd, onLevel, micTarget, sysTarget } = {}) {
  if (active) return;
  active = true;
  onSpeechEndCb = onSpeechEnd;
  onLevelCb = onLevel || null;

  const micSt = makeStreamState();
  const sysSt = makeStreamState();

  // Resolve alvos reais em runtime (override do chamador tem prioridade).
  const micT = micTarget || await resolveMicTarget();
  const sysT = sysTarget || await resolveSysTarget();
  currentSysTarget = sysT;
  sysStateRef = sysSt;

  // Microfone: candidato/usuário
  pwProcs.mic = startStream(micT, 'mic', micSt);

  // Monitor do sistema: interlocutor (áudio do Meet/Teams/browser)
  pwProcs.sys = startStream(sysT, 'sys', sysSt);

  console.log(`[TranslationAssistant] VAD iniciado — mic: ${micT} | sys: ${sysT}`);

  // Segue a saída ativa automaticamente — exceto quando o chamador FIXOU o sink.
  // Follower usa pactl (PulseAudio) → só faz sentido no Linux.
  if (!sysTarget && process.platform === 'linux') {
    sysFollowInterval = setInterval(() => { followActiveSink().catch(() => {}); }, SYS_FOLLOW_MS);
  }
}

/**
 * Para ambos os streams e libera recursos.
 */
async function stopVAD() {
  active = false;
  onLevelCb = null;
  if (sysFollowInterval) { clearInterval(sysFollowInterval); sysFollowInterval = null; }
  currentSysTarget = null;
  sysStateRef = null;
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
