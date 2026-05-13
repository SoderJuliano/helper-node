const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

/**
 * Resolve the Python executable. Prefers a local venv shipped with the app,
 * so end users don't need to install vosk manually.
 */
function resolvePython() {
  const candidates = [
    path.join(__dirname, "..", "venv", "bin", "python3"),
    "/opt/helper-node/venv/bin/python3",
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return "python3";
}

/**
 * VoskStreamService — manages a pw-record → vosk-stream.py pipeline.
 *
 * Emits events via a callback:
 *   { type: 'partial', text: '...' }   — partial recognition (word-by-word)
 *   { type: 'result',  text: '...' }   — final sentence (silence detected by Vosk)
 *   { type: 'ready' }                  — model loaded, listening
 *   { type: 'error',   message: '...' }
 *   { type: 'stopped' }                — pipeline terminated
 */
class VoskStreamService {
  constructor() {
    this.recorderProc = null;
    this.voskProc = null;
    this.running = false;
    this.onEvent = null; // callback(event)
  }

  /**
   * Start streaming speech recognition.
   * @param {Object} opts
   * @param {string} opts.audioTarget — pw-record target (e.g. sink.monitor)
   * @param {string} opts.modelPath  — path to vosk model directory
   * @param {Function} opts.onEvent  — callback for events
   */
  async start({ audioTarget, modelPath, onEvent }) {
    if (this.running) return;
    this.running = true;
    this.onEvent = onEvent || (() => {});

    const scriptPath = path.join(__dirname, "..", "vosk-stream.py");
    const resolvedModelPath = modelPath || path.join(__dirname, "..", "vosk-model");

    // Spawn vosk-stream.py using local venv when available
    const pythonExec = resolvePython();
    console.log("[vosk-stream] using python:", pythonExec);
    this.voskProc = spawn(pythonExec, [scriptPath, resolvedModelPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Parse JSON lines from vosk stdout
    const rl = readline.createInterface({ input: this.voskProc.stdout });
    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        this.onEvent(event);
      } catch (e) {
        // ignore malformed lines
      }
    });

    this.voskProc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[vosk-stream]", msg);
    });

    this.voskProc.on("close", (code) => {
      this.running = false;
      this.onEvent({ type: "stopped" });
      this.cleanup();
    });

    this.voskProc.on("error", (err) => {
      this.onEvent({ type: "error", message: `Vosk process error: ${err.message}` });
      this.stop();
    });

    // Spawn parec (PulseAudio compat, ships with PipeWire): output raw PCM to stdout.
    // pw-record does NOT accept /dev/stdout em todos builds — parec sempre funciona.
    console.log("[vosk-stream] starting parec device:", audioTarget);
    this.recorderProc = spawn("parec", [
      "--device=" + audioTarget,
      "--rate=16000",
      "--channels=1",
      "--format=s16le",
      "--raw",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Diagnóstico: contar bytes que estão chegando do pw-record
    let bytesReceived = 0;
    let firstChunkLogged = false;
    this.recorderProc.stdout.on("data", (chunk) => {
      bytesReceived += chunk.length;
      if (!firstChunkLogged) {
        firstChunkLogged = true;
        console.log("[vosk-stream] pw-record first audio chunk received:", chunk.length, "bytes");
      }
    });
    // Log a cada 5s para ver se áudio continua fluindo
    this._byteLogInterval = setInterval(() => {
      console.log("[vosk-stream] audio bytes received so far:", bytesReceived);
    }, 5000);

    // Pipe recorder stdout → vosk stdin
    this.recorderProc.stdout.pipe(this.voskProc.stdin);

    this.recorderProc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[parec]", msg);
    });

    this.recorderProc.on("error", (err) => {
      console.error("[vosk-stream] parec spawn error:", err);
      this.onEvent({ type: "error", message: `Recorder error: ${err.message}` });
      this.stop();
    });

    this.recorderProc.on("close", (code) => {
      console.log("[vosk-stream] parec exited with code:", code, "total bytes:", bytesReceived);
      // When recorder stops, close vosk stdin to flush final result
      if (this.voskProc && this.voskProc.stdin && !this.voskProc.stdin.destroyed) {
        this.voskProc.stdin.end();
      }
    });
  }

  stop() {
    this.running = false;
    if (this._byteLogInterval) { clearInterval(this._byteLogInterval); this._byteLogInterval = null; }

    if (this.recorderProc) {
      try { this.recorderProc.kill("SIGTERM"); } catch (_) {}
      this.recorderProc = null;
    }

    if (this.voskProc) {
      // Give vosk a moment to flush, then kill
      setTimeout(() => {
        if (this.voskProc) {
          try { this.voskProc.kill("SIGTERM"); } catch (_) {}
          this.voskProc = null;
        }
      }, 500);
    }
  }

  isRunning() {
    return this.running;
  }

  cleanup() {
    this.recorderProc = null;
    this.voskProc = null;
    this.running = false;
    this.onEvent = null;
  }
}

module.exports = new VoskStreamService();
