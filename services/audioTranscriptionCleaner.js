// services/audioTranscriptionCleaner.js
//
// Utilitário centralizado de higienização de transcrições e eliminação de
// alucinações geradas pelo Whisper / gpt-4o-transcribe (especialmente em pausas de
// silêncio, ruído ambiente ou eco de prompt).

const { CORE, CATALOG } = require('./techGlossary');

const ALL_TECH_TERMS = new Set([
  ...CORE.map((t) => t.toLowerCase().trim()),
  ...(Object.values(CATALOG || {}).flat().map((t) => t.toLowerCase().trim())),
]);

// Padrões clássicos de alucinação do Whisper
const HALLUCINATION_PATTERNS = [
  /^(?:m[úu]sica(?:\s+de\s+fundo|\s+instrumental|\s+ambiente|\s+suave|\s+ao\s+fundo|\s+relaxante|\s+tema|\s+animada|\s+alegre|\s+triste|\s+cl[áa]ssica|\s+eletr[ôo]nica|\s+dram[áa]tica)?[\s.,!?:;]*)+$/i,
  /^(?:som\s+ambiente|ru[íi]do(?:\s+de\s+fundo)?|barulho(?:\s+de\s+fundo)?|sil[êe]ncio|aplausos|risos|palmas|vozes(?:\s+ao\s+fundo)?|tosse|suspiro)[\s.,!?:;]*$/i,
  /^(?:legendas(?:\s+pela\s+comunidade\s+amara\.org|\s+por\s+amara\.org)?|subtitles\s+by(?:\s+the\s+amara\.org\s+community)?|subt[íi]tulos\s+por)[\s.,!?:;]*$/i,
  /^(?:(?:obrigad[oa]\s+por\s+assistir|inscreva-se(?:\s+no\s+canal)?|se\s+inscreva(?:\s+no\s+canal)?|curta\s+e\s+compartilhe|deixe\s+seu\s+like|ative\s+o\s+sininho|at[ée]\s+a\s+pr[óo]xima|at[ée]\s+o\s+pr[óo]ximo\s+v[íi]deo|e\s+|valeu)[\s.,!?:;]*)+$/i,
  /^(?:transmiss[ãa]o(?:\s+encerrada)?|todos\s+os\s+direitos\s+reservados|copyright)[\s.,!?:;]*$/i,
  /^(?:(?:thank\s+you\s+for\s+watching|please\s+subscribe|thanks\s+for\s+watching|like\s+and\s+subscribe|and\s+)[\s.,!?:;]*)+$/i,
  /^(?:(?:https?:\/\/|www\.)[^\s]+\s*)+$/i,
  /^[a-z0-9\-._]+\.(?:com|org|net|io|tv|br|edu|gov|co|app|dev|me)(?:\/[^\s]*)?$/i,
  /^(?:chiado|estalos?|fritura|borbulha|sizzl(?:ing|e)|panela)[\s.,!?:;]*$/i,
  /^(?:steve\s+vozze[,\s]+whisper|whisper\s+transcription|whisper\s+ai|whisper)[\s.,!?:;]*$/i,
  /^(?:(?:bing[\s.,!?:;]+)?doisberg[\s.,!?:;\-]*sclarkey|doisberg|sclarkey)[\s.,!?:;]*$/i,
  /\b(?:doisberg|sclarkey)\b/i,
  /^(?:[.\-_*~=+\s,!?:;·…]+)$/,
  /^\[blank_audio\]$/i,
  /^\(sem\s+fala\)$/i,
];

/**
 * Detecta loops de repetição de palavras ou sílabas causados por alucinação do Whisper em áudio/música/ruído.
 * Ex: "Sapshopshopshopshopshop...", "da da da da da", "yeah yeah yeah"
 */
