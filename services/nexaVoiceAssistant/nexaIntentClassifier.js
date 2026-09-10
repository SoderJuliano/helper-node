/**
 * services/nexaVoiceAssistant/nexaIntentClassifier.js
 * 
 * Classificador leve e determinístico de intenção para o Modo de Voz Ativo da Nexa.
 * Avalia a transcrição de áudio e determina a ação correta com ZERO custo de tokens:
 * 
 * 1. 'IGNORE':
 *    - Menção da Nexa em 3ª pessoa / apresentação a terceiros (ex: "Essa é a Nexa...", "Apresentando a Nexa").
 *    - Conversas de terceiros ou ruídos onde a Nexa não foi solicitada a responder.
 * 
 * 2. 'REACT_ANIMATION_ONLY':
 *    - Pedidos de gestos ou saudações sem necessidade de resposta falada (ex: "Nexa dá tchauzinho", "Nexa faz um coração", "Dança Nexa", "Nexa, hora do café").
 * 
 * 3. 'RESPOND_AUDIO_AND_CHAT':
 *    - Perguntas diretas, comandos técnicos ou conversação destinada à Nexa (ex: "Nexa, qual a previsão do tempo?", "Nexa, como cria um controller Java").
 */

function stripAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Padrões de ativação por Wake Word e variações fonéticas geradas pelo Whisper (PT-BR)
// Exemplos comuns: Nexa, Naxa, Nessa, Neza, Neksa, Nexus, Nexxa, Neca, Necca, Necha, Nixa, Alexa, Anexa
const WAKE_WORD_REGEX = /\b(nexa|naxa|neza|neksa|nexus|nexxa|neca|necca|necha|nixa|alexa|anexa)\b|^(ei|oi|ola|olá|fala|opa|bom dia|boa tarde|boa noite|alo|alô)?\s*nessa\b|\bnessa\b(?=[,\s:!?]+(voce|vc|tudo|como|o que|qual|quando|onde|me|pode|faz|da|ajuda|ta|esta|estas|ai|escuta|ouve|olha|\?))/i;
const WAKE_WORD_WORDS_PATTERN = "(nexa|naxa|nessa|neza|neksa|nexus|nexxa|neca|necca|necha|nixa|alexa|anexa)";

// Expressões de apresentação em 3ª pessoa (NÃO deve responder por áudio)
const THIRD_PERSON_PRESENTATION_PATTERNS = [
  /\b(essa|esta|aqui)\s+(e|eh)\s+(a\s+)?(nexa)\b/i,
  /\b(apresento|apresentando|mostrando)\s+(a\s+)?(nexa)\b/i,
  /\b(conhecam|vejam)\s+(a\s+)?(nexa)\b/i,
  /\b(a\s+)?(nexa)\s+(e|eh)\s+(uma|minha|nossa)\s+(ia|assistente|ferramenta|aplicacao|software)\b/i,
  /\b(gravei|estou gravando|gravando video|pro youtube|video)\s+.*(nexa)\b/i,
  /\b(falei da|falei sobre a|comentando da)\s+(nexa)\b/i,
  /\b(o nome dela|o nome do assistente)\s+(e|eh)\s+(nexa)\b/i,
];

// Pedidos específicos de animação/gestos (apenas animação, sem áudio longo)
const GESTURE_ANIMATION_MAPPINGS = [
  {
    animation: "wave",
    patterns: [
      /\b(da|manda|faz|acena|aceno)\s+(um\s+)?(tchau|tchauzinho|ola|aceno|maozinha|mãozinha)\b/i,
      /\b(cumprimenta|cumprimente|diz oi|fala oi)\b/i,
      /\b(da um alo|manda um alo)\b/i,
    ]
  },
  {
    animation: "heart",
    patterns: [
      /\b(faz|manda|mostra|cria)\s+(um\s+)?(coracao|s2|coracaozinho)\b/i,
      /\b(manda amor|demonstra carinho)\b/i,
    ]
  },
  {
    animation: "cute",
    patterns: [
      /\b(fica|faz pose|faz cara|faz carinha)\s+(fofa|fofinha|timida|cute)\b/i,
      /\b(que fofa|fofura|vergonha)\b/i,
    ]
  },
  {
    animation: "dance",
    patterns: [
      /\b(danca|dancar|dancinha|faz uma dancinha|comemora|comemore)\b/i,
    ]
  },
  {
    animation: "coffee",
    patterns: [
      /\b(toma|bebe|hora do|pega um)\s+(cafe|cafezinho|cha)\b/i,
      /\b(pausa pro cafe|hora do cafe)\b/i,
    ]
  },
  {
    animation: "adjust_glasses",
    patterns: [
      /\b(arruma|ajusta|ajeita|limpa)\s+(os\s+)?(oculos)\b/i,
      /\b(pose de dev|pose inteligente)\b/i,
    ]
  },
  {
    animation: "stretching_arms",
    patterns: [
      /\b(se espreguica|alongamento|estica os bracos)\b/i,
    ]
  }
];

