// services/visionGuideService.js
//
// Assistente Guiado por Visão (RAG + Vision) — tutor em tempo real.
//
// CONCEITO: observa a tela do dev por PRINTS PERIÓDICOS (não vídeo — economia de
// token), opcionalmente ouve mic + áudio do sistema, ACUMULA contexto entre
// frames e só intervém em PONTOS ESTRATÉGICOS (não responde a cada print). Guia o
// dev a escrever o código ele mesmo — NUNCA entrega a tarefa inteira pronta.
//
// PLATAFORMA (Windows-first): a captura (tela + áudio) é consumida por trás de uma
// interface. Hoje liga o backend do Windows/macOS:
//   - tela  → screenCapture.captureFullScreenToFile (desktopCapturer, silencioso)
//   - áudio → bridge nativeAudio.js (getUserMedia + loopback WASAPI)
// No Linux essas duas peças serão plugadas no port (grim/parec) — o "cérebro"
// abaixo (acúmulo, intervenção estratégica, RAG, roteamento) roda igual nos dois.
//
// MOTOR DE VISÃO: OpenAI (getOpenAiVisionModel). A config já está pronta pra trocar
// de provider no futuro; por ora OpenAI é o caminho cabeado e estável.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const configService = require('./configService');
const knowledgeBase = require('./knowledgeBase');
const { captureFullScreenToFile } = require('./platform/screenCapture');
const { transcribeAudio } = require('./translationAssistant/openaiClient');
const { maxTokensParam } = require('./openAiRealtimeModels');

// Sentinela que o modelo devolve quando NÃO há nada estratégico a dizer agora.
// Suprimimos essas respostas — é o que evita encher a tela.
const NOOP = '[AGUARDAR]';

let running = false;
let cfg = {};                 // { apiKey, intervalMs, minInterventionMs, listenAudio, useKnowledgeBase }
let captureTimer = null;
let inFlight = false;         // evita chamadas de visão sobrepostas
let lastFrameHash = null;     // pula chamada quando a tela não mudou
let lastInterventionAt = 0;   // cooldown entre intervenções
const recentGuidance = [];    // últimas dicas dadas (pra não repetir)
const recentAudio = [];       // { source, text, ts } — falas recentes (contexto)
let audioMarker = 0;          // muda quando chega fala nova (detecta "novo áudio")
let lastAudioMarkerSeen = 0;

// Callbacks (registrados pelo main).
let guidanceCb = null;
let statusCb = null;
let contextProvider = null;   // () => string  (metadados do editor/modo, opcional)

const tmpShot = path.join(os.tmpdir(), 'helper-vision-guide.png');

function onGuidance(cb) { guidanceCb = cb; }
function onStatus(cb) { statusCb = cb; }
function setContextProvider(fn) { contextProvider = fn; }
function isActive() { return running; }

function emitStatus(s) { try { if (statusCb) statusCb(s); } catch (_) {} }

// ---------------------------------------------------------------------------
// ÁUDIO (Windows/macOS via bridge). Segmentador simples por energia (RMS): junta
// PCM enquanto há fala, fecha o trecho após ~700ms de silêncio, transcreve e
// guarda como contexto. No Linux é no-op por enquanto (port futuro).
// ---------------------------------------------------------------------------
const SAMPLE_RATE = 16000;
const SPEECH_RMS = 600;       // acima disso = fala (int16, max 32768)
const SILENCE_HANGOVER_MS = 700;
const MIN_SEGMENT_MS = 450;
const MAX_SEGMENT_MS = 15000;

let nativeAudio = null;       // require tardio (só fora do Linux)
const audioSubs = [];         // { source, cb } pra dar unsubscribe depois
const segmenters = new Map(); // source -> estado do segmentador

