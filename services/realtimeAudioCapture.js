// realtimeAudioCapture.js — Motor de captura DEDICADO ao Assistente em Tempo
// Real (online/OpenAI). É independente do vadEngine do Assistente de Tradução
// — propositalmente, pra que mexer aqui NUNCA afete a tradução.
//
// Captura simultaneamente o microfone E o áudio do sistema (monitor do sink que
// está tocando), detecta fim de fala por energia RMS e entrega um WAV por
// segmento. Usa `parec` (camada PulseAudio) porque captura de monitor via
// `pw-record --target` é instável no PipeWire.

const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const os = require('os');

const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;                              // s16le
const BYTES_PER_SEC = SAMPLE_RATE * BYTES_PER_SAMPLE;    // 32000 bytes/s
const CHUNK_SIZE = BYTES_PER_SEC / 10;                   // 100ms por janela
const SILENCE_RMS = 300;                                 // abaixo disso = silêncio
const SILENCE_DURATION = { mic: 2500, sys: 1200 };       // silêncio p/ fechar segmento
const MIN_SPEECH_MS = 400;                               // fala mínima válida
const MAX_SEGMENT_MS = 60000;                            // duração máxima de um segmento
const SYS_FOLLOW_MS = 2000;                              // re-checa saída ativa
const DIAG_MS = 3000;                                    // log de nível

const procs = { mic: null, sys: null };
let active = false;
let onSpeechEndCb = null;
let sysFollowInterval = null;
let diagInterval = null;
let currentSysTarget = null;
let sysStateRef = null;
let micStateRef = null;

// ---------- Resolução de alvos de áudio ----------

// Monitor do sink que está TOCANDO agora (estado RUNNING) — a saída realmente em
// uso (Meet/Brave), mesmo que não seja o default. null se nada estiver tocando.
async function detectRunningSinkMonitor() {
  try {
    const { stdout } = await execPromise('pactl list short sinks');
    const rows = stdout.split('\n').filter(Boolean).map((l) => l.split('\t'));
    const running = rows.find((c) => (c[c.length - 1] || '').trim().toUpperCase() === 'RUNNING');
    if (running && running[1]) return running[1] + '.monitor';
  } catch (_) {}
  return null;
}

async function defaultSinkMonitor() {
  try {
    const { stdout } = await execPromise('pactl get-default-sink');
    const sink = stdout.trim();
    if (sink) return sink + '.monitor';
  } catch (_) {}
  return '@DEFAULT_MONITOR@';
}

async function resolveSysTarget() {
  return (await detectRunningSinkMonitor()) || (await defaultSinkMonitor());
}

async function resolveMicTarget() {
  try {
    const { stdout } = await execPromise('pactl get-default-source');
    const name = stdout.trim();
    if (name && !name.endsWith('.monitor')) return name;
  } catch (_) {}
  return '@DEFAULT_SOURCE@';
}

// ---------- VAD ----------

function makeStreamState() {
  return { pcmRemainder: Buffer.alloc(0), speechBuf: Buffer.alloc(0), hasSpeech: false, silenceMs: 0, speechMs: 0, peakRms: 0 };
}

function calcRms(buf) {
  let sum = 0;
  const samples = Math.floor(buf.length / 2);
  for (let i = 0; i < samples; i++) { const s = buf.readInt16LE(i * 2); sum += s * s; }
  return samples > 0 ? Math.sqrt(sum / samples) : 0;
}

function pcmToWav(pcmBuf) {
  const wav = Buffer.alloc(44 + pcmBuf.length);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + pcmBuf.length, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
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
  if (!st.hasSpeech || st.speechMs < MIN_SPEECH_MS) { resetState(st); return; }
  const buf = st.speechBuf;
  resetState(st);
  try {
    const tmpPath = path.join(os.tmpdir(), `rt_${source}_${Date.now()}.wav`);
    fs.writeFileSync(tmpPath, pcmToWav(buf));
    if (onSpeechEndCb) onSpeechEndCb(tmpPath, source);
  } catch (e) {
    console.error('[realtime-audio] erro ao salvar segmento:', e.message);
  }
}