function isRepetitiveHallucination(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (t.length < 4) return false;

  // 1. Repetição de padrão de sílaba/substring dentro de palavras (ex: "Sapshopshopshopshopshop...")
  if (/(.{2,8})\1{4,}/i.test(t)) {
    return true;
  }

  // 2. Repetição da mesma palavra 3 ou mais vezes consecutivas (ex: "shop shop shop shop", "da da da da")
  if (/(\b\w{2,}\b)(?:[\s,]+\1){2,}/i.test(t)) {
    return true;
  }

  // 3. Sentenças com alta densidade de repetição de um mesmo termo (ex: > 40% das palavras são iguais)
  const words = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const freq = {};
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
      if (freq[w] >= 3 && (freq[w] / words.length) >= 0.4) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Detecta se uma string é um eco de prompt/glossário gerado por alucinação do Whisper.
 * Exemplo de alucinação: "context:\nSOLID, Clean Architecture, design patterns, Java..."
 * ou "SOLID, Clean Architecture, design patterns, Kafka, Docker..."
 */
function isGlossaryOrPromptEcho(text, glossaryPrompt = '') {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();

  // 1. Prefixo de contexto/glossário explícito (ex: "Vocabulário técnico: ...")
  if (/^(?:context|contexto|glossary|glossario|vocabul[aá]rio\s+t[ée]cnico|keywords?|prompt)\s*[:\-]/i.test(t)) {
    return true;
  }

  // 2. Se a frase tiver verbos ou conectores gramaticais, é uma fala real do usuário e NÃO um eco
  const hasConversationalWords = /\b(?:eu|voc[eê]|cria|criar|faz|fazer|mostra|mostrar|olha|olhar|ajuda|ajudar|como|quando|onde|porque|por\s*que|qual|quais|no|na|do|da|com|em|um|uma|tipo|para|pra|pro|tem|est[aá]|is|the|with|for|to|make|create|build|run|test|open|close|give|get|set)\b/i.test(t);
  if (hasConversationalWords) {
    return false;
  }

  // 3. Se for uma lista crua de termos separados por vírgula/ponto-e-vírgula sem nenhuma estrutura gramatical
  const items = t.split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean);
  if (items.length >= 4) {
    let techHits = 0;
    for (const item of items) {
      const lower = item.toLowerCase();
      if (ALL_TECH_TERMS.has(lower) || CORE.some((c) => c.toLowerCase() === lower)) {
        techHits++;
      }
    }
    // Se praticamente todos os itens forem palavras-chave isoladas do glossário sem verbo
    if (techHits >= 4 && (techHits / items.length) >= 0.8) {
      return true;
    }
  }

  return false;
}

/**
 * Normaliza distorções fonéticas comuns geradas pelo Whisper ou STT
 * ao transcrever jargão e termos de desenvolvimento falados em PT-BR e Inglês.
 *
 * Exemplos:
 *  - "helper node", "elper node", "help node", "helper note" -> "helper-node"
 *  - "Geet", "guite" -> "Git"
 *  - "comit" -> "commit"
 *  - "nessa brente", "a brent", "na brenti" -> "nessa branch", "a branch", "na branch"
 *  - "no isper", "o isper" -> "no Whisper", "o Whisper"
 *
 * @param {string} text
 * @returns {string}
 */
