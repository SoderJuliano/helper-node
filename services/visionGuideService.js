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
const { nativeImage } = require('electron');

const configService = require('./configService');
const knowledgeBase = require('./knowledgeBase');
const { captureFullScreenToFile } = require('./platform/screenCapture');
const { transcribeAudio } = require('./translationAssistant/openaiClient');
const { maxTokensParam } = require('./openAiRealtimeModels');

// Sentinela que o modelo devolve quando NÃO há nada estratégico a dizer agora.
// Suprimimos essas respostas — é o que evita encher a tela.
const NOOP = '[AGUARDAR]';

let running = false;
let needsIntroduction = false; // controla o envio da mensagem inicial de introdução
let cfg = {};                 // { apiKey, intervalMs, minInterventionMs, listenAudio, useKnowledgeBase }
let captureTimer = null;
let inFlight = false;         // evita chamadas de visão sobrepostas
let lastFrameHash = null;     // pula chamada quando a tela não mudou
let lastFrameBase64 = null;   // guarda o base64 do frame anterior
let lastInterventionAt = 0;   // cooldown entre intervenções
const recentGuidance = [];    // últimas dicas dadas (pra não repetir)
const recentAudio = [];       // { source, text, ts } — falas recentes (contexto)
let audioMarker = 0;          // muda quando chega fala nova (detecta "novo áudio")
let lastAudioMarkerSeen = 0;
let visionBackoffUntil = 0;   // após um 429, segura as chamadas por um tempo

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
        // Economia/otimização de áudio: mantemos apenas os primeiros 200ms de silêncio (padding) 
        // para não cortar as palavras abruptamente. Silêncios subsequentes são cortados do buffer,
        // mas continuam incrementando silenceMs para estourar o SILENCE_HANGOVER_MS e finalizar o trecho.
        if (this.silenceMs <= 200) {
          this.chunks.push(buf);
        }
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

// Reduz o screenshot antes de enviar: cai a resolução (menos "tiles" na conta de
// tokens) e re-codifica em JPEG (payload menor, upload mais rápido). Usa o
// nativeImage do Electron — zero dependência nativa.
const MAX_IMG_WIDTH = 900;
function optimizeToJpegBase64(pngPath) {
  try {
    let img = nativeImage.createFromPath(pngPath);
    const size = img.getSize();
    
    // Crop chrome (top bar, bottom bar, small side margins)
    const cutTop = Math.min(120, Math.floor(size.height * 0.1));
    const cutBottom = Math.min(80, Math.floor(size.height * 0.08));
    const cutSides = Math.min(60, Math.floor(size.width * 0.05));
    
    if (size.width > cutSides * 2 && size.height > cutTop + cutBottom) {
      const rect = {
        x: cutSides,
        y: cutTop,
        width: size.width - cutSides * 2,
        height: size.height - cutTop - cutBottom
      };
      img = img.crop(rect);
    }
    
    const newSize = img.getSize();
    if (newSize.width > MAX_IMG_WIDTH) {
      img = img.resize({ width: MAX_IMG_WIDTH, quality: 'good' });
    }
    const jpeg = img.toJPEG(72);
    if (jpeg && jpeg.length) return jpeg.toString('base64');
  } catch (_) {}
  return fs.readFileSync(pngPath).toString('base64');
}

// gpt-4o-mini / -nano cobram imagem ~33× mais caro que os modelos normais: em
// `detail:high` um screenshot de tela cheia passa de 25k tokens e estoura o TPM.
// Nesses modelos forçamos `detail:low` (~2.8k tokens, custo fixo). Nos demais
// (gpt-4o, gpt-4.1-mini…) `high` é barato e legível.
function visionDetailFor(model) {
  return /mini|nano/i.test(model || '') ? 'low' : 'high';
}

