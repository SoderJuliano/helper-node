// main/helpers/audio.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  ROOT_DIR, APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  execPromise, appConfig, Notification, VoskStreamService
} = require('../globals.js');

helpers.startWinDictation = async function() {
  const nativeAudio = require('../../services/platform/nativeAudio');
  state.winDictationChunks = [];
  state.winDictationBytes = 0;
  state.winDictationMicCb = (buf) => { state.winDictationChunks.push(buf); state.winDictationBytes += buf.length; };
  await nativeAudio.subscribe('mic', state.winDictationMicCb);
  state.winDictationActive = true;
  state.isRecording = true;
  try { state.mainWindow.webContents.send('toggle-recording', { isRecording: true, audioFilePath: null, isIdeMode: true }); } catch (_) {}
}

helpers.stopWinDictationAndTranscribe = async function() {
  const nativeAudio = require('../../services/platform/nativeAudio');
  try { if (state.winDictationMicCb) nativeAudio.unsubscribe('mic', state.winDictationMicCb); } catch (_) {}
  state.winDictationMicCb = null;
  state.winDictationActive = false;
  state.isRecording = false;

  const pcm = Buffer.concat(state.winDictationChunks, state.winDictationBytes);
  state.winDictationChunks = [];
  state.winDictationBytes = 0;

  // Esconde o "ouvindo" no renderer.
  try { state.mainWindow.webContents.send('toggle-recording', { isRecording: false, audioFilePath: null, isIdeMode: true }); } catch (_) {}

  if (!pcm || pcm.length < 3200) { // < ~0.1s de áudio útil
    try { state.mainWindow.webContents.send('transcription-error', 'Nenhum áudio detectado. Tente de novo.'); } catch (_) {}
    return;
  }

  const token = configService.getOpenIaToken();
  if (!token) {
    try { state.mainWindow.webContents.send('transcription-error', 'Configure a chave da OpenAI (Configurações) para transcrever no Windows.'); } catch (_) {}
    return;
  }

  state.recordingBusy = true;
  try {
    fs2.mkdirSync(AUDIO_TMP_DIR, { recursive: true });
    const wavPath = path.join(AUDIO_TMP_DIR, `windict_${Date.now()}.wav`);
    fs2.writeFileSync(wavPath, helpers._buildWavFile(pcm, 16000, 1, 16));

    let text = '';
    try {
      text = await cloudTranscribeAudio(wavPath, token);
    } finally {
      try { await fs.unlink(wavPath); } catch (_) {}
    }

    if (!text || !text.trim() || text === '[BLANK_AUDIO]') {
      state.mainWindow.webContents.send('transcription-error', 'Nenhum áudio detectado. Tente de novo.');
      return;
    }

    const isIdeModeNow = (workspace.list() || []).length > 0;
    const aiModel = helpers.getEffectiveAiModel();
    if (isIdeModeNow) {
      state.mainWindow.webContents.send('ide-audio-transcribed', { text: text + ' ' });
    } else if (aiModel === 'llama-stream') {
      state.mainWindow.webContents.send('send-to-gemini-stream-auto', text);
    } else {
      helpers.getIaResponse(text);
    }
  } catch (e) {
    console.error('[win-dictation] erro:', e.message);
    try { state.mainWindow.webContents.send('transcription-error', 'Falha ao transcrever o áudio: ' + e.message); } catch (_) {}
  } finally {
    state.recordingBusy = false;
  }
}