function normalizeDevPhonetics(text) {
  if (!text || typeof text !== 'string') return '';

  let res = text;

  // 1. Variações fonéticas de helper-node e website-helper-node
  res = res.replace(/\b(?:website\s*helper\s*node|site\s*helper\s*node|website-helper-node)\b/gi, 'website-helper-node');
  res = res.replace(/\b(?:helper\s*node|helper\s*nodi|help\s*node|helper\s*note|elper\s*node|elper\s*nodi|helpenode|ajudador\s*node)\b/gi, 'helper-node');

  // 2. Variações de Ctrl+D
  res = res.replace(/\b(?:control\s*d|controle\s*d|control\s*de|ctrl\s*d)\b/gi, 'Ctrl+D');

  // 3. Variações fonéticas de Nexa ("né xa", "né, xa", "nèxa", "néxa")
  res = res.replace(/\b(?:n[eé],\s*xa|n[eé]\s+xa)\b/gi, 'Nexa');
  res = res.replace(/\b(?:n[eè]xa|n[eé]xa)\b/gi, 'Nexa');

  // 4. Variações fonéticas de Git ("Geet", "guite")
  res = res.replace(/\b(?:geet|guite)\b/gi, 'Git');

  // 5. Variações fonéticas de Commit ("comit" com 1 m isolado)
  res = res.replace(/\bcomit\b/gi, 'commit');
  res = res.replace(/\bcomitando\b/gi, 'commitando');

  // 6. Variações fonéticas de Branch ("brente", "brenti", "brench", "brent", "brain" em contexto git)
  res = res.replace(/\b(comita|comitar|comite|commit|checkout|switch|merge|cria|criar|muda|mudar|entra|entrar|vai pra|vai para|nessa|nesta|na|da|a|uma|nova|sua)\s+(?:a\s+)?(?:brent[ei]?|brain)\b/gi, '$1 branch');
  res = res.replace(/\b(brent[ei]?|brain)\s+(main|master|develop|feature|bugfix|release|hotfix)\b/gi, 'branch $2');
  res = res.replace(/\b(traduzindo para a|mudando para a|criando a)\s+(?:brent|brain)\b/gi, '$1 branch');
  res = res.replace(/\bbrench\b/gi, 'branch');

  // 7. Variações fonéticas de Whisper ("isper", "uísper", "expert" em contexto de transcrição/áudio)
  res = res.replace(/\b(no|do|o|pro|para o|pelo)\s+isper\b/gi, '$1 Whisper');
  res = res.replace(/\b(?:u[íi]sper|isper)\b/gi, 'Whisper');
  res = res.replace(/\b(no|do|o|pro|para o|pelo)\s+expert(?=\s+(?:para|entender|transcrever|capturar|reconhecer|ouvir|gravar|traduzir|processar))\b/gi, '$1 Whisper');
  res = res.replace(/\bexpert\s+(?:n[ãa]o\s+est[áa]\s+conseguindo\s+entender)\b/gi, 'Whisper não está conseguindo entender');

  // 8. Pull request / Code review
  res = res.replace(/\bpuli\s+request\b/gi, 'pull request');
  res = res.replace(/\bcode\s+revi[eê]u\b/gi, 'code review');

  return res;
}

/**
 * Limpa e valida o texto transcrito.
 * Retorna o texto higienizado, ou '' se for ruído, silêncio ou alucinação.
 *
 * @param {string} rawText
 * @param {string} [glossaryPrompt]
 * @returns {string}
 */
function cleanTranscription(rawText, glossaryPrompt = '') {
  if (!rawText || typeof rawText !== 'string') return '';

  let clean = rawText
    .replace(/\[\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '')
    .trim();

  // Remove marcas de áudio entre colchetes [...], chaves {...} ou parênteses (...)
  clean = clean.replace(/\[[^\]]*\]/g, ' ').replace(/\([^\)]*\)/g, ' ').replace(/\{[^\}]*\}/g, ' ');
  clean = clean.replace(/\s+/g, ' ').trim();

  if (!clean || clean.length < 2) return '';

  // Checa alucinações clássicas de ruído
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(clean)) return '';
  }

  if (/^(?:m[úu]sica[s]?[\s.,!?;:]*)+$/i.test(clean)) return '';

  // Checa alucinações de eco de contexto/glossário
  if (isGlossaryOrPromptEcho(clean, glossaryPrompt)) {
    return '';
  }

  // Checa alucinações de repetição/loops geradas em música ou ruído ambiente
  if (isRepetitiveHallucination(clean)) {
    return '';
  }

  // Normaliza distorções fonéticas de termos técnicos em PT-BR
  clean = normalizeDevPhonetics(clean);

  return clean;
}

module.exports = {
  cleanTranscription,
  normalizeDevPhonetics,
  isGlossaryOrPromptEcho,
  isRepetitiveHallucination,
  HALLUCINATION_PATTERNS,
};