async function askTutor(base64Image, editorState, isIntro = false) {
  const apiKey = cfg.apiKey;
  const model = configService.getOpenAiVisionModel();
  const detail = visionDetailFor(model);

  let userCtx = '';
  try { userCtx = configService.getUserContextBlock ? configService.getUserContextBlock() : ''; } catch (_) {}

  let editorMeta = '';
  try { 
    if (contextProvider) {
      const ctx = contextProvider();
      if (typeof ctx === 'object') {
        editorMeta = ctx.text;
      } else {
        editorMeta = (ctx || '').toString();
      }
    } 
  } catch (_) {}

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
    `Você é um TUTOR de programação em tempo real que observa a tela do desenvolvedor por prints periódicos ou pelo conteúdo do editor atual. Seu papel é GUIAR, nunca resolver por ele.`,
    ``,
    `REGRAS (críticas):`,
    `- NUNCA entregue a tarefa inteira pronta nem escreva o código completo por ele. Dê o PRÓXIMO passo, uma correção pontual, ou o TRECHO MÍNIMO que destrava. O objetivo é o dev ESCREVER, não copiar.`,
    `- Só intervenha em PONTOS ESTRATÉGICOS: erro de sintaxe/lógica visível na tela, o dev claramente travado/parado, um passo importante prestes a ser feito errado, ou uma PERGUNTA/COMENTÁRIO dirigido a ele ou a você (na tela ou no áudio) ou saudações/testes de áudio direcionados a você ("oi", "olá", "você me ouve", "testando", "tudo bem").`,
    isIntro
      ? `- Esta é a sua mensagem inicial de boas-vindas (introdução). Você DEVE saudar o usuário amigavelmente e descrever de forma breve o que vê na tela dele (por exemplo, quais ferramentas, sites ou arquivos estão abertos). NÃO responda com [AGUARDAR] ou NOOP de jeito nenhum.`
      : `- Se NÃO há nada estratégico agora (o dev está escrevendo normalmente, sem erro, sem dúvida), responda EXATAMENTE com ${NOOP} e mais nada. NUNCA descreva a tela.`,
    `- Seja CURTO: no máximo 2-3 frases + no máximo 1 bloco de código pequeno.`,
    `- IDIOMA DO CÓDIGO (crítico): mantenha a MESMA linguagem de programação e o MESMO idioma de identificadores/nomes/comentários que o USUÁRIO já está escrevendo na tela — a escolha DELE tem prioridade máxima. Se ele ainda não escreveu nada, siga o idioma do enunciado/problema. Nunca troque a linguagem nem "traduza" os nomes que ele já usou.`,
    `- IDIOMA DA CONVERSA/PERGUNTA (crítico): responda EXATAMENTE no idioma da pergunta/enunciado. Pergunta em inglês → responda em inglês. Pergunta em pt-br → responda em pt-br. Não force pt-br quando o contexto está em inglês.`,
    `- Se houver uma pergunta de entrevista na tela ou dita pelo entrevistador no áudio, ajude o desenvolvedor a responder (diga COMO responder, em primeira pessoa, fornecendo um exemplo curto).`,
    `- Se o próprio DESENVOLVEDOR estiver fazendo uma pergunta direta para você no áudio ou tela (ex: "o que você acha?", "como resolver?", "me ajuda", "o que fazer?", "você me ouve?", "olá", "oi", "tudo bem?"), responda DIRETAMENTE a ele de forma natural e amigável (ex: "Estou te ouvindo perfeitamente!", "Olá! Como posso ajudar?", "Tudo ótimo por aqui, e com você?"). Perguntas diretas do usuário ou saudações/testes de áudio direcionados a você NUNCA devem ser silenciadas com [AGUARDAR].`,
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

  // Detecta se há uma pergunta direta do dev no áudio recente (ou saudação/teste de áudio)
  const audioText = recentAudio.map(a => a.text).join(' ').toLowerCase();
  const hasDirectQuestion = /o que (voc[êe]|vc) acha|o que acha|como resolver|me ajuda|como fa[çc]o|como implementar|me ouve|me ouvindo|me escuta|oi|ol[aá]|tudo bem/i.test(audioText);

  const userContent = [];
  
  if (editorState) {
    const textContext = `[ARQUIVO: ${editorState.path}]\n<cursor_position>${editorState.cursorIndex}</cursor_position>\n<content>\n${editorState.content}\n</content>`;
    userContent.push({ type: 'text', text: textContext });
  } else {
    if (hasDirectQuestion && lastFrameBase64) {
      userContent.push(
        { type: 'text', text: 'Print da tela anterior (antes da pergunta):' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${lastFrameBase64}`, detail: 'low' } }, // sempre low: só serve p/ comparar o que mudou
        { type: 'text', text: 'Print da tela atual (momento da pergunta):' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail } }
      );
    } else {
      userContent.push(
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail } }
      );
    }
  }

  userContent.push(
    { type: 'text', text: `Print da tela ou conteúdo do editor agora. Intervenha SÓ se for estratégico (erro, dev travado, ou pergunta pra responder). Senão responda exatamente ${NOOP}.` }
  );

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
          content: userContent,
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
  // Após um 429, segura as chamadas até o backoff expirar (evita marteladas).
  if (Date.now() < visionBackoffUntil) return;

  const isIntro = needsIntroduction;

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
      base64 = null; // não precisa de imagem no modo texto
    } else {
      await captureFullScreenToFile(tmpShot);
      const buf = fs.readFileSync(tmpShot);
      hash = crypto.createHash('md5').update(buf).digest('hex');
      base64 = optimizeToJpegBase64(tmpShot);   // downscale + JPEG (menos tokens/payload)
    }
  } catch (e) {
    console.warn('[vision-guide] captura falhou:', e.message);
    return;
  }

  const newAudio = audioMarker !== lastAudioMarkerSeen;
  const frameChanged = hash !== lastFrameHash;
  const withinCooldown = (Date.now() - lastInterventionAt) < cfg.minInterventionMs;

  if (!isIntro) {
    // Economia de token: nada mudou na tela e nenhuma fala nova → não chama a API.
    if (!frameChanged && !newAudio) return;
    // Descansando logo após uma dica e sem áudio urgente → também pula a chamada.
    if (withinCooldown && !newAudio) { lastFrameHash = hash; lastFrameBase64 = base64; return; }
  }

  inFlight = true;
  emitStatus('thinking');
  try {
    const answer = await askTutor(base64, editorState, isIntro);
    lastFrameHash = hash;
    lastFrameBase64 = base64;
    lastAudioMarkerSeen = audioMarker;

    const isNoop = !isIntro && (!answer || answer === NOOP || answer.replace(/[\[\]]/g, '').trim().toUpperCase() === 'AGUARDAR');
    if (isNoop) { emitStatus('watching'); return; }

    // Respeita o cooldown (a menos que seja disparado por fala nova — pergunta é urgente, ou se for introdução).
    if (!isIntro && withinCooldown && !newAudio) { emitStatus('watching'); return; }

    lastInterventionAt = Date.now();
    recentGuidance.push(answer.slice(0, 240));
    if (recentGuidance.length > 6) recentGuidance.shift();
    
    if (isIntro) {
      needsIntroduction = false;
    }

    if (guidanceCb) guidanceCb({ text: answer, ts: Date.now() });
    emitStatus('watching');
  } catch (e) {
    console.warn('[vision-guide] tutor falhou:', e.message);
    // Rate limit (429): recua ~20s em vez de martelar a API a cada tick.
    if (/rate limit|429|tokens per min|TPM/i.test(e.message || '')) {
      visionBackoffUntil = Date.now() + 20000;
      console.warn('[vision-guide] rate limit → pausando chamadas por 20s.');
    }
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
  needsIntroduction = true; // Habilita a introdução para esta nova sessão
  lastFrameHash = null;
  lastFrameBase64 = null;
  lastInterventionAt = 0;
  audioMarker = 0; lastAudioMarkerSeen = 0;
  recentGuidance.length = 0;
  recentAudio.length = 0;

  console.log(`[vision-guide] iniciando (intervalo=${cfg.intervalMs}ms, áudio=${cfg.listenAudio}, RAG=${cfg.useKnowledgeBase})`);
  emitStatus('watching');

  if (cfg.listenAudio) {
    try { await startAudio(cfg.apiKey); } catch (e) { console.warn('[vision-guide] startAudio falhou:', e.message); }
  }

  // Primeiro tick de introdução agendado para 5 segundos, para dar tempo do usuário focar a tela
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
  needsIntroduction = false; // Cancela introdução pendente se houver
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
