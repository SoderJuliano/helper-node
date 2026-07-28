// main/helpers/voskStream.js
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
  execPromise
} = require('../globals.js');

helpers.handleOsLiveVoskEvent = function(event) {
  if (!event) return;
  if (event.type === 'ready' || event.type === 'stopped') return;
  if (event.type === 'error') {
    console.warn('[os-live] vosk error:', event.message);
    return;
  }
  if (event.type === 'audio') return helpers._onOsLiveAudioChunk(event.data);

  if (event.type === 'partial') {
    const seg = helpers._ensureOsLiveSegment();
    seg.partial = event.text || '';
    helpers._renderOsLiveTurn(seg);
    return;
  }
  if (event.type === 'result') {
    const txt = (event.text || '').trim();
    if (!txt) return;
    const seg = helpers._ensureOsLiveSegment();
    seg.voskBuffer.push(txt);
    seg.partial = '';
    seg.hasSpeech = true;
    helpers._renderOsLiveTurn(seg);
  }
}

helpers._ensureOsLiveSegment = function() {
  if (state.osLiveSegment && !state.osLiveSegment.closing) return state.osLiveSegment;
  state.osLiveTurnCount += 1;
  const seg = {
    id: 'osseg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    turnNumber: state.osLiveTurnCount,
    voskBuffer: [],
    partial: '',
    pcmChunks: [],
    pcmBytes: 0,
    startedAt: Date.now(),
    lastLoudAt: Date.now(),
    hasSpeech: false,
    closing: false,
    voskText: '',
    whisperText: null,
    responseVosk: null,
    responseWhisper: null,
  };
  state.osLiveSegment = seg;
  // Cria bolha nova no overlay
  if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    state.osNotificationWindow.webContents.executeJavaScript(
      `window.startTurn && window.startTurn(${JSON.stringify(seg.id)}, ${seg.turnNumber})`
    ).catch(() => {});
  }
  return seg;
}

helpers._onOsLiveAudioChunk = function(chunk) {
  if (!chunk) return;
  const seg = helpers._ensureOsLiveSegment();
  seg.pcmChunks.push(chunk);
  seg.pcmBytes += chunk.length;
  if (helpers._computeRMS(chunk) > OS_LIVE_SILENCE_RMS) seg.lastLoudAt = Date.now();
}

helpers._segmentTextOsLive = function(seg) {
  const finalized = seg.voskBuffer.join(' ').trim();
  const partial = (seg.partial || '').trim();
  return [finalized, partial].filter(Boolean).join(' ');
}

helpers._renderOsLiveTurn = function(seg) {
  if (!state.osNotificationWindow || state.osNotificationWindow.isDestroyed()) return;
  const text = helpers._segmentTextOsLive(seg);
  state.osNotificationWindow.webContents.executeJavaScript(
    `window.updateTurn && window.updateTurn(${JSON.stringify(seg.id)}, ${JSON.stringify(text)})`
  ).catch(() => {});
}

helpers.checkOsLiveSegmentLimits = function() {
  const seg = state.osLiveSegment;
  if (!seg || seg.closing || !seg.hasSpeech) return;
  const now = Date.now();
  if (now - seg.startedAt >= OS_LIVE_MAX_MS) {
    console.log(`[os-live] ${seg.id}: max duracao -> fechar`);
    return void helpers.closeOsLiveSegment().catch(console.error);
  }
  if (now - seg.lastLoudAt >= OS_LIVE_SILENCE_MS) {
    console.log(`[os-live] ${seg.id}: silencio -> fechar`);
    helpers.closeOsLiveSegment().catch(console.error);
  }
}

helpers.closeOsLiveSegment = async function() {
  const seg = state.osLiveSegment;
  if (!seg || seg.closing) return;
  seg.closing = true;
  state.osLiveSegment = null;

  seg.voskText = helpers._segmentTextOsLive(seg);
  if (!seg.voskText || !seg.hasSpeech) return;

  // Salva WAV pra Whisper rodar em paralelo
  const pcm = Buffer.concat(seg.pcmChunks, seg.pcmBytes);
  seg.pcmChunks = [];
  const wavPath = path.join(OS_LIVE_TMP_DIR, seg.id + '.wav');
  try {
    fs2.mkdirSync(OS_LIVE_TMP_DIR, { recursive: true });
    fs2.writeFileSync(wavPath, helpers._buildWavFile(pcm, OS_LIVE_SAMPLE_RATE, 1, 16));
  } catch (e) { console.error('[os-live] WAV write failed:', e.message); }

  // Continuacao de fala: se o segmento anterior fechou ha pouco tempo (pausa pra
  // respirar, nao fim de pergunta), junta os textos e reprocessa a pergunta INTEIRA.
  const prevClosed = state.osLiveLastClosed;
  const isContinuation = !!(prevClosed && (Date.now() - prevClosed.closedAt) <= OS_LIVE_CONTINUATION_WINDOW_MS);
  const askVoskText = isContinuation ? `${prevClosed.text} ${seg.voskText}`.trim() : seg.voskText;

  // Marca bolha como "processando" — mostra a pergunta completa se for continuacao.
  if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    state.osNotificationWindow.webContents.executeJavaScript(
      `window.markTurnFinal && window.markTurnFinal(${JSON.stringify(seg.id)}, ${JSON.stringify(askVoskText)})`
    ).catch(() => {});
  }

  // Marca a resposta do turno anterior como superada — a pergunta continuava.
  if (isContinuation && state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    state.osNotificationWindow.webContents.executeJavaScript(
      `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(prevClosed.id)}, ${JSON.stringify('↳ pergunta continuou no trecho seguinte — veja a resposta completa abaixo.')}, true)`
    ).catch(() => {});
  }

  state.osLiveLastClosed = { id: seg.id, text: askVoskText, closedAt: Date.now() };

  // 1) Pergunta IA com texto Vosk (rapido, ja mesclado se continuacao)
  try {
    const resp = await helpers._askOsLiveAI(askVoskText, null);
    seg.responseVosk = resp;
    if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
      state.osNotificationWindow.webContents.executeJavaScript(
        `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(seg.id)}, ${JSON.stringify(resp)}, false)`
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[os-live] AI vosk error:', err.message);
    if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
      state.osNotificationWindow.webContents.executeJavaScript(
        `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(seg.id)}, ${JSON.stringify('Erro: ' + err.message)}, false)`
      ).catch(() => {});
    }
  }

  // 2) Whisper async pra corrigir e re-perguntar se diferir
  if (fs2.existsSync(wavPath)) {
    helpers._runOsLiveWhisper(seg, wavPath).catch(e => console.error('[os-live] whisper:', e.message));
  }
}

