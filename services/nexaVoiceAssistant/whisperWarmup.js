/**
 * services/nexaVoiceAssistant/whisperWarmup.js
 * 
 * Módulo para aquecimento (warmup) assíncrono e preventivo do Whisper.
 * Pre-carrega o binário whisper-cli e os pesos GGML na memória/cache do SO,
 * eliminando a latência de cold start quando a primeira fala for finalizada.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");

let lastWarmupTimestamp = 0;
let isWarmingUp = false;
const WARMUP_TTL_MS = 5 * 60 * 1000; // 5 minutos de cache quente

function getWhisperPaths() {
  const rootDir = path.resolve(__dirname, "..", "..");
  const exeName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const binPath = path.join(rootDir, "whisper", "build", "bin", exeName);
  
  const modelPaths = [
    path.join(rootDir, "whisper", "models", "ggml-medium.bin"),
    path.join(rootDir, "whisper", "models", "ggml-small.bin"),
    path.join(rootDir, "whisper", "models", "ggml-base.bin"),
    path.join(rootDir, "whisper", "models", "ggml-tiny.bin")
  ];
  
  let validModel = null;
  for (const mp of modelPaths) {
    if (fs.existsSync(mp)) {
      validModel = mp;
      break;
    }
  }

  return {
    binPath: fs.existsSync(binPath) ? binPath : null,
    modelPath: validModel
  };
}

function buildDummyWavBuffer() {
  const pcmLen = 3200; // 100ms de silêncio a 16kHz mono 16-bit
  const buffer = Buffer.alloc(44 + pcmLen);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + pcmLen, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(16000, 24); // 16kHz
  buffer.writeUInt32LE(32000, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // 16-bit
  buffer.write("data", 36);
  buffer.writeUInt32LE(pcmLen, 40);
  return buffer;
}

/**
 * Executa o warmup do Whisper em background de forma totalmente não-bloqueante.
 */
async function warmupWhisper({ force = false } = {}) {
  const now = Date.now();
  if (!force && (now - lastWarmupTimestamp < WARMUP_TTL_MS)) {
    return { status: "already_warm", timestamp: lastWarmupTimestamp };
  }
  if (isWarmingUp) {
    return { status: "in_progress" };
  }

  const { binPath, modelPath } = getWhisperPaths();
  if (!binPath || !modelPath) {
    return { status: "not_available" };
  }

  isWarmingUp = true;
  const tmpWavPath = path.join(os.tmpdir(), `whisper_warmup_${Date.now()}.wav`);

  try {
    fs.writeFileSync(tmpWavPath, buildDummyWavBuffer());
    
    return new Promise((resolve) => {
      const threads = Math.min(4, os.cpus()?.length || 2);
      const cmd = `"${binPath}" -m "${modelPath}" -f "${tmpWavPath}" -l pt -np --threads ${threads} --no-timestamps`;

      exec(cmd, (err) => {
        isWarmingUp = false;
        lastWarmupTimestamp = Date.now();
        try { if (fs.existsSync(tmpWavPath)) fs.unlinkSync(tmpWavPath); } catch (_) {}
        
        if (err) {
          console.warn("[whisperWarmup] Aviso ao aquecer Whisper:", err.message);
          resolve({ status: "error", error: err.message });
        } else {
          console.log("[whisperWarmup] 🔥 Whisper aquecido com sucesso em background!");
          resolve({ status: "warmed", timestamp: lastWarmupTimestamp });
        }
      });
    });
  } catch (err) {
    isWarmingUp = false;
    try { if (fs.existsSync(tmpWavPath)) fs.unlinkSync(tmpWavPath); } catch (_) {}
    return { status: "error", error: err.message };
  }
}

function isWhisperWarm() {
  return (Date.now() - lastWarmupTimestamp < WARMUP_TTL_MS);
}

module.exports = {
  warmupWhisper,
  isWhisperWarm,
  getWhisperPaths
};
