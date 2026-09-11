/**
 * services/nexaVoiceAssistant/nexaVoiceSession.js
 * 
 * Orquestrador da Sessão de Voz Ativa da Nexa.
 * Integra o detector de turnos (VAD), o classificador de intenção, o gerenciador de contexto,
 * a síntese de voz Google TTS e a sincronização com as animações da Nexa.
 * 
 * Regras cruciais:
 * - Janela de follow-up (8s): após responder, permite o usuário falar sem repetir "Nexa".
 * - Suporta execução com ou sem arquivos/workspace anexados, ferramentas ligadas ou desligadas.
 * - Não bloqueia a thread principal nem o arraste da janela.
 */

const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const NexaTurnDetector = require("./nexaTurnDetector");
const NexaIntentClassifier = require("./nexaIntentClassifier");
const NexaConversationContext = require("./nexaConversationContext");
const NexaResponseFilter = require("./nexaResponseFilter");
const { warmupWhisper } = require("./whisperWarmup");

const FOLLOW_UP_DURATION_MS = 6000; // Janela de 6 segundos para conversa contínua após resposta

class NexaVoiceSession extends EventEmitter {
  constructor(options = {}) {
    super();
    this.turnDetector = new NexaTurnDetector();
    this.context = new NexaConversationContext({ ttlMs: 15000 });

    this.active = false;
    this.isProcessing = false;
    this.isSpeakingTts = false;
    this.followUpTimer = null;
    this.followUpActive = false;

    this._bindEvents();
  }

  _bindEvents() {
    this.turnDetector.on("level", (data) => {
      this.emit("level", data);
    });

    this.turnDetector.on("speech-start", () => {
      // Dispara aquecimento preventivo do Whisper em background (0% de impacto na thread de áudio)
      warmupWhisper().catch(() => {});

      // Se estava em follow-up e o usuário começou a falar, cancela o timer para não expirar durante a fala
      if (this.followUpTimer) {
        clearTimeout(this.followUpTimer);
        this.followUpTimer = null;
      }
      this.emit("state-changed", { state: "listening", followUpActive: this.followUpActive });
    });

    this.turnDetector.on("voice-decay", (decayInfo) => {
      // Decaimento de voz detectado: garante que o Whisper já esteja aquecido antes do fim dos 800ms
      warmupWhisper().catch(() => {});
      this.emit("voice-decay", decayInfo);
    });

    this.turnDetector.on("turn-complete", async (turnData) => {
      await this._handleTurnComplete(turnData);
    });

    this.turnDetector.on("turn-discarded", (info) => {
      // Turno descartado por ruído/duração curta: NÃO reativa o timer para evitar loops infinitos em som ambiente
    });
  }

  /**
   * Inicia o assistente de voz contínuo.
   */
  async start(deviceId = "") {
    if (this.active) return;
    this.active = true;
    this.isProcessing = false;
    this.isSpeakingTts = false;
    this.followUpActive = false;
    if (this.followUpTimer) clearTimeout(this.followUpTimer);
    this.followUpTimer = null;

    // Pré-aquece o Whisper em background logo ao iniciar o modo de voz
    warmupWhisper().catch(() => {});

    await this.turnDetector.start(deviceId);
    this.emit("status-changed", { active: true, state: "listening", followUpActive: false });
    this.emit("animation-trigger", { animation: "wave" });
  }

  /**
   * Para o assistente de voz contínuo.
   */
  stop() {
    if (!this.active) return;
    this.active = false;
    this.isProcessing = false;
    this.isSpeakingTts = false;
    this.followUpActive = false;
    if (this.followUpTimer) clearTimeout(this.followUpTimer);
    this.followUpTimer = null;
    this.context.clear();

    this.stopTtsPlayback();
    this.turnDetector.stop();
    this.emit("status-changed", { active: false, state: "idle", followUpActive: false });
  }

  isActive() {
    return this.active;
  }

  handleTtsStarted() {
    this.isSpeakingTts = true;
    this.isProcessing = false;
    this.emit("state-changed", { state: "speaking", followUpActive: false });
  }