helpers.toggleRecording = async function() {
  try {
    // Realtime existe em todas as edições: na Lite/ChatGPT é 100% online (OpenAI),
    // na Full com backend/Ollama é o pipeline local (Vosk+Whisper). pickRealtimeService decide.
    const isRealtimeAssistantEnabled = configService.getRealtimeAssistantStatus();
    if (isRealtimeAssistantEnabled) {
      await helpers.toggleRealtimeAssistantRecording();
      return;
    }

    // Tradutor é um modo exclusivo, sem input de texto — nunca deve gravar/transcrever
    // via Ctrl+D nem jogar texto no composer (isso é exclusividade do modo IDE).
    // Sem esse guard, com pasta de projeto aberta (modo IDE) + Tradutor ativo numa
    // janela normal (não OS Integration), o Ctrl+D caía na rota de baixo e enchia
    // o composer mesmo com o Tradutor ligado.
    if (translationAssistant.isActive()) {
      console.log("Ctrl+D ignorado — Assistente de Tradução ativo (modo exclusivo, sem input de texto).");
      return;
    }

    // Anti-spam: ignora Ctrl+D enquanto ainda estamos transcrevendo/respondendo
    // o áudio do toque anterior (senão múltiplos toques enviam o mesmo áudio).
    if (state.recordingBusy) {
      console.log("Ctrl+D ignorado — ainda processando o áudio anterior.");
      return;
    }

    if (state.isRecording) {
      // === STOP RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();

      // Windows/macOS modo janela: para o press-to-talk e transcreve.
      if (state.winDictationActive) {
        await helpers.stopWinDictationAndTranscribe();
        return;
      }

      if (isOsIntegration && VoskStreamService.isRunning()) {
        const pending = state.osLiveSegment;
        VoskStreamService.stop();
        state.isRecording = false;
        helpers.clearOsVoskSilenceTimer();
        console.log("OS Integration: conversa contínua encerrada");
        if (pending && pending.hasSpeech && !pending.closing) {
          state.osLiveSegment = pending;
          helpers.closeOsLiveSegment().catch(e => console.error('[os-live] flush on stop:', e.message));
        }
        return;
      }

      if (state.dictationActive) {
        VoskStreamService.stop();
        state.dictationActive = false;
        state.isRecording = false;
        if (!isOsIntegration) {
          state.mainWindow.webContents.send("toggle-recording", { isRecording: false, audioFilePath: null, isIdeMode: true });
        }
        return;
      }

      if (state.recordingProcess) {
        state.recordingProcess.kill("SIGTERM");
        state.recordingProcess = null;
      }
      state.isRecording = false;
      console.log("Recording stopped");
      state.recordingBusy = true;

      if (!isOsIntegration) {
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({ title: "Helper-Node", body: "Ok, aguarde...", silent: true }).show();
        }
        state.mainWindow.webContents.send("toggle-recording", { isRecording: state.isRecording, audioFilePath });
      } else {
        helpers.destroyNotificationWindow();
        helpers.createOsNotificationWindow('loading', 'Processando áudio...');
      }

      try {
        await fs.access(audioFilePath);
        console.log("Audio file created:", audioFilePath);

        if (!isOsIntegration) {
          state.mainWindow.webContents.send("transcription-start", { audioFilePath });
        }

        const convertedAudioPath = path.join(AUDIO_TMP_DIR, "output_converted.wav");
        await execPromise(`ffmpeg -i ${audioFilePath} -ar 16000 -ac 1 -sample_fmt s16 -y ${convertedAudioPath}`);

        const audioText = edition.isLite()
          ? await cloudTranscribeAudio(convertedAudioPath, configService.getOpenIaToken())
          : await helpers.transcribeAudio(convertedAudioPath);

        try { await fs.unlink(audioFilePath); } catch (_) {}
        try { await fs.unlink(convertedAudioPath); } catch (_) {}

        if (!audioText || !audioText.trim() || audioText === "[BLANK_AUDIO]") {
          if (isOsIntegration) {
            helpers.createOsNotificationWindow('response', 'Nenhum áudio detectado. Tente novamente.');
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({ title: "Helper-Node", body: "Nenhum áudio detectado.", silent: true }).show();
          }
          return;
        }

        const aiModel = helpers.getEffectiveAiModel();
        const isIdeModeNow = (workspace.list() || []).length > 0;
        if (isIdeModeNow) {
          state.mainWindow.webContents.send("ide-audio-transcribed", { text: audioText + " " });
        } else if (isOsIntegration) {
          await helpers.processOsQuestion(audioText);
        } else if (aiModel === 'llama-stream') {
          state.mainWindow.webContents.send("send-to-gemini-stream-auto", audioText);
        } else {
          helpers.getIaResponse(audioText);
        }
      } catch (error) {
        console.error("Audio processing failed:", error);
      } finally {
        state.recordingBusy = false;
      }
    } else {
      // === START RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();
      const isIdeMode = (workspace.list() || []).length > 0;

      if (isOsIntegration && translationAssistant.isActive()) {
        console.log("OS Integration: Translation Assistant ativo — Ctrl+D ignorado (mutex).");
        return;
      }

      // Windows/macOS modo janela: Vosk/parec não existem fora do Linux. Usa o
      // bridge nativo (press-to-talk): Ctrl+D grava, Ctrl+D de novo transcreve.
      if (!isOsIntegration && process.platform !== 'linux') {
        try {
          await helpers.startWinDictation();
        } catch (e) {
          console.error('[win-dictation] falha ao iniciar:', e.message);
          try { state.mainWindow.webContents.send('transcription-error', 'Falha ao acessar o microfone: ' + e.message); } catch (_) {}
          state.winDictationActive = false;
          state.isRecording = false;
        }
        return;
      }

      if (!isOsIntegration) {
        // App Full / Janela / CLI -> Modo Ditado com 2s de silêncio (Vosk + Whisper Progressivo)
        state.dictationActive = true;
        state.dictationPcmChunks = [];
        state.dictationPcmBytes = 0;
        state.dictationProcessing = false;

        state.mainWindow.webContents.send("toggle-recording", { isRecording: true, audioFilePath: null, isIdeMode: true });

        VoskStreamService.start({
          audioSources: ['@DEFAULT_SOURCE@'],
          onEvent: async (event) => {
            if (event.type === 'audio') {
              state.dictationPcmChunks.push(event.data);
              state.dictationPcmBytes += event.data.length;
            } else if (event.type === 'result') {
              if (state.dictationPcmBytes > 0 && !state.dictationProcessing) {
                state.dictationProcessing = true;
                const pcm = Buffer.concat(state.dictationPcmChunks, state.dictationPcmBytes);
                state.dictationPcmChunks = [];
                state.dictationPcmBytes = 0;
                const wavPath = path.join(AUDIO_TMP_DIR, `dictation_${Date.now()}.wav`);
                try {
                  fs2.mkdirSync(AUDIO_TMP_DIR, { recursive: true });
                  fs2.writeFileSync(wavPath, helpers._buildWavFile(pcm, 16000, 1, 16));
                  
                  const text = edition.isLite() 
                    ? await cloudTranscribeAudio(wavPath, configService.getOpenIaToken()) 
                    : await helpers.transcribeAudio(wavPath, { emitRenderer: false, emitNotifications: false });
                    
                  if (text && text.trim() && text !== "[BLANK_AUDIO]") {
                    // Manda colar no input
                    state.mainWindow.webContents.send("ide-audio-transcribed", { text: text + " " });
                    // Garante que o icone 'listening' volte após colar, pois o frontend esconde
                    state.mainWindow.webContents.send("toggle-recording", { isRecording: true, audioFilePath: null, isIdeMode: true });
                  }
                } catch (e) {
                  console.error("[dictation] error:", e.message);
                } finally {
                  try { await fs.unlink(wavPath); } catch (_) {}
                  state.dictationProcessing = false;
                }
              }
            }
          }
        });
        state.isRecording = true;
        return;
      }

      // OS Integration Legacy Start
      await fs.unlink(audioFilePath).catch(() => {});
      const command = `pw-record "${audioFilePath}"`;
      state.recordingProcess = exec(command, (error) => {});
      state.isRecording = true;

      helpers.destroyNotificationWindow();
      helpers.createOsNotificationWindow('recording', '');
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
  }
}

