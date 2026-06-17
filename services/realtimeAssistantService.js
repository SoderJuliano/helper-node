const axios = require("axios");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const os = require("os");
const { exec, spawn } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const voskStreamService = require("./voskStreamService");

/**
 * Realtime Assistant — Whisper-first (Option A).
 *
 * Vosk roda só pra feedback visual ao vivo (mostra que esta ouvindo).
 * A IA recebe APENAS o texto refinado do Whisper (fonte de verdade).
 * Se Whisper falhar/timeout, cai pro texto Vosk como fallback.
 *
 * Por segmento:
 *   1. Vosk transcreve ao vivo → atualiza bolha do usuario (preview).
 *   2. PCM e bufferizado em paralelo.
 *   3. Segmento fecha quando:
 *        - >= SILENCE_DURATION_MS de silencio (com regra de conectores), OU
 *        - >= MAX_SEGMENT_MS atingido COM silencio recente (grace ate HARD_CAP).
 *   4. Ao fechar:
 *        a) emite segment_vosk_final (UI mostra "transcrevendo com Whisper").
 *        b) enfileira Whisper (max N paralelos).
 *        c) Whisper termina (ou timeout/falha) → texto final definido.
 *        d) emite segment_whisper_correction com texto final.
 *        e) chama IA UMA VEZ com texto final → emite segment_response.
 *        f) escreve historico (user + assistant) uma unica vez.
 */

const SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 250;
const SILENCE_DURATION_MS = 4000;        // pausa real, nao respirada
const MAX_SEGMENT_MS = 90000;            // explicacao tecnica longa cabe
const GRACE_EXTEND_MS = 15000;           // se ainda falando ao bater max, estende
const HARD_CAP_MS = 120000;              // limite absoluto (sem chance de virar audiobook)
const CONNECTOR_GRACE_MS = 4000;         // se parou em conector, aguarda mais X
const LOUD_ACTIVE_WINDOW_MS = 700;       // "ainda falando" = teve som loud nos ultimos N ms
const WHISPER_TIMEOUT_MS = 45000;        // mata whisper se ultrapassar
const MAX_PARALLEL_WHISPER = 2;          // evita N whisper-cli concorrendo no CPU

// Tokens que indicam fala incompleta ("...porque", "...entao", "...e").
// Quando o ultimo token do parcial bate, NAO fechamos por silencio na hora —
// damos CONNECTOR_GRACE_MS extra pra terminar a frase.
const CONNECTORS = new Set([
  "porque","entao","então","mas","e","ai","aí","que","e'","ou","tipo","dai","daí",
  "so","só","pra","para","quando","enquanto","com","sem","no","na","do","da",
  "um","uma","os","as","de","vou","vai","ele","ela","isso","se","ja","já",
  "mais","meu","minha","nosso","nossa","em","por","como","qual","essa","esse"
]);

