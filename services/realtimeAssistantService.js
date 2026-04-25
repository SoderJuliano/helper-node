const axios = require("axios");
const path = require("path");
const fs = require("fs").promises;
const { spawn } = require("child_process");

class RealtimeAssistantService {
  constructor({ app, configService, transcribeAudio, execPromise, getMainWindow, onFatalStop, historyService }) {
    this.app = app;
    this.configService = configService;
    this.transcribeAudio = transcribeAudio;
    this.execPromise = execPromise;
    this.getMainWindow = getMainWindow;
    this.onFatalStop = onFatalStop || null;
    this.historyService = historyService || null;

    this.active = false;
    this.stopping = false;
    this.iteration = 0;
    this.contextMessages = [];
    this.maxIterationsInContext = 10;
    this.currentRecordingProc = null;
    this.loopPromise = null;
    this.currentSessionId = null;
  }

  isActive() {
    return this.active || this.stopping;
  }

  async start() {
    if (this.active) return true;

    this.active = true;
    this.stopping = false;
    this.iteration = 0;
    this.contextMessages = [];
    this.currentSessionId = null;

    // Criar sessão de histórico
    if (this.historyService) {
      try {
        const now = new Date();
        const title = `🎧 Live Assistant — ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const session = await this.historyService.createNewSession(title);
        this.currentSessionId = session.id;
      } catch (e) {
        console.warn('Falha ao criar sessão de histórico para realtime:', e.message);
      }
    }

    this.emitUpdate({
      type: "state",
      state: "started",
      message: "Assistente em tempo real iniciado. Capturando áudio em blocos de 30s.",
      timestamp: new Date().toISOString(),
    });

    this.loopPromise = this.runLoop();
    return true;
  }

  async stop() {
    if (!this.active && !this.stopping) return;

    // Sinaliza para parar de gravar novos chunks
    this.active = false;
    this.stopping = true;

    // Interrompe a gravação do chunk atual (ffmpeg) imediatamente
    if (this.currentRecordingProc) {
      try {
        this.currentRecordingProc.kill("SIGTERM");
      } catch (error) {
        // ignore
      }
    }

    // Notifica a UI imediatamente — não espera o chunk terminar
    this.emitUpdate({
      type: "state",
      state: "stopped",
      message: "Assistente em tempo real parado.",
      timestamp: new Date().toISOString(),
    });

    // Finaliza o último chunk em background (transcrição + IA continuam rodando)
    // A resposta será emitida via 'interaction' assim que ficar pronta.
    if (this.loopPromise) {
      this.loopPromise
        .catch(() => {})
        .finally(() => { this.stopping = false; });
    } else {
      this.stopping = false;
    }
  }

  getSystemInstruction() {
    return (
      "Você é um assistente técnico especializado em programação, engenharia de software, DevOps e legislação tecnológica brasileira, " +
      "ouvindo áudio em tempo real de aulas, vídeos, podcasts e reuniões técnicas. " +
      "\n\n" +
      "CONTINUIDADE ENTRE TRECHOS: O áudio é dividido em blocos de 30 segundos. Cada trecho pode ser continuação " +
      "direta do anterior — uma mesma frase ou assunto pode estar dividido entre dois blocos consecutivos. " +
      "SEMPRE leve muito em conta a última mensagem do histórico ao interpretar o trecho atual: " +
      "se o trecho atual parecer incompleto ou sem contexto, é provável que seja continuação do bloco anterior. " +
      "Nunca interprete um trecho isoladamente se o histórico indicar continuidade. " +
      "\n\n" +
      "SIGLAS E TERMOS TÉCNICOS EM PROGRAMAÇÃO: " +
      "Você tem domínio completo de: SOLID (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion), " +
      "Clean Code, Clean Architecture, DDD (Domain-Driven Design), TDD, BDD, CQRS, Event Sourcing, " +
      "Design Patterns (GoF), microsserviços, Docker, Kubernetes, CI/CD, DevOps, GitOps, IaC (Infraestrutura como Código), " +
      "REST, GraphQL, gRPC, Kafka, RabbitMQ, bancos SQL e NoSQL, " +
      "JavaScript, TypeScript, Python, Java, Go, Rust, React, Angular, Vue, Node.js, Spring, FastAPI. " +
      "\n\n" +
      "SIGLAS E LEIS BRASILEIRAS: Conheça e interprete corretamente as principais siglas do contexto jurídico e regulatório brasileiro: " +
      "LGPD = Lei Geral de Proteção de Dados (Lei 13.709/2018, equivalente ao GDPR europeu, trata de privacidade e dados pessoais); " +
      "ANPD = Autoridade Nacional de Proteção de Dados; " +
      "Marco Civil da Internet = Lei 12.965/2014; " +
      "LINDB = Lei de Introdução às Normas do Direito Brasileiro; " +
      "CLT = Consolidação das Leis do Trabalho; " +
      "CDC = Código de Defesa do Consumidor; " +
      "BACEN = Banco Central do Brasil; CVM = Comissão de Valores Mobiliários; " +
      "PIX, Open Banking/Open Finance = regulamentações do BACEN; " +
      "SELIC, CDI, IPCA = indicadores financeiros brasileiros; " +
      "RFB = Receita Federal do Brasil; CNPJ, CPF = documentos fiscais; " +
      "Nota Fiscal Eletrônica (NF-e), SPED = sistema fiscal digital; " +
      "SOX = Sarbanes-Oxley (lei americana de compliance frequentemente citada em contexto corporativo brasileiro); " +
      "ISO 27001, ISO 27701 = normas de segurança da informação e privacidade. " +
      "\n\n" +
      "JOGOS, POP CULTURE E ENTRETENIMENTO: Reconheça nomes de jogos, personagens e franquias mesmo que a transcrição venha distorcida. " +
      "Exemplos frequentes no Brasil: Genshin Impact (jogo gacha da HoYoverse, comunidade muito ativa), " +
      "League of Legends / LoL (Riot Games), Valorant (Riot Games), Counter-Strike / CS:GO / CS2, " +
      "World of Warcraft / WoW (Blizzard), Overwatch (Blizzard), Fortnite (Epic Games), " +
      "Minecraft, Roblox, Free Fire (Garena), Call of Duty / CoD, GTA (Grand Theft Auto), " +
      "Elden Ring, Dark Souls (FromSoftware), Zelda, Mario (Nintendo), " +
      "Pokémon, Diablo (Blizzard), Path of Exile, Dota 2 (Valve), " +
      "franquias Marvel (MCU, Avengers, Iron Man, Spider-Man, Thor, Capitão América, Thanos, etc.), " +
      "DC (Batman, Superman, Wonder Woman, Flash, etc.), Star Wars, Harry Potter, " +
      "nomes de streamers/criadores brasileiros populares: Gaules, Loud, paiN Gaming, FURIA, " +
      "plataformas: Twitch, YouTube, TikTok, Netflix, Prime Video, Disney+. " +
      "Se o assunto mudar abruptamente de tema técnico para pop culture (ou vice-versa), " +
      "DETECTE a mudança de contexto pelo conteúdo e responda adequadamente ao novo tema " +
      "em vez de continuar respondendo sobre o assunto anterior. " +
      "\n\n" +
      "IMPORTANTE: Os termos técnicos aparecem frequentemente em inglês ou misturados com português — " +
      "interprete SEMPRE com contexto técnico e nunca como nomes de empresas ou marcas a menos que seja óbvio. " +
      "Por exemplo: 'LGPD' é sempre a lei brasileira de dados, NUNCA a empresa LG; " +
      "'Genshin' ou 'guenxin' = Genshin Impact (jogo), NUNCA empresa; " +
      "'solid' = princípios SOLID de OOP; 'deploy' = implantação; 'pipeline' = esteira CI/CD. " +
      "\n\n" +
      "LINGUAGEM INFORMAL E NOMES: O áudio pode conter linguagem completamente informal, gírias brasileiras, " +
      "palavrões, expressões coloquiais, erros de pronúncia e nomes próprios distorcidos. " +
      "Exemplos: 'Fábio Aqui' ou 'Fábio aki' = Fabio Akita (dev/youtuber brasileiro famoso); " +
      "'Flow' = Flow Podcast (podcast brasileiro); 'Dev Reis' ou 'devirrais' = DevReis (canal de dev BR); " +
      "'Lucas Montano' = Lucas Montano (dev/youtuber BR); 'Filipe Deschamps' = dev/youtuber BR; " +
      "'Código Fonte TV', 'Attekita Dev', 'Rocketseat', 'Alura', 'DIO' = plataformas/canais BR de dev; " +
      "'Flow Podcast', 'Inteligência Ltda', 'Podpah' = podcasts brasileiros famosos; " +
      "Interprete sempre tentando reconstruir o nome ou termo mais provável pelo contexto. " +
      "\n\n" +
      "FORMATO DA RESPOSTA: Seja MUITO CONCISO. Máximo 3-4 linhas por resposta. " +
      "Não use markdown com títulos ou bullet points longos. " +
      "Vá direto ao ponto: 1 frase explicando o que foi dito + 1 frase de insight ou dica prática. " +
      "Se o assunto for informal/entretenimento, apenas resuma em 2 frases o que foi discutido. " +
      "\n\n" +
      "Analise o trecho, explique o conceito com exemplos práticos em código quando relevante, " +
      "destaque boas práticas e anti-patterns, e sugira próximos passos. Seja objetivo, técnico e útil."
    );
  }

  isQuotaError(error) {
    const status = error?.response?.status;
    const code = error?.response?.data?.error?.code || "";
    const message = (error?.response?.data?.error?.message || error?.message || "").toLowerCase();

    if (status === 429) return true;
    if (status === 402) return true;
    if (code === "insufficient_quota") return true;
    if (message.includes("insufficient_quota")) return true;
    if (message.includes("exceeded your current quota")) return true;
    if (message.includes("billing")) return true;
    if (message.includes("rate limit") && message.includes("quota")) return true;

    return false;
  }

  async runLoop() {
    while (this.active) {
      const baseName = `helpernode-rt-${Date.now()}-${this.iteration}`;
      const rawChunkPath = path.join(this.app.getPath("temp"), `${baseName}.wav`);
      const spedChunkForAudioModelPath = path.join(this.app.getPath("temp"), `${baseName}-3x.wav`);

      // Snapshot: se active=false aqui, não inicia novo chunk
      if (!this.active) break;

      try {
        const recorded = await this.recordChunk(rawChunkPath, 30);
        // Após gravação: se foi interrompida (stop pressionado durante gravação),
        // verifica se gravou algo útil antes de descartar
        if (!recorded) {
          await this.safeDelete(rawChunkPath);
          await this.safeDelete(spedChunkForAudioModelPath);
          break;
        }

        const hasRelevantAudio = await this.hasRelevantAudio(rawChunkPath);
        if (!hasRelevantAudio) {
          this.emitUpdate({
            type: "skip",
            iteration: this.iteration + 1,
            reason: "low_energy",
            transcript: "",
            timestamp: new Date().toISOString(),
          });

          await this.safeDelete(rawChunkPath);
          await this.safeDelete(spedChunkForAudioModelPath);
          continue;
        }

        // Rodar aceleração do áudio e transcrição local em paralelo — ambos leem do raw.
        const [, rawTranscript] = await Promise.all([
          this.speedUpAudio(rawChunkPath, spedChunkForAudioModelPath, 3),
          this.transcribeAudio(rawChunkPath, {
            emitRenderer: false,
            emitNotifications: false,
          }),
        ]);
        const cleanTranscript = this.normalizeTranscript(rawTranscript);

        const useAudioNativeModel = this.iteration % 2 === 1;

        if (this.shouldSkipChunk(cleanTranscript)) {
          // Se for iteração de áudio nativo, ainda tenta inferir pelo próprio áudio
          // para não perder trechos válidos quando o Whisper falhar.
          if (useAudioNativeModel) {
            const audioOnlyResponse = await this.askOpenAIWithAudio(
              spedChunkForAudioModelPath,
              "[Transcrição local indisponível neste trecho]"
            );

            const finalAudioOnlyResponse =
              (audioOnlyResponse || "").trim() || "Sem resposta útil para este trecho.";

            this.pushContext("[Áudio sem transcrição local]", finalAudioOnlyResponse);

            // Salvar no histórico
            if (this.historyService && this.currentSessionId) {
              try {
                const sid = await this.historyService.addMessage(this.currentSessionId, 'user', '[Áudio sem transcrição local]');
                await this.historyService.addMessage(sid, 'assistant', finalAudioOnlyResponse);
                this.currentSessionId = sid;
              } catch (e) {}
            }

            this.emitUpdate({
              type: "interaction",
              iteration: this.iteration + 1,
              mode: "audio-native",
              transcript: "[Transcrição indisponível; análise feita via áudio]",
              response: finalAudioOnlyResponse,
              timestamp: new Date().toISOString(),
            });

            await this.safeDelete(rawChunkPath);
            await this.safeDelete(spedChunkForAudioModelPath);
            continue;
          }

          this.emitUpdate({
            type: "skip",
            iteration: this.iteration + 1,
            reason: "no_speech",
            transcript: cleanTranscript,
            timestamp: new Date().toISOString(),
          });

          await this.safeDelete(rawChunkPath);
          await this.safeDelete(spedChunkForAudioModelPath);
          continue;
        }

        let responseText;
        if (useAudioNativeModel) {
          responseText = await this.askOpenAIWithAudio(spedChunkForAudioModelPath, cleanTranscript);
        } else {
          responseText = await this.askOpenAIWithText(cleanTranscript);
        }

        const finalResponse = (responseText || "").trim() || "Sem resposta útil para este trecho.";

        this.pushContext(cleanTranscript, finalResponse);

        // Salvar no histórico
        if (this.historyService && this.currentSessionId) {
          try {
            const sid = await this.historyService.addMessage(this.currentSessionId, 'user', cleanTranscript);
            await this.historyService.addMessage(sid, 'assistant', finalResponse);
            this.currentSessionId = sid; // atualiza caso sessão tenha sido recriada
          } catch (e) {
            // não bloqueia o loop
          }
        }

        this.emitUpdate({
          type: "interaction",
          iteration: this.iteration + 1,
          mode: useAudioNativeModel ? "audio-native" : "local-transcript",
          transcript: cleanTranscript,
          response: finalResponse,
          timestamp: new Date().toISOString(),
        });

      } catch (error) {
        if (this.isQuotaError(error)) {
          this.active = false;
          this.emitUpdate({
            type: "fatal_error",
            message:
              "⚠️ Limite de créditos da API atingido. " +
              "O Assistente em Tempo Real foi desligado automaticamente. " +
              "Ter créditos disponíveis na API Key é essencial para esta funcionalidade.",
            timestamp: new Date().toISOString(),
          });
          if (this.onFatalStop) {
            try { this.onFatalStop(); } catch (_) {}
          }
          break;
        }

        this.emitUpdate({
          type: "error",
          message: `Erro no assistente em tempo real: ${error.message}`,
          timestamp: new Date().toISOString(),
        });
      } finally {
        this.iteration += 1;
        await this.safeDelete(rawChunkPath);
        await this.safeDelete(spedChunkForAudioModelPath);
      }
    }
  }

  normalizeTranscript(transcript) {
    const raw = (transcript || "").trim();
    if (!raw) return "";

    const lower = raw.toLowerCase();
    if (lower.includes("no text recognized")) return "";
    if (lower.includes("[blank_audio]")) return "";

    return raw;
  }

  shouldSkipChunk(transcript) {
    if (!transcript) return true;
    if (transcript === "[BLANK_AUDIO]") return true;

    const sanitized = transcript
      .replace(/\[BLANK_AUDIO\]/gi, "")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!sanitized) return true;

    const words = sanitized.split(" ").filter(Boolean);
    if (words.length < 2) return true;

    return false;
  }

  buildContextMessages() {
    const maxMessages = this.maxIterationsInContext * 2;
    return this.contextMessages.slice(-maxMessages);
  }

  pushContext(userText, assistantText) {
    this.contextMessages.push({ role: "user", content: userText });
    this.contextMessages.push({ role: "assistant", content: assistantText });

    const maxMessages = this.maxIterationsInContext * 2;
    if (this.contextMessages.length > maxMessages) {
      this.contextMessages = this.contextMessages.slice(-maxMessages);
    }
  }

  async askOpenAIWithText(transcript) {
    const token = this.configService.getOpenIaToken();
    if (!token) {
      throw new Error("Token da OpenAI não configurado.");
    }

    const context = this.buildContextMessages();

    const payload = {
      model: "gpt-4.1-nano",
      max_tokens: 300,
      messages: [
        { role: "system", content: this.getSystemInstruction() },
        ...context,
        {
          role: "user",
          content:
            "Trecho atual do áudio (transcrição local):\n" + transcript +
            "\n\nDê explicação e sugestão prática em linguagem simples.",
        },
      ],
    };

    try {
      const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      });
      return response?.data?.choices?.[0]?.message?.content || "";
    } catch (error) {
      // Preserve axios response for quota detection upstream
      throw error;
    }
  }

  async askOpenAIWithAudio(audioPath, transcriptHint) {
    const token = this.configService.getOpenIaToken();
    if (!token) {
      throw new Error("Token da OpenAI não configurado.");
    }

    const audioBase64 = await fs.readFile(audioPath, { encoding: "base64" });
    const context = this.buildContextMessages();

    // gpt-4o-audio-preview via /v1/chat/completions — única API que suporta input_audio corretamente
    try {
      const contextText = context
        .map((m) => `${m.role === "user" ? "Usuário" : "Assistente"}: ${m.content}`)
        .join("\n");

      const userTextContent =
        "Contexto recente:\n" +
        (contextText || "Sem contexto anterior") +
        "\n\nTranscrição local de apoio (pode estar incompleta ou com erros de pronúncia — " +
        "use-a como dica, mas confie no áudio para a interpretação final):\n" +
        transcriptHint +
        "\n\nAnalise o áudio e responda com explicação técnica e sugestões práticas.";

      const payload = {
        model: "gpt-4o-audio-preview",
        max_tokens: 300,
        messages: [
          { role: "system", content: this.getSystemInstruction() },
          ...context,
          {
            role: "user",
            content: [
              { type: "text", text: userTextContent },
              {
                type: "input_audio",
                input_audio: { data: audioBase64, format: "wav" },
              },
            ],
          },
        ],
      };

      const response = await axios.post("https://api.openai.com/v1/chat/completions", payload, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 90000,
      });

      const content = response?.data?.choices?.[0]?.message?.content;
      if (content) return content;
    } catch (error) {
      const apiMessage =
        error?.response?.data?.error?.message ||
        error?.response?.data?.message ||
        error.message;
      console.warn("Falha no modelo nativo de áudio. Fallback para texto.", apiMessage);
    }

    // Fallback garantido para modo texto
    return this.askOpenAIWithText(transcriptHint);
  }

  extractResponseText(data) {
    if (!data) return "";
    if (typeof data.output_text === "string" && data.output_text.trim()) {
      return data.output_text.trim();
    }

    if (Array.isArray(data.output)) {
      const texts = [];
      for (const item of data.output) {
        if (!Array.isArray(item.content)) continue;
        for (const c of item.content) {
          if (typeof c.text === "string") texts.push(c.text);
          if (typeof c.output_text === "string") texts.push(c.output_text);
        }
      }
      if (texts.length > 0) return texts.join("\n").trim();
    }

    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }

    return "";
  }

  async speedUpAudio(inputPath, outputPath, speed = 3) {
    let filter = "atempo=2.0,atempo=1.5";
    if (speed === 2) {
      filter = "atempo=2.0";
    }

    const cmd = `ffmpeg -y -i "${inputPath}" -filter:a "${filter}" "${outputPath}"`;
    await this.execPromise(cmd);
  }

  async hasRelevantAudio(inputPath) {
    try {
      const { stdout, stderr } = await this.execPromise(
        `ffmpeg -hide_banner -i "${inputPath}" -af volumedetect -f null /dev/null`
      );

      const output = `${stdout || ""}\n${stderr || ""}`;
      const meanMatch = output.match(/mean_volume:\s*(-?[\d.]+)\s*dB/i);
      const maxMatch = output.match(/max_volume:\s*(-?[\d.]+)\s*dB/i);

      if (!meanMatch && !maxMatch) {
        return true;
      }

      const meanDb = meanMatch ? parseFloat(meanMatch[1]) : -120;
      const maxDb = maxMatch ? parseFloat(maxMatch[1]) : -120;

      // Heurística mais permissiva para não descartar fala baixa/compressão de podcast.
      const hasEnergy = maxDb > -50 || meanDb > -60;
      return hasEnergy;
    } catch (error) {
      // Se a análise falhar, não bloqueia o fluxo.
      return true;
    }
  }

  async recordChunk(outputPath, seconds = 30) {
    const captureModes = [
      {
        label: "mic+system",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "pulse",
          "-i",
          "default",
          "-f",
          "pulse",
          "-i",
          "@DEFAULT_MONITOR@",
          "-filter_complex",
          "[0:a]volume=1.2[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=longest:dropout_transition=0[aout]",
          "-map",
          "[aout]",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-t",
          String(seconds),
          outputPath,
        ],
      },
      {
        label: "system-only",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "pulse",
          "-i",
          "@DEFAULT_MONITOR@",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-t",
          String(seconds),
          outputPath,
        ],
      },
      {
        label: "mic-only",
        args: [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "pulse",
          "-i",
          "default",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-t",
          String(seconds),
          outputPath,
        ],
      },
    ];

    for (const mode of captureModes) {
      if (!this.active && !this.stopping) return false;

      const ok = await this.runRecordProcess(mode.args);
      if (ok) {
        this.emitUpdate({
          type: "capture",
          mode: mode.label,
          iteration: this.iteration + 1,
          timestamp: new Date().toISOString(),
        });
        return true;
      }
    }

    throw new Error("Falha ao capturar áudio (microfone e saída do sistema indisponíveis).");
  }

  runRecordProcess(args) {
    return new Promise((resolve) => {
      const proc = spawn("ffmpeg", args, { stdio: "ignore" });
      this.currentRecordingProc = proc;

      proc.on("error", () => {
        if (this.currentRecordingProc === proc) this.currentRecordingProc = null;
        resolve(false);
      });

      proc.on("close", (code) => {
        if (this.currentRecordingProc === proc) this.currentRecordingProc = null;

        // Se parou normalmente (code=0) -> ok
        // Se foi interrompido pelo stop() (active=false, SIGTERM -> code!=0)
        // ainda assim aceita o chunk parcial para processar a última fala.
        // Só descarta se houve erro real durante uma sessão ativa.
        if (code !== 0 && this.active) {
          resolve(false);
          return;
        }

        resolve(true);
      });
    });
  }

  emitUpdate(payload) {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("realtime-assistant-update", payload);
  }

  async safeDelete(filePath) {
    try {
      await fs.unlink(filePath);
    } catch (_) {
      // ignore
    }
  }
}

module.exports = RealtimeAssistantService;
