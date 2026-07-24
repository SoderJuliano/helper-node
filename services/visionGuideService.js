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

// fetch com timeout via AbortController. SEM isto, uma conexão pendurada na
// OpenAI deixa o `await` preso pra sempre → `inFlight` nunca zera → o tutor
// para de responder em silêncio ("trava do nada") até reiniciar o app. Com o
// abort, o pendurado vira um erro tratável e o loop segue vivo.
async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Corrida com timeout p/ promessas que não dá pra abortar (ex.: captura de
// tela). Não cancela o trabalho subjacente, mas impede que o `tick()` fique
// pendurado esperando uma captura que travou.
function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} excedeu ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Estado da "aula" (guiar por etapas) ─────────────────────────────────────
// Quando o tutor detecta um DESAFIO/PROJETO/TAREFA inteira na tela, ele:
//   1) anuncia que leu e vai montar um plano (mencionando o idioma do enunciado);
//   2) no turno seguinte entrega o plano RESUMIDO (só as primeiras etapas);
//   3) acompanha o progresso — quando o dev cria os primeiros arquivos, mostra o
//      conteúdo mínimo a escrever; aponta erros e possíveis soluções; etapa a etapa.
// Para telas casuais (não é tarefa) fica no modo oportunista de sempre.
let lesson = { isTask: false, planAnnounced: false, planDelivered: false, plan: '' };
function resetLesson() { lesson = { isTask: false, planAnnounced: false, planDelivered: false, plan: '' }; }

