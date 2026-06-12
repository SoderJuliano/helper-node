// audioUtils.js — Converte Float32Array → WAV e aplica aceleração via ffmpeg
// Acelerar 2x (atempo=2.0) reduz duração do áudio antes de enviar pra API,
// diminuindo custo e latência sem perder inteligibilidade.

const { execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * Converte um Float32Array PCM 16kHz mono em buffer WAV.
 */
function float32ToWav(float32Array, sampleRate = 16000) {
  const buffer = Buffer.alloc(44 + float32Array.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + float32Array.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);   // PCM
  buffer.writeUInt16LE(1, 22);   // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(float32Array.length * 2, 40);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    buffer.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7FFF, 44 + i * 2);
  }
  return buffer;
}

/**
 * Salva o audio Float32Array como WAV e converte para WebM acelerado 2x via ffmpeg.
 * Retorna o caminho do arquivo temporário de saída (quem chama deve deletar depois).
 */
async function saveAndAccelerate(float32Array, sampleRate = 16000) {
  const ts = Date.now();
  const tmpInput = path.join(os.tmpdir(), `ta_in_${ts}.wav`);
  const tmpOutput = path.join(os.tmpdir(), `ta_out_${ts}.webm`);

  fs.writeFileSync(tmpInput, float32ToWav(float32Array, sampleRate));

  await new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-i', tmpInput,
      '-filter:a', 'atempo=2.0',
      '-y', tmpOutput,
    ], (err) => {
      if (err) reject(new Error(`ffmpeg falhou: ${err.message}`));
      else resolve();
    });
  });

  // Remove o WAV de entrada; o WebM de saída é responsabilidade do caller
  try { fs.unlinkSync(tmpInput); } catch (_) {}

  return tmpOutput;
}

module.exports = { saveAndAccelerate };

