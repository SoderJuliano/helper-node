const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const { exec, spawn } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const { startCapture, stopCapture } = require("./realtimeAudioCapture");

/**
 * Realtime Assistant — caminho OFFLINE/provider próprio (backend, Ollama).
 *
 * A transcrição é LOCAL (Whisper.cpp) e a RESPOSTA vai pro provider selecionado
 * via `aiResponder` injetado — nunca OpenAI (regra do projeto: sem fallback
 * automático entre providers).
 *
 * Captura: `realtimeAudioCapture` (o MESMO motor do realtime online) — parec no
 * Linux, loopback WASAPI/getUserMedia no Windows/macOS. Cross-platform.
 *
 * Por segmento de fala entregue pelo motor de captura:
 *   1. emite segment_start (UI cria a bolha).
 *   2. Whisper local transcreve o WAV (fila com paralelismo limitado).
 *   3. emite segment_whisper_correction com o texto final.
 *   4. chama o provider UMA vez → emite segment_response.
 *   5. grava histórico (user + assistant) uma única vez.
 *
 * Sem Vosk: não há mais preview palavra-a-palavra (`segment_partial`). O modelo
 * PT-BR do Vosk não tinha vocabulário técnico/inglês e só servia de preview.
 */

const SAMPLE_RATE = 16000;
const WHISPER_TIMEOUT_MS = 45000;        // mata whisper se ultrapassar
const MAX_PARALLEL_WHISPER = 2;          // evita N whisper-cli concorrendo no CPU
// Se o proximo segmento (mesma fonte) fechar dentro desta janela apos o
// anterior, tratamos como continuacao da MESMA pergunta (pausa pra respirar) —
// juntamos os textos e reprocessamos a pergunta inteira.
const CONTINUATION_WINDOW_MS = 3000;

function getWhisperBinCandidates() {
  const exeName = process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
  const list = [
    path.join(__dirname, "..", "whisper", "build", "bin", exeName),
    path.join(__dirname, "..", "whisper", "bin", exeName),
  ];
  if (process.env.LOCALAPPDATA) {
    list.push(
      path.join(process.env.LOCALAPPDATA, "helper-node-whisper-cache", "bin", exeName),
      path.join(process.env.LOCALAPPDATA, "helper-node", "whisper", "build", "bin", exeName),
      path.join(process.env.LOCALAPPDATA, "helper-node", "bin", exeName)
    );
  }
  return list;
}

function whisperBinPath() {
  for (const p of getWhisperBinCandidates()) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return path.join(__dirname, "..", "whisper", "build", "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
}

function getWhisperModelPath() {
  const names = ["ggml-base.bin", "ggml-small.bin", "ggml-tiny.bin", "ggml-medium.bin"];
  const searchDirs = [
    path.join(__dirname, "..", "whisper", "models"),
  ];
  if (process.env.LOCALAPPDATA) {
    searchDirs.push(
      path.join(process.env.LOCALAPPDATA, "helper-node-whisper-cache", "models"),
      path.join(process.env.LOCALAPPDATA, "helper-node", "whisper", "models")
    );
  }
  for (const dir of searchDirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) return full;
      } catch (_) {}
    }
  }
  return null;
}

async function cloudTranscribeWav(audioPath, apiKey) {
  const fileBuffer = await fsp.readFile(audioPath);
  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  form.append('file', blob, path.basename(audioPath));
  form.append('model', 'gpt-4o-transcribe');
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Cloud transcription failed');
  return data.text || '';
}

function isAcousticEcho(text, otherClosed) {
  if (!text || !otherClosed || !otherClosed.text) return false;
  if (Date.now() - otherClosed.closedAt > 5000) return false;
  const cleanA = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const cleanB = otherClosed.text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
    const minLen = Math.min(cleanA.length, cleanB.length);
    const maxLen = Math.max(cleanA.length, cleanB.length);
    if (minLen >= 8 && (minLen / maxLen) > 0.7) return true;
  }
  return false;
}

class RealtimeAssistantService {
  constructor({ configService, getMainWindow, onFatalStop, historyService, aiResponder }) {
    this.configService = configService;
    this.getMainWindow = getMainWindow;
    this.onFatalStop = onFatalStop || null;
    this.historyService = historyService || null;
    // Responder injetado: a resposta da IA é gerada pelo provider SELECIONADO
    // (backend/Ollama), não por OpenAI. Recebe a transcrição final e devolve texto.
    this.aiResponder = typeof aiResponder === 'function' ? aiResponder : null;

    this.active = false;
    this.contextMessages = [];
    this.maxIterationsInContext = 10;
    this.currentSessionId = null;

    this.iterationCount = 0;
    // Fusao de fala fragmentada por pausa — rastreado por fonte (mic/sys nao se misturam).
    this.lastClosedBySource = { mic: null, sys: null };

    // Fila do Whisper: limita paralelismo pra nao travar CPU.
    this._whisperQueue = [];
    this._whisperRunning = 0;
  }