helpers._runOsLiveWhisper = async function(seg, wavPath) {
  const whisperBin = path.join(ROOT_DIR, 'whisper', 'build', 'bin', 'whisper-cli');
  const modelMed = path.join(ROOT_DIR, 'whisper', 'models', 'ggml-medium.bin');
  const modelSm = path.join(ROOT_DIR, 'whisper', 'models', 'ggml-small.bin');
  const model = fs2.existsSync(modelMed) ? modelMed : (fs2.existsSync(modelSm) ? modelSm : null);
  if (!fs2.existsSync(whisperBin) || !model) {
    try { fs2.unlinkSync(wavPath); } catch (_) {}
    return;
  }
  const lang = (configService.getLanguage && configService.getLanguage()) === 'us-en' ? 'en' : 'pt';
  const cmd = `"${whisperBin}" -m "${model}" -f "${wavPath}" -l ${lang} --threads 8 --no-timestamps --best-of 3 --beam-size 3`;
  console.log('[os-live] whisper rodando para', seg.id);

  let text = '';
  try {
    const { stdout } = await execPromise(cmd, { maxBuffer: 10 * 1024 * 1024 });
    text = (stdout || '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    console.error('[os-live] whisper exec error:', e.message);
    try { fs2.unlinkSync(wavPath); } catch (_) {}
    return;
  }
  try { fs2.unlinkSync(wavPath); } catch (_) {}

  if (!text || text === seg.voskText) return;
  if (helpers._textsAreEquivalent(text, seg.voskText)) return;
  console.log(`[os-live] whisper corrigiu ${seg.id}: "${seg.voskText}" -> "${text}"`);
  seg.whisperText = text;

  // Atualiza a bolha do user com texto corrigido
  if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    state.osNotificationWindow.webContents.executeJavaScript(
      `window.replaceTurnText && window.replaceTurnText(${JSON.stringify(seg.id)}, ${JSON.stringify(text)})`
    ).catch(() => {});
  }

  // Re-pergunta IA com versao corrigida
  try {
    const resp = await helpers._askOsLiveAI(text, seg.responseVosk);
    seg.responseWhisper = resp;
    if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
      state.osNotificationWindow.webContents.executeJavaScript(
        `window.showTurnResponse && window.showTurnResponse(${JSON.stringify(seg.id)}, ${JSON.stringify(resp)}, true)`
      ).catch(() => {});
    }
  } catch (err) {
    console.error('[os-live] AI whisper error:', err.message);
  }
}

helpers._askOsLiveAI = async function(transcript, previousResponse) {
  const token = configService.getOpenIaToken();
  if (!token) throw new Error('Token da OpenAI nao configurado.');
  const model = configService.getOpenAiModel();
  const instruction = configService.getPromptInstruction();

  const userPrompt = previousResponse
    ? `TRANSCRIÇÃO CORRIGIDA (Whisper, mais precisa) de um trecho que ja foi enviado em versao menos precisa (Vosk):\n\n"${transcript}"\n\nResposta anterior (com base na versao imprecisa): "${previousResponse}"\n\nRefaca sua ajuda com base APENAS na versao corrigida.`
    : `TRANSCRIÇÃO ao vivo (modelo Vosk, pode conter erros) do audio captado:\n\n"${transcript}"\n\nResponda conforme as regras do system prompt. Se for incompreensivel ou sem conteudo, responda APENAS '(trecho sem conteudo relevante)'.`;

  // Tool calling fica desligado aqui (latencia). Stateless tambem — cada
  // turno e' independente pra IA conseguir tratar contexto via prompt.
  return await OpenAIService.makeOpenAIRequest(
    userPrompt,
    token,
    instruction,
    model,
    null,
    { stateless: true }
  );
}

helpers._textsAreEquivalent = function(a, b) {
  const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return norm(a) === norm(b);
}