function processChunk(pcm, st, source) {
  const rms = calcRms(pcm);
  if (rms > (st.peakRms || 0)) st.peakRms = rms;
  const chunkMs = (pcm.length / BYTES_PER_SEC) * 1000;
  const silenceLimit = SILENCE_DURATION[source] || 1200;

  if (rms > SILENCE_RMS) {
    st.hasSpeech = true;
    st.silenceMs = 0;
    st.speechMs += chunkMs;
    st.speechBuf = Buffer.concat([st.speechBuf, pcm]);
    if (st.speechMs > MAX_SEGMENT_MS) flushSegment(st, source);
  } else if (st.hasSpeech) {
    st.silenceMs += chunkMs;
    st.speechBuf = Buffer.concat([st.speechBuf, pcm]);
    if (st.silenceMs >= silenceLimit) flushSegment(st, source);
  }
}

// ---------- Streams ----------

function startStream(target, source, st) {
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
    if (msg) console.log(`[realtime-audio] parec (${source}):`, msg);
  });
  proc.on('error', (err) => console.error(`[realtime-audio] parec (${source}) falhou:`, err.message));
  proc.on('exit', (code) => { if (active) console.warn(`[realtime-audio] parec (${source}) saiu (code=${code})`); });
  return proc;
}

function logLevels() {
  if (!active) return;
  const m = micStateRef ? Math.round(micStateRef.peakRms || 0) : 0;
  const s = sysStateRef ? Math.round(sysStateRef.peakRms || 0) : 0;
  console.log(`[realtime-audio] nível — mic: ${m} | sys: ${s} (silêncio < ${SILENCE_RMS})`);
  if (micStateRef) micStateRef.peakRms = 0;
  if (sysStateRef) sysStateRef.peakRms = 0;
}

// Segue a saída ativa: se o sink que está tocando mudar (ex: trocou monitor →
// fone com o app já aberto), migra a captura do áudio do sistema pra ele.
async function followActiveSink() {
  if (!active || !sysStateRef) return;
  const running = await detectRunningSinkMonitor();
  if (!running || running === currentSysTarget) return;
  if (procs.sys) { try { procs.sys.kill('SIGTERM'); } catch (_) {} }
  resetState(sysStateRef);
  sysStateRef.pcmRemainder = Buffer.alloc(0);
  currentSysTarget = running;
  procs.sys = startStream(running, 'sys', sysStateRef);
  console.log(`[realtime-audio] saída ativa mudou → capturando ${running}`);
}

// ---------- API ----------

/**
 * Inicia a captura mic + sistema.
 * @param {object} opts
 * @param {function} opts.onSpeechEnd - callback(wavPath, source: 'mic'|'sys')
 * @param {string} [opts.micTarget] - override manual do microfone
 * @param {string} [opts.sysTarget] - override manual do sink (desativa o follower)
 */
async function startCapture({ onSpeechEnd, micTarget, sysTarget } = {}) {
  if (active) return;
  active = true;
  onSpeechEndCb = onSpeechEnd;

  const micSt = makeStreamState();
  const sysSt = makeStreamState();
  sysStateRef = sysSt;
  micStateRef = micSt;

  const micT = micTarget || await resolveMicTarget();
  const sysT = sysTarget || await resolveSysTarget();
  currentSysTarget = sysT;

  procs.mic = startStream(micT, 'mic', micSt);
  procs.sys = startStream(sysT, 'sys', sysSt);
  console.log(`[realtime-audio] captura iniciada — mic: ${micT} | sys: ${sysT}`);

  if (!sysTarget) {
    sysFollowInterval = setInterval(() => { followActiveSink().catch(() => {}); }, SYS_FOLLOW_MS);
  }
  diagInterval = setInterval(logLevels, DIAG_MS);
}

async function stopCapture() {
  active = false;
  if (sysFollowInterval) { clearInterval(sysFollowInterval); sysFollowInterval = null; }
  if (diagInterval) { clearInterval(diagInterval); diagInterval = null; }
  currentSysTarget = null;
  sysStateRef = null;
  micStateRef = null;
  for (const key of ['mic', 'sys']) {
    if (procs[key]) { try { procs[key].kill('SIGTERM'); } catch (_) {} procs[key] = null; }
  }
  console.log('[realtime-audio] captura parada.');
}

module.exports = { startCapture, stopCapture };
