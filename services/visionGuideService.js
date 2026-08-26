// services/visionGuideService.js
// Assistente Guiado por Visão (RAG + Vision) — tutor em tempo real.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const configService = require('./configService');
const knowledgeBase = require('./knowledgeBase');
const historyService = require('./historyService');
const { captureFullScreenToFile } = require('./platform/screenCapture');
const { maxTokensParam } = require('./openAiRealtimeModels');

const {
  NOOP,
  lesson,
  resetLesson,
  isFiller,
  buildTutorSystemPrompt,
} = require('./visionGuide/visionPromptBuilder.js');

const {
  fetchWithTimeout,
  withTimeout,
  optimizeToJpegBase64,
  visionDetailFor,
  isSimilarToRecentGuidance,
  containsDuplicateCodeBlock,
  isSimilarToLastTip,
  getIdeAutocomplete,
} = require('./visionGuide/visionApiClient.js');

const {
  getAudioMarker,
  recentAudio,
  startAudio,
  stopAudio,
} = require('./visionGuide/visionAudioCapture.js');

let running = false;
let paused = false;
let lastErrorEmit = 0;
let pendingQuestion = null;
let forceAnalyze = false;
let pendingHelp = false;

let historySessionId = null;
let pauseCb = null;
let needsIntroduction = false;
let cfg = {};
let captureTimer = null;
let inFlight = false;
let lastFrameHash = null;
let lastFrameBase64 = null;
let lastInterventionAt = 0;
const recentGuidance = [];
let lastAudioMarkerSeen = 0;
let lastAudioTimestampProcessed = 0;
let visionBackoffUntil = 0;
let lastVisionDiag = '';

let guidanceCb = null;
let statusCb = null;
let contextProvider = null;

const tmpShot = path.join(os.tmpdir(), 'helper-vision-guide.png');

function onGuidance(cb) { guidanceCb = cb; }
function onStatus(cb) { statusCb = cb; }
function onPauseChange(cb) { pauseCb = cb; }
function setContextProvider(fn) { contextProvider = fn; }
function isActive() { return running; }
function isPaused() { return paused; }

function emitStatus(s) { try { if (statusCb) statusCb(s); } catch (_) {} }

async function logToHistory(role, content) {
  if (!historySessionId || !content || !content.trim()) return;
  try {
    historySessionId = await historyService.addMessage(historySessionId, role, content.trim());
  } catch (e) {
    console.warn('[vision-guide] falha ao registrar no histórico:', e.message);
  }
}