function rmsOf(buf) {
  const n = Math.floor(buf.length / 2);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

function writeWav(pcm, outPath) {
  const byteRate = SAMPLE_RATE * 2;      // mono * 16-bit
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // audio format = PCM
  header.writeUInt16LE(1, 22);           // channels = mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
}

function pushAudio(source, text) {
  const t = (text || '').trim();
  if (t.length < 3) return;
  const label = source === 'mic' ? 'você' : 'sistema';
  recentAudio.push({ source: label, text: t, ts: Date.now() });
  // Mantém só as últimas 8 falas e expira o que tem mais de 90s.
  const cutoff = Date.now() - 90000;
  while (recentAudio.length && (recentAudio.length > 8 || recentAudio[0].ts < cutoff)) {
    recentAudio.shift();
  }
  audioMarker++;
}

function makeSegmenter(source, apiKey) {
  return {
    chunks: [],
    speechMs: 0,
    silenceMs: 0,
    collecting: false,
    feed(buf) {
      const durMs = (buf.length / 2) / SAMPLE_RATE * 1000;
      const rms = rmsOf(buf);
      if (rms > SPEECH_RMS) {
        this.collecting = true;
        this.silenceMs = 0;
        this.speechMs += durMs;
        this.chunks.push(buf);
      } else if (this.collecting) {
        this.silenceMs += durMs;
        this.chunks.push(buf); // segura um pouco do rabo do silêncio
        if (this.silenceMs >= SILENCE_HANGOVER_MS) this.finalize(apiKey, source);
      }
      // Trava de segurança: trecho longo demais fecha na marra.
      const totalMs = this.chunks.reduce((a, b) => a + (b.length / 2) / SAMPLE_RATE * 1000, 0);
      if (this.collecting && totalMs >= MAX_SEGMENT_MS) this.finalize(apiKey, source);
    },
    finalize(key, src) {
      const speechMs = this.speechMs;
      const pcm = Buffer.concat(this.chunks);
      this.chunks = []; this.speechMs = 0; this.silenceMs = 0; this.collecting = false;
      if (speechMs < MIN_SEGMENT_MS || !key) return;
      const wav = path.join(os.tmpdir(), `helper-vg-${src}-${Date.now()}.wav`);
      try {
        writeWav(pcm, wav);
      } catch (_) { return; }
      // Transcreve em background — não trava o segmentador.
      transcribeAudio(wav, key)
        .then((text) => pushAudio(src, text))
        .catch((e) => console.warn('[vision-guide] transcrição falhou:', e.message))
        .finally(() => { try { fs.unlinkSync(wav); } catch (_) {} });
    },
  };
}

async function startAudio(apiKey) {
  if (process.platform === 'linux') {
    console.log('[vision-guide] áudio desligado no Linux (port futuro).');
    return;
  }
  try {
    nativeAudio = require('./platform/nativeAudio');
  } catch (e) {
    console.warn('[vision-guide] bridge de áudio indisponível:', e.message);
    return;
  }
  for (const source of ['mic', 'sys']) {
    segmenters.set(source, makeSegmenter(source, apiKey));
    const cb = (buf) => {
      const seg = segmenters.get(source);
      if (seg) { try { seg.feed(buf); } catch (_) {} }
    };
    audioSubs.push({ source, cb });
    try { await nativeAudio.subscribe(source, cb); } catch (e) {
      console.warn(`[vision-guide] subscribe(${source}) falhou:`, e.message);
    }
  }
}

function stopAudio() {
  if (nativeAudio) {
    for (const { source, cb } of audioSubs) {
      try { nativeAudio.unsubscribe(source, cb); } catch (_) {}
    }
  }
  audioSubs.length = 0;
  segmenters.clear();
  recentAudio.length = 0;
}

// ---------------------------------------------------------------------------
// VISÃO — pergunta ao tutor. Devolve a dica (string) ou NOOP.
// ---------------------------------------------------------------------------
function buildRecentAudioBlock() {
  if (!recentAudio.length) return '';
  const lines = recentAudio.map((a) => `- (${a.source}) ${a.text}`);
  return `[ÁUDIO RECENTE — o que foi falado por perto (mic do usuário / áudio do sistema)]\n${lines.join('\n')}`;
}

function buildRecentGuidanceBlock() {
  if (!recentGuidance.length) return '';
  return `[DICAS QUE VOCÊ JÁ DEU (não repita, não volte a explicar o mesmo)]\n${recentGuidance.slice(-3).map((g) => `- ${g}`).join('\n')}`;
}

async function askTutor(base64Image) {
  const apiKey = cfg.apiKey;
  const model = configService.getOpenAiVisionModel();

  let userCtx = '';
  try { userCtx = configService.getUserContextBlock ? configService.getUserContextBlock() : ''; } catch (_) {}

  let editorMeta = '';
  try { if (contextProvider) editorMeta = (contextProvider() || '').toString(); } catch (_) {}

  // RAG: usa o áudio recente como query (é onde costuma aparecer a dúvida). Sem
  // áudio, não temos texto de query confiável (não fazemos OCR aqui) → pula.
  let ragBlock = '';
  if (cfg.useKnowledgeBase) {
    const q = recentAudio.map((a) => a.text).join(' ').slice(0, 400);
    if (q.trim()) {
      try { ragBlock = await knowledgeBase.augment(q, { token: apiKey, topK: 3 }); } catch (_) {}
    }
  }

  const parts = [
    `Você é um TUTOR de programação em tempo real que observa a tela do desenvolvedor por prints periódicos. Seu papel é GUIAR, nunca resolver por ele.`,
    ``,
    `REGRAS (críticas):`,
    `- NUNCA entregue a tarefa inteira pronta nem escreva o código completo por ele. Dê o PRÓXIMO passo, uma correção pontual, ou o TRECHO MÍNIMO que destrava. O objetivo é o dev ESCREVER, não copiar.`,
    `- Só intervenha em PONTOS ESTRATÉGICOS: erro de sintaxe/lógica visível na tela, o dev claramente travado/parado, um passo importante prestes a ser feito errado, ou uma PERGUNTA dirigida a ele (na tela ou no áudio).`,
    `- Se NÃO há nada estratégico agora (o dev está escrevendo normalmente, sem erro, sem dúvida), responda EXATAMENTE com ${NOOP} e mais nada. NUNCA descreva a tela.`,
    `- Seja CURTO: no máximo 2-3 frases + no máximo 1 bloco de código pequeno.`,
    `- IDIOMA DO CÓDIGO (crítico): mantenha a MESMA linguagem de programação e o MESMO idioma de identificadores/nomes/comentários que o USUÁRIO já está escrevendo na tela — a escolha DELE tem prioridade máxima. Se ele ainda não escreveu nada, siga o idioma do enunciado/problema. Nunca troque a linguagem nem "traduza" os nomes que ele já usou.`,
    `- IDIOMA DA CONVERSA/PERGUNTA (crítico): responda EXATAMENTE no idioma da pergunta/enunciado. Pergunta em inglês → responda em inglês. Pergunta em pt-br → responda em pt-br. Não force pt-br quando o contexto está em inglês.`,
    `- Se houver uma PERGUNTA (na tela ou dita no áudio), diga COMO responder, com um exemplo curto, no idioma dela. Ex.: "Pra essa pergunta, responde algo tipo: ... ; e o erro no código você resolve com \`public void exemplo()\`".`,
    `- Aja com paciência: corrija e oriente, deixe o dev conduzir a tarefa.`,
  ];
  if (userCtx) parts.push('', userCtx);
  if (editorMeta) parts.push('', `[CONTEXTO DO EDITOR/MODO]\n${editorMeta}`);
  if (ragBlock) parts.push('', ragBlock);
  const audioBlock = buildRecentAudioBlock();
  if (audioBlock) parts.push('', audioBlock);
  const guidanceBlock = buildRecentGuidanceBlock();
  if (guidanceBlock) parts.push('', guidanceBlock);

  const systemPrompt = parts.join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      ...maxTokensParam(model, 500),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } },
            { type: 'text', text: `Print da tela agora. Intervenha SÓ se for estratégico (erro, dev travado, ou pergunta pra responder). Senão responda exatamente ${NOOP}.` },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI vision error');
  return (data.choices?.[0]?.message?.content || '').trim();
}

