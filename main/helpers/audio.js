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
  execPromise, appConfig, Notification
} = require('../globals.js');

// Press-to-talk UNIVERSAL (Linux/Windows/macOS): Ctrl+D grava, Ctrl+D de novo
// transcreve. O PCM vem do bridge nativo (getUserMedia via Chromium) — o mesmo
// que alimenta os motores de VAD. Sem parec/pw-record/ffmpeg, sem Vosk.
helpers.startDictation = async function() {
  const nativeAudio = require('../../services/platform/nativeAudio');
  const micDevice = (configService && typeof configService.getMicDevice === 'function')
    ? configService.getMicDevice()
    : '';
  state.dictationChunks = [];
  state.dictationBytes = 0;
  state.dictationMicCb = (buf) => { state.dictationChunks.push(buf); state.dictationBytes += buf.length; };
  await nativeAudio.subscribe('mic', state.dictationMicCb, { deviceId: micDevice });
  state.dictationActive = true;
  state.isRecording = true;

  if (configService.getOsIntegrationStatus()) {
    helpers.destroyNotificationWindow();
    helpers.createOsNotificationWindow('recording', '');
  } else {
    try { state.mainWindow.webContents.send('toggle-recording', { isRecording: true, audioFilePath: null, isIdeMode: true }); } catch (_) {}
  }
}

// Solta o microfone e devolve o PCM acumulado. Usado no cancelamento (X do
// overlay) e como primeira etapa do stop normal.
helpers.releaseDictationMic = function() {
  const nativeAudio = require('../../services/platform/nativeAudio');
  try { if (state.dictationMicCb) nativeAudio.unsubscribe('mic', state.dictationMicCb); } catch (_) {}
  state.dictationMicCb = null;
  state.dictationActive = false;
  state.isRecording = false;
  const pcm = Buffer.concat(state.dictationChunks, state.dictationBytes);
  state.dictationChunks = [];
  state.dictationBytes = 0;
  return pcm;
}

helpers.cancelDictation = function() {
  if (!state.dictationActive && !state.isRecording) return false;
  helpers.releaseDictationMic();
  state.recordingBusy = false;
  if (configService.getOsIntegrationStatus()) {
    helpers.destroyNotificationWindow();
  } else if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    try {
      state.mainWindow.webContents.send('toggle-recording', { isRecording: false, isTranscribing: false, audioFilePath: null, isIdeMode: true, cancelled: true });
      state.mainWindow.webContents.send('ide-audio-transcribing', { isTranscribing: false });
    } catch (_) {}
  }
  return true;
}

// Transcricao do press-to-talk: Whisper LOCAL na edicao Full (quando o binario
// existe de fato), OpenAI na Lite ou quando o Whisper local nao esta disponivel.
helpers.transcribeDictation = async function(wavPath) {
  const whisperBin = path.join(
    ROOT_DIR, 'whisper', 'build', 'bin',
    process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
  );
  if (!edition.isLite() && fs2.existsSync(whisperBin)) {
    return await helpers.transcribeAudio(wavPath, { emitRenderer: false, emitNotifications: false });
  }
  const token = configService.getOpenIaToken();
  if (!token) throw new Error('Configure a chave da OpenAI (Configuracoes) para transcrever o audio.');
  return await cloudTranscribeAudio(wavPath, token);
}

helpers.stopDictationAndTranscribe = async function() {
  const isOsIntegration = configService.getOsIntegrationStatus();
  const pcm = helpers.releaseDictationMic();

  if (!isOsIntegration) {
    try {
      state.mainWindow.webContents.send('toggle-recording', { isRecording: false, isTranscribing: true, audioFilePath: null, isIdeMode: true });
      state.mainWindow.webContents.send('ide-audio-transcribing', { isTranscribing: true });
    } catch (_) {}
  }

  const rms = helpers._computeRMS(pcm);
  if (!pcm || pcm.length < 4800 || rms < 40) { // < ~0.15s de áudio ou silêncio/microfone mudo
    if (isOsIntegration) {
      helpers.destroyNotificationWindow();
      helpers.createOsNotificationWindow('response', 'Nenhum áudio detectado no microfone.');
    } else {
      try {
        state.mainWindow.webContents.send('ide-audio-transcribing', { isTranscribing: false });
        state.mainWindow.webContents.send('transcription-error', 'Nenhum áudio detectado (verifique o microfone ou fale mais alto).');
      } catch (_) {}
    }
    return;
  }

  if (isOsIntegration) {
    helpers.destroyNotificationWindow();
    helpers.createOsNotificationWindow('loading', 'Processando audio...');
  }

  state.recordingBusy = true;
  let wavPath = null;
  try {
    fs2.mkdirSync(AUDIO_TMP_DIR, { recursive: true });
    wavPath = path.join(AUDIO_TMP_DIR, `dictation_${Date.now()}.wav`);
    fs2.writeFileSync(wavPath, helpers._buildWavFile(pcm, 16000, 1, 16));

    const text = await helpers.transcribeDictation(wavPath);

    if (!text || !text.trim() || text === '[BLANK_AUDIO]') {
      if (isOsIntegration) {
        helpers.createOsNotificationWindow('response', 'Nenhum audio reconhecido.');
      } else {
        state.mainWindow.webContents.send('transcription-error', 'Nenhum audio reconhecido.');
      }
      return;
    }

    if (isOsIntegration) {
      await helpers.processOsQuestion(text);
    } else {
      // Modo IDE da janela principal: Ctrl+D grava e Ctrl+D de novo transcreve para o composer
      state.mainWindow.webContents.send('ide-audio-transcribed', { text: text + ' ' });
    }
  } catch (e) {
    console.error('[dictation] erro:', e.message);
    if (isOsIntegration) {
      helpers.createOsNotificationWindow('response', 'Falha ao transcrever o audio: ' + e.message);
    } else {
      try { state.mainWindow.webContents.send('transcription-error', 'Falha ao transcrever o audio: ' + e.message); } catch (_) {}
    }
  } finally {
    if (wavPath) { try { await fs.unlink(wavPath); } catch (_) {} }
    state.recordingBusy = false;
    if (!isOsIntegration) {
      try { state.mainWindow.webContents.send('ide-audio-transcribing', { isTranscribing: false }); } catch (_) {}
    }
  }
}