helpers.getAudioDuration = async function(filePath) {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of json "${filePath}"`
    );
    const data = JSON.parse(stdout);
    const duration = parseFloat(data.format.duration);
    console.log(`Duração do áudio: ${duration} segundos`);
    return duration;
  } catch (error) {
    console.error("Erro ao obter duração do áudio:", error.message);
  }
}

helpers.transcribeAudio = async function(filePath, options = {}) {
  const { emitRenderer = true, emitNotifications = true } = options;

  try {
    // Obter a duração do áudio
    const duration = await helpers.getAudioDuration(filePath);

    const whisperPath = path.join(ROOT_DIR, "whisper/build/bin/whisper-cli");
    const modelPathSmall = path.join(ROOT_DIR, "whisper/models/ggml-small.bin");
    const modelPathMedium = path.join(ROOT_DIR, "whisper/models/ggml-medium.bin");

    // Determinar idioma do whisper com base na configuração do app
    const savedLang = configService.getLanguage();
    const whisperLang = savedLang === 'us-en' ? 'en' : 'pt';

    // Escolher modelo e parâmetros com base na duração
    // medium = melhor qualidade, entende nomes próprios e termos em inglês misturados com pt-br
    // small = fallback para áudios longos (> 60s) onde velocidade importa mais
    let modelPath, command;
    if (duration > 60) {
      modelPath = modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l ${whisperLang} --threads 16 --no-timestamps --best-of 3 --beam-size 3`;
      console.log("Usando modelo small (áudio longo)");
    } else {
      modelPath = fs2.existsSync(modelPathMedium) ? modelPathMedium : modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l ${whisperLang} --threads 18 --no-timestamps --best-of 5 --beam-size 5`;
      console.log(`Usando modelo ${modelPath.includes('medium') ? 'medium' : 'small'}`);
    }

    console.log("Executing whisper:", command);
    return new Promise((resolve, reject) => {
      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error("Whisper error:", stderr);
          state.mainWindow.webContents.send(
            "transcription-error",
            "Failed to transcribe audio"
          );
          reject(error);
          return;
        }
        const text = stdout.trim();
        console.log("Transcription:", text || "No text recognized");
        const cleanText = await helpers.limparTranscricao(text);
        if (emitRenderer && state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send("transcription-result", { cleanText });
        }

        if (
          emitNotifications &&
          appConfig.notificationsEnabled &&
          Notification.isSupported() &&
          cleanText
        ) {
          const notification = new Notification({
            title: "Helper-Node",
            body: "Usuário perguntou: " + cleanText,
            silent: true,
          });
          notification.show();
        }

        resolve(cleanText);
      });
    });
  } catch (error) {
    console.error("Transcription error:", error);
    if (emitRenderer && state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send(
        "transcription-error",
        "Failed to transcribe audio"
      );
    }
  }
}

helpers.limparTranscricao = async function(texto) {
  return texto
    .replace(
      /\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g,
      ""
    )
    .trim();
}

helpers._computeRMS = function(buf) {
  if (!buf || buf.length < 2) return 0;
  let sumSq = 0, count = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const s = buf.readInt16LE(i);
    sumSq += s * s; count++;
  }
  if (!count) return 0;
  return Math.sqrt(sumSq / count);
}

helpers._buildWavFile = function(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize = pcm.length;
  const fileSize = 36 + dataSize;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(fileSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm], 44 + dataSize);
}
