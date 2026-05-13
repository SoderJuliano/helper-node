const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { Transform } = require("stream");

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
 * Creates a Transform stream that mixes N interleaved s16le PCM sources.
 * Accumulates chunks per source and, whenever all sources have data,
 * sums the samples (with clamping) and pushes the mixed buffer.
 */
function createPCMMixer(sourceCount) {
  const buffers = Array.from({ length: sourceCount }, () => Buffer.alloc(0));

  return new Transform({
    transform(chunk, encoding, cb) {
      // chunk.source is tagged by the caller
      const idx = chunk._sourceIndex || 0;
      buffers[idx] = Buffer.concat([buffers[idx], chunk]);

      // Find minimum available length across all sources
      const minLen = Math.min(...buffers.map(b => b.length));
      // Process in 2-byte aligned chunks (s16le)
      const mixLen = minLen - (minLen % 2);

      if (mixLen >= 2) {
        const out = Buffer.alloc(mixLen);
        for (let i = 0; i < mixLen; i += 2) {
          let sum = 0;
          for (let s = 0; s < sourceCount; s++) {
            sum += buffers[s].readInt16LE(i);
          }
          // Clamp to int16 range
          out.writeInt16LE(Math.max(-32768, Math.min(32767, sum)), i);
        }
        // Trim consumed bytes
        for (let s = 0; s < sourceCount; s++) {
          buffers[s] = buffers[s].subarray(mixLen);
        }
        this.push(out);
      }
      cb();
    },
    flush(cb) {
      // Push any remaining from source 0 as-is
      if (buffers[0].length > 0) this.push(buffers[0]);
      cb();
    },
  });
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
    this.recorderProcs = [];
    this.voskProc = null;
    this.running = false;
    this.onEvent = null;
    this._byteLogInterval = null;
  }

  /**
   * Start streaming speech recognition with mixed audio sources.
   * @param {Object} opts
   * @param {string[]} opts.audioSources — array of parec device names (e.g. ['@DEFAULT_SOURCE@', 'sink.monitor'])
   * @param {string} [opts.audioTarget] — single source (legacy, converted to array)
   * @param {string} opts.modelPath  — path to vosk model directory
   * @param {Function} opts.onEvent  — callback for events
   */
  async start({ audioSources, audioTarget, modelPath, onEvent }) {
    if (this.running) return;
    this.running = true;
    this.onEvent = onEvent || (() => {});

    // Normalize: accept either audioSources (array) or audioTarget (string)
    const sources = audioSources || (audioTarget ? [audioTarget] : ['@DEFAULT_SOURCE@']);

    const scriptPath = path.join(__dirname, "..", "vosk-stream.py");
    const resolvedModelPath = modelPath || path.join(__dirname, "..", "vosk-model");

    // Spawn vosk-stream.py
    const pythonExec = resolvePython();
    console.log("[vosk-stream] using python:", pythonExec);
    this.voskProc = spawn(pythonExec, [scriptPath, resolvedModelPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    const rl = readline.createInterface({ input: this.voskProc.stdout });
    rl.on("line", (line) => {
      try {
        const event = JSON.parse(line);
        this.onEvent(event);
      } catch (e) {}
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

    // Spawn one parec per audio source and mix their PCM output
    let totalBytesReceived = 0;
    let firstChunkLogged = false;

    // Helper: emit raw mixed PCM to the consumer (for silence detection + Whisper buffering)
    const emitAudio = (chunk) => {
      this.onEvent({ type: "audio", data: chunk });
    };

    if (sources.length === 1) {
      // Single source — pipe directly + tap for audio events
      console.log("[vosk-stream] single source:", sources[0]);
      const proc = this._spawnParec(sources[0]);
      this.recorderProcs.push(proc);

      proc.stdout.on("data", (chunk) => {
        totalBytesReceived += chunk.length;
        if (!firstChunkLogged) { firstChunkLogged = true; console.log("[vosk-stream] first audio chunk:", chunk.length, "bytes"); }
        emitAudio(chunk);
      });
      proc.stdout.pipe(this.voskProc.stdin);
    } else {
      // Multiple sources — mix PCM before piping to Vosk
      console.log("[vosk-stream] mixing", sources.length, "audio sources:", sources);
      const mixer = createPCMMixer(sources.length);
      // Tap mixer output: send to vosk AND emit as audio events
      mixer.on("data", (chunk) => {
        emitAudio(chunk);
        if (this.voskProc && this.voskProc.stdin && !this.voskProc.stdin.destroyed) {
          this.voskProc.stdin.write(chunk);
        }
      });
      mixer.on("end", () => {
        if (this.voskProc && this.voskProc.stdin && !this.voskProc.stdin.destroyed) {
          this.voskProc.stdin.end();
        }
      });

      sources.forEach((src, idx) => {
        const proc = this._spawnParec(src);
        this.recorderProcs.push(proc);

        proc.stdout.on("data", (chunk) => {
          totalBytesReceived += chunk.length;
          if (!firstChunkLogged) { firstChunkLogged = true; console.log("[vosk-stream] first audio chunk:", chunk.length, "bytes from source", idx); }
          chunk._sourceIndex = idx;
          mixer.write(chunk);
        });

        proc.on("close", () => {
          if (this.recorderProcs.every(p => p.killed || p.exitCode !== null)) {
            mixer.end();
          }
        });
      });
    }

    // Log bytes every 5s
    this._byteLogInterval = setInterval(() => {
      console.log("[vosk-stream] audio bytes received so far:", totalBytesReceived);
    }, 5000);
  }

  _spawnParec(device) {
    console.log("[vosk-stream] starting parec device:", device);
    const proc = spawn("parec", [
      "--device=" + device,
      "--rate=16000",
      "--channels=1",
      "--format=s16le",
      "--raw",
    ], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg) console.error("[parec:" + device + "]", msg);
    });

    proc.on("error", (err) => {
      console.error("[vosk-stream] parec spawn error (" + device + "):", err);
      this.onEvent({ type: "error", message: `Recorder error (${device}): ${err.message}` });
    });

    proc.on("close", (code) => {
      console.log("[vosk-stream] parec (" + device + ") exited with code:", code);
      // If all recorders closed, close vosk stdin
      if (this.recorderProcs.every(p => p.killed || p.exitCode !== null)) {
        if (this.voskProc && this.voskProc.stdin && !this.voskProc.stdin.destroyed) {
          this.voskProc.stdin.end();
        }
      }
    });

    return proc;
  }

  stop() {
    this.running = false;
    if (this._byteLogInterval) { clearInterval(this._byteLogInterval); this._byteLogInterval = null; }

    for (const proc of this.recorderProcs) {
      try { proc.kill("SIGTERM"); } catch (_) {}
    }
    this.recorderProcs = [];

    if (this.voskProc) {
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
    this.recorderProcs = [];
    this.voskProc = null;
    this.running = false;
    this.onEvent = null;
  }
}

module.exports = new VoskStreamService();