helpers.toggleRecording = async function() {
  try {
    // Realtime existe em todas as edicoes: na Lite/ChatGPT e 100% online (OpenAI),
    // na Full com backend/Ollama e o pipeline local (Whisper). pickRealtimeService decide.
    if (configService.getRealtimeAssistantStatus()) {
      await helpers.toggleRealtimeAssistantRecording();
      return;
    }

    // Tradutor e um modo exclusivo, sem input de texto — nunca deve gravar/transcrever
    // via Ctrl+D nem jogar texto no composer (isso e exclusividade do modo IDE).
    if (translationAssistant.isActive()) {
      console.log("Ctrl+D ignorado — Assistente de Traducao ativo (modo exclusivo, sem input de texto).");
      return;
    }

    // Anti-spam: ignora Ctrl+D enquanto ainda estamos transcrevendo/respondendo
    // o audio do toque anterior (senao multiplos toques enviam o mesmo audio).
    if (state.recordingBusy) {
      console.log("Ctrl+D ignorado — ainda processando o audio anterior.");
      return;
    }

    if (state.isRecording) {
      await helpers.stopDictationAndTranscribe();
      return;
    }

    try {
      await helpers.startDictation();
    } catch (e) {
      console.error('[dictation] falha ao iniciar:', e.message);
      state.dictationActive = false;
      state.isRecording = false;
      if (configService.getOsIntegrationStatus()) {
        helpers.createOsNotificationWindow('response', 'Falha ao acessar o microfone: ' + e.message);
      } else {
        try { state.mainWindow.webContents.send('transcription-error', 'Falha ao acessar o microfone: ' + e.message); } catch (_) {}
      }
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
    // Fallback sem ffprobe: para arquivo WAV (s16le 16kHz mono = 32000 bytes/s)
    try {
      if (filePath && fs2.existsSync(filePath)) {
        const stats = fs2.statSync(filePath);
        const duration = Math.max(0, (stats.size - 44) / 32000);
        return duration;
      }
    } catch (_) {}
    return 0;
  }
}

helpers.transcribeAudio = async function(filePath, options = {}) {
  const { emitRenderer = true, emitNotifications = true } = options;

  try {
    // Obter a duração do áudio
    const duration = await helpers.getAudioDuration(filePath);

    const whisperPath = path.join(
      ROOT_DIR, "whisper", "build", "bin",
      process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"
    );
    const modelPathBase = path.join(ROOT_DIR, "whisper/models/ggml-base.bin");
    const modelPathSmall = path.join(ROOT_DIR, "whisper/models/ggml-small.bin");
    const modelPathMedium = path.join(ROOT_DIR, "whisper/models/ggml-medium.bin");
    const modelPathTiny = path.join(ROOT_DIR, "whisper/models/ggml-tiny.bin");

    // Determinar idioma do whisper com base na configuração do app
    const savedLang = configService.getLanguage();
    const whisperLang = savedLang === 'us-en' ? 'en' : 'pt';

    // Escolher modelo disponível
    let modelPath;
    if (duration && duration > 60) {
      modelPath = fs2.existsSync(modelPathSmall) ? modelPathSmall : (fs2.existsSync(modelPathBase) ? modelPathBase : (fs2.existsSync(modelPathTiny) ? modelPathTiny : modelPathMedium));
      console.log(`Usando modelo ${modelPath ? path.basename(modelPath) : 'default'} (áudio longo)`);
    } else {
      // Para áudio curto (press-to-talk), ggml-base é 3x mais rápido na CPU e não atrasa a resposta
      modelPath = fs2.existsSync(modelPathBase) ? modelPathBase : (fs2.existsSync(modelPathSmall) ? modelPathSmall : (fs2.existsSync(modelPathTiny) ? modelPathTiny : modelPathMedium));
      console.log(`Usando modelo ${modelPath ? path.basename(modelPath) : 'default'}`);
    }

    const token = configService.getOpenIaToken();
    if (!fs2.existsSync(whisperPath) || !modelPath || !fs2.existsSync(modelPath)) {
      if (token && typeof cloudTranscribeAudio === 'function') {
        console.log('[transcribeAudio] Whisper local indisponível — usando transcrição na nuvem (OpenAI)');
        const cloudText = await cloudTranscribeAudio(filePath, token);
        const cleanText = await helpers.limparTranscricao(cloudText || '');
        if (emitRenderer && state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send("transcription-result", { cleanText });
        }
        return cleanText;
      }
      throw new Error("Nenhum modelo Whisper encontrado em whisper/models/ e token OpenAI não configurado");
    }

    const threads = Math.min(8, (os.cpus() && os.cpus().length) || 4);
    const command = `"${whisperPath}" -m "${modelPath}" -f "${filePath}" -l ${whisperLang} -np --threads ${threads} --no-timestamps --temperature 0.0 --no-fallback`;

    console.log("Executing whisper:", command);
    return new Promise((resolve, reject) => {
      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error("Whisper error:", stderr);
          if (token && typeof cloudTranscribeAudio === 'function') {
            try {
              console.log('[transcribeAudio] Whisper local falhou — fallback para transcrição na nuvem (OpenAI)');
              const cloudText = await cloudTranscribeAudio(filePath, token);
              const cleanText = await helpers.limparTranscricao(cloudText || '');
              if (emitRenderer && state.mainWindow && !state.mainWindow.isDestroyed()) {
                state.mainWindow.webContents.send("transcription-result", { cleanText });
              }
              return resolve(cleanText);
            } catch (cloudErr) {
              console.error('[transcribeAudio] Fallback na nuvem também falhou:', cloudErr.message);
            }
          }
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
  if (!texto || typeof texto !== 'string') return '';
  let clean = texto
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
    .trim();

  // Remove marcas de áudio/subtítulo entre colchetes [...], chaves {...} ou parênteses (...)
  // Ex: [música], [música de fundo], (música instrumental), [risos], (aplausos), [silêncio], [ruído], etc.
  clean = clean.replace(/\[[^\]]*\]/g, ' ').replace(/\([^\)]*\)/g, ' ').replace(/\{[^\}]*\}/g, ' ');

  // Normaliza múltiplos espaços
  clean = clean.replace(/\s+/g, ' ').trim();

  // Alucinações típicas de silêncio e ruído do Whisper em português, inglês e espanhol
  const hallucinationPatterns = [
    /^(?:m[úu]sica(?:\s+de\s+fundo|\s+instrumental|\s+ambiente|\s+suave|\s+ao\s+fundo|\s+relaxante|\s+tema|\s+animada|\s+alegre|\s+triste|\s+cl[áa]ssica|\s+eletr[ôo]nica|\s+dram[áa]tica)?[\s.,!?:;]*)+$/i,
    /^(?:som\s+ambiente|ru[íi]do(?:\s+de\s+fundo)?|barulho(?:\s+de\s+fundo)?|sil[êe]ncio|aplausos|risos|palmas|vozes(?:\s+ao\s+fundo)?|tosse|suspiro)[\s.,!?:;]*$/i,
    /^(?:legendas(?:\s+pela\s+comunidade\s+amara\.org|\s+por\s+amara\.org)?|subtitles\s+by(?:\s+the\s+amara\.org\s+community)?|subt[íi]tulos\s+por)[\s.,!?:;]*$/i,
    /^(?:obrigad[oa]\s+por\s+assistir|inscreva-se\s+no\s+canal|curta\s+e\s+compartilhe|deixe\s+seu\s+like|ative\s+o\s+sininho|at[ée]\s+a\s+pr[óo]xima|at[ée]\s+o\s+pr[óo]ximo\s+v[íi]deo)[\s.,!?:;]*$/i,
    /^(?:transmiss[ãa]o(?:\s+encerrada)?|todos\s+os\s+direitos\s+reservados|copyright)[\s.,!?:;]*$/i,
    /^(?:thank\s+you\s+for\s+watching|please\s+subscribe|thanks\s+for\s+watching|like\s+and\s+subscribe)[\s.,!?:;]*$/i,
    /^(?:[.\-_*~=+\s,!?:;·…]+)$/
  ];

  for (const pattern of hallucinationPatterns) {
    if (pattern.test(clean)) return '';
  }

  if (/^(?:m[úu]sica[s]?[\s.,!?;:]*)+$/i.test(clean)) return '';

  return clean;
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
