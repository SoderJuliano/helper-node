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
const historyService = require('./historyService');
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
let pendingHelp = false;      // botão [h] "me ajuda": refaz o plano do que falta

let historySessionId = null;  // sessão de histórico da "aula" atual (uma por start())
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
let lastVisionDiag = '';      // motivo real da última resposta vazia (modelo/finish/tokens)

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

// Registra a conversa da "aula" no histórico (mesmo store do chat): a fala/pergunta
// do dev entra como 'user' e cada orientação do tutor como 'assistant'. addMessage
// devolve o id final (recria a sessão se ela tiver sido apagada) — guardamos de volta.
async function logToHistory(role, content) {
  if (!historySessionId || !content || !content.trim()) return;
  try {
    historySessionId = await historyService.addMessage(historySessionId, role, content.trim());
  } catch (e) {
    console.warn('[vision-guide] falha ao registrar no histórico:', e.message);
  }
}

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
  return `[DICAS QUE VOCÊ JÁ DEU (não repita, não volte a explicar o mesmo)]\n${recentGuidance.slice(-3).map((g) => `- ${g.slice(0, 400)}${g.length > 400 ? '...' : ''}`).join('\n')}`;
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
    `- NUNCA entregue o desafio/projeto INTEIRO pronto de uma vez (todos os arquivos). Mas para o ARQUIVO/COMPONENTE da etapa ATUAL do plano, você PODE e DEVE dar um EXEMPLO COMPLETO desse arquivo quando fizer sentido (ele vai começar aquele arquivo, ou está travado nele) — isso é o fluxo normal de dev, não é "entregar pronto". Terminado aquele arquivo, ajude com o PRÓXIMO da lista. A unidade de trabalho é o ARQUIVO/ETAPA, não a linha.`,
    `- NUNCA encerre suas mensagens com perguntas redundantes ou robóticas de preenchimento de chat (ex: "Posso ajudar com algo mais?", "Quer ajuda em mais alguma coisa?", "Posso ajudar em algo mais?"). Você é um tutor sempre assistindo, então apenas dê a orientação/dica direta de forma natural e silencie. O usuário já sabe que você continuará assistindo.`,
    `- Só intervenha em PONTOS ESTRATÉGICOS, no nível do ARQUIVO/ETAPA (crítico, NUNCA no nível de linha/token): ele vai começar um arquivo da etapa atual e ainda não tem exemplo, ele está claramente travado/parado NUM ARQUIVO (várias telas seguidas sem progresso nele — não uma linha isolada), um arquivo inteiro ficou quebrado de um jeito que trava o avanço, ou uma PERGUNTA/COMENTÁRIO dirigido a você (por voz ou na tela). NUNCA comente sintaxe/token/linha isolada em andamento (\`Map<\`, import pela metade, parêntese ainda aberto, etc.) — o dev sabe escrever, isso é digitação normal, fique em silêncio.`,
    `- EVITE loops de repetição e redundância (crítico): se a fala transcrita do usuário (ou o áudio recente) for apenas ele lendo/repetindo a sua própria dica anterior (ou a captura do seu próprio áudio sendo reproduzido no ambiente), IGNORE essa entrada. NUNCA responda repetindo a mesma orientação ou elaborando sobre algo que você acabou de falar, a menos que o usuário tenha feito uma pergunta genuinamente nova. Nesse caso, se não houver mais nada a adicionar, responda EXATAMENTE com [AGUARDAR].`,
    `- SÓ FALE DO QUE ESTÁ LITERALMENTE VISÍVEL no print ATUAL (crítico): nunca cite número de linha, nome de arquivo, framework ou trecho de código que você não consegue realmente ver na imagem AGORA. Se o plano ou suas dicas anteriores mencionam algo (ex.: outro arquivo/projeto) que não bate mais com a tela atual, IGNORE essa referência antiga — a tela atual é a verdade, não sua memória. Pode haver música/ruído de fundo sendo transcrito como "fala" — se o texto não fizer sentido como algo dito PRA você, ignore-o.`,
  ];

  const phase = options.phase || (isIntro ? 'intro' : 'guide');

  if (phase === 'intro') {
    // CRÍTICO: a classificação TASK/CASUAL roda SEMPRE na intro, mesmo que o
    // usuário tenha falado algo nesse meio-tempo (ex.: ruído do mic captado nos
    // primeiros segundos). Antes, quando havia fala do usuário nesse momento,
    // esse bloco inteiro era pulado — matando a detecção de desafio pra sessão
    // INTEIRA (nunca montava plano nenhum, mesmo sendo claramente um desafio).
    parts.push(
      `- Esta é a sua mensagem inicial. Saúde o usuário e descreva BREVEMENTE o que vê na tela.`,
      `- AVALIE se a tela mostra um DESAFIO/PROBLEMA de código, uma TAREFA/FEATURE ou um PROJETO inteiro a desenvolver (ex.: LeetCode, desafio técnico, um enunciado a implementar):`,
      `  • SE FOR: diga que LEU o enunciado, mencione em que IDIOMA ele está, e avise que vai montar um PLANO por etapas pra guiar. NÃO dê o plano nem código agora. Na ÚLTIMA linha coloque APENAS o marcador [[TASK]].`,
      `  • SE NÃO FOR (tela casual: editor vazio, navegador, configurações, etc.): só saúde e descreva em 1 frase. Na ÚLTIMA linha coloque APENAS o marcador [[CASUAL]].`,
      `- O marcador ([[TASK]] ou [[CASUAL]]) é OBRIGATÓRIO nesta mensagem e será removido antes de exibir — inclua um dos dois SEMPRE, mesmo que o usuário tenha falado algo.`
    );
    if (hasUserSpeech) {
      parts.push(`- O usuário também disse algo no microfone: "${userSpeech}". Responda a ele brevemente ANTES da avaliação da tela, no mesmo idioma da fala dele — mas NÃO pule a avaliação nem o marcador final.`);
    }
    parts.push(`- NÃO responda com [AGUARDAR].`);
  } else if (hasUserSpeech) {
    parts.push(`- O usuário acabou de falar algo direcionado a você por voz/microfone. Você DEVE responder diretamente, de forma concisa e amigável, com base na imagem da tela ou conteúdo do editor. Responda no MESMO idioma da fala dele. NÃO responda com [AGUARDAR] de jeito nenhum.`);
  } else if (phase === 'plan') {
    parts.push(
      `- Você já avisou que ia montar o plano. AGORA entregue um RESUMO SIMPLIFICADO do desafio inteiro, pro dev ter a VISÃO GERAL e confirmar que entendeu. Estruture assim:`,
      `  1) Em 1 frase: o que o desafio pede / aonde vamos chegar no final.`,
      `  2) Os passos principais em bullets CURTOS, na ordem — que arquivos/componentes criar, um por um. Visão geral, SEM código completo aqui (isso vem depois, arquivo por arquivo).`,
      `  3) Feche dizendo, de forma natural, que vai te guiar arquivo por arquivo durante o processo.`,
      `- No máximo ~6-7 linhas no total. É um resumo pra ele ler e dizer "entendi" — não é a solução nem o primeiro arquivo ainda. NÃO responda com [AGUARDAR].`
    );
  } else if (phase === 'help') {
    // Botão [h] "me ajuda, travei": o dev está perdido no meio do desafio que o
    // tutor já leu. Reavalia o estado, dá um EXEMPLO COMPLETO do arquivo da etapa
    // atual e refaz o plano SÓ com o que falta — sem repetir o que já funciona.
    parts.push(
      `- O usuário apertou o botão de AJUDA ("me ajuda, fiquei perdido/travado"). Ele está no MEIO do desenvolvimento do último desafio que você leu e não sabe como prosseguir DESTE exato ponto. Faça, NESTA ordem e SEM enrolação:`,
      `  1) Revise mentalmente o que JÁ FOI FEITO (suas dicas anteriores + o print anterior + o plano) e o estado ATUAL da tela.`,
      `  2) Dê uma análise MUITO curta (1-2 linhas) do ponto exato em que ele está — qual arquivo/etapa.`,
      `  3) Entregue um EXEMPLO COMPLETO do arquivo dessa etapa (não uma linha solta), e diga qual é o PRÓXIMO arquivo do plano depois desse.`,
      `  • SE o print atual mostrar um ERRO/BUG (stack trace, exceção, teste falhando): FOQUE primeiro em resolver esse erro — mostre o arquivo corrigido completo — SEM quebrar o que já funciona. Só depois, se couber, indique o próximo passo.`,
      `- Seja direto e prático. NÃO responda com [AGUARDAR] de jeito nenhum.`,
      `- OBRIGATÓRIO (crítico): sua resposta TEM que conter um bloco de código (entre \`\`\`) com o exemplo completo. Uma resposta que só EXPLICA o que fazer, sem o bloco de código, é INVÁLIDA e inútil pro usuário — ele já sabe o que precisa ser feito, ele quer VER o código. NÃO narre a solução em prosa ("defina um método separado", "mantenha um mapa de frequências") — ESCREVA o método/arquivo de verdade, completo, dentro de um bloco de código.`
    );
    if (options.retryNoCode) {
      parts.push(`- ATENÇÃO: sua resposta ANTERIOR a este mesmo pedido não continha bloco de código — foi rejeitada por não ser útil. NÃO repita esse erro. Esta resposta PRECISA ter um bloco de código com a implementação completa, agora.`);
    }
  } else if (options.forceHelp) {
    parts.push(`- O usuário pediu ajuda AGORA (apertou o atalho de captura). Olhe a tela atual e dê a orientação mais útil pro que ele está fazendo/vendo — o próximo passo, uma correção pontual, ou como destravar. NÃO responda com [AGUARDAR].`);
  } else {
    if (!lesson.isTask) {
      parts.push(
        `- Você está em uma sessão CASUAL de programação (nenhum plano ou desafio ativo).`,
        `- AVALIE cuidadosamente se a tela ou o código agora passou a mostrar um DESAFIO/PROBLEMA de código, uma TAREFA/FEATURE ou um enunciado de projeto/desafio técnico a desenvolver (por exemplo: um enunciado em comentário do arquivo, uma aba de LeetCode/Hackerrank, etc.):`,
        `  • SE DETECTOU UM DESAFIO: cumprimente o usuário, diga que leu o enunciado, mencione em que idioma ele está, e avise que identificou o desafio e vai montar um PLANO para guiá-lo. Na última linha da resposta, adicione OBRIGATORIAMENTE o marcador [[TASK]].`,
        `  • SE NÃO HÁ DESAFIO ATIVO: se não há nada estratégico agora (o dev está escrevendo normalmente, sem erro, sem dúvida), responda EXATAMENTE com ${NOOP} e mais nada. NUNCA descreva a tela.`
      );
    } else {
      parts.push(`- Se NÃO há nada estratégico agora (o dev está escrevendo normalmente, sem erro, sem dúvida), responda EXATAMENTE com ${NOOP} e mais nada. NUNCA descreva a tela.`);
    }
  }

  parts.push(
    `- Seja CURTO no texto (no máximo 2-3 frases). O bloco de código, porém, pode ser o ARQUIVO INTEIRO da etapa quando for isso que você está entregando — não corte um exemplo de arquivo só pra "parecer resumido".`,
    `- Sempre use formatação de código com crases inline (\`valor\`) para nomes de pacotes, identificadores, comandos de terminal, chaves de configuração, links ou valores que o usuário precise copiar ou digitar. Isso é CRÍTICO para que o usuário possa copiar esses valores simplesmente clicando neles na interface.`,
    `- IDIOMA — SEGUE A TELA, SEMPRE (crítico, vale pra TUDO: linguagem de programação, texto da explicação, comentários, nomes): o idioma é o que está NAS FOTOS/PRINTS — enunciado em inglês → você escreve E explica em inglês; enunciado/tela em pt-br → você escreve E explica em pt-br. Isso vale igual pra qualquer linguagem de programação (Java, Python, JS, etc.) e pro texto da sua resposta — os dois seguem JUNTOS o idioma da tela, nunca um em pt-br e outro em inglês. Mantenha também a MESMA linguagem de programação e o MESMO idioma de identificadores/nomes/comentários que o USUÁRIO já está escrevendo — a escolha dele tem prioridade sobre o enunciado se ele já começou a escrever. Se ele falar por voz num idioma diferente da tela, responda no idioma DELE só naquela resposta pontual — sem mudar o idioma dos exemplos de código, que continua o da tela.`,
    `- Se houver uma pergunta de entrevista na tela ou dita pelo entrevistador no áudio, ajude o desenvolvedor a responder (diga COMO responder, em primeira pessoa, fornecendo um exemplo curto).`,
    `- Se o DESENVOLVEDOR fizer uma pergunta direta, ou expressar um pensamento em voz alta, comentário ou dúvida técnica sobre o código (ex: "talvez preciso de um log aqui", "deveria usar um map?", "como fazer tal coisa?", "estou com dúvida"), você DEVE responder proativamente. Ajude-o a validar, debugar ou complementar a ideia (ex: onde colocar o log e como, comparar map vs set, etc.). Não se silencie com [AGUARDAR] diante de reflexões técnicas ou dúvidas faladas do dev. Se for uma pergunta/saudação direta (ex: "o que você acha?", "me ajuda", "olá", "oi"), responda amigavelmente (ex: "Estou te ouvindo!", "Olá! Como posso ajudar?"). Perguntas e musings técnicos do usuário NUNCA devem ser silenciados com [AGUARDAR], a menos que seja a mera repetição de sua própria dica anterior.`,
    `- FLEXIBILIDADE (crítico): o DEV conduz, você acompanha. Se ele DECIDIR ou ANUNCIAR um caminho (por voz ou pela ação na tela) — ex.: "vou usar Mongo", "vou criar a interface antes da service" — ACEITE e adapte: "boa, dá pra fazer assim — então o próximo passo é…". NUNCA insista no SEU caminho.`,
    `- OBSERVE ANTES DE CORRIGIR (crítico): compare o print atual com o anterior SÓ pra saber se o dev está PROGREDINDO no arquivo atual (código mudando, avançando — fique em silêncio, é trabalho normal) ou PARADO/travado no mesmo estado por vários prints seguidos NUM ARQUIVO INTEIRO (aí sim, ofereça ajuda nesse arquivo). Nunca julgue pelo conteúdo de uma linha isolada.`,
    `- SUGIRA, NUNCA MANDE: jamais dê ordens tipo "apaga isso" ou "cancela essa janela". No máximo SUGIRA com ressalva ("se isso não for proposital, dá pra desfazer — mas se for de propósito, pode seguir"). A decisão é sempre dele.`,
    `- PERGUNTE quando precisar entender: se você realmente precisa saber a intenção pra ajudar bem, faça UMA pergunta curta ("qual a ideia aqui — uma service ou um repository?"). O dev responde discretamente por voz ou digitando (Ctrl+I). Não avance chutando errado — pergunte.`,
    `- Reconheça padrões legítimos de devs experientes SEM ele precisar explicar (interface antes da implementação, repository pattern, usar DUAS tecnologias juntas como Mongo + Redis, etc.). Desvio do seu plano NÃO é erro. Tecnologias podem coexistir — nunca force exclusividade ("apaga o Mongo e usa Redis" é proibido se ele quer os dois).`,
    `- O plano é uma SUGESTÃO, não uma regra. Se o dev muda de ideia, ATUALIZE o plano pro que ele está fazendo. Só se o caminho dele realmente não funcionar, ajude-o a concluí-lo do jeito dele e SÓ ENTÃO ofereça a alternativa — sem "eu avisei".`,
    `- ERRO SEMPRE COM SOLUÇÃO (crítico): se um ARQUIVO INTEIRO está genuinamente quebrado ou travando o avanço (não uma linha sendo digitada agora), NUNCA diga apenas "está errado" ou "apaga". SEMPRE mostre o EXEMPLO COMPLETO do arquivo certo pra aquela etapa. Apontar erro sem dar o exemplo completo é proibido.`,
    `- Aja com paciência: corrija e oriente, deixe o dev conduzir a tarefa. Ele muitas vezes está falando com OUTRA pessoa (entrevistador), não com você — não exija explicação nem atenção; infira a intenção pela ação.`
  );

  if (lesson.plan && (phase === 'guide' || phase === 'help')) {
    parts.push('', `[PLANO SUGERIDO — é um GUIA, NÃO uma regra]\n${lesson.plan}\n\nAcompanhe o dev ARQUIVO POR ARQUIVO, seguindo a ordem do plano. Se ele mudar de abordagem (por voz ou pela ação na tela), ADAPTE o plano ao que ELE está fazendo — não force o original nem mande apagar. Quando ele for COMEÇAR um arquivo da etapa atual, ou estiver TRAVADO nele, dê um EXEMPLO COMPLETO desse arquivo — não uma linha solta. NUNCA adiante de uma vez arquivos de etapas futuras. Quando aquele arquivo estiver pronto (ele seguiu em frente, criou o próximo), avance você também pro próximo item do plano sem precisar que ele peça. Se um arquivo inteiro estiver quebrado, mostre o JEITO CERTO completo — nunca só "apaga". Avance sem repetir o que já foi dito.`);
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
    // Manda o print ANTERIOR junto sempre que existir (não só quando o usuário fala) —
    // sem isso o modelo vê uma única foto estática e não tem como saber se uma linha
    // incompleta (ex.: `Map<`) é código sendo DIGITADO agora ou algo abandonado/quebrado.
    if (lastFrameBase64) {
      userContent.push(
        { type: 'text', text: 'Print anterior (referência — não comente sobre ele sozinho):' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${lastFrameBase64}`, detail: 'low' } }, // sempre low: só serve p/ comparar o que mudou
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

  // 'help'/'plan' pedem um arquivo de código INTEIRO na resposta — em cima do
  // raciocínio que modelos gpt-5.x já gastam sozinhos, 1500 tokens não sobra
  // espaço nenhum pro código e a resposta volta vazia. Orçamento bem maior só
  // nessas duas fases; o resto (guide oportunista, geralmente NOOP) fica em 1500.
  const tokenBudget = (phase === 'help' || phase === 'plan') ? 4000 : 1500;

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      // Modelos de VISÃO com raciocínio (gpt-5.x) gastam tokens "pensando" antes
      // de escrever — com orçamento curto o raciocínio consome tudo e a resposta
      // vem VAZIA (que o main descarta em silêncio → tutor mudo).
      ...maxTokensParam(model, tokenBudget),
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

  const choice = data.choices?.[0];
  const content = (choice?.message?.content || '').trim();
  if (!content) {
    // Diagnóstico real de por que veio vazio — guardado em lastVisionDiag pra
    // aparecer NA MENSAGEM que vai pro histórico (copiável), já que o terminal
    // do usuário não mostra os console.warn de forma confiável.
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
// HELPER — Verifica se a nova resposta contém um bloco de código idêntico a
// alguma dica recente (para evitar loops de repetição de código)
// ---------------------------------------------------------------------------
function containsDuplicateCodeBlock(newText, recentList) {
  if (!newText || !recentList || !recentList.length) return false;

  const extractCodeBlocks = (text) => {
    const blocks = [];
    const regex = /```[\s\S]*?```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push(match[0].replace(/```[a-zA-Z]*\n?|```/g, '').trim());
    }
    return blocks;
  };

  const newBlocks = extractCodeBlocks(newText);
  if (newBlocks.length === 0) return false;

  for (const recentText of recentList) {
    const recentBlocks = extractCodeBlocks(recentText);
    for (const nb of newBlocks) {
      if (recentBlocks.includes(nb)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// HELPER — Verifica se a explicação textual é muito similar à última dica
// ---------------------------------------------------------------------------
function isSimilarToLastTip(newText, lastTip) {
  if (!newText || !lastTip) return false;

  const clean = (str) => {
    return str
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, '') // remove blocos de código
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(w => w.length > 2);
  };

  const newWords = clean(newText);
  const lastWords = clean(lastTip);
  if (newWords.length === 0 || lastWords.length === 0) return false;

  let matches = 0;
  for (const word of newWords) {
    if (lastWords.includes(word)) {
      matches++;
    }
  }

  const ratio = matches / Math.max(newWords.length, lastWords.length);
  return ratio > 0.75;
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
  const doHelp = pendingHelp; pendingHelp = false;        // botão [h] "me ajuda, travei"
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
  let isDirectQuestion = false;
  // Pergunta de TEXTO direta (Ctrl+I) tem prioridade e não passa pelos filtros
  // de eco/filler — é uma pergunta explícita do usuário pro tutor.
  if (pendingQuestion) {
    userSpeech = pendingQuestion;
    hasNewMicSpeech = true;
    isDirectQuestion = true;
    pendingQuestion = null;
  }
  // Botão [h] tem intenção própria ("refaz o plano do que falta") — se o usuário
  // por acaso falou no mesmo tick, a ajuda tem prioridade e ignora a fala.
  if (doHelp) { userSpeech = ''; hasNewMicSpeech = false; }

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

    const answerIsNoop = !answer || answer === NOOP || answer.replace(/[\[\]]/g, '').trim().toUpperCase() === 'AGUARDAR';

    const requiresResponse = forced || isDirectQuestion;

    // Evita loops de repetição de dicas idênticas ou códigos duplicados
    const isDuplicate = !requiresResponse && (
      containsDuplicateCodeBlock(answer, recentGuidance) ||
      (recentGuidance.length > 0 && isSimilarToLastTip(answer, recentGuidance[recentGuidance.length - 1]))
    );

    if (isDuplicate) {
      emitStatus('watching');
      return;
    }

    // Turno que EXIGE resposta de verdade (forçado: intro/plano/ajuda — OU
    // pergunta direta do usuário por texto) mas o modelo respondeu vazio
    // ou [AGUARDAR] mesmo assim. NUNCA mostra o [AGUARDAR] na tela nem some em
    // silêncio quando o usuário fez uma ação explícita — avisa e tenta de novo.
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

    // Turno casual ou de escuta oportunista (mic) onde o modelo decidiu ficar
    // em silêncio. Retorna normalmente sem emitir erro.
    if (!requiresResponse && (!(answer && answer.trim()) || answerIsNoop)) {
      emitStatus('watching');
      return;
    }

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
    } else if (phase === 'guide' && !lesson.isTask) {
      const hasNewTask = /\[\[\s*TASK\s*\]\]/i.test(answer);
      if (hasNewTask) {
        lesson.isTask = true;
        lesson.planAnnounced = true;
        lesson.planDelivered = false; // força a geração do plano no próximo tick
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

    // Registra a conversa no histórico: fala/pergunta do dev (quando houve) como
    // 'user' e a orientação do tutor como 'assistant'. Não bloqueia o loop se falhar.
    if (userSpeech && userSpeech.trim()) await logToHistory('user', userSpeech);
    await logToHistory('assistant', outText);

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
      const errText = `⚠️ Não consegui analisar a tela agora: ${reason}. Sigo tentando.`;
      guidanceCb({ text: errText, ts: Date.now() });
      try { await logToHistory('assistant', errText); } catch (_) {} // copiável no histórico
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
    // Piso de silêncio entre dicas. 0 = A IA DECIDE quando falar. Usa ?? (não ||)
    // pra respeitar o 0 — com || o zero cai no fallback e o piso fixo volta sozinho.
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

  needsIntroduction = true; // Habilita a introdução para esta nova sessão
  lastFrameHash = null;
  lastFrameBase64 = null;
  lastInterventionAt = 0;
  audioMarker = 0; lastAudioMarkerSeen = 0;
  lastAudioTimestampProcessed = Date.now(); // Ignora áudios gravados antes de iniciar o Tutor
  recentGuidance.length = 0;
  recentAudio.length = 0;
  resetLesson();

  // Cria uma sessão de histórico nova pra ESTA aula: registra a conversa entre o
  // dev (user) e o tutor (assistant) no mesmo histórico do resto do app.
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
  pendingHelp = false;
  historySessionId = null;   // encerra o registro desta aula (nova sessão no próximo start)
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

// Botão [h] "me ajuda, fiquei perdido/travado" (modo integrado): tira um print
// AGORA, revisa o que já foi feito (dicas anteriores + print anterior + plano),
// dá uma análise curtíssima e entrega o exemplo completo do arquivo da etapa
// atual. Se a tela tiver um erro/bug, foca em resolvê-lo sem quebrar o resto.
function askHelp() {
  if (!running || paused) return;
  pendingHelp = true;
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

module.exports = { start, stop, pause, resume, isPaused, isActive, askQuestion, analyzeNow, askHelp, onGuidance, onStatus, onPauseChange, setContextProvider, getIdeAutocomplete, triggerIntroduction };
