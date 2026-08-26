// services/visionGuide/visionAudioCapture.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { transcribeAudio } = require('../translationAssistant/openaiClient');

const SAMPLE_RATE = 16000;
const SPEECH_RMS = 600;
const SILENCE_HANGOVER_MS = 700;
const MIN_SEGMENT_MS = 450;
const MAX_SEGMENT_MS = 15000;

let nativeAudio = null;
const audioSubs = [];
const segmenters = new Map();
const recentAudio = [];
let audioMarker = 0;

function getAudioMarker() {
  return audioMarker;
}

function getRecentAudio() {
  return recentAudio;
}

function rmsOf(buf) {
  let sum = 0;
  const samples = buf.length / 2;
  for (let i = 0; i < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sum += s * s;
  }
  return Math.sqrt(sum / (samples || 1));
}

function writeWav(pcm, outPath) {
  const header = Buffer.alloc(44);
  const dataLen = pcm.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // 16-bit
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
}

function pushAudio(source, text) {
  const t = (text || '').trim();
  if (!t) return;
  recentAudio.push({
    source: source === 'mic' ? 'você' : 'sistema',
    text: t,
    ts: Date.now(),
  });
  if (recentAudio.length > 8) recentAudio.shift();
  audioMarker++;
}

function makeSegmenter(source, apiKey) {
  return {
    chunks: [],
    speechMs: 0,
    silenceMs: 0,
    collecting: false,
    feed(buf) {
      const durMs = (buf.length / 2) / SAMPLE_RATE * 1000;
      const rms = rmsOf(buf);
      if (rms > SPEECH_RMS) {
        this.collecting = true;
        this.silenceMs = 0;
        this.speechMs += durMs;
        this.chunks.push(buf);
      } else if (this.collecting) {
        this.silenceMs += durMs;
        if (this.silenceMs <= 200) {
          this.chunks.push(buf);
        }
        if (this.silenceMs >= SILENCE_HANGOVER_MS) this.finalize(apiKey, source);
      }
      const totalMs = this.chunks.reduce((a, b) => a + (b.length / 2) / SAMPLE_RATE * 1000, 0);
      if (this.collecting && totalMs >= MAX_SEGMENT_MS) this.finalize(apiKey, source);
    },
    finalize(key, src) {
      const speechMs = this.speechMs;
      const pcm = Buffer.concat(this.chunks);
      this.chunks = []; this.speechMs = 0; this.silenceMs = 0; this.collecting = false;
      if (speechMs < MIN_SEGMENT_MS || !key) return;
      const wav = path.join(os.tmpdir(), `helper-vg-${src}-${Date.now()}.wav`);
      try {
        writeWav(pcm, wav);
      } catch (_) { return; }
      transcribeAudio(wav, key)
        .then((text) => pushAudio(src, text))
        .catch((e) => console.warn('[vision-guide] transcrição falhou:', e.message))
        .finally(() => { try { fs.unlinkSync(wav); } catch (_) {} });
    },
  };
}

async function startAudio(apiKey) {
  if (process.platform === 'linux') {
    console.log('[vision-guide] áudio desligado no Linux (port futuro).');
    return;
  }
  try {
    nativeAudio = require('../platform/nativeAudio');
  } catch (e) {
    console.warn('[vision-guide] bridge de áudio indisponível:', e.message);
    return;
  }
  for (const source of ['mic', 'sys']) {
    segmenters.set(source, makeSegmenter(source, apiKey));
    const cb = (buf) => {
      const seg = segmenters.get(source);
      if (seg) { try { seg.feed(buf); } catch (_) {} }
    };
    audioSubs.push({ source, cb });
    try { await nativeAudio.subscribe(source, cb); } catch (e) {
      console.warn(`[vision-guide] subscribe(${source}) falhou:`, e.message);
    }
  }
}

function stopAudio() {
  if (nativeAudio) {
    for (const { source, cb } of audioSubs) {
      try { nativeAudio.unsubscribe(source, cb); } catch (_) {}
    }
  }
  audioSubs.length = 0;
  segmenters.clear();
  recentAudio.length = 0;
}

module.exports = {
  getAudioMarker,
  getRecentAudio,
  recentAudio,
  startAudio,
  stopAudio,
  pushAudio,
};