// Falas curtas sem conteúdo acionável NÃO disparam o tutor ("hum", "é", "idk"…).
// Musings PRODUTIVOS ("wondering how", "maybe this…", "stuck") NÃO são filler —
// têm conteúdo e devem provocar dica — por isso o filtro é conservador.
const FILLER_RE = /^(hu?m+|a+h+|e+h+|é|uh+|hmm+|ok|okay|tá|ta|sei la|idk|nada|deixa|pera|entao|então|tipo|isso|é isso|blz|beleza|uhum|aham|ãn|hein|so|so\.\.\.)$/i;
function isFiller(text) {
  const t = (text || '').trim().toLowerCase().replace(/[.…,!?]+$/g, '').trim();
  if (t.length < 2) return true;
  if (FILLER_RE.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  // 1-2 palavras e sem sinal de conteúdo (pergunta/dúvida/erro) → filler.
  const hasContent = /\?|como|how|why|por ?qu|what|onde|where|qual|erro|error|bug|stuck|travad|help|ajud|faz|fazer|make|fix|conserta|wondering|maybe|should|stack/i.test(t);
  if (words.length <= 2 && !hasContent) return true;
  return false;
}

let running = false;
let paused = false;           // pausa temporária (botão): para prints + áudio, mantém a sessão
let lastErrorEmit = 0;        // throttle p/ mostrar falhas na telinha sem poluir
let pendingQuestion = null;   // pergunta de texto direto (Ctrl+I) a responder já
let forceAnalyze = false;     // print explícito (Ctrl+Shift+S): força análise agora

let pauseCb = null;           // notifica mudança de pausa (manual OU auto por custo)
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
let lastAudioTimestampProcessed = 0; // timestamp do último áudio processado
let visionBackoffUntil = 0;   // após um 429, segura as chamadas por um tempo

// Callbacks (registrados pelo main).
let guidanceCb = null;
let statusCb = null;
let contextProvider = null;   // () => string  (metadados do editor/modo, opcional)

const tmpShot = path.join(os.tmpdir(), 'helper-vision-guide.png');

function onGuidance(cb) { guidanceCb = cb; }
function onStatus(cb) { statusCb = cb; }
function onPauseChange(cb) { pauseCb = cb; }
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
const MAX_IMG_WIDTH = 1600;
function optimizeToJpegBase64(pngPath) {
  try {
    let img = nativeImage.createFromPath(pngPath);
    const size = img.getSize();
    if (size.width > MAX_IMG_WIDTH) {
      img = img.resize({ width: MAX_IMG_WIDTH, quality: 'good' });
    }
    const jpeg = img.toJPEG(75);
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

async function askTutor(base64Image, editorState, options = {}) {
  const isIntro = options.isIntro || false;
  const userSpeech = options.userSpeech || '';
  const hasUserSpeech = !!userSpeech.trim();

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
    `- NUNCA encerre suas mensagens com perguntas redundantes ou robóticas de preenchimento de chat (ex: "Posso ajudar com algo mais?", "Quer ajuda em mais alguma coisa?", "Posso ajudar em algo mais?"). Você é um tutor sempre assistindo, então apenas dê a orientação/dica direta de forma natural e silencie. O usuário já sabe que você continuará assistindo.`,
    `- Só intervenha em PONTOS ESTRATÉGICOS: erro de sintaxe/lógica visível na tela, o dev claramente travado/parado, um passo importante prestes a ser feito errado, ou uma PERGUNTA/COMENTÁRIO dirigido a você (por voz ou na tela).`,
    `- EVITE loops de repetição e redundância (crítico): se a fala transcrita do usuário (ou o áudio recente) for apenas ele lendo/repetindo a sua própria dica anterior (ou a captura do seu próprio áudio sendo reproduzido no ambiente), IGNORE essa entrada. NUNCA responda repetindo a mesma orientação ou elaborando sobre algo que você acabou de falar, a menos que o usuário tenha feito uma pergunta genuinamente nova. Nesse caso, se não houver mais nada a adicionar, responda EXATAMENTE com [AGUARDAR].`,
  ];

  const phase = options.phase || (isIntro ? 'intro' : 'guide');

  if (hasUserSpeech) {
    parts.push(`- O usuário acabou de falar algo direcionado a você por voz/microfone. Você DEVE responder diretamente, de forma concisa e amigável, com base na imagem da tela ou conteúdo do editor. Responda no MESMO idioma da fala dele. NÃO responda com [AGUARDAR] de jeito nenhum.`);
  } else if (phase === 'intro') {
    parts.push(
      `- Esta é a sua mensagem inicial. Saúde o usuário e descreva BREVEMENTE o que vê na tela.`,
      `- AVALIE se a tela mostra um DESAFIO/PROBLEMA de código, uma TAREFA/FEATURE ou um PROJETO inteiro a desenvolver (ex.: LeetCode, desafio técnico, um enunciado a implementar):`,
      `  • SE FOR: diga que LEU o enunciado, mencione em que IDIOMA ele está, e avise que vai montar um PLANO por etapas pra guiar. NÃO dê o plano nem código agora. Na ÚLTIMA linha coloque APENAS o marcador [[TASK]].`,
      `  • SE NÃO FOR (tela casual: editor vazio, navegador, configurações, etc.): só saúde e descreva em 1 frase. Na ÚLTIMA linha coloque APENAS o marcador [[CASUAL]].`,
      `- NÃO responda com [AGUARDAR]. O marcador é obrigatório e será removido antes de exibir.`
    );
  } else if (phase === 'plan') {
    parts.push(`- Você já avisou que ia montar o plano. AGORA entregue o PLANO por etapas, mas RESUMIDO: só as PRIMEIRAS 2-3 etapas, curtas (1 linha cada), SEM código ainda, sem poluir a tela. O dev vai executando e você revela o resto conforme ele avança. NÃO responda com [AGUARDAR].`);
  } else if (options.forceHelp) {
    parts.push(`- O usuário pediu ajuda AGORA (apertou o atalho de captura). Olhe a tela atual e dê a orientação mais útil pro que ele está fazendo/vendo — o próximo passo, uma correção pontual, ou como destravar. NÃO responda com [AGUARDAR].`);
  } else {
    parts.push(`- Se NÃO há nada estratégico agora (o dev está escrevendo normalmente, sem erro, sem dúvida), responda EXATAMENTE com ${NOOP} e mais nada. NUNCA descreva a tela.`);
  }

  parts.push(
    `- Seja CURTO: no máximo 2-3 frases + no máximo 1 bloco de código pequeno.`,
    `- Sempre use formatação de código com crases inline (\`valor\`) para nomes de pacotes, identificadores, comandos de terminal, chaves de configuração, links ou valores que o usuário precise copiar ou digitar. Isso é CRÍTICO para que o usuário possa copiar esses valores simplesmente clicando neles na interface.`,
    `- IDIOMA DO CÓDIGO (crítico): mantenha a MESMA linguagem de programação e o MESMO idioma de identificadores/nomes/comentários que o USUÁRIO já está escrevendo na tela — a escolha DELE tem prioridade máxima. Se ele ainda não escreveu nada, siga o idioma do enunciado/problema. Nunca troque a linguagem nem "traduza" os nomes que ele já usou.`,
    `- IDIOMA DA CONVERSA/PERGUNTA (crítico): responda EXATAMENTE no idioma da pergunta/enunciado. Pergunta in inglês → responda em inglês. Pergunta em pt-br → responda em pt-br. Não force pt-br quando o contexto está em inglês.`,
    `- Se houver uma pergunta de entrevista na tela ou dita pelo entrevistador no áudio, ajude o desenvolvedor a responder (diga COMO responder, em primeira pessoa, fornecendo um exemplo curto).`,
    `- Se o próprio DESENVOLVEDOR estiver fazendo uma pergunta direta para você (ex: "o que você acha?", "como resolver?", "me ajuda", "o que fazer?", "você me ouve?", "olá", "oi", "tudo bem?"), responda DIRETAMENTE a ele de forma natural e amigável (ex: "Estou te ouvindo perfeitamente!", "Olá! Como posso ajudar?", "Tudo ótimo por aqui, e com você?"). Perguntas diretas do usuário ou saudações/testes de áudio direcionados a você NUNCA devem ser silenciadas com [AGUARDAR], a menos que seja a mera leitura ou repetição redundante de sua própria resposta anterior.`,
    `- FLEXIBILIDADE (crítico): o DEV conduz, você acompanha. Se ele DECIDIR ou ANUNCIAR um caminho (por voz ou pela ação na tela) — ex.: "vou usar Mongo", "vou criar a interface antes da service" — ACEITE e adapte: "boa, dá pra fazer assim — então o próximo passo é…". NUNCA insista no SEU caminho.`,
    `- OBSERVE ANTES DE CORRIGIR: quando o dev faz algo cujo objetivo ainda não está claro, PREFIRA esperar e acompanhar ("vejo que você está criando esse arquivo — vou acompanhar pra ver aonde você vai") em vez de corrigir na hora. Dê alguns frames antes de intervir.`,
    `- SUGIRA, NUNCA MANDE: jamais dê ordens tipo "apaga isso" ou "cancela essa janela". No máximo SUGIRA com ressalva ("se isso não for proposital, dá pra desfazer — mas se for de propósito, pode seguir"). A decisão é sempre dele.`,
    `- PERGUNTE quando precisar entender: se você realmente precisa saber a intenção pra ajudar bem, faça UMA pergunta curta ("qual a ideia aqui — uma service ou um repository?"). O dev responde discretamente por voz ou digitando (Ctrl+I). Não avance chutando errado — pergunte.`,
    `- Reconheça padrões legítimos de devs experientes SEM ele precisar explicar (interface antes da implementação, repository pattern, usar DUAS tecnologias juntas como Mongo + Redis, etc.). Desvio do seu plano NÃO é erro. Tecnologias podem coexistir — nunca force exclusividade ("apaga o Mongo e usa Redis" é proibido se ele quer os dois).`,
    `- O plano é uma SUGESTÃO, não uma regra. Se o dev muda de ideia, ATUALIZE o plano pro que ele está fazendo. Só se o caminho dele realmente não funcionar, ajude-o a concluí-lo do jeito dele e SÓ ENTÃO ofereça a alternativa — sem "eu avisei".`,
    `- ERRO SEMPRE COM SOLUÇÃO (crítico): se algo está genuinamente errado (erro de sintaxe, marcação vermelha da IDE), NUNCA diga apenas "está errado" ou "apaga". SEMPRE mostre O JEITO CERTO — o trecho corrigido ou o próximo passo exato (ex.: se ele travou no \`extends\`, mostre a linha \`class X extends Y\` certa). Apontar erro sem dar o exemplo certo é proibido.`,
    `- Aja com paciência: corrija e oriente, deixe o dev conduzir a tarefa. Ele muitas vezes está falando com OUTRA pessoa (entrevistador), não com você — não exija explicação nem atenção; infira a intenção pela ação.`
  );

  if (lesson.plan && phase === 'guide') {
    parts.push('', `[PLANO SUGERIDO — é um GUIA, NÃO uma regra]\n${lesson.plan}\n\nAcompanhe o dev, mas se ele mudar de abordagem (por voz ou pela ação na tela), ADAPTE o plano ao que ELE está fazendo — não force o original nem mande apagar. Quando ele criar os primeiros arquivos/estruturas, mostre o CONTEÚDO MÍNIMO que ajuda (trecho pequeno, não o arquivo inteiro). Se algo estiver errado, mostre o JEITO CERTO — nunca só "apaga". Avance sem repetir o que já foi dito.`);
  }

  if (userCtx) parts.push('', userCtx);
  if (editorMeta) parts.push('', `[CONTEXTO DO EDITOR/MODO]\n${editorMeta}`);
  if (ragBlock) parts.push('', ragBlock);
  const audioBlock = buildRecentAudioBlock();
  if (audioBlock) parts.push('', audioBlock);
  const guidanceBlock = buildRecentGuidanceBlock();
  if (guidanceBlock) parts.push('', guidanceBlock);

  const systemPrompt = parts.join('\n');

  const userContent = [];
  
  if (editorState) {
    const textContext = `[ARQUIVO: ${editorState.path}]\n<cursor_position>${editorState.cursorIndex}</cursor_position>\n<content>\n${editorState.content}\n</content>`;
    userContent.push({ type: 'text', text: textContext });
  } else {
    if (hasUserSpeech && lastFrameBase64) {
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

  if (hasUserSpeech) {
    userContent.push({
      type: 'text',
      text: `O usuário disse no microfone: "${userSpeech}"\n\nResponda diretamente a essa fala do usuário com base no print da tela ou conteúdo do editor. NÃO responda com [AGUARDAR].`
    });
  } else {
    userContent.push({
      type: 'text',
      text: `Print da tela ou conteúdo do editor agora. Intervenha SÓ se for estratégico (erro, dev travado, ou pergunta pra responder). Senão responda exatamente ${NOOP}.`
    });
  }

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      // 1500 (não 500): modelos de VISÃO com raciocínio (gpt-5.x) gastam tokens
      // "pensando" antes de escrever — com orçamento curto o raciocínio consome
      // tudo e a resposta vem VAZIA (que o main descarta em silêncio → tutor mudo).
      ...maxTokensParam(model, 1500),
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: userContent,
        },
      ],
    }),
  }, 120000); // 120s: modelos de VISÃO com raciocínio (gpt-5.x) pensam antes de
              // responder e passam fácil de 30s. Timeout curto abortava a
              // chamada boa e o tutor ficava mudo. 120s ainda evita hang eterno.

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'OpenAI vision error');

  return (data.choices?.[0]?.message?.content || '').trim();
}

