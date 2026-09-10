/**
 * services/nexaVoiceAssistant/nexaIntentClassifier.js
 * 
 * Classificador determinístico de intenção para o Modo de Voz Ativo da Nexa.
 * Distingue com precisão comandos e conversas reais do usuário de:
 * 1. Músicas, vídeos do YouTube, podcasts e áudios reproduzidos no ambiente ou alto-falantes.
 * 2. Conversas paralelas e menções em 3ª pessoa.
 * 3. Alucinações de ruído do Whisper.
 */

function stripAccents(str) {
  return String(str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Padrões de ativação por Wake Word estritos e variações fonéticas válidas
// Rejeita categoricamente falsos positivos como "nessa casa", "nessa branch", "nesse apartamento", "neca", "nexus"
const WAKE_WORD_EXACT = /\b(nexa|n[eéè]xa|nexxa|neksa)\b/i;
const WAKE_WORD_WITH_GREETING = /\b(?:ei|oi|ol[aá]|fala|opa|bom\s+dia|boa\s+tarde|boa\s+noite|al[oô])\s+(?:nexa|n[eéè]xa|nexxa|neksa|naxa|neza|nessa)\b/i;
const WAKE_WORD_WITH_VOCATIVE = /\b(?:nexa|n[eéè]xa|nexxa|neksa|naxa|neza|nessa)\s*[,:!?]+\s*(?:voc[eê]|vc|tudo|como|o\s+que|qual|quando|onde|por\s*que|porque|me|pode|faz|d[aá]|ajuda|t[aá]|est[aá]|est[aá]s|a[ií]|escuta|ouve|olha|\?)/i;
const WAKE_WORD_PHONETIC_DIRECT = /^nessa\s+(?:voc[eê]|vc)\s+(?:est[aá]|t[aá])\s+a[ií]/i;
const WAKE_WORD_AT_END = /[,\s]+(?:nexa|n[eéè]xa)\s*[!?.]*$/i;

// Padrões de links/alucinações ou ruídos que devem ser descartados imediatamente
const URL_OR_NOISE_PATTERNS = [
  /^(?:(?:https?:\/\/|www\.)[^\s]+\s*)+$/i,
  /^[a-z0-9\-._]+\.(?:com|org|net|io|tv|br|edu|gov|co|app|dev|me)(?:\/[^\s]*)?$/i,
  /^(?:[a-z0-9\-._]+\.(?:com|org|net|br)\/[^\s]*\s*)+$/i,
  /^(?:chiado|estalos?|fritura|borbulha|sizzl(?:ing|e)|panela)[\s.,!?:;]*$/i,
  /^(?:steve\s+vozze|whisper)[\s.,!?:;]*$/i,
];

// Padrões de conversa com terceiros / família / filhos na sala (NÃO deve responder)
// Ex: "Filho, vai almoçar", "Guarda seus brinquedos", "Amor, você viu a chave?", "Vem aqui, filho"
const THIRD_PARTY_CONVERSATION_PATTERNS = [
  /\b(?:filho|filha|amor|esposa|marido|m[aã]e|pai|galera|pessoal|gente|voc[eê]s|meninos?|meninas?|cara|mano|bicho)\b/i,
  /\b(?:vai\s+(?:dormir|almo[çc]ar|jantar|tomar\s+banho|estudar|brincar|pro\s+quarto|pra\s+cama))\b/i,
  /\b(?:guarda\s+(?:os\s+brinquedos|isso|suas\s+coisas|o\s+material))\b/i,
  /\b(?:arruma\s+(?:o\s+quarto|a\s+cama|a\s+casa|a\s+mesa))\b/i,
  /\b(?:desliga\s+(?:a\s+tv|o\s+videogame|o\s+jogo|o\s+celular|a\s+luz))\b/i,
  /\b(?:come\s+(?:a\s+comida|o\s+almo[çc]o|a\s+janta|tudo)|fez\s+a\s+li[çc][ãa]o|fez\s+o\s+dever|escovou\s+os\s+dentes)\b/i,
  /\b(?:olha\s+(?:o\s+cachorro|o\s+gato|o\s+carro|a\s+panela|quem\s+est[aá]\s+a[ií]))\b/i,
  /\b(?:atende\s+(?:o\s+telefone|a\s+porta|o\s+interfone))\b/i,
  /\b(?:vem\s+(?:c[aá]|aqui|almo[çc]ar|jantar|comer|tomar\s+caf[eé]))\b/i,
];

// Padrões de comandos de parada / interrupção / silêncio (Barge-In)
const STOP_COMMAND_PATTERNS = [
  /^(?:(?:ei|oi|ok|ol[aá])\s+)?(?:nexa|n[eéè]xa)?[,\s]*(?:para|pare|cancela|cancelar|cala\s+a\s+boca|quiet[ao]|sil[êe]ncio|chega|stop|interrompe|interromper|pausa|pausar)[,\s]*(?:nexa|n[eéè]xa)?[!\s.,]*$/i,
  /^(?:para|pare|cancela|cancelar|cala\s+a\s+boca|sil[êe]ncio|chega|stop)[,\s]*(?:nexa|n[eéè]xa)?[!\s.,]*$/i,
];

// Padrões de conectores e finais incompletos de frases (para não cortar no meio da fala)
const INCOMPLETE_SENTENCE_CONNECTORS = [
  /\b(?:e|ou|mas|que|se|como|para|pra|quando|onde|porque|por\s*que|no|na|do|da|com|em|um|uma|tipo|de)\s*[.,!?]*$/i,
];

// Padrões de áudio de mídia, vídeos do YouTube, podcasts, tutoriais ou monólogos contínuos
const AMBIENT_MEDIA_OR_MONOLOGUE_PATTERNS = [
  /\b(?:nesse|neste|no\s+nosso|no\s+meu)\s+(?:v[ií]deo|canal|podcast|epis[oó]dio|tutorial|vlog|reels?|shorts?|stories|curso|artigo|post)\b/i,
  /\b(?:vou\s+te\s+mostrar|vou\s+mostrar\s+pra\s+voc[eê]s?|hoje\s+eu\s+vou|hoje\s+vamos\s+falar|hoje\s+vamos\s+ver|nesse\s+conte[uú]do)\b/i,
  /\b(?:deixe\s+(?:nos|o\s+seu)\s+coment[aá]rios?|comentem\s+aqui|link\s+na\s+descri[çc][ãa]o|na\s+descri[çc][ãa]o\s+do\s+v[ií]deo)\b/i,
  /\b(?:sejam\s+bem[- ]vindos|fala\s+galera|fala\s+pessoal|e\s+a[ií]\s+pessoal|ol[aá]\s+a\s+todos)\b/i,
  /\b(?:inscreva-se|se\s+inscreva|deixe\s+seu\s+like|ative\s+o\s+sininho|compartilhe\s+com\s+os\s+amigos)\b/i,
  /\b(?:o\s+gasto\s+que\s+mais|eu\s+descobri\s+esse\s+valor|eu\s+pago\s+\d+|esse\s+dinheiro\s+foi|apartamento\s+que\s+tem)\b/i,
  /\b(?:quando\s+eu\s+era|quando\s+eu\s+tinha|na\s+minha\s+opini[ãa]o|minha\s+experi[êe]ncia)\b/i,
  /\b(?:steve\s+vozze|whisper)\b/i,
];

// Expressões de apresentação em 3ª pessoa (NÃO deve responder por áudio)
const THIRD_PERSON_PRESENTATION_PATTERNS = [
  /\b(?:essa|esta|aqui)\s+(?:e|eh)\s+(?:a\s+)?(?:nexa)\b/i,
  /\b(?:apresento|apresentando|mostrando)\s+(?:a\s+)?(?:nexa)\b/i,
  /\b(?:conhecam|vejam)\s+(?:a\s+)?(?:nexa)\b/i,
  /\b(?:a\s+)?(?:nexa)\s+(?:e|eh)\s+(?:uma|minha|nossa)\s+(?:ia|assistente|ferramenta|aplicacao|software)\b/i,
  /\b(?:gravei|estou gravando|gravando video|pro youtube|video)\s+.*(?:nexa)\b/i,
  /\b(?:falei da|falei sobre a|comentando da|conversando com a|falando com a)\s+(?:nexa)\b/i,
  /\b(?:o nome dela|o nome do assistente)\s+(?:e|eh)\s+(?:nexa)\b/i,
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

// Padrões que indicam intenção conversacional ativa em janela de follow-up
const CONVERSATIONAL_FOLLOW_UP_PATTERNS = [
  /\b(?:e\s+como|e\s+se|e\s+no|e\s+na|qual|quais|como|quando|onde|por\s*que|porque|quem|quanto|quantos|o\s+que|que|\?)\b/i,
  /\b(?:pode|consegue|mostra|v[eê]|explica|faz|troca|muda|cria|adiciona|remove|comita|atualiza|continua|tem\s+como|ajuda|executa|roda|testa|abre|fecha|salva)\b/i,
  /\b(?:sim|n[aã]o|pode\s+ser|com\s+certeza|isso|exato|exatamente|perfeito|valeu|obrigad[oa]|entendi|beleza|otimo|ótimo)\b/i,
];

class NexaIntentClassifier {
  /**
   * Verifica se a string contém uma invocação válida por Wake Word.
   */
  static hasValidWakeWord(normalizedText) {
    if (!normalizedText) return false;
    return (
      WAKE_WORD_EXACT.test(normalizedText) ||
      WAKE_WORD_WITH_GREETING.test(normalizedText) ||
      WAKE_WORD_WITH_VOCATIVE.test(normalizedText) ||
      WAKE_WORD_PHONETIC_DIRECT.test(normalizedText) ||
      WAKE_WORD_AT_END.test(normalizedText)
    );
  }

  /**
   * Verifica se a frase parece estar cortada no meio (termina em conector ou vírgula).
   */
  static isSentenceIncomplete(text) {
    if (!text || typeof text !== "string") return false;
    const t = text.trim();
    if (t.endsWith(",")) return true;
    const norm = stripAccents(t).toLowerCase();
    return INCOMPLETE_SENTENCE_CONNECTORS.some((p) => p.test(norm));
  }

  /**
   * Classifica a transcrição de voz.
   * @param {string} rawText Texto bruto recebido do Whisper
   * @param {Object} [options]
   * @param {boolean} [options.followUpActive=false] Se a janela de follow-up está ativa
   * @returns {{ action: 'IGNORE'|'REACT_ANIMATION_ONLY'|'RESPOND_AUDIO_AND_CHAT'|'STOP_AND_LISTEN', cleanedQuery?: string, animation?: string, animationHint?: string, reason?: string, expireFollowUp?: boolean }}
   */
  static classify(rawText, options = {}) {
    const text = String(rawText || "").trim();
    if (!text) {
      return { action: "IGNORE", expireFollowUp: true, reason: "Texto vazio" };
    }

    // 0. Descarta imediatamente links, URLs web ou ruídos ambientais
    for (const pattern of URL_OR_NOISE_PATTERNS) {
      if (pattern.test(text)) {
        return { action: "IGNORE", expireFollowUp: true, reason: "URL ou ruído descartado" };
      }
    }

    const normalizedText = stripAccents(text);
    const followUpActive = !!options.followUpActive;

    // 1. Comandos imediatos de parada/interrupção de áudio (Barge-In)
    for (const pattern of STOP_COMMAND_PATTERNS) {
      if (pattern.test(normalizedText)) {
        return {
          action: "STOP_AND_LISTEN",
          reason: "Comando de parada / silêncio detectado (barge-in)",
          expireFollowUp: false
        };
      }
    }

    // 2. Checagem de apresentação em 3ª pessoa (ex: "Pessoal, essa aqui é a Nexa, minha assistente")
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

    // 3. Descarta conversas paralelas com outras pessoas no cômodo (filhos, cônjuge, família, colegas)
    // Ex: "Filho, vai almoçar", "Guarda seus brinquedos", "Amor, vem cá", a menos que comece explicitamente com "Nexa, ..."
    const hasExplicitNexaVocativePrefix = /^(?:ei|oi|ol[aá])?\s*(?:nexa|n[eéè]xa)\s*[,:]/i.test(normalizedText);
    for (const pattern of THIRD_PARTY_CONVERSATION_PATTERNS) {
      if (pattern.test(normalizedText) && !hasExplicitNexaVocativePrefix) {
        return {
          action: "IGNORE",
          expireFollowUp: true,
          reason: "Conversa com terceiros/família detectada (não direcionada à Nexa)"
        };
      }
    }

    const hasWakeWord = NexaIntentClassifier.hasValidWakeWord(normalizedText);

    // Se o nome Nexa não foi falado e não estamos em janela de follow-up ativa, descarta silenciosamente
    if (!hasWakeWord && !followUpActive) {
      return { action: "IGNORE", expireFollowUp: false, reason: "Wake word ausente e sem follow-up ativo" };
    }

    // Se está em follow-up sem wake word: validação rigorosa contra áudios de vídeo/música/monólogos de fundo
    if (!hasWakeWord && followUpActive) {
      // 1. Descarta ruídos curtos, interjeições isoladas
      if (text.length < 5 || /^(?:ok|hmm|ah|eh|opa|hum|e|uh)[\s.,!?]*$/i.test(text)) {
        return { action: "IGNORE", expireFollowUp: true, reason: "Ruído curto ou interjeição isolada em follow-up" };
      }

      // 2. Descarta narração de vídeos do YouTube, podcasts ou histórias de terceiros
      for (const pattern of AMBIENT_MEDIA_OR_MONOLOGUE_PATTERNS) {
        if (pattern.test(normalizedText)) {
          return { action: "IGNORE", expireFollowUp: true, reason: "Áudio de mídia ou narração de vídeo descartado em follow-up" };
        }
      }

      // 3. Verifica se possui estrutura de conversa/pergunta
      const words = normalizedText.split(/\s+/).filter(Boolean);
      const isConversational = CONVERSATIONAL_FOLLOW_UP_PATTERNS.some((p) => p.test(normalizedText));
      
      // Se for uma fala longa (> 8 palavras) sem nenhuma estrutura conversacional ou pergunta, é som de fundo/vídeo
      if (words.length > 8 && !isConversational && !text.includes("?")) {
        return { action: "IGNORE", expireFollowUp: true, reason: "Monólogo ou conversa de terceiros sem intenção conversacional" };
      }
    }

    // 4. Checagem de comandos diretos de gesto/animação (ex: "Nexa, faz um coraçãozinho", "Nexa dança")
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
        .replace(/^(?:ei|oi|olá|ola|e\s+aí|e\s+ai|opa|fala|alô|alo)?\s*(?:nexa|néxa|nèxa|nexá|naxa|nessa|neza|neksa|nexxa)[,\s:!]*/i, "")
        .replace(/[,\s]*(?:nexa|néxa|nèxa|nexá|naxa|nessa|neza|neksa|nexxa)[,\s:!?.]*$/i, "")
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