class RealtimeAssistantService {
  constructor({ configService, getMainWindow, onFatalStop, historyService, aiResponder }) {
    this.configService = configService;
    this.getMainWindow = getMainWindow;
    this.onFatalStop = onFatalStop || null;
    this.historyService = historyService || null;
    // Responder injetado: quando presente, a resposta da IA é gerada pelo
    // provider SELECIONADO (backend/Ollama), não por OpenAI. Mantém a regra do
    // projeto "sem fallback automático entre providers". Recebe a transcrição
    // final (string) e retorna a resposta (string).
    this.aiResponder = typeof aiResponder === 'function' ? aiResponder : null;

    this.active = false;
    this.contextMessages = [];
    this.maxIterationsInContext = 10;
    this.currentSessionId = null;

    this.iterationCount = 0;
    this.tmpDir = path.join(os.tmpdir(), "helper-node-realtime");
    try { fs.mkdirSync(this.tmpDir, { recursive: true }); } catch (_) {}

    this.currentSegment = null;
    this._silenceCheckInterval = null;

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
    this.currentSegment = null;

    if (this.historyService) {
      try {
        const now = new Date();
        const title = `🎧 Live Assistant — ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const session = await this.historyService.createNewSession(title);
        this.currentSessionId = session.id;
      } catch (e) { console.warn('history session failed:', e.message); }
    }

    this.emitUpdate({ type: "state", state: "started", message: "Assistente em tempo real iniciado.", timestamp: new Date().toISOString() });

    let audioSources = ['@DEFAULT_SOURCE@'];
    try {
      const { stdout } = await execPromise('pactl get-default-sink');
      audioSources.push(stdout.trim() + '.monitor');
    } catch (_) { audioSources.push('@DEFAULT_MONITOR@'); }

    const modelPath = path.join(__dirname, "..", "vosk-model");
    await voskStreamService.start({
      audioSources,
      modelPath,
      onEvent: (event) => this.handleVoskEvent(event),
    });

    this._silenceCheckInterval = setInterval(() => this._checkSegmentLimits(), 500);
    return true;
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    if (this._silenceCheckInterval) { clearInterval(this._silenceCheckInterval); this._silenceCheckInterval = null; }
    if (this.currentSegment && this.currentSegment.hasSpeech && !this.currentSegment.closing) {
      try { await this._closeAndProcessSegment(); } catch (e) { console.error(e); }
    }
    voskStreamService.stop();
    this.currentSegment = null;
    this.emitUpdate({ type: "state", state: "stopped", message: "Assistente em tempo real parado.", timestamp: new Date().toISOString() });
  }

  // ---------- Vosk events ----------
  handleVoskEvent(event) {
    if (!event || !this.active) return;
    if (event.type === "ready" || event.type === "stopped") return;
    if (event.type === "error") {
      this.emitUpdate({ type: "error", message: "Erro Vosk: " + event.message, timestamp: new Date().toISOString() });
      return;
    }
    if (event.type === "audio") return this._onAudioChunk(event.data);
    if (event.type === "partial") {
      const seg = this._ensureSegment();
      seg.partial = event.text || "";
      this.emitUpdate({ type: "segment_partial", id: seg.id, text: this._segmentText(seg), timestamp: new Date().toISOString() });
      return;
    }
    if (event.type === "result") {
      const txt = (event.text || "").trim();
      if (!txt) return;
      const seg = this._ensureSegment();
      seg.voskBuffer.push(txt);
      seg.partial = "";
      seg.hasSpeech = true;
      this.emitUpdate({ type: "segment_partial", id: seg.id, text: this._segmentText(seg), timestamp: new Date().toISOString() });
    }
  }

  _onAudioChunk(chunk) {
    if (!this.active) return;
    const seg = this._ensureSegment();
    seg.pcmChunks.push(chunk);
    seg.pcmBytes += chunk.length;
    if (computeRMS(chunk) > SILENCE_RMS_THRESHOLD) seg.lastLoudAt = Date.now();
  }

  _checkSegmentLimits() {
    const seg = this.currentSegment;
    if (!seg || seg.closing || !seg.hasSpeech) return;
    const now = Date.now();
    const elapsed = now - seg.startedAt;
    const sinceLoud = now - seg.lastLoudAt;

    // Hard-cap absoluto: depois disso fecha sem pena.
    if (elapsed >= HARD_CAP_MS) {
      console.log(`[realtime] ${seg.id}: hard-cap ${(elapsed/1000)|0}s → close`);
      return void this._closeAndProcessSegment().catch(console.error);
    }

    // Estourou max: so fecha se o usuario PAROU de falar (silencio recente).
    // Caso contrario, da grace ate HARD_CAP_MS.
    if (elapsed >= MAX_SEGMENT_MS + GRACE_EXTEND_MS) {
      console.log(`[realtime] ${seg.id}: max+grace ${(elapsed/1000)|0}s → close`);
      return void this._closeAndProcessSegment().catch(console.error);
    }
    if (elapsed >= MAX_SEGMENT_MS && sinceLoud >= LOUD_ACTIVE_WINDOW_MS) {
      console.log(`[realtime] ${seg.id}: max duration + silencio → close`);
      return void this._closeAndProcessSegment().catch(console.error);
    }

    // Silencio normal: regra de conectores.
    if (sinceLoud >= SILENCE_DURATION_MS) {
      const lastToken = this._lastSpokenToken(seg);
      const isConnector = lastToken && CONNECTORS.has(lastToken);
      const grace = isConnector ? (SILENCE_DURATION_MS + CONNECTOR_GRACE_MS) : SILENCE_DURATION_MS;
      if (sinceLoud >= grace) {
        console.log(`[realtime] ${seg.id}: silence ${(sinceLoud/1000)|0}s (last="${lastToken||''}") → close`);
        this._closeAndProcessSegment().catch(console.error);
      }
      // senao: espera mais um pouco — pode estar terminando frase
    }
  }

  _lastSpokenToken(seg) {
    const text = this._segmentText(seg).toLowerCase().trim();
    if (!text) return null;
    const m = text.match(/([\wáéíóúâêôãõàç']+)\s*$/i);
    return m ? m[1] : null;
  }

  _ensureSegment() {
    if (this.currentSegment && !this.currentSegment.closing) return this.currentSegment;
    const id = "seg_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    this.iterationCount += 1;
    const seg = {
      id, voskBuffer: [], partial: "", pcmChunks: [], pcmBytes: 0,
      startedAt: Date.now(), lastLoudAt: Date.now(), hasSpeech: false, closing: false,
      historyUserIdx: null, historyAssistantIdx: null,
      voskText: "", whisperText: null, responseRaw: null, responseCorrected: null,
    };
    this.currentSegment = seg;
    this.emitUpdate({ type: "segment_start", id, iteration: this.iterationCount, timestamp: new Date().toISOString() });
    return seg;
  }

  _segmentText(seg) {
    const finalized = seg.voskBuffer.join(" ").trim();
    const partial = (seg.partial || "").trim();
    return [finalized, partial].filter(Boolean).join(" ");
  }

  // ---------- Close + process ----------
  async _closeAndProcessSegment() {
    const seg = this.currentSegment;
    if (!seg || seg.closing) return;
    seg.closing = true;
    this.currentSegment = null;

    seg.voskText = this._segmentText(seg);
    if (!seg.voskText) return;

    const pcm = Buffer.concat(seg.pcmChunks, seg.pcmBytes);
    seg.pcmChunks = [];
    seg.durationSec = pcm.length / (SAMPLE_RATE * 2); // s16le mono

    const wavPath = path.join(this.tmpDir, seg.id + ".wav");
    let wavOk = false;
    try {
      await fsp.writeFile(wavPath, buildWavFile(pcm, SAMPLE_RATE, 1, 16));
      wavOk = true;
    } catch (e) { console.error("WAV write failed:", e.message); }

    // UI: avisa que segmento fechou e estamos transcrevendo com Whisper.
    this.emitUpdate({ type: "segment_vosk_final", id: seg.id, text: seg.voskText, timestamp: new Date().toISOString() });

    // Enfileira tudo (Whisper -> IA -> historico) — IA so chama UMA vez no fim.
    this._enqueueWhisper(async () => {
      let finalText = seg.voskText;
      let whisperOk = false;

      if (wavOk) {
        try {
          const text = await this._runWhisperAdaptive(seg, wavPath);
          if (text && text.trim()) {
            finalText = text.trim();
            whisperOk = true;
          }
        } catch (e) {
          console.warn(`[realtime] whisper falhou em ${seg.id}: ${e.message} — usando Vosk como fallback`);
        }
      }
      // Cleanup wav
      try { await fsp.unlink(wavPath); } catch (_) {}

      seg.whisperText = whisperOk ? finalText : null;
      // Sempre emite o texto definitivo (whisper ou vosk fallback).
      this.emitUpdate({
        type: "segment_whisper_correction",
        id: seg.id,
        text: finalText,
        source: whisperOk ? "whisper" : "vosk-fallback",
        timestamp: new Date().toISOString(),
      });

      // Agora sim — pergunta a IA UMA unica vez com o texto final.
      try {
        const resp = await this._askAI(finalText);
        seg.responseFinal = resp;
        this.emitUpdate({
          type: "segment_response",
          id: seg.id,
          response: resp,
          source: whisperOk ? "whisper" : "vosk-fallback",
          timestamp: new Date().toISOString(),
        });
        await this._writeHistory(seg, finalText, resp);
      } catch (err) { this._handleAIError(err, seg); }
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
  async _runWhisperAdaptive(seg, wavPath) {
    const whisperBin = path.join(__dirname, "..", "whisper", "build", "bin", "whisper-cli");
    const modelMed = path.join(__dirname, "..", "whisper", "models", "ggml-medium.bin");
    const modelSm  = path.join(__dirname, "..", "whisper", "models", "ggml-small.bin");
    const model = fs.existsSync(modelMed) ? modelMed : (fs.existsSync(modelSm) ? modelSm : null);
    if (!fs.existsSync(whisperBin) || !model) {
      throw new Error("whisper-cli ou modelo indisponivel");
    }

    const dur = seg.durationSec || 0;
    // Best-of / beam adaptativo (mantem modelo medium sempre)
    let bestOf, beam, atempo;
    if (dur <= 15)      { bestOf = 5; beam = 5; atempo = 1.0; }
    else if (dur <= 45) { bestOf = 3; beam = 3; atempo = 1.0; }
    else if (dur <= 90) { bestOf = 1; beam = 1; atempo = 1.0; }
    else                { bestOf = 1; beam = 1; atempo = 1.3; }

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
        console.log(`[realtime] ${seg.id}: pre-aceleracao ffmpeg ${atempo}x ok (dur ${dur.toFixed(1)}s)`);
      } catch (e) {
        console.warn(`[realtime] ${seg.id}: ffmpeg atempo falhou (${e.message}) — usando wav original`);
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
    console.log(`[realtime] whisper start ${seg.id} dur=${dur.toFixed(1)}s best=${bestOf} beam=${beam} atempo=${atempo}`);
    const t0 = Date.now();

    let text = "";
    try {
      text = await this._spawnWhisper(whisperBin, args, WHISPER_TIMEOUT_MS);
    } finally {
      if (speedPath) { try { await fsp.unlink(speedPath); } catch (_) {} }
    }
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    text = (text || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    console.log(`[realtime] whisper done ${seg.id} em ${elapsed}s → ${text.length} chars`);
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
  async _askAI(transcript) {
    // Provider injetado (backend/Ollama): a transcrição é local (Vosk+Whisper),
    // mas a RESPOSTA vai pro provider selecionado, não pra OpenAI.
    if (this.aiResponder) {
      const r = await this.aiResponder(transcript);
      return (r || "").trim() || "(sem resposta)";
    }

    const token = this.configService.getOpenIaToken();
    if (!token) throw new Error("Token da OpenAI não configurado.");
    const model = this.configService.getOpenAiModel();

    const userPrompt =
      `TRANSCRIÇÃO do áudio captado (refinada por Whisper, alta qualidade):\n\n` +
      `"${transcript}"\n\n` +
      `Aja segundo as regras do system prompt. Se for incompreensível ou sem conteúdo útil, ` +
      `responda APENAS '(trecho sem conteúdo relevante)'.`;

    const payload = {
      model, max_tokens: 500,
      messages: [
        { role: "system", content: this._systemInstruction() },
        ...this._buildContext(),
        { role: "user", content: userPrompt },
      ],
    };
    const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      timeout: 60000,
    });
    return (response?.data?.choices?.[0]?.message?.content || "").trim() || "(sem resposta)";
  }

  _systemInstruction() {
    return [
      "Você é um COPILOTO DISCRETO em tempo real para o usuário durante reuniões, ligações, vídeos e conversas.",
      "Você ouve simultaneamente o microfone do usuário E o áudio do sistema (interlocutores, vídeos, podcasts).",
      "O texto recebido é uma TRANSCRIÇÃO automática do que está sendo falado — pode conter erros (Vosk) ou estar refinada (Whisper).",
      "",
      "OBJETIVO PRINCIPAL: AJUDAR O USUÁRIO A RESPONDER, ENTENDER OU AGIR. Você NÃO é um resumidor — é um copiloto.",
      "",
      "REGRAS DE COMPORTAMENTO (escolha o modo apropriado por trecho):",
      "",
      "1) PERGUNTA TÉCNICA / QUALQUER PERGUNTA (ex: 'como resolvo essa equação?', 'qual a diferença entre var e let?', 'quanto é 15% de 240?', 'como funciona o algoritmo X?'):",
      "   → RESPONDA A PERGUNTA DIRETAMENTE com a solução/resposta correta. Mostre cálculo, código, definição, passo-a-passo curto. Esse é o cenário mais importante.",
      "",
      "2) PERGUNTA FEITA AO USUÁRIO (alguém pergunta algo a ele em reunião/entrevista/conversa):",
      "   → SUGIRA UMA RESPOSTA pronta para ele falar, em 1-3 frases, no tom apropriado (técnico, casual, formal). Prefixe com '💬 Sugestão:'.",
      "",
      "3) DISCUSSÃO TÉCNICA / DECISÃO / TRADE-OFF (arquitetura, ferramentas, código sendo revisado):",
      "   → Dê insight valioso: aponte trade-off, risco, alternativa melhor, ou confirme/refute o que está sendo dito. Seja opinativo e útil.",
      "",
      "4) TERMO/CONCEITO MENCIONADO QUE PODE SER OBSCURO (sigla, framework, lei, produto):",
      "   → Defina em 1 linha + por que importa no contexto.",
      "",
      "5) NÚMEROS / DADOS / VALORES (preço, prazo, métrica, equação):",
      "   → Confirme/calcule/contextualize. Ex: usuário diz '70 ou 80 cm', você responde 'Centímetros — equivale a 0,7-0,8 m'.",
      "",
      "6) CONVERSA CASUAL / SAUDAÇÃO / RUÍDO / PIADA / CONVERSA COM CRIANÇA SEM PERGUNTA:",
      "   → Responda APENAS: '(trecho sem conteúdo relevante)'. Não force ajuda onde não há demanda.",
      "",
      "CONHECIMENTO ESPERADO: programação ampla (JS/TS/Python/Java/Go/Rust/C++/SQL, React/Vue/Node/Spring/FastAPI/Django, Docker/K8s/AWS/GCP, SOLID/DDD/TDD/CI-CD, REST/GraphQL/gRPC/Kafka/RabbitMQ), termos em inglês de TI (job, deploy, build, debug, feature, branch, merge, PR, commit, sprint, refactor, scope, scope creep, etc), matemática (cálculo, álgebra, estatística), física básica, leis BR (LGPD, CLT, CDC, Marco Civil), produtos financeiros (empréstimos, contratos, propostas, assinatura digital, notificações WhatsApp/email), inglês fluente.",
      "",
      "FORMATO OBRIGATÓRIO:",
      "- MÁXIMO 4 linhas (a menos que seja código — aí pode ser um bloco curto).",
      "- DIRETO, sem 'A fala menciona...', 'O interlocutor diz...', 'No áudio é dito...'. PROIBIDO esses preâmbulos.",
      "- NÃO repita o que foi falado. ENTREGUE O VALOR.",
      "- Se for sugestão de resposta, prefixe '💬 Sugestão:'.",
      "- Se for resposta a pergunta técnica, vá direto na resposta com bullets ou cálculo.",
    ].join("\n");
  }

  _buildContext() { return this.contextMessages.slice(-(this.maxIterationsInContext * 2)); }

  _pushContext(u, a) {
    this.contextMessages.push({ role: "user", content: u });
    this.contextMessages.push({ role: "assistant", content: a });
    const max = this.maxIterationsInContext * 2;
    if (this.contextMessages.length > max) this.contextMessages = this.contextMessages.slice(-max);
  }

  _replaceLastContext(u, a) {
    if (this.contextMessages.length < 2) return this._pushContext(u, a);
    this.contextMessages[this.contextMessages.length - 2] = { role: "user", content: u };
    this.contextMessages[this.contextMessages.length - 1] = { role: "assistant", content: a };
  }

  // ---------- History ----------
  async _writeHistory(seg, userText, assistantText) {
    this._pushContext(userText, assistantText);
    if (!this.historyService || !this.currentSessionId) return;
    try {
      const session = this.historyService.getSessionById(this.currentSessionId);
      const baseLen = session ? session.conversations.length : 0;
      const sid1 = await this.historyService.addMessage(this.currentSessionId, 'user', userText);
      const sid2 = await this.historyService.addMessage(sid1, 'assistant', assistantText);
      this.currentSessionId = sid2;
      seg.historyUserIdx = baseLen;
      seg.historyAssistantIdx = baseLen + 1;
    } catch (e) { console.warn("history write failed:", e.message); }
  }

  async _updateHistory(seg, newU, newA) {
    this._replaceLastContext(newU, newA);
    if (!this.historyService || !this.currentSessionId) return;
    if (seg.historyUserIdx == null) return this._writeHistory(seg, newU, newA);
    try {
      await this.historyService.replaceMessage(this.currentSessionId, seg.historyUserIdx, newU);
      await this.historyService.replaceMessage(this.currentSessionId, seg.historyAssistantIdx, newA);
    } catch (e) { console.warn("history update failed:", e.message); }
  }

  // ---------- Errors ----------
  _handleAIError(error, seg) {
    if (this._isQuotaError(error)) {
      this.active = false;
      voskStreamService.stop();
      this.emitUpdate({ type: "fatal_error", message: "⚠️ Limite de créditos da API atingido.", timestamp: new Date().toISOString() });
      if (this.onFatalStop) try { this.onFatalStop(); } catch (_) {}
      return;
    }
    console.error("[realtime] AI error:", error.message);
    this.emitUpdate({ type: "segment_error", id: seg.id, message: "Erro IA: " + error.message, timestamp: new Date().toISOString() });
  }

  _isQuotaError(error) {
    const status = error?.response?.status;
    const msg = (error?.response?.data?.error?.message || error?.message || "").toLowerCase();
    return status === 429 || status === 402 || msg.includes("insufficient_quota") || msg.includes("exceeded your current quota") || msg.includes("billing");
  }

  emitUpdate(payload) {
    const w = this.getMainWindow();
    if (!w || w.isDestroyed()) return;
    w.webContents.send("realtime-assistant-update", payload);
  }
}

function computeRMS(buf) {
  if (!buf || buf.length < 2) return 0;
  let sumSq = 0, count = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sumSq += s * s; count++;
  }
  if (!count) return 0;
  return Math.sqrt(sumSq / count);
}

function buildWavFile(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(fileSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm], 44 + dataSize);
}

module.exports = RealtimeAssistantService;