// ---------------------------------------------------------------------------
// LOOP — captura periódica + decisão de intervir.
// ---------------------------------------------------------------------------
async function tick() {
  if (!running || inFlight) return;

  let base64, hash;
  try {
    await captureFullScreenToFile(tmpShot);
    const buf = fs.readFileSync(tmpShot);
    hash = crypto.createHash('md5').update(buf).digest('hex');
    base64 = buf.toString('base64');
  } catch (e) {
    console.warn('[vision-guide] captura falhou:', e.message);
    return;
  }

  const newAudio = audioMarker !== lastAudioMarkerSeen;
  const frameChanged = hash !== lastFrameHash;
  const withinCooldown = (Date.now() - lastInterventionAt) < cfg.minInterventionMs;

  // Economia de token: nada mudou na tela e nenhuma fala nova → não chama a API.
  if (!frameChanged && !newAudio) return;
  // Descansando logo após uma dica e sem áudio urgente → também pula a chamada.
  if (withinCooldown && !newAudio) { lastFrameHash = hash; return; }

  inFlight = true;
  emitStatus('thinking');
  try {
    const answer = await askTutor(base64);
    lastFrameHash = hash;
    lastAudioMarkerSeen = audioMarker;

    const isNoop = !answer || answer === NOOP || answer.replace(/[\[\]]/g, '').trim().toUpperCase() === 'AGUARDAR';
    if (isNoop) { emitStatus('watching'); return; }

    // Respeita o cooldown (a menos que seja disparado por fala nova — pergunta é urgente).
    if (withinCooldown && !newAudio) { emitStatus('watching'); return; }

    lastInterventionAt = Date.now();
    recentGuidance.push(answer.slice(0, 240));
    if (recentGuidance.length > 6) recentGuidance.shift();
    if (guidanceCb) guidanceCb({ text: answer, ts: Date.now() });
    emitStatus('watching');
  } catch (e) {
    console.warn('[vision-guide] tutor falhou:', e.message);
    emitStatus('error');
  } finally {
    inFlight = false;
  }
}

