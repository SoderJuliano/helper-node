// services/realtimeQuestionHeuristics.js
//
// Heuristicas LOCAIS (custo zero, sem round-trip) usadas pelo disparo
// especulativo do assistente em tempo real.
//
// Substituem o antigo classificador `gpt-4.1-nano`, que gastava uma chamada
// inteira a cada checagem so' pra responder "e' uma pergunta?".

// Heuristica LOCAL de pergunta completa. Substitui o antigo classificador
// gpt-4.1-nano, que custava um round-trip inteiro por checagem.
function looksLikeCompleteQuestion(text) {
  let t = text.toLowerCase().trim();
  if (t.endsWith('?')) return true;
  if (t.split(/\s+/).filter(Boolean).length < 5) return false;

  // Fala real de entrevistador quase nunca começa na pergunta — vem com muleta
  // ("So how would you…", "Beleza, me fala…"). Sem tirar isso, a âncora de
  // início nunca casa e o disparo especulativo simplesmente não acontece.
  t = t.replace(/^(?:(?:so|ok|okay|alright|right|well|now|and|but|yeah|yes|hi|hii|hello|hey|um|uh|então|entao|bom|beleza|certo|tá|ta|olá|ola|oi|legal|perfeito|ótimo|otimo|agora|e aí|e ai)[\s,.!]+){1,4}/, '');

  const CUE = '(?:como|qual|quais|quando|onde|quem|por que|porque|o que|me fala|me conta|me diz|me explica|voce pode|você pode|poderia|pode explicar|explica|fala sobre|conta sobre|descreve|what|how|why|when|where|who|which|can you|could you|would you|do you|did you|have you|tell me|walk me|describe|explain|give me)';
  // Aceita a deixa no início OU logo depois de uma fronteira de oração —
  // cobre "Hi there, tell me about yourself".
  return new RegExp(`(?:^|[,.;:]\\s*)${CUE}\\b`).test(t);
}

// Duas perguntas sao "a mesma" se o texto final so acrescentou pontuacao ou um
// rabicho curto ao que ja foi especulado.
function sameQuestion(a, b) {
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  return nb.startsWith(na) && (nb.length - na.length) <= 12;
}


module.exports = { looksLikeCompleteQuestion, sameQuestion };