async function askTutor(base64Image, editorState, options = {}) {
  const userSpeech = options.userSpeech || '';
  const hasUserSpeech = !!userSpeech.trim();
  const phase = options.phase || (options.isIntro ? 'intro' : 'guide');

  const apiKey = cfg.apiKey;
  const model = configService.getOpenAiVisionModel();
  const detail = visionDetailFor(model);

  let userCtx = '';
  try { userCtx = configService.getUserContextBlock ? configService.getUserContextBlock() : ''; } catch (_) {}

  let editorMeta = '';
  try {
    if (contextProvider) {
      const ctx = contextProvider();
      editorMeta = (typeof ctx === 'object') ? ctx.text : (ctx || '').toString();
    }
  } catch (_) {}

  let ragBlock = '';
  if (cfg.useKnowledgeBase) {
    const q = recentAudio.map((a) => a.text).join(' ').slice(0, 400);
    if (q.trim()) {
      try { ragBlock = await knowledgeBase.augment(q, { token: apiKey, topK: 3 }); } catch (_) {}
    }
  }

  const systemPrompt = buildTutorSystemPrompt(options, {
    userCtx,
    editorMeta,
    ragBlock,
    recentAudio,
    recentGuidance,
  });

  const userContent = [];
  if (editorState) {
    const textContext = `[ARQUIVO: ${editorState.path}]\n<cursor_position>${editorState.cursorIndex}</cursor_position>\n<content>\n${editorState.content}\n</content>`;
    userContent.push({ type: 'text', text: textContext });
  } else {
    if (lastFrameBase64) {
      userContent.push(
        { type: 'text', text: 'Print anterior (referência — não comente sobre ele sozinho):' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${lastFrameBase64}`, detail: 'low' } },
        { type: 'text', text: 'Print ATUAL (é sobre este que você deve se pronunciar):' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail } }
      );
    } else {
      userContent.push(
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail } }
      );
    }
  }

  if (hasUserSpeech) {
    userContent.push({
      type: 'text',
      text: `O usuário disse no microfone: "${userSpeech}"\n\nResponda diretamente a essa fala do usuário com base no print da tela ou conteúdo do editor. NÃO responda com [AGUARDAR].`
    });
  } else if (phase === 'help') {
    userContent.push({
      type: 'text',
      text: `O usuário apertou AJUDA: "me ajuda, fiquei perdido/travado". Analise a tela ATUAL, compare com o print anterior e suas dicas, dê a análise curtíssima (1-2 linhas) e entregue o EXEMPLO COMPLETO do arquivo da etapa atual. Se a tela mostrar um erro/bug, resolva-o primeiro sem quebrar o que já funciona. NÃO responda com [AGUARDAR].`
    });
  } else {
    userContent.push({
      type: 'text',
      text: `Print da tela ou conteúdo do editor agora. Compare com o print anterior (se houver): se o arquivo está PROGREDINDO (código mudando/avançando), ele está trabalhando normalmente — NÃO comente sintaxe/linha isolada, responda ${NOOP}. Intervenha SÓ se for estratégico no nível do ARQUIVO/ETAPA (ele vai começar um arquivo do plano e precisa do exemplo, está travado no MESMO arquivo há vários prints seguidos, um arquivo inteiro está quebrado, ou pergunta pra responder). Senão responda exatamente ${NOOP}.`
    });
  }

  const tokenBudget = (phase === 'help' || phase === 'plan') ? 4000 : 1500;

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      ...maxTokensParam(model, tokenBudget),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  }, 120000);

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI vision error');

  const choice = data.choices?.[0];
  const content = (choice?.message?.content || '').trim();
  if (!content) {
    const finishReason = choice?.finish_reason || 'sem finish_reason';
    const refusal = choice?.message?.refusal;
    const u = data.usage || {};
    lastVisionDiag = `modelo=${model} · fase=${phase} · finish_reason=${finishReason} · orçamento=${tokenBudget} · tokens(prompt/compl/total)=${u.prompt_tokens || '?'}/${u.completion_tokens || '?'}/${u.total_tokens || '?'}${refusal ? ` · REFUSAL="${refusal}"` : ''}`;
    console.warn(`[vision-guide] resposta vazia → ${lastVisionDiag}`);
  } else {
    lastVisionDiag = '';
  }
  return content;
}

async function tick() {
  if (!running || paused || inFlight) return;
  if (Date.now() < visionBackoffUntil) return;

  const isIntro = needsIntroduction;
  const deliverPlan = !isIntro && lesson.isTask && lesson.planAnnounced && !lesson.planDelivered;
  const doForceHelp = forceAnalyze; forceAnalyze = false;
  const doHelp = pendingHelp; pendingHelp = false;
  const forced = isIntro || deliverPlan || doForceHelp || doHelp;
  const phase = isIntro ? 'intro' : (deliverPlan ? 'plan' : (doHelp ? 'help' : 'guide'));

  let base64, hash, editorState;

  try {
    if (contextProvider) {
      const ctx = contextProvider();
      if (typeof ctx === 'object' && ctx.editorState) {
        editorState = ctx.editorState;
      }
    }
  } catch (_) {}

  try {
    if (editorState) {
      hash = crypto.createHash('md5').update(editorState.content).digest('hex');
      base64 = null;
    } else {
      await withTimeout(captureFullScreenToFile(tmpShot), 15000, 'captura de tela');
      const buf = fs.readFileSync(tmpShot);
      hash = crypto.createHash('md5').update(buf).digest('hex');
      base64 = optimizeToJpegBase64(tmpShot);
    }
  } catch (e) {
    console.warn('[vision-guide] captura falhou:', e.message);
    return;
  }

  const audioMarker = getAudioMarker();
  const newAudio = audioMarker !== lastAudioMarkerSeen;
  const frameChanged = hash !== lastFrameHash;
  const withinCooldown = (Date.now() - lastInterventionAt) < cfg.minInterventionMs;

  const newMicUtterances = recentAudio.filter(a => a.ts > lastAudioTimestampProcessed && a.source === 'você');
  const filteredMicUtterances = newMicUtterances.filter(a => !isSimilarToRecentGuidance(a.text, recentGuidance) && !isFiller(a.text));

  let userSpeech = filteredMicUtterances.map(a => a.text).join(' ');
  let hasNewMicSpeech = filteredMicUtterances.length > 0;
  let isDirectQuestion = false;

  if (pendingQuestion) {
    userSpeech = pendingQuestion;
    hasNewMicSpeech = true;
    isDirectQuestion = true;
    pendingQuestion = null;
  }
  if (doHelp) { userSpeech = ''; hasNewMicSpeech = false; }

  if (!forced) {
    if (!frameChanged && !newAudio && !hasNewMicSpeech) return;
    if (withinCooldown && !hasNewMicSpeech) { lastFrameHash = hash; lastFrameBase64 = base64; return; }
  }

  if (recentAudio.length > 0) {
    lastAudioTimestampProcessed = Math.max(...recentAudio.map(a => a.ts));
  }

  inFlight = true;
  emitStatus('thinking');
  try {
    const answer = await askTutor(base64, editorState, { isIntro, userSpeech, phase, forceHelp: doForceHelp });
    lastFrameHash = hash;
    lastFrameBase64 = base64;
    lastAudioMarkerSeen = audioMarker;

    const answerIsNoop = !answer || answer === NOOP || answer.replace(/[\[\]]/g, '').trim().toUpperCase() === 'AGUARDAR';
    const requiresResponse = forced || isDirectQuestion;

    const isDuplicate = !requiresResponse && (
      containsDuplicateCodeBlock(answer, recentGuidance) ||
      (recentGuidance.length > 0 && isSimilarToLastTip(answer, recentGuidance[recentGuidance.length - 1]))
    );

    if (isDuplicate) {
      emitStatus('watching');
      return;
    }

    if (requiresResponse && (!(answer && answer.trim()) || answerIsNoop)) {
      if (guidanceCb) {
        lastErrorEmit = Date.now();
        const diag = lastVisionDiag ? `\n[diag: ${lastVisionDiag}]` : '';
        const warnText = `⚠️ O tutor não conseguiu formular uma resposta agora (resposta vazia do modelo de visão).${diag}`;
        guidanceCb({ text: warnText, ts: Date.now() });
        await logToHistory('assistant', warnText);
      }
      emitStatus('watching');
      return;
    }

    if (!requiresResponse && (!(answer && answer.trim()) || answerIsNoop)) {
      emitStatus('watching');
      return;
    }

    if (!forced && withinCooldown && !hasNewMicSpeech) { emitStatus('watching'); return; }

    let outText = answer;
    if (phase === 'intro') {
      needsIntroduction = false;
      if (!hasNewMicSpeech) {
        lesson.isTask = /\[\[\s*TASK\s*\]\]/i.test(answer);
        if (lesson.isTask) lesson.planAnnounced = true;
        outText = answer.replace(/\[\[\s*(TASK|CASUAL)\s*\]\]/ig, '').trim();
      }
    } else if (phase === 'guide' && !lesson.isTask) {
      const hasNewTask = /\[\[\s*TASK\s*\]\]/i.test(answer);
      if (hasNewTask) {
        lesson.isTask = true;
        lesson.planAnnounced = true;
        lesson.planDelivered = false;
        outText = answer.replace(/\[\[\s*TASK\s*\]\]/ig, '').trim();
      }
    } else if (phase === 'plan' && !hasNewMicSpeech) {
      lesson.planDelivered = true;
      lesson.plan = outText.slice(0, 800);
    }

    lastInterventionAt = Date.now();
    recentGuidance.push(outText);
    if (recentGuidance.length > 6) recentGuidance.shift();

    if (guidanceCb) guidanceCb({ text: outText, ts: Date.now() });

    if (userSpeech && userSpeech.trim()) await logToHistory('user', userSpeech);
    await logToHistory('assistant', outText);

    emitStatus('watching');
  } catch (e) {
    const msg = e && e.message || '';
    console.warn('[vision-guide] tutor falhou:', msg);
    const isRate = /rate limit|429|tokens per min|TPM/i.test(msg);
    if (isRate) {
      visionBackoffUntil = Date.now() + 20000;
      console.warn('[vision-guide] rate limit → pausando chamadas por 20s.');
    }
    if (guidanceCb && Date.now() - lastErrorEmit > 60000) {
      lastErrorEmit = Date.now();
      const reason = /abort/i.test(msg)
        ? 'a análise passou do tempo limite (o modelo de visão pode estar lento — tente um modelo de visão mais rápido nas Configurações)'
        : isRate ? 'limite de uso da API da OpenAI' : (msg || 'erro desconhecido');
      const errText = `⚠️ Não consegui analisar a tela agora: ${reason}. Sigo tentando.`;
      guidanceCb({ text: errText, ts: Date.now() });
      try { await logToHistory('assistant', errText); } catch (_) {}
    }
    emitStatus('error');
  } finally {
    inFlight = false;
  }
}

async function start(options = {}) {
  if (running) return;
  const vg = configService.getVisionGuideConfig();
  cfg = {
    apiKey: options.apiKey,
    intervalMs: Math.max(2000, (options.intervalSeconds || vg.intervalSeconds || 5) * 1000),
    minInterventionMs: Math.max(0, (options.minInterventionSeconds ?? vg.minInterventionSeconds ?? 0) * 1000),
    listenAudio: options.listenAudio !== undefined ? options.listenAudio : vg.listenAudio,
    useKnowledgeBase: options.useKnowledgeBase !== undefined ? options.useKnowledgeBase : vg.useKnowledgeBase,
  };
  if (!cfg.apiKey) throw new Error('API key OpenAI não configurada');

  running = true;
  paused = false;
  pendingQuestion = null;
  forceAnalyze = false;
  pendingHelp = false;

  needsIntroduction = true;
  lastFrameHash = null;
  lastFrameBase64 = null;
  lastInterventionAt = 0;
  lastAudioMarkerSeen = 0;
  lastAudioTimestampProcessed = Date.now();
  recentGuidance.length = 0;
  recentAudio.length = 0;
  resetLesson();

  historySessionId = null;
  try {
    const now = new Date();
    const title = `👁 Tutor — ${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const session = await historyService.createNewSession(title);
    historySessionId = session.id;
  } catch (e) {
    console.warn('[vision-guide] não consegui criar sessão de histórico:', e.message);
  }

  console.log(`[vision-guide] iniciando (intervalo=${cfg.intervalMs}ms, áudio=${cfg.listenAudio}, RAG=${cfg.useKnowledgeBase})`);
  emitStatus('watching');

  if (cfg.listenAudio) {
    try { await startAudio(cfg.apiKey); } catch (e) { console.warn('[vision-guide] startAudio falhou:', e.message); }
  }

  setTimeout(() => {
    if (running && needsIntroduction) {
      tick();
      if (running && !captureTimer) {
        captureTimer = setInterval(tick, cfg.intervalMs);
      }
    }
  }, 5000);
}

async function stop() {
  running = false;
  paused = false;
  pendingQuestion = null;
  forceAnalyze = false;
  pendingHelp = false;
  historySessionId = null;
  needsIntroduction = false;
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  stopAudio();
  emitStatus('idle');
  console.log('[vision-guide] parado.');
}

async function pause() {
  if (!running || paused) return;
  paused = true;
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  stopAudio();
  emitStatus('idle');
  if (pauseCb) { try { pauseCb(true); } catch (_) {} }
  console.log('[vision-guide] pausado.');
}

async function resume() {
  if (!running || !paused) return;
  paused = false;

  if (pauseCb) { try { pauseCb(false); } catch (_) {} }
  emitStatus('watching');
  if (cfg.listenAudio) {
    try { await startAudio(cfg.apiKey); } catch (e) { console.warn('[vision-guide] startAudio (resume) falhou:', e.message); }
  }
  lastAudioTimestampProcessed = Date.now();
  if (!captureTimer) captureTimer = setInterval(tick, cfg.intervalMs);
  console.log('[vision-guide] retomado.');
}

function askQuestion(text) {
  const t = (text || '').trim();
  if (!running || paused || !t) return;
  pendingQuestion = t;
  if (!inFlight) tick();
}

function analyzeNow() {
  if (!running || paused) return;
  forceAnalyze = true;
  if (!inFlight) tick();
}

function askHelp() {
  if (!running || paused) return;
  pendingHelp = true;
  if (!inFlight) tick();
}

function triggerIntroduction() {
  if (running) {
    needsIntroduction = true;
    if (!inFlight) {
      tick();
    }
  }
}

module.exports = {
  start,
  stop,
  pause,
  resume,
  isPaused,
  isActive,
  askQuestion,
  analyzeNow,
  askHelp,
  onGuidance,
  onStatus,
  onPauseChange,
  setContextProvider,
  getIdeAutocomplete,
  triggerIntroduction,
};