class NexaIntentClassifier {
  /**
   * Classifica a transcrição de voz.
   * @param {string} rawText Texto bruto recebido do Whisper
   * @param {Object} [options]
   * @param {boolean} [options.followUpActive=false] Se a janela de follow-up (8s) está ativa
   * @returns {{ action: 'IGNORE'|'REACT_ANIMATION_ONLY'|'RESPOND_AUDIO_AND_CHAT', cleanedQuery?: string, animation?: string, animationHint?: string, reason?: string }}
   */
  static classify(rawText, options = {}) {
    const text = String(rawText || "").trim();
    if (!text) {
      return { action: "IGNORE", reason: "Texto vazio" };
    }

    const normalizedText = stripAccents(text);
    const followUpActive = !!options.followUpActive;
    const hasWakeWord = WAKE_WORD_REGEX.test(normalizedText);

    // Se o nome Nexa não foi falado e não estamos em janela de follow-up ativa, descarta silenciosamente
    if (!hasWakeWord && !followUpActive) {
      return { action: "IGNORE", reason: "Wake word ausente e sem follow-up ativo" };
    }

    // 1. Checagem de apresentação em 3ª pessoa (ex: "Essa aqui é a Nexa, minha assistente")
    for (const pattern of THIRD_PERSON_PRESENTATION_PATTERNS) {
      if (pattern.test(normalizedText)) {
        // Se a frase também pedir explicitamente uma saudação (ex: "Essa é a Nexa, dá um tchauzinho")
        for (const gesture of GESTURE_ANIMATION_MAPPINGS) {
          for (const p of gesture.patterns) {
            if (p.test(normalizedText)) {
              return {
                action: "REACT_ANIMATION_ONLY",
                animation: gesture.animation,
                reason: "Apresentação com pedido de gesto (" + gesture.animation + ")"
              };
            }
          }
        }

        // Caso seja apenas apresentação em 3ª pessoa sem pergunta:
        // Nexa reage com aceno amigável 'wave' silenciosamente (sem emitir áudio para não interromper a apresentação do usuário).
        return {
          action: "REACT_ANIMATION_ONLY",
          animation: "wave",
          reason: "Apresentação a terceiros detectada (aceno silencioso)"
        };
      }
    }

    // 2. Checagem de comandos diretos de gesto/animação (ex: "Nexa, faz um coraçãozinho", "Nexa dança")
    for (const gesture of GESTURE_ANIMATION_MAPPINGS) {
      for (const p of gesture.patterns) {
        if (p.test(normalizedText)) {
          return {
            action: "REACT_ANIMATION_ONLY",
            animation: gesture.animation,
            reason: "Pedido direto de gesto (" + gesture.animation + ")"
          };
        }
      }
    }

    // 3. Pergunta ou comando direto endereçado à Nexa
    // Limpa a palavra-chave de invocação para enviar uma pergunta limpa à IA
    let cleanedQuery = text;
    if (hasWakeWord) {
      cleanedQuery = text
        .replace(/^(ei|oi|olá|ola|e\s+aí|e\s+ai|opa|fala|alô|alo)?\s*(nexa|néxa|nèxa|nexá|naxa|nessa|neza|neksa|nexus|nexxa|neca|necca|necha|nixa|alexa|anexa)[,\s:!]*/i, "")
        .replace(/[,\s]*(nexa|néxa|nèxa|nexá|naxa|nessa|neza|neksa|nexus|nexxa|neca|necca|necha|nixa|alexa|anexa)[,\s:!?.]*$/i, "")
        .trim();
    }

    // Se após limpar só sobrou saudação simples (ex: "Oi Nexa", "Nexa!", "Nessa você está aí.", "tudo bem?")
    const cleanNorm = stripAccents(cleanedQuery).toLowerCase().replace(/[.,!?;:]+$/g, "").trim();
    if (!cleanedQuery || /^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|como vai|voce esta ai|vc esta ai|esta ai|estas ai)$/i.test(cleanNorm)) {
      return {
        action: "RESPOND_AUDIO_AND_CHAT",
        cleanedQuery: cleanedQuery || "Olá!",
        animationHint: "wave",
        isCasualGreeting: true,
        reason: "Saudação casual direta"
      };
    }

    // Sugestão de animação contextual com base no conteúdo da pergunta
    let animationHint = "thinking";
    if (cleanNorm.includes("codigo") || cleanNorm.includes("classe") || cleanNorm.includes("arquivo") || cleanNorm.includes("funcao") || cleanNorm.includes("criar") || cleanNorm.includes("escrever")) {
      animationHint = "writing_code";
    } else if (cleanNorm.includes("obrigado") || cleanNorm.includes("valeu") || cleanNorm.includes("agradeco") || cleanNorm.includes("parabens")) {
      animationHint = "cute";
    }

    return {
      action: "RESPOND_AUDIO_AND_CHAT",
      cleanedQuery,
      animationHint,
      isCasualGreeting: false,
      reason: "Pergunta/Comando ativo endereçado à Nexa"
    };
  }
}

module.exports = NexaIntentClassifier;