/**
 * Inicia o assistente guiado por visão.
 * @param {object} options
 * @param {string} options.apiKey            chave OpenAI (motor de visão + transcrição)
 * @param {number} [options.intervalSeconds] cadência dos prints (default config)
 * @param {number} [options.minInterventionSeconds]
 * @param {boolean}[options.listenAudio]
 * @param {boolean}[options.useKnowledgeBase]
 */
async function start(options = {}) {
  if (running) return;
  const vg = configService.getVisionGuideConfig();
  cfg = {
    apiKey: options.apiKey,
    intervalMs: Math.max(2000, (options.intervalSeconds || vg.intervalSeconds || 5) * 1000),
    minInterventionMs: Math.max(4000, (options.minInterventionSeconds || vg.minInterventionSeconds || 12) * 1000),
    listenAudio: options.listenAudio !== undefined ? options.listenAudio : vg.listenAudio,
    useKnowledgeBase: options.useKnowledgeBase !== undefined ? options.useKnowledgeBase : vg.useKnowledgeBase,
  };
  if (!cfg.apiKey) throw new Error('API key OpenAI não configurada');

  running = true;
  lastFrameHash = null;
  lastInterventionAt = 0;
  audioMarker = 0; lastAudioMarkerSeen = 0;
  recentGuidance.length = 0;
  recentAudio.length = 0;

  console.log(`[vision-guide] iniciando (intervalo=${cfg.intervalMs}ms, áudio=${cfg.listenAudio}, RAG=${cfg.useKnowledgeBase})`);
  emitStatus('watching');

  if (cfg.listenAudio) {
    try { await startAudio(cfg.apiKey); } catch (e) { console.warn('[vision-guide] startAudio falhou:', e.message); }
  }

  // Primeiro tick imediato, depois periódico.
  tick();
  captureTimer = setInterval(tick, cfg.intervalMs);
}

async function stop() {
  running = false;
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  stopAudio();
  emitStatus('idle');
  console.log('[vision-guide] parado.');
}

async function getIdeAutocomplete(prefix, suffix, lang, apiKey) {
  const model = configService.getOpenAiVisionModel() || 'gpt-4o-mini';
  // Use config apiKey or provided apiKey
  const key = apiKey || cfg.apiKey || configService.getConfig().openIaToken;
  if (!key) return null;

  const systemPrompt = `Você é um assistente de autocomplete de código.
Complete o código onde o cursor está. O usuário enviará o prefixo e o sufixo.
Retorne APENAS o trecho de código exato que deve ser inserido entre o prefixo e o sufixo, sem blocos markdown (\`\`\`), sem explicações, sem texto extra.

REGRAS DE IDIOMA E NOMEAÇÃO (críticas):
- Mantenha rigorosamente a mesma linguagem de programação e o mesmo idioma de identificadores, variáveis, funções e comentários que o usuário já está escrevendo no prefixo e sufixo. A escolha dele tem prioridade máxima.
- Se o usuário estiver escrevendo em inglês (comentários ou variáveis em inglês), complete em inglês. Se estiver escrevendo em português, complete em português. Se for inglês no enunciado, use inglês.`;

  const userPrompt = `Prefixo (antes do cursor):
${prefix}

Sufixo (depois do cursor):
${suffix}

Linguagem: ${lang || 'text'}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        max_tokens: 60,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'OpenAI autocomplete error');
    let suggestion = data.choices?.[0]?.message?.content || '';
    suggestion = suggestion.replace(/^```[\w]*\n/, '').replace(/```$/, '').trimEnd();
    return suggestion;
  } catch (e) {
    console.warn('[vision-guide] getIdeAutocomplete falhou:', e.message);
    return null;
  }
}

module.exports = { start, stop, isActive, onGuidance, onStatus, setContextProvider, getIdeAutocomplete };
