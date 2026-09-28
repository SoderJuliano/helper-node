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
const MAX_PARALLEL_TRANSCRIBE = 2;
const CONTINUATION_WINDOW_MS = 3000;

const transcriptionService = require("./transcriptionService");

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

    const googleKey = (this.configService.getGoogleApiKey ? this.configService.getGoogleApiKey() : '').trim();
    const token = (this.configService.getOpenIaToken ? this.configService.getOpenIaToken() : '').trim();

    if (!googleKey && !token) {
      this.active = false;
      this.emitUpdate({
        type: "fatal_error",
        message: "Transcrição de áudio não disponível. Configure sua Google API Key ou Token da OpenAI em Configurações > APIs & Provedores.",
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

    // Enfileira tudo (Whisper -> IA -> historico) — IA so chama UMA vez no fim.
    this._enqueueWhisper(async () => {
      const { cleanTranscription, mergeContinuationText, isAcousticEcho } = require('./audioTranscriptionCleaner');
      let rawText = "";
      const tempId = "whisper_" + Date.now();
      try {
        rawText = await this._runWhisperAdaptive(tempId, wavPath);
      } catch (e) {
        console.warn(`[realtime] whisper falhou: ${e.message}`);
      } finally {
        try { await fsp.unlink(wavPath); } catch (_) {}
      }

      const text = cleanTranscription(rawText);
      if (!text || text.length < 3) {
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
      // pouco tempo (pausa pra respirar, pensar "humm...", nao fim de pergunta),
      // junta os textos e atualiza a bolha existente em vez de criar novas bolhas.
      const prevClosed = this.lastClosedBySource[source];
      const continuationWindowMs = source === 'mic' ? 8000 : 5000;
      const isContinuation = !!(prevClosed && (Date.now() - prevClosed.closedAt) <= continuationWindowMs);

      if (isContinuation && prevClosed) {
        const askText = mergeContinuationText(prevClosed.text, text);
        if (askText === prevClosed.text) {
          console.log(`[realtime] Texto idêntico já processado no Trecho #${prevClosed.iteration}, ignorando duplicata`);
          return;
        }
        console.log(`[realtime] Continuação de fala detectada: "${prevClosed.text}" + "${text}" -> "${askText}" (atualizando Trecho #${prevClosed.iteration})`);
        this.lastClosedBySource[source] = { id: prevClosed.id, iteration: prevClosed.iteration, text: askText, closedAt: Date.now() };

        this.emitUpdate({
          type: "segment_whisper_correction",
          id: prevClosed.id,
          iteration: prevClosed.iteration,
          text: askText,
          audioSource: source,
          source: "whisper",
          noSuggestion: !respondToSegment,
          timestamp: new Date().toISOString(),
        });

        if (!respondToSegment) return;

        let image = null;
        try {
          console.log(`[realtime] Fala concatenada aprovada para resposta! Texto: "${askText}"`);
          const resp = await this._askAI(askText, image, (partial) => {
            this.emitUpdate({
              type: "segment_response",
              id: prevClosed.id,
              iteration: prevClosed.iteration,
              response: partial,
              audioSource: source,
              timestamp: new Date().toISOString(),
            });
          });
          console.log(`[realtime] Resposta da IA obtida para trecho concatenado: "${resp}"`);
          this.emitUpdate({
            type: "segment_response",
            id: prevClosed.id,
            iteration: prevClosed.iteration,
            response: resp,
            audioSource: source,
            timestamp: new Date().toISOString(),
          });
          await this._writeHistory(askText, resp);
        } catch (err) {
          console.error(`[realtime] Erro ao obter resposta da IA para "${askText}":`, err);
          this._handleAIError(err, prevClosed.id, prevClosed.iteration);
        }
        return;
      }

      // Novo turno / Primeira fala
      const id = "seg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
      this.iterationCount += 1;
      const iteration = this.iterationCount;
      const askText = text;
      this.lastClosedBySource[source] = { id, iteration, text: askText, closedAt: Date.now() };

      this.emitUpdate({ type: "segment_start", id, iteration, audioSource: source, timestamp: new Date().toISOString() });
      this.emitUpdate({
        type: "segment_whisper_correction",
        id, iteration,
        text: askText,
        audioSource: source,
        source: "whisper",
        noSuggestion: !respondToSegment,
        timestamp: new Date().toISOString(),
      });

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
    while (this._whisperRunning < MAX_PARALLEL_TRANSCRIBE && this._whisperQueue.length) {
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

  async _runWhisperAdaptive(id, wavPath) {
    const lang = (this.configService.getLanguage && this.configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
    const text = await transcriptionService.transcribe(wavPath, { language: lang });
    return (text || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
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