  isActive() { return this.active; }

  async start() {
    if (this.active) return true;
    this.active = true;
    this.iterationCount = 0;
    this.contextMessages = [];
    this.currentSessionId = null;
    this.lastClosedBySource = { mic: null, sys: null };

    if (this.historyService) {
      try {
        const now = new Date();
        const title = `🎧 Live Assistant — ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const session = await this.historyService.createNewSession(title);
        this.currentSessionId = session.id;
      } catch (e) { console.warn('history session failed:', e.message); }
    }

    const hasLocalWhisper = fs.existsSync(whisperBinPath()) && !!getWhisperModelPath();
    const token = this.configService.getOpenIaToken ? this.configService.getOpenIaToken() : '';

    if (!hasLocalWhisper && !token) {
      this.active = false;
      this.emitUpdate({
        type: "fatal_error",
        message: "⚠️ Transcrição de áudio não disponível. Instale o Whisper localmente ou configure uma API key da OpenAI nas configurações para transcrever a voz.",
        timestamp: new Date().toISOString()
      });
      if (this.onFatalStop) try { this.onFatalStop(); } catch (_) {}
      return false;
    }

    this.emitUpdate({ type: "state", state: "started", message: "Assistente em tempo real iniciado.", timestamp: new Date().toISOString() });

    // Garante estado limpo antes de iniciar — senao startCapture faz early-return.
    await stopCapture().catch(() => {});

    // Overrides manuais opcionais (config.json) caso o auto-detect de áudio erre.
    const cfg = this.configService.getConfig ? this.configService.getConfig() : {};
    const sysTarget = cfg.systemAudioSink
      ? (cfg.systemAudioSink.endsWith('.monitor') ? cfg.systemAudioSink : cfg.systemAudioSink + '.monitor')
      : undefined;
    const micTarget = cfg.micSource || undefined;

    await startCapture({
      onSpeechEnd: (wavPath, source) => this._handleSegment(wavPath, source),
      sysTarget,
      micTarget,
    });
    return true;
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    await stopCapture();
    this.emitUpdate({ type: "state", state: "stopped", message: "Assistente em tempo real parado.", timestamp: new Date().toISOString() });
  }

  // ---------- Pipeline por segmento ----------
  _handleSegment(wavPath, source) {
    if (!this.active) {
      try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch (_) {}
      return;
    }

    // Modo de áudio: 'both' (default) | 'system' | 'mic'.
    const cfg = this.configService.getConfig ? this.configService.getConfig() : {};
    const mode = cfg.realtimeAudioMode || 'both';
    const wanted = mode === 'mic' ? 'mic' : (mode === 'system' ? 'sys' : null);
    if (wanted && source !== wanted) {
      try { if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath); } catch (_) {}
      return;
    }

    // No modo 'both', a SUA fala (mic) so' e' transcrita — nao gera sugestao.
    // Senao, quando voce LE a sugestao em voz alta, o mic re-dispara a IA (loop).
    const respondToSegment = (source === 'sys') || (mode === 'mic');

    const id = "seg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    this.iterationCount += 1;
    const iteration = this.iterationCount;
    this.emitUpdate({ type: "segment_start", id, iteration, audioSource: source, timestamp: new Date().toISOString() });

    // Enfileira tudo (Whisper -> IA -> historico) — IA so chama UMA vez no fim.
    this._enqueueWhisper(async () => {
      let text = "";
      try {
        text = await this._runWhisperAdaptive(id, wavPath);
      } catch (e) {
        console.warn(`[realtime] whisper falhou em ${id}: ${e.message}`);
      } finally {
        try { await fsp.unlink(wavPath); } catch (_) {}
      }

      text = (text || "").trim();
      if (!text || text === '[BLANK_AUDIO]') {
        this.emitUpdate({ type: "segment_whisper_correction", id, iteration, text: '(sem fala)', audioSource: source, source: 'whisper', timestamp: new Date().toISOString() });
        this.emitUpdate({ type: "segment_response", id, iteration, response: '(trecho sem conteúdo relevante)', audioSource: source, timestamp: new Date().toISOString() });
        return;
      }

      // Eco acústico: se a outra fonte acabou de fechar o MESMO texto nos últimos 5s, descarta duplicata.
      const otherSource = source === 'mic' ? 'sys' : 'mic';
      const otherClosed = this.lastClosedBySource[otherSource];
      if (isAcousticEcho(text, otherClosed)) {
        console.log(`[realtime] Eco acústico detectado em ${source} duplicando ${otherSource}: "${text}" - descartando`);
        return;
      }

      // Continuacao de fala: se o ultimo segmento DESSA MESMA fonte fechou ha
      // pouco tempo (pausa pra respirar, nao fim de pergunta), junta os textos e
      // reprocessa a pergunta INTEIRA — em vez de responder so o pedaco novo.
      const prevClosed = this.lastClosedBySource[source];
      const isContinuation = !!(prevClosed && (Date.now() - prevClosed.closedAt) <= CONTINUATION_WINDOW_MS);
      const askText = isContinuation ? `${prevClosed.text} ${text}`.trim() : text;

      this.emitUpdate({
        type: "segment_whisper_correction",
        id, iteration,
        text: askText,
        audioSource: source,
        source: "whisper",
        noSuggestion: !respondToSegment,
        timestamp: new Date().toISOString(),
      });

      this.lastClosedBySource[source] = { id, text: askText, closedAt: Date.now() };

      // Sua fala em modo both: ja transcreveu — nao gera sugestao.
      if (!respondToSegment) return;

      let image = null;

      try {
        console.log(`[realtime] Fala aprovada para resposta! Texto: "${askText}"`);
        const resp = await this._askAI(askText, image, (partial) => {
          this.emitUpdate({
            type: "segment_response",
            id, iteration,
            response: partial,
            audioSource: source,
            timestamp: new Date().toISOString(),
          });
        });
        console.log(`[realtime] Resposta da IA obtida: "${resp}"`);
        if (isContinuation) {
          // Marca a resposta do trecho anterior como superada — a pergunta continuava.
          this.emitUpdate({
            type: "segment_response",
            id: prevClosed.id,
            response: "↳ pergunta continuou no trecho seguinte — veja a resposta completa abaixo.",
            audioSource: source,
            timestamp: new Date().toISOString(),
          });
        }
        this.emitUpdate({ type: "segment_response", id, iteration, response: resp, audioSource: source, timestamp: new Date().toISOString() });
        await this._writeHistory(askText, resp);
      } catch (err) {
        console.error(`[realtime] Erro ao obter resposta da IA para "${askText}":`, err);
        this._handleAIError(err, id, iteration);
      }
    });
  }

  // ---------- Whisper queue ----------
  _enqueueWhisper(task) {
    this._whisperQueue.push(task);
    this._drainWhisperQueue();
  }

  _drainWhisperQueue() {
    while (this._whisperRunning < MAX_PARALLEL_WHISPER && this._whisperQueue.length) {
      const task = this._whisperQueue.shift();
      this._whisperRunning++;
      Promise.resolve()
        .then(() => task())
        .catch(e => console.error("[realtime] whisper task error:", e.message))
        .finally(() => {
          this._whisperRunning--;
          this._drainWhisperQueue();
        });
    }
  }

  // Roda whisper com timeout + best-of adaptativo por duracao.
  // Para audios > 90s, acelera 1.3x com ffmpeg antes (cabe melhor no budget).
  async _runWhisperAdaptive(id, wavPath) {
    const whisperBin = whisperBinPath();
    const model = getWhisperModelPath();
    const token = this.configService.getOpenIaToken ? this.configService.getOpenIaToken() : '';

    if (!fs.existsSync(whisperBin) || !model) {
      if (token) {
        console.log(`[realtime] ${id}: Whisper local ausente/incompleto, usando transcrição via OpenAI cloud...`);
        return await cloudTranscribeWav(wavPath, token);
      }
      throw new Error("whisper-cli ou modelo indisponível");
    }

    // Duracao a partir do proprio WAV (s16le mono 16k, header de 44 bytes).
    let dur = 0;
    try { dur = Math.max(0, (fs.statSync(wavPath).size - 44) / (SAMPLE_RATE * 2)); } catch (_) {}

    // Whisper rápido no CPU (best-of 1, beam-size 1 para latência ultrabaixa < 300ms)
    let bestOf = 1, beam = 1, atempo = 1.0;

    // Pre-processa com ffmpeg se atempo != 1.0
    let inputPath = wavPath;
    let speedPath = null;
    if (atempo !== 1.0) {
      speedPath = wavPath.replace(/\.wav$/, ".x.wav");
      try {
        await execPromise(
          `ffmpeg -y -loglevel error -i "${wavPath}" -filter:a "atempo=${atempo}" -ar 16000 -ac 1 -c:a pcm_s16le "${speedPath}"`,
          { timeout: 20000 }
        );
        inputPath = speedPath;
        console.log(`[realtime] ${id}: pre-aceleracao ffmpeg ${atempo}x ok (dur ${dur.toFixed(1)}s)`);
      } catch (e) {
        console.warn(`[realtime] ${id}: ffmpeg atempo falhou (${e.message}) — usando wav original`);
        speedPath = null;
        inputPath = wavPath;
      }
    }

    const lang = (this.configService.getLanguage && this.configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
    const args = [
      "-m", model,
      "-f", inputPath,
      "-l", lang,
      "--threads", "8",
      "--no-timestamps",
      "--best-of", String(bestOf),
      "--beam-size", String(beam),
    ];
    console.log(`[realtime] whisper start ${id} dur=${dur.toFixed(1)}s best=${bestOf} beam=${beam} atempo=${atempo}`);
    const t0 = Date.now();

    let text = "";
    try {
      text = await this._spawnWhisper(whisperBin, args, WHISPER_TIMEOUT_MS);
    } catch (whisperErr) {
      if (token) {
        console.warn(`[realtime] ${id}: Whisper local falhou (${whisperErr.message}) — fallback para OpenAI cloud`);
        text = await cloudTranscribeWav(inputPath, token);
      } else {
        throw whisperErr;
      }
    } finally {
      if (speedPath) { try { await fsp.unlink(speedPath); } catch (_) {} }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    text = (text || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    console.log(`[realtime] whisper done ${id} em ${elapsed}s → ${text.length} chars`);
    return text;
  }

  // Spawn cru com timeout efetivo (SIGKILL se ultrapassar).
  _spawnWhisper(bin, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        try { proc.kill("SIGKILL"); } catch (_) {}
        reject(new Error(`timeout ${timeoutMs}ms`));
      }, timeoutMs);
      proc.stdout.on("data", d => { stdout += d.toString(); });
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.on("error", e => { clearTimeout(timer); reject(e); });
      proc.on("close", code => {
        clearTimeout(timer);
        if (killed) return; // ja rejeitou
        if (code === 0) return resolve(stdout);
        reject(new Error(`exit ${code}: ${stderr.slice(-200)}`));
      });
    });
  }

  // ---------- AI ----------
  async _askAI(transcript, image, onDelta) {
    if (!this.aiResponder) throw new Error("Nenhum provider configurado para o modo em tempo real offline.");
    const r = await this.aiResponder(transcript, image, onDelta, this._buildContext());
    return (r || "").trim() || "(sem resposta)";
  }

  _buildContext() { return this.contextMessages.slice(-(this.maxIterationsInContext * 2)); }

  // ---------- History ----------
  async _writeHistory(userText, assistantText) {
    this.contextMessages.push({ role: "user", content: userText });
    this.contextMessages.push({ role: "assistant", content: assistantText });
    const max = this.maxIterationsInContext * 2;
    if (this.contextMessages.length > max) this.contextMessages = this.contextMessages.slice(-max);

    if (!this.historyService || !this.currentSessionId) return;
    try {
      const sid1 = await this.historyService.addMessage(this.currentSessionId, 'user', userText);
      const sid2 = await this.historyService.addMessage(sid1, 'assistant', assistantText);
      this.currentSessionId = sid2;
    } catch (e) { console.warn("history write failed:", e.message); }
  }

  // ---------- Errors ----------
  _handleAIError(error, id, iteration) {
    if (this._isQuotaError(error)) {
      this.active = false;
      stopCapture().catch(() => {});
      this.emitUpdate({ type: "fatal_error", message: "⚠️ Limite de créditos da API atingido.", timestamp: new Date().toISOString() });
      if (this.onFatalStop) try { this.onFatalStop(); } catch (_) {}
      return;
    }
    console.error("[realtime] AI error:", error.message);
    this.emitUpdate({ type: "segment_error", id, iteration, message: "Erro IA: " + error.message, timestamp: new Date().toISOString() });
  }

  _isQuotaError(error) {
    const status = error?.response?.status;
    const msg = (error?.response?.data?.error?.message || error?.message || "").toLowerCase();
    return status === 429 || status === 402 || msg.includes("insufficient_quota") || msg.includes("exceeded your current quota") || msg.includes("billing");
  }

  emitUpdate(payload) {
    const w = this.getMainWindow();
    if (w && !w.isDestroyed()) {
      w.webContents.send("realtime-assistant-update", payload);
    }
    try {
      const isStopped = payload && payload.type === 'state' && payload.state === 'stopped';
      const configService = require('./configService');
      const isEnabled = configService && typeof configService.getRealtimeAssistantStatus === 'function' ? configService.getRealtimeAssistantStatus() : false;
      const isOs = configService && typeof configService.getOsIntegrationStatus === 'function' ? configService.getOsIntegrationStatus() : false;

      if (isOs && isEnabled && !isStopped && this.active) {
        const { helpers } = require('../main/globals');
        if (helpers) {
          if (helpers.createRealtimeAssistantOverlay) {
            helpers.createRealtimeAssistantOverlay();
          }
          if (helpers.sendToRealtimeAssistantOverlay) {
            helpers.sendToRealtimeAssistantOverlay('realtime-assistant-update', payload);
          }
        }
      }
    } catch (_) {}
  }
}

module.exports = RealtimeAssistantService;
