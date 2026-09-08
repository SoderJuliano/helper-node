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
  /^(?:[.\-_*~=+\s,!?:;·…]+)$/,
  /^\[blank_audio\]$/i,
  /^\(sem\s+fala\)$/i,
];

/**
 * Detecta se uma string é um eco de prompt/glossário gerado por alucinação do Whisper.
 * Exemplo de alucinação: "context:\nSOLID, Clean Architecture, design patterns, Java..."
 * ou "SOLID, Clean Architecture, design patterns, Kafka, Docker..."
 */
function isGlossaryOrPromptEcho(text, glossaryPrompt = '') {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();

  // 1. Prefixo de contexto/glossário explícito
  if (/^(?:context|contexto|glossary|glossario|vocabul[aá]rio|keywords?|prompt)\s*[:\-]/i.test(t)) {
    const afterPrefix = t.replace(/^(?:context|contexto|glossary|glossario|vocabul[aá]rio|keywords?|prompt)\s*[:\-]\s*/i, '').trim();
    // Se o que vem após o prefixo for vazio ou uma sequência de termos técnicos
    if (!afterPrefix || isGlossaryOrPromptEcho(afterPrefix, glossaryPrompt)) {
      return true;
    }
  }

  // 2. Se for uma lista de termos separados por vírgula/ponto-e-vírgula/quebra de linha sem estrutura de oração
  const items = t.split(/[,;\n\r]+/).map((s) => s.trim()).filter(Boolean);
  if (items.length >= 3) {
    let techHits = 0;
    for (const item of items) {
      const lower = item.toLowerCase();
      if (ALL_TECH_TERMS.has(lower) || CORE.some((c) => c.toLowerCase() === lower)) {
        techHits++;
      }
    }
    // Se a grande maioria dos itens forem palavras-chave isoladas do glossário
    if (techHits >= 3 && (techHits / items.length) >= 0.5) {
      return true;
    }
  }

  // 3. Comparação direta com o prompt usado na transcrição
  if (glossaryPrompt && typeof glossaryPrompt === 'string') {
    const normText = t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const normPrompt = glossaryPrompt.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (normText && normPrompt) {
      if (normPrompt.includes(normText) && normText.length > 20) return true;
      if (normText.includes(normPrompt) && normPrompt.length > 20) return true;
    }
  }

  return false;
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

  return clean;
}

module.exports = {
  cleanTranscription,
  isGlossaryOrPromptEcho,
  HALLUCINATION_PATTERNS,
};
