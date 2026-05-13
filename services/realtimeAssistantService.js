const axios = require("axios");
const path = require("path");
const voskStreamService = require("./voskStreamService");

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

    // Sentence accumulation + silence detection
    this.sentenceBuffer = [];
    this.silenceTimer = null;
    this.SILENCE_TIMEOUT_MS = 2500;       // pausa real para disparar IA
    this.MAX_ACCUMULATION_MS = 60000;     // fallback duro
    this.MIN_WORDS_TO_SEND = 10;          // não envia menos que isso (evita micro-pausas)
    this.accumulationTimer = null;
    this.hasSpeech = false;
    this.isProcessing = false;            // trava enquanto IA responde
    this.iteration = 0;
  }

  isActive() {
    return this.active;
  }

  async start() {
    if (this.active) return true;
    this.active = true;
    this.iteration = 0;
    this.contextMessages = [];
    this.sentenceBuffer = [];
    this.hasSpeech = false;
    this.isProcessing = false;
    this.currentSessionId = null;

    if (this.historyService) {
      try {
        const now = new Date();
        const title = `🎧 Live Assistant — ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const session = await this.historyService.createNewSession(title);
        this.currentSessionId = session.id;
      } catch (e) {
        console.warn('Failed to create history session:', e.message);
      }
    }

    this.emitUpdate({
      type: "state",
      state: "started",
      message: "Assistente em tempo real iniciado. Transcrição ao vivo ativa.",
      timestamp: new Date().toISOString(),
    });

    // Captura microfone + áudio do sistema (monitor do sink padrão)
    let audioSources = ['@DEFAULT_SOURCE@'];
    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);
      const { stdout } = await execPromise('pactl get-default-sink');
      const monitor = stdout.trim() + '.monitor';
      audioSources.push(monitor);
    } catch (e) {
      audioSources.push('@DEFAULT_MONITOR@');
    }

    const modelPath = path.join(__dirname, "..", "vosk-model");

    await voskStreamService.start({
      audioSources,
      modelPath,
      onEvent: (event) => this.handleVoskEvent(event),
    });

    return true;
  }

  async stop() {
    if (!this.active) return;
    this.active = false;
    this.clearTimers();

    if (this.sentenceBuffer.length > 0) {
      await this.sendBufferToAI();
    }

    voskStreamService.stop();

    this.emitUpdate({
      type: "state",
      state: "stopped",
      message: "Assistente em tempo real parado.",
      timestamp: new Date().toISOString(),
    });
  }

  handleVoskEvent(event) {
    if (!event || !this.active) return;

    if (event.type === "ready") {
      console.log("Vosk model loaded, streaming active");
      return;
    }

    if (event.type === "error") {
      console.error("Vosk error:", event.message);
      this.emitUpdate({ type: "error", message: "Erro na transcrição: " + event.message, timestamp: new Date().toISOString() });
      return;
    }

    if (event.type === "stopped") return;

    if (event.type === "partial") {
      // Ignora partials enquanto a IA está respondendo (evita lixo na bolha antiga)
      if (this.isProcessing) return;
      this.emitUpdate({ type: "partial", text: event.text, timestamp: new Date().toISOString() });
      return;
    }

    if (event.type === "result") {
      if (this.isProcessing) return; // descarta resultados que chegam durante a resposta
      const txt = (event.text || "").trim();
      if (!txt) return;
      this.hasSpeech = true;
      this.sentenceBuffer.push(txt);
      this.emitUpdate({ type: "sentence", text: txt, timestamp: new Date().toISOString() });

      // Só dispara o timer de silêncio depois de ter conteúdo mínimo
      if (this.bufferWordCount() >= this.MIN_WORDS_TO_SEND) {
        this.resetSilenceTimer();
      }

      if (!this.accumulationTimer) {
        this.accumulationTimer = setTimeout(() => {
          if (this.sentenceBuffer.length > 0) this.sendBufferToAI();
        }, this.MAX_ACCUMULATION_MS);
      }
    }
  }

  bufferWordCount() {
    return this.sentenceBuffer.join(" ").trim().split(/\s+/).filter(Boolean).length;
  }

  resetSilenceTimer() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => {
      if (this.sentenceBuffer.length > 0 && this.active) this.sendBufferToAI();
    }, this.SILENCE_TIMEOUT_MS);
  }

  clearTimers() {
    if (this.silenceTimer) { clearTimeout(this.silenceTimer); this.silenceTimer = null; }
    if (this.accumulationTimer) { clearTimeout(this.accumulationTimer); this.accumulationTimer = null; }
  }

  async sendBufferToAI() {
    const text = this.sentenceBuffer.join(" ").trim();
    this.sentenceBuffer = [];
    this.hasSpeech = false;
    this.clearTimers();
    if (!text) return;

    // Trava: ignora qualquer partial/result até a IA terminar
    this.isProcessing = true;
    this.iteration += 1;
    this.emitUpdate({ type: "processing", iteration: this.iteration, transcript: text, timestamp: new Date().toISOString() });

    try {
      const responseText = await this.askOpenAI(text);
      const finalResponse = (responseText || "").trim() || "Sem resposta útil para este trecho.";
      this.pushContext(text, finalResponse);

      if (this.historyService && this.currentSessionId) {
        try {
          const sid = await this.historyService.addMessage(this.currentSessionId, 'user', text);
          await this.historyService.addMessage(sid, 'assistant', finalResponse);
          this.currentSessionId = sid;
        } catch (e) {}
      }

      this.emitUpdate({ type: "interaction", iteration: this.iteration, transcript: text, response: finalResponse, timestamp: new Date().toISOString() });
    } catch (error) {
      if (this.isQuotaError(error)) {
        this.active = false;
        this.isProcessing = false;
        voskStreamService.stop();
        this.emitUpdate({ type: "fatal_error", message: "⚠️ Limite de créditos da API atingido. Assistente desligado.", timestamp: new Date().toISOString() });
        if (this.onFatalStop) try { this.onFatalStop(); } catch (_) {}
        return;
      }
      this.emitUpdate({ type: "error", message: "Erro: " + error.message, timestamp: new Date().toISOString() });
    } finally {
      this.isProcessing = false;
    }
  }

  async askOpenAI(transcript) {
    const token = this.configService.getOpenIaToken();
    if (!token) throw new Error("Token da OpenAI não configurado.");

    const model = this.configService.getOpenAiModel();
    const context = this.buildContextMessages();

    const payload = {
      model,
      max_tokens: 300,
      messages: [
        { role: "system", content: this.getSystemInstruction() },
        ...context,
        { role: "user", content: "TRANSCRIÇÃO do áudio (pode conter erros do Vosk):\n\"" + transcript + "\"\n\nResuma e comente conforme as regras. Se for incompreensível, responda apenas '(trecho sem conteúdo relevante)'." },
      ],
    };

    const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      timeout: 60000,
    });

    return response?.data?.choices?.[0]?.message?.content || "";
  }

  getSystemInstruction() {
    return (
      "Você é um assistente que escuta áudio em tempo real (aulas, vídeos do YouTube, podcasts, lives, reuniões). " +
      "O texto recebido é a TRANSCRIÇÃO do que está sendo falado por TERCEIROS — NÃO é uma pergunta do usuário. " +
      "A transcrição vem de um modelo open-source (Vosk PT-BR) e PODE TER ERROS de palavras parecidas, " +
      "palavras inventadas ou frases truncadas. Use o contexto para inferir o sentido provável. " +
      "Se o trecho estiver muito incompreensível ou for só ruído/saudação sem conteúdo, responda apenas: " +
      "'(trecho sem conteúdo relevante)' e nada mais. " +
      "Quando houver conteúdo real, faça: (1) resumo de 1 linha do que foi dito, " +
      "(2) explicação técnica/contextual se for tema técnico (SOLID, Docker, K8s, JS/TS/Python/Java/Go, React, etc), " +
      "ou comentário relevante se for outro assunto (games, política, cultura BR, leis BR — LGPD, CLT, CDC). " +
      "NUNCA diga 'o usuário perguntou', 'o usuário comentou' — diga 'o vídeo/áudio fala sobre...' ou 'o palestrante diz...'. " +
      "FORMATO: máximo 3 linhas, seja direto, sem introduções."
    );
  }

  isQuotaError(error) {
    const status = error?.response?.status;
    const msg = (error?.response?.data?.error?.message || error?.message || "").toLowerCase();
    return status === 429 || status === 402 || msg.includes("insufficient_quota") || msg.includes("exceeded your current quota") || msg.includes("billing");
  }

  buildContextMessages() {
    return this.contextMessages.slice(-(this.maxIterationsInContext * 2));
  }

  pushContext(userText, assistantText) {
    this.contextMessages.push({ role: "user", content: userText });
    this.contextMessages.push({ role: "assistant", content: assistantText });
    const max = this.maxIterationsInContext * 2;
    if (this.contextMessages.length > max) this.contextMessages = this.contextMessages.slice(-max);
  }

  emitUpdate(payload) {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("realtime-assistant-update", payload);
  }
}

module.exports = RealtimeAssistantService;