// ---------------------------------------------------------------------------
// HELPER — Verifica se o áudio transcrito é muito similar a alguma dica recente
// ---------------------------------------------------------------------------
function isSimilarToRecentGuidance(text, recentGuidanceList) {
  if (!text || !recentGuidanceList || !recentGuidanceList.length) return false;

  const cleanWords = (str) => {
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(w => w.length > 2); // ignora palavras de 1 ou 2 letras
  };

  const userWords = cleanWords(text);
  if (userWords.length === 0) return false;

  for (const guidance of recentGuidanceList) {
    const guidanceWords = cleanWords(guidance);
    if (guidanceWords.length === 0) continue;

    let matches = 0;
    for (const word of userWords) {
      if (guidanceWords.includes(word)) {
        matches++;
      }
    }

    // Se a frase dita for média/longa (3 ou mais palavras significativas)
    if (userWords.length >= 3) {
      const userRatio = matches / userWords.length;
      if (userRatio > 0.70) return true;
    } else {
      // Se for muito curta, só bate se coincidir 100% e a dica anterior também for muito curta (<= 4 palavras)
      if (matches === userWords.length && guidanceWords.length <= 4) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// LOOP — captura periódica + decisão de intervir.
// ---------------------------------------------------------------------------
async function tick() {
  if (!running || paused || inFlight) return;
  // Após um 429, segura as chamadas até o backoff expirar (evita marteladas).
  if (Date.now() < visionBackoffUntil) return;

  const isIntro = needsIntroduction;
  // Fases da aula. A entrega do plano é um turno "forçado" (fala mesmo sem
  // mudança de tela/cooldown), logo após o anúncio na intro. Depois, guia normal.
  const deliverPlan = !isIntro && lesson.isTask && lesson.planAnnounced && !lesson.planDelivered;
  const doForceHelp = forceAnalyze; forceAnalyze = false; // print explícito (Ctrl+Shift+S)
  const forced = isIntro || deliverPlan || doForceHelp;
  const phase = isIntro ? 'intro' : (deliverPlan ? 'plan' : 'guide');

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
      await withTimeout(captureFullScreenToFile(tmpShot), 15000, 'captura de tela');
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

  // Filtra as falas do usuário (mic) que surgiram desde o último processamento
  const newMicUtterances = recentAudio.filter(a => a.ts > lastAudioTimestampProcessed && a.source === 'você');
  
  // Filtra falas que são leituras ou repetições da sugestão recente dada pelo Tutor para evitar loops de eco
  const filteredMicUtterances = newMicUtterances.filter(a => !isSimilarToRecentGuidance(a.text, recentGuidance) && !isFiller(a.text));
  
  let userSpeech = filteredMicUtterances.map(a => a.text).join(' ');
  let hasNewMicSpeech = filteredMicUtterances.length > 0;
  // Pergunta de TEXTO direta (Ctrl+I) tem prioridade e não passa pelos filtros
  // de eco/filler — é uma pergunta explícita do usuário pro tutor.
  if (pendingQuestion) { userSpeech = pendingQuestion; hasNewMicSpeech = true; pendingQuestion = null; }

  if (!forced) {
    // Economia de token: nada mudou na tela e nenhuma fala/pergunta nova → não chama a API.
    if (!frameChanged && !newAudio && !hasNewMicSpeech) return;
    // Descansando logo após uma dica e sem pergunta direta do usuário (mic) → pula a chamada.
    if (withinCooldown && !hasNewMicSpeech) { lastFrameHash = hash; lastFrameBase64 = base64; return; }
  }

  // Atualiza a marcação de áudio processado antes de chamar a API
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



    // Resposta VAZIA num turno forçado (intro/plano): o modelo não produziu texto
    // (ex.: raciocínio consumiu o orçamento). Torna visível e NÃO consome a intro
    // (needsIntroduction segue true) — tenta de novo no próximo tick.
    if (forced && !(answer && answer.trim())) {
      if (guidanceCb && Date.now() - lastErrorEmit > 60000) {
        lastErrorEmit = Date.now();
        guidanceCb({ text: '⚠️ O modelo de visão respondeu vazio (pode estar lento ou sem orçamento de tokens). Tentando de novo…', ts: Date.now() });
      }
      emitStatus('watching');
      return;
    }

    const isNoop = !forced && (!answer || answer === NOOP || answer.replace(/[\[\]]/g, '').trim().toUpperCase() === 'AGUARDAR');
    if (isNoop) { emitStatus('watching'); return; }

    // Respeita o cooldown (a menos que seja turno forçado — intro/plano — ou fala nova do mic)
    if (!forced && withinCooldown && !hasNewMicSpeech) { emitStatus('watching'); return; }

    // Transições da máquina de estados da aula + limpeza do marcador da intro.
    // Se o usuário falou neste turno, o modelo respondeu a ELE (prioridade) — não
    // é a intro/plano esperado, então não fazemos a transição de fase com isso.
    let outText = answer;
    if (phase === 'intro') {
      needsIntroduction = false;
      if (!hasNewMicSpeech) {
        lesson.isTask = /\[\[\s*TASK\s*\]\]/i.test(answer);
        if (lesson.isTask) lesson.planAnnounced = true;
        outText = answer.replace(/\[\[\s*(TASK|CASUAL)\s*\]\]/ig, '').trim();
      }
    } else if (phase === 'plan' && !hasNewMicSpeech) {
      lesson.planDelivered = true;
      lesson.plan = outText.slice(0, 800);
    }

    lastInterventionAt = Date.now();
    recentGuidance.push(outText.slice(0, 500));
    if (recentGuidance.length > 6) recentGuidance.shift();

    if (guidanceCb) guidanceCb({ text: outText, ts: Date.now() });
    emitStatus('watching');
  } catch (e) {
    const msg = e && e.message || '';
    console.warn('[vision-guide] tutor falhou:', msg);
    const isRate = /rate limit|429|tokens per min|TPM/i.test(msg);
    // Rate limit (429): recua ~20s em vez de martelar a API a cada tick.
    if (isRate) {
      visionBackoffUntil = Date.now() + 20000;
      console.warn('[vision-guide] rate limit → pausando chamadas por 20s.');
    }
    // Torna a falha VISÍVEL na telinha (antes era silenciosa e parecia "tutor
    // morto"). Throttle de 60s pra não poluir. Abort de timeout cai aqui também.
    if (guidanceCb && Date.now() - lastErrorEmit > 60000) {
      lastErrorEmit = Date.now();
      const reason = /abort/i.test(msg)
        ? 'a análise passou do tempo limite (o modelo de visão pode estar lento — tente um modelo de visão mais rápido nas Configurações)'
        : isRate ? 'limite de uso da API da OpenAI' : (msg || 'erro desconhecido');
      guidanceCb({ text: `⚠️ Não consegui analisar a tela agora: ${reason}. Sigo tentando.`, ts: Date.now() });
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
  paused = false;
  pendingQuestion = null;
  forceAnalyze = false;

  needsIntroduction = true; // Habilita a introdução para esta nova sessão
  lastFrameHash = null;
  lastFrameBase64 = null;
  lastInterventionAt = 0;
  audioMarker = 0; lastAudioMarkerSeen = 0;
  lastAudioTimestampProcessed = Date.now(); // Ignora áudios gravados antes de iniciar o Tutor
  recentGuidance.length = 0;
  recentAudio.length = 0;
  resetLesson();

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
  paused = false;
  pendingQuestion = null;
  forceAnalyze = false;
  needsIntroduction = false; // Cancela introdução pendente se houver
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  stopAudio();
  emitStatus('idle');
  console.log('[vision-guide] parado.');
}

// Pausa TEMPORÁRIA (botão): para de tirar prints e de colher áudio, mas mantém
// a sessão viva (plano, histórico, contexto) — resume() volta de onde parou.
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
  // Ignora áudio/tela capturados durante a pausa; retoma a cadência normal.
  lastAudioTimestampProcessed = Date.now();
  if (!captureTimer) captureTimer = setInterval(tick, cfg.intervalMs);
  console.log('[vision-guide] retomado.');
}

function isPaused() { return paused; }

// Pergunta de TEXTO direto pro tutor (Ctrl+I no modo integrado): responde na
// própria telinha, com o contexto que ele já tem da tela, em vez de abrir uma
// janela separada sem contexto.
function askQuestion(text) {
  const t = (text || '').trim();
  if (!running || paused || !t) return;
  pendingQuestion = t;
  if (!inFlight) tick();
}

// Print explícito (Ctrl+Shift+S) com o tutor ligado: força olhar a tela AGORA e
// dar a orientação mais útil (não silencia com [AGUARDAR]).
function analyzeNow() {
  if (!running || paused) return;
  forceAnalyze = true;
  if (!inFlight) tick();
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
    const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
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
    }, 20000);
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

function triggerIntroduction() {
  if (running) {
    needsIntroduction = true;
    if (!inFlight) {
      tick();
    }
  }
}

module.exports = { start, stop, pause, resume, isPaused, isActive, askQuestion, analyzeNow, onGuidance, onStatus, onPauseChange, setContextProvider, getIdeAutocomplete, triggerIntroduction };