  /**
   * Interrompe imediatamente a reprodução de áudio TTS da Nexa (Barge-In).
   */
  stopTtsPlayback() {
    this.isSpeakingTts = false;
    this.isProcessing = false;
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    const { state, helpers } = require("../../main/globals");
    if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
      try {
        state.nexaWindow.webContents.send("stop-tts-audio");
      } catch (_) {}
    }
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      try {
        state.mainWindow.webContents.send("stop-tts-audio");
      } catch (_) {}
    }
    if (helpers && typeof helpers.cancelIaAndFreezeStream === "function") {
      try { helpers.cancelIaAndFreezeStream(); } catch (_) {}
    }
    this.emit("barge-in");
  }

  /**
   * Processa o áudio capturado ao final de um turno de fala.
   */
  async _handleTurnComplete({ pcmBuffer, sampleRate, channels, bitDepth }) {
    if (!this.active) return;

    const { helpers, state } = require("../../main/globals");
    let wavPath = null;

    try {
      // 1. Grava o PCM em arquivo WAV temporário para transcrição
      const tmpDir = (state && state.AUDIO_TMP_DIR) || path.join(require("os").tmpdir(), "helper-node-audio");
      fs.mkdirSync(tmpDir, { recursive: true });
      wavPath = path.join(tmpDir, `nexa_voice_${Date.now()}.wav`);
      
      const wavHeader = helpers._buildWavFile
        ? helpers._buildWavFile(pcmBuffer, sampleRate, channels, bitDepth)
        : this._buildWavFallback(pcmBuffer, sampleRate, channels, bitDepth);

      fs.writeFileSync(wavPath, wavHeader);

      // 2. Transcreve o áudio via Whisper e aplica limpeza rigorosa de ruídos/alucinações
      const rawTranscript = await helpers.transcribeDictation(wavPath);
      const { cleanTranscription } = require("../audioTranscriptionCleaner");
      const cleanedText = cleanTranscription(rawTranscript);

      if (!cleanedText || cleanedText === "[BLANK_AUDIO]") {
        if (!this.isSpeakingTts && !this.isProcessing) {
          this._endProcessingAndResume();
        }
        return;
      }

      // 3. Classifica a intenção
      const classification = NexaIntentClassifier.classify(cleanedText, {
        followUpActive: this.followUpActive
      });

      console.log("[NexaVoiceSession] Transcrição:", cleanedText, "-> Ação:", classification.action, "(", classification.reason, ")");

      const hasWakeWord = NexaIntentClassifier.hasValidWakeWord(cleanedText);

      // A) BARGE-IN: Se a Nexa estava falando ou processando e o usuário fala para interromper ou chama a wake word
      if (this.isSpeakingTts || this.isProcessing) {
        if (classification.action === "STOP_AND_LISTEN" || hasWakeWord) {
          console.log("[NexaVoiceSession] Barge-in: usuário interveio durante fala/processamento da Nexa.");
          this.stopTtsPlayback();

          // Se a intervenção foi apenas para chamar a Nexa ou mandar parar (sem uma pergunta complexa anexada)
          if (classification.action === "STOP_AND_LISTEN" || !classification.cleanedQuery || classification.isCasualGreeting) {
            this.emit("animation-trigger", { animation: "listening" });
            this._startFollowUpTimer();
            this._endProcessingAndResume();
            return;
          }
          // Caso contrário (ex: "Nexa, cria um script pra mim"), prossegue abaixo para responder à nova pergunta
        } else {
          // Ruído ambiente ou fala não direcionada à Nexa durante a execução -> ignora
          return;
        }
      }

      // B) Comando de parada explícito fora de fala
      if (classification.action === "STOP_AND_LISTEN") {
        console.log("[NexaVoiceSession] Comando de parada recebido em idle.");
        this.stopTtsPlayback();
        this.followUpActive = false;
        if (this.followUpTimer) {
          clearTimeout(this.followUpTimer);
          this.followUpTimer = null;
        }
        this._endProcessingAndResume();
        return;
      }

      // C) Ação IGNORAR (ruído, conversa paralela com filho/terceiros, monólogo)
      if (classification.action === "IGNORE") {
        if (classification.expireFollowUp || this.followUpActive) {
          this.followUpActive = false;
          if (this.followUpTimer) {
            clearTimeout(this.followUpTimer);
            this.followUpTimer = null;
          }
        }
        this._endProcessingAndResume();
        return;
      }

      // D) Ação ANIMAÇÃO APENAS (ex: "Nexa dá tchauzinho", "Nexa manda coração")
      if (classification.action === "REACT_ANIMATION_ONLY") {
        const anim = classification.animation || "wave";
        this.emit("animation-trigger", { animation: anim });
        this._startFollowUpTimer();
        this._endProcessingAndResume();
        return;
      }

      // E) Ação RESPONDER POR ÁUDIO E CHAT
      // Verifica se a frase parece cortada no meio (ex: termina em vírgula ou conector)
      if (NexaIntentClassifier.isSentenceIncomplete(classification.cleanedQuery)) {
        console.log("[NexaVoiceSession] Frase incompleta detectada ('" + classification.cleanedQuery + "'), aguardando complemento...");
        this._endProcessingAndResume();
        return;
      }

      // Se for resposta direta/presença/saudação casual sem necessidade de execução de ferramentas da IDE
      if (classification.directVoiceResponse) {
        this.isProcessing = true;
        this.emit("speech-preview", { text: cleanedText });
        this.emit("state-changed", { state: "speaking", followUpActive: this.followUpActive });
        this.emit("animation-trigger", { animation: classification.animationHint || "wave" });

        const replyText = classification.directVoiceResponse;
        this.context.recordTurn(cleanedText, replyText);

        const { state, configService, googleTtsService } = require("../../main/globals");

        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          try {
            state.mainWindow.webContents.send("nexa-voice:quick-reply", {
              question: cleanedText,
              reply: replyText
            });
          } catch (_) {}
        }

        let audioPlayed = false;
        if (googleTtsService) {
          try {
            const ttsCfg = configService.getGoogleTtsConfig ? configService.getGoogleTtsConfig() : {};
            const hasTtsKey = !!(ttsCfg && ttsCfg.keyPathOrKey && ttsCfg.keyPathOrKey.trim());
            if (ttsCfg && (ttsCfg.enabled || this.active) && hasTtsKey) {
              const voiceName = ttsCfg.voiceName || "pt-BR-Neural2-C";
              const audioBuf = await googleTtsService.synthesizeText(replyText, {
                keyOrPath: ttsCfg.keyPathOrKey,
                voiceName,
                speakingRate: ttsCfg.speakingRate || 1.0,
                pitch: ttsCfg.pitch || 0.0
              });
              if (audioBuf && audioBuf.length > 0) {
                const base64Audio = audioBuf.toString("base64");
                const audioPayload = { audioBase64: base64Audio, text: replyText };
                const { ipcMain } = require("electron");
                this.isSpeakingTts = true;
                this.isProcessing = false;
                ipcMain.emit("play-tts-audio", null, audioPayload);

                const { isNexaWindowOpen } = require("../../main/nexa/nexaWindow.js");
                if (isNexaWindowOpen() && state.nexaWindow && !state.nexaWindow.isDestroyed()) {
                  try { state.nexaWindow.webContents.send("play-tts-audio", audioPayload); } catch (_) {}
                } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
                  try { state.mainWindow.webContents.send("play-tts-audio", audioPayload); } catch (_) {}
                }
                audioPlayed = true;
              }
            }
          } catch (ttsErr) {
            console.warn("[NexaVoiceSession] Erro TTS quick-reply:", ttsErr.message);
          }
        }

        if (!audioPlayed) {
          this._endProcessingAndResume();
          this._startFollowUpTimer();
        }
        return;
      }

      this.isProcessing = true;
      this.emit("speech-preview", { text: cleanedText });
      this.emit("state-changed", { state: "thinking", followUpActive: this.followUpActive });
      this.emit("animation-trigger", { animation: classification.animationHint || "thinking" });

      const enrichedQuery = this.context.enrichQueryWithContext(classification.cleanedQuery);
      await this._executeAssistantQuery(enrichedQuery, classification.animationHint);

    } catch (err) {
      console.error("[NexaVoiceSession] Erro no processamento do turno:", err);
      this._endProcessingAndResume();
    } finally {
      if (wavPath && fs.existsSync(wavPath)) {
        try { fs.unlinkSync(wavPath); } catch (_) {}
      }
    }
  }

  /**
   * Executa a pergunta enriquecida no modelo ativo e sintetiza a resposta.
   */
  async _executeAssistantQuery(userPrompt, animationHint = "thinking") {
    const { state, configService, googleTtsService, helpers } = require("../../main/globals");

    // Timeout de segurança (45s) para evitar bloqueio caso a rede/IA falhe
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
    }
    this.processingTimeout = setTimeout(() => {
      console.warn("[NexaVoiceSession] Timeout no processamento do turno. Retomando escuta...");
      this._endProcessingAndResume();
    }, 45000);

    try {
      this.emit("state-changed", { state: "thinking" });
      this.emit("animation-trigger", { animation: animationHint || "thinking" });

      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        // Envia pergunta diretamente para o chat da tela (sem poluir o composer de input)
        state.mainWindow.webContents.send("nexa-voice:submit-question", { text: userPrompt });
      } else {
        // Execução direta quando a janela principal do chat não está disponível
        const systemDirective = NexaResponseFilter.getVoiceModeSystemPromptInstruction();
        const promptWithDirective = `${userPrompt}\n${systemDirective}`;
        const rawAiResponse = helpers.getIaResponseDirect
          ? await helpers.getIaResponseDirect(promptWithDirective)
          : "";
        const { voiceSummary, displayText, animation } = NexaResponseFilter.processResponse(rawAiResponse);
        this.context.recordTurn(userPrompt, displayText);
        this.emit("animation-trigger", { animation });

        if (voiceSummary && googleTtsService) {
          const ttsCfg = configService.getGoogleTtsConfig ? configService.getGoogleTtsConfig() : {};
          const hasTtsKey = !!(ttsCfg && ttsCfg.keyPathOrKey && ttsCfg.keyPathOrKey.trim());
          if (ttsCfg && (ttsCfg.enabled || this.active) && hasTtsKey) {
            const voiceName = ttsCfg.voiceName || "pt-BR-Neural2-C";
            const audioBuf = await googleTtsService.synthesizeText(voiceSummary, {
              keyOrPath: ttsCfg.keyPathOrKey,
              voiceName,
              speakingRate: ttsCfg.speakingRate || 1.0,
              pitch: ttsCfg.pitch || 0.0
            });
            if (audioBuf && audioBuf.length > 0) {
              const base64Audio = audioBuf.toString("base64");
              this.isSpeakingTts = true;
              if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
                state.nexaWindow.webContents.send("play-tts-audio", { audioBase64: base64Audio, text: voiceSummary });
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[NexaVoiceSession] Erro ao executar query da IA:", err);
      this._endProcessingAndResume();
    }
  }

  handleTtsEnded() {
    this.isSpeakingTts = false;
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    this._endProcessingAndResume();
    this._startFollowUpTimer();
  }

  handleAiProcessingFinished() {
    if (this.processingTimeout) {
      clearTimeout(this.processingTimeout);
      this.processingTimeout = null;
    }
    if (!this.isSpeakingTts) {
      this._endProcessingAndResume();
      this._startFollowUpTimer();
    }
  }

  _startFollowUpTimer() {
    if (this.followUpTimer) clearTimeout(this.followUpTimer);
    this.followUpActive = true;
    this.emit("status-changed", { active: this.active, state: "listening", followUpActive: true });

    this.followUpTimer = setTimeout(() => {
      this.followUpActive = false;
      this.followUpTimer = null;
      if (this.active) {
        this.emit("status-changed", { active: true, state: "listening", followUpActive: false });
      }
    }, FOLLOW_UP_DURATION_MS);
  }

  _endProcessingAndResume() {
    this.isProcessing = false;
    if (this.active) {
      this.emit("state-changed", {
        state: "listening",
        followUpActive: this.followUpActive
      });
    }
  }

  _buildWavFallback(pcmData, sampleRate = 16000, numChannels = 1, bitsPerSample = 16) {
    const dataLen = pcmData.length;
    const buffer = Buffer.alloc(44 + dataLen);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLen, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * numChannels * (bitsPerSample / 8), 28);
    buffer.writeUInt16LE(numChannels * (bitsPerSample / 8), 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLen, 40);
    pcmData.copy(buffer, 44);
    return buffer;
  }
}

module.exports = NexaVoiceSession;
