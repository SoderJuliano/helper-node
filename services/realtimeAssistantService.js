const axios = require("axios");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const os = require("os");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const voskStreamService = require("./voskStreamService");

/**
 * Realtime Assistant — Vosk live + Whisper background correction.
 *
 * Per segment:
 *   1. Vosk transcribes live (partial + result update one bubble in place).
 *   2. PCM is buffered.
 *   3. Segment closes when:
 *        - >=5s of silence AND vosk has speech, OR
 *        - >=25s elapsed (forced cut).
 *   4. On close:
 *        a) ask AI with Vosk text → emit `segment_response` (raw)
 *        b) async: WAV → whisper-cli → emit `segment_whisper_correction`
 *           → re-ask AI → emit `segment_response_corrected`
 *        c) history is replaced (not appended) when corrections come in.
 */

const SAMPLE_RATE = 16000;
const SILENCE_RMS_THRESHOLD = 250;
const SILENCE_DURATION_MS = 5000;
const MAX_SEGMENT_MS = 25000;

class RealtimeAssistantService {
  constructor({ configService, getMainWindow, onFatalStop, historyService }) {
    this.configService = configService;
    this.getMainWindow = getMainWindow;
    this.onFatalStop = onFatalStop || null;
    this.historyService = historyService || null;

    this.active = false;
    this.contextMessages = [];
    this.maxIterationsInContext = 10;
    this.currentSessionId = null;

    this.iterationCount = 0;
    this.tmpDir = path.join(os.tmpdir(), "helper-node-realtime");
    try { fs.mkdirSync(this.tmpDir, { recursive: true }); } catch (_) {}

    this.currentSegment = null;
    this._silenceCheckInterval = null;
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
    if (now - seg.startedAt >= MAX_SEGMENT_MS) {
      console.log(`[realtime] ${seg.id}: max duration → close`);
      return void this._closeAndProcessSegment().catch(console.error);
    }
    if (now - seg.lastLoudAt >= SILENCE_DURATION_MS) {
      console.log(`[realtime] ${seg.id}: silence → close`);
      this._closeAndProcessSegment().catch(console.error);
    }
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
    const wavPath = path.join(this.tmpDir, seg.id + ".wav");
    try { await fsp.writeFile(wavPath, buildWavFile(pcm, SAMPLE_RATE, 1, 16)); }
    catch (e) { console.error("WAV write failed:", e.message); }

    this.emitUpdate({ type: "segment_vosk_final", id: seg.id, text: seg.voskText, timestamp: new Date().toISOString() });

    try {
      const resp = await this._askAI(seg.voskText, false);
      seg.responseRaw = resp;
      this.emitUpdate({ type: "segment_response", id: seg.id, response: resp, source: "vosk", timestamp: new Date().toISOString() });
      await this._writeHistory(seg, seg.voskText, resp);
    } catch (err) { this._handleAIError(err, seg); }

    if (fs.existsSync(wavPath)) {
      this._runWhisperCorrection(seg, wavPath).catch(e => console.error("whisper correction:", e.message));
    }
  }

  async _runWhisperCorrection(seg, wavPath) {
    const whisperBin = path.join(__dirname, "..", "whisper", "build", "bin", "whisper-cli");
    const modelMed = path.join(__dirname, "..", "whisper", "models", "ggml-medium.bin");
    const modelSm  = path.join(__dirname, "..", "whisper", "models", "ggml-small.bin");
    const model = fs.existsSync(modelMed) ? modelMed : (fs.existsSync(modelSm) ? modelSm : null);
    if (!fs.existsSync(whisperBin) || !model) {
      console.warn("[realtime] whisper unavailable, skip correction");
      try { await fsp.unlink(wavPath); } catch (_) {}
      return;
    }
    const lang = (this.configService.getLanguage && this.configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
    const cmd = `"${whisperBin}" -m "${model}" -f "${wavPath}" -l ${lang} --threads 8 --no-timestamps --best-of 3 --beam-size 3`;
    console.log("[realtime] whisper running for", seg.id);

    let text = "";
    try {
      const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
      text = (stdout || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
    } catch (e) {
      console.error("[realtime] whisper exec error:", e.message);
      try { await fsp.unlink(wavPath); } catch (_) {}
      return;
    }
    try { await fsp.unlink(wavPath); } catch (_) {}

    if (!text || text === seg.voskText) return;
    console.log(`[realtime] whisper corrected ${seg.id}: "${seg.voskText}" -> "${text}"`);
    seg.whisperText = text;
    this.emitUpdate({ type: "segment_whisper_correction", id: seg.id, text, timestamp: new Date().toISOString() });

    try {
      const resp = await this._askAI(text, true, seg.responseRaw);
      seg.responseCorrected = resp;
      this.emitUpdate({ type: "segment_response_corrected", id: seg.id, response: resp, source: "whisper", timestamp: new Date().toISOString() });
      await this._updateHistory(seg, text, resp);
    } catch (err) { this._handleAIError(err, seg); }
  }

  // ---------- AI ----------
  async _askAI(transcript, isCorrection, previousResponse) {
    const token = this.configService.getOpenIaToken();
    if (!token) throw new Error("Token da OpenAI não configurado.");
    const model = this.configService.getOpenAiModel();

    const userPrompt = isCorrection
      ? `TRANSCRIÇÃO CORRIGIDA (Whisper, mais precisa) de um trecho que já foi enviado em versão menos precisa (Vosk):\n\n"${transcript}"\n\nResposta anterior (com base na versão imprecisa): "${previousResponse || '(nenhuma)'}"\n\nRefaça sua ajuda com base APENAS na versão corrigida, seguindo as MESMAS regras de formato do system prompt.`
      : `TRANSCRIÇÃO ao vivo (modelo rápido Vosk, pode conter erros) do áudio captado:\n\n"${transcript}"\n\nAja segundo as regras do system prompt. Se for incompreensível, responda APENAS '(trecho sem conteúdo relevante)'.`;

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
      "- Se vier versão CORRIGIDA (Whisper) de trecho anterior, REFAÇA do zero — não acumule contexto antigo errado.",
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
