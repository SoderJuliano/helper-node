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
// Rejeita categoricamente falsos positivos como "nessa casa", "nessa branch", "nesse apartamento", "nexus"
const WAKE_WORD_EXACT = /\b(nexa|n[eéè]xa|nexxa|neksa|naxa|neza|dexa|decsa|nanax|nanaxa|nanex|nanexa|nanac|nanak|neca|neka|nex|nax|nexia|anexa|messa|mexa)\b/i;
const WAKE_WORD_WITH_GREETING = /\b(?:ei|oi|ol[aá]|fala|opa|bom\s+dia|boa\s+tarde|boa\s+noite|al[oô]|e\s+a[ií]|perfeito|beleza|show|pronto|certo|ent[aã]o|ok|por\s+favor)\s+(?:nexa|n[eéè]xa|nexxa|neksa|naxa|neza|nessa|dessa|dexa|deixa|decsa|nanax|nanaxa|nanex|nanexa|nanac|nanak|neca|neka|nex|nax|nexia|anexa|messa|mexa)\b/i;
const WAKE_WORD_WITH_VOCATIVE = /\b(?:nexa|n[eéè]xa|nexxa|neksa|naxa|neza|nessa|dessa|dexa|deixa|decsa|nanax|nanaxa|nanex|nanexa|nanac|nanak|neca|neka|nex|nax|nexia|anexa|messa|mexa)\s*[,:!?\-]+\s*(?:voc[eê]|vc|eu|tudo|como|o\s+que|qual|quando|onde|por\s*que|porque|me|pode|faz|fa[çc]a|d[aá]|ajuda|t[aá]|est[aá]|est[aá]s|tas|a[ií]|escuta|ouve|olha|fala|se|comita|commita|como\s+imitar|dar|push|\?)/i;
const WAKE_WORD_PHONETIC_DIRECT = /^(?:nessa|dessa|dexa|deixa|decsa|nexa|n[eéè]xa|nanax|nanaxa|nanex|nanexa|nanac|nanak)\s+(?:voc[eê]|vc)?\s*(?:est[aá]|t[aá]|est[aá]s|tas)?\s*(?:a[ií]|me\s+ouvindo|me\s+escutando|me\s+ouve|me\s+escuta|ouvindo|ouviu|escutou)/i;
const WAKE_WORD_AT_END = /[,\s]+(?:nexa|n[eéè]xa|nexxa|naxa|neza|dexa|deixa|decsa|nanax|nanaxa|nanex|nanexa|nanac|nanak)\s*[!?.]*$/i;

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
// NOTA: 'a gente' (nós) nunca deve ser considerado conversa com terceiros.
const THIRD_PARTY_CONVERSATION_PATTERNS = [
  /^(?:filho|filha|amor|esposa|marido|m[aã]e|pai|meninos?|meninas?|galera|pessoal|gente)\s*[,:!]/i,
  /\b(?:vai\s+(?:dormir|almo[çc]ar|jantar|tomar\s+banho|estudar|brincar|pro\s+quarto|pra\s+cama))\b/i,
  /\b(?:guarda\s+(?:os\s+brinquedos|isso|suas\s+coisas|o\s+material))\b/i,
  /\b(?:arruma\s+(?:o\s+quarto|a\s+cama|a\s+casa|a\s+mesa))\b/i,
  /\b(?:desliga\s+(?:a\s+tv|o\s+videogame|o\s+jogo|o\s+celular|a\s+luz))\b/i,
  /\b(?:come\s+(?:a\s+comida|o\s+almo[çc]o|a\s+janta|tudo)|fez\s+a\s+li[çc][ãa]o|fez\s+o\s+dever|escovou\s+os\s+dentes)\b/i,
  /\b(?:olha\s+(?:o\s+cachorro|o\s+gato|o\s+carro|a\s+panela|quem\s+est[aá]\s+a[ií]))\b/i,
  /\b(?:atende\s+(?:o\s+telefone|a\s+porta|o\s+interfone))\b/i,
  /\b(?:vem\s+(?:c[aá]|aqui)\s+(?:almo[çc]ar|jantar|comer|tomar\s+caf[eé]))\b/i,
];

// Padrões de comandos de parada / interrupção / silêncio (Barge-In)
const STOP_COMMAND_PATTERNS = [
  /^(?:(?:ei|oi|ok|ol[aá])\s+)?(?:nexa|n[eéè]xa)?[,\s]*(?:para|pare|cancela|cancelar|cala\s+a\s+boca|quiet[ao]|sil[êe]ncio|chega|stop|interrompe|interromper|pausa|pausar)[,\s]*(?:nexa|n[eéè]xa)?[!\s.,]*$/i,
  /^(?:para|pare|cancela|cancelar|cala\s+a\s+boca|sil[êe]ncio|chega|stop)[,\s]*(?:nexa|n[eéè]xa)?[!\s.,]*$/i,
];

// Padrões de conectores, preposições, verbos auxiliares e finais incompletos de frases (para não cortar no meio da fala)
const INCOMPLETE_SENTENCE_CONNECTORS = [
  /\b(?:e|ou|mas|que|se|como|para|pra|pro|pras|pros|quando|onde|porque|por\s*que|pq|pois|no|na|nos|nas|do|da|dos|das|com|sem|em|um|uma|uns|umas|tipo|tipo\s+assim|de|pelo|pela|pelos|pelas|ao|aos|ent[aã]o|a[ií]|qual|quais|o|a|os|as|meu|minha|meus|minhas|seu|sua|seus|suas|esse|essa|esses|essas|este|esta|estes|estas|aquele|aquela|aqueles|aquelas|[eé]|eh|era|foi|ser|estar|est[aá]|t[aá]|vai|vou|ia|tem|tinha|faz|fazia|fica|ficou|deu|d[aá]|ou\s+seja|por[eé]m|contudo|todavia|entretanto|ali|l[aá])\s*$/i,
];

// Padrões de áudio de mídia, vídeos do YouTube, TV, notícias, podcasts, tutoriais ou monólogos contínuos
const AMBIENT_MEDIA_OR_MONOLOGUE_PATTERNS = [
  /\b(?:nesse|neste|no\s+nosso|no\s+meu)\s+(?:v[ií]deo|canal|podcast|epis[oó]dio|tutorial|vlog|reels?|shorts?|stories|curso|artigo|post)\b/i,
  /\b(?:vou\s+te\s+mostrar|vou\s+mostrar\s+pra\s+voc[eê]s?|hoje\s+eu\s+vou|hoje\s+vamos\s+falar|hoje\s+vamos\s+ver|nesse\s+conte[uú]do)\b/i,
  /\b(?:deixe\s+(?:nos|o\s+seu)\s+coment[aá]rios?|comentem\s+aqui|link\s+na\s+descri[çc][ãa]o|na\s+descri[çc][ãa]o\s+do\s+v[ií]deo)\b/i,
  /\b(?:sejam\s+bem[- ]vindos|fala\s+galera|fala\s+pessoal|e\s+a[ií]\s+pessoal|ol[aá]\s+a\s+todos)\b/i,
  /\b(?:inscreva-se|se\s+inscreva|deixe\s+seu\s+like|ative\s+o\s+sininho|compartilhe\s+com\s+os\s+amigos)\b/i,
  /\b(?:o\s+gasto\s+que\s+mais|eu\s+descobri\s+esse\s+valor|eu\s+pago\s+\d+|esse\s+dinheiro\s+foi|apartamento\s+que\s+tem)\b/i,
  /\b(?:quando\s+eu\s+era|quando\s+eu\s+tinha|na\s+minha\s+opini[ãa]o|minha\s+experi[êe]ncia)\b/i,
  /\b(?:escala\s+(?:6\s*(?:x|por)\s*1|6x1)|pec\s+(?:da\s+)?escala|jornal\s+nacional|not[ií]cia|reportagem|minist[eé]rio|deputad[oa]|senador|c[aâ]mara|governo|infla[çc][ãa]o|mercado\s+financeiro|entrevista|ao\s+vivo|plant[ãa]o)\b/i,
  /\b(?:respira[çc][ãa]o|suspiro|tosse|limpando\s+a\s+garganta)\b/i,
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
  /\b(?:e\s+como|e\s+se|e\s+no|e\s+na|e\s+o|e\s+a|qual|quais|como|quando|onde|por\s*que|porque|pq|quem|quanto|quantos|o\s+que|que|ser[aá]\s+que|d[aá]\s+pra|tem\s+como|\?)\b/i,
  /\b(?:pode|consegue|mostra|v[eê]|explica|faz|troca|muda|cria|adiciona|remove|comita|commita|atualiza|continua|ajuda|executa|roda|testa|abre|fecha|salva|arruma|conserta|corrige|gera|escreve|compila|builda|deploy|subir|publicar|ver)\b/i,
  /\b(?:c[oó]digo|classe|fun[çc][ãa]o|m[eé]todo|arquivo|branch|commit|push|pull|merge|projeto|pasta|bug|erro|exception|stacktrace|terminal|console|play\s+console|vers[ãa]o|release|app|gradle|maven|docker|spring|java|quarkus|kotlin|node|nestjs|angular|react|vue)\b/i,
  /\b(?:sim|n[aã]o|pode\s+ser|com\s+certeza|isso|exato|exatamente|perfeito|valeu|obrigad[oa]|entendi|beleza|otimo|[oó]timo|certo|fechou|manda\s+ver|continua|prossiga)\b/i,
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
   * Verifica se a frase parece estar cortada no meio (termina em conector, preposição, vírgula ou reticências).
   */
  static isSentenceIncomplete(text) {
    if (!text || typeof text !== "string") return false;
    const t = text.trim();
    if (!t) return false;

    // Se termina expressamente em reticências ou vírgula
    if (t.endsWith("...") || t.endsWith(",")) return true;

    // Remove pontuação final comum (. ! ? , ...) para inspecionar a última palavra real da frase
    const cleanTrailing = t.replace(/[.,!?:;…]+$/g, "").trim();
    if (!cleanTrailing) return false;

    const norm = stripAccents(cleanTrailing).toLowerCase();

    // Se a última palavra da frase for um conector/preposição/verbo de ligação incompleto
    const isConnectorAtEnd = INCOMPLETE_SENTENCE_CONNECTORS.some((p) => p.test(norm));
    if (isConnectorAtEnd) {
      return true;
    }

    // Se terminou com ponto/exclamação/interrogação e tem pelo menos 3 palavras
    if (/[.!?]$/.test(t) && t.split(/\s+/).length >= 3) {
      return false;
    }

    return false;
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

    const hasWakeWord = NexaIntentClassifier.hasValidWakeWord(normalizedText);

    // 3. Descarta conversas paralelas com outras pessoas no cômodo (filhos, cônjuge, família, colegas)
    // Se a frase tem Wake Word ou foi explicitamente direcionada à Nexa, ela NÃO é conversa de terceiros
    if (!hasWakeWord) {
      for (const pattern of THIRD_PARTY_CONVERSATION_PATTERNS) {
        if (pattern.test(normalizedText)) {
          return {
            action: "IGNORE",
            expireFollowUp: true,
            reason: "Conversa com terceiros/família detectada (não direcionada à Nexa)"
          };
        }
      }
    }

    // Comandos explícitos de desenvolvimento e workspace (ex: "pode comitar e dar push", "faz commit", "cria branch", "roda os testes")
    const DIRECT_DEV_COMMAND = /\b(?:(?:pode|consegue|favor|por\s+favor)?\s*(?:comitar|commitar|comita|commita|como\s+imitar|fazer\s+commit|dar\s+push|fazer\s+push|criar\s+branch|abrir\s+arquivo|rodar\s+teste|corrigir\s+bug|aplicar\s+altera[çc][õo]es|salvar\s+arquivo))\b/i;
    const isDirectDevCommand = DIRECT_DEV_COMMAND.test(normalizedText) || DIRECT_DEV_COMMAND.test(text);

    // Se o nome Nexa não foi falado, não estamos em follow-up ativo E não é um comando direto inequívoco de desenvolvimento
    if (!hasWakeWord && !followUpActive && !isDirectDevCommand) {
      return { action: "IGNORE", expireFollowUp: false, reason: "Wake word ausente e sem follow-up ativo" };
    }

    // Se está em follow-up sem wake word: validação rigorosa contra áudios de vídeo/música/monólogos de fundo
    if (!hasWakeWord && followUpActive && !isDirectDevCommand) {
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

    // 4. Limpa a palavra-chave de invocação para obter a consulta/comando
    let cleanedQuery = text;
    if (hasWakeWord) {
      // Remove vocativo inicial: "Nexa, ...", "Ei Nexa, ...", "Oi Nexa, ...", "Perfeito Nexa, ..."
      cleanedQuery = cleanedQuery
        .replace(/^(?:(?:ei|oi|ol[aá]|opa|fala|al[oô]|e\s+a[ií]|bom\s+dia|boa\s+tarde|boa\s+noite|por\s+favor|perfeito|beleza|show|pronto|certo|ent[aã]o|ok)\s*[,:]*\s*)?(?:nexa|n[eéè]xa|nexxa|neksa|naxa|neza|nessa|dessa|dexa|deixa|decsa|nanax|nanaxa|nanex|nanexa|nanac|nanak|neca|neka|nex|nax|nexia|anexa|messa|mexa)\s*[,:!\-.]*\s*/i, "");

      // Remove vocativo final SOMENTE se for vocativo isolado (ex: "o que acha, Nexa?"), NUNCA se for preposição ou parte do objeto (ex: "configurações da Nexa", "sobre a Nexa", "com a Nexa")
      cleanedQuery = cleanedQuery.replace(/(,\s*|\s+)(nexa|n[eéè]xa|nexxa|neksa|naxa|neza|nessa|dessa|dexa|deixa|decsa|nanax|nanaxa|nanex|nanexa|nanac|nanak|neca|neka|nex|nax|nexia|anexa|messa|mexa)[!?.]*$/i, (match, prefix, _name, offset, fullStr) => {
        const before = fullStr.slice(0, offset).trim().toLowerCase();
        const lastWord = before.split(/\s+/).pop();
        const prepositions = ["da", "de", "do", "das", "dos", "com", "sobre", "para", "pra", "pro", "em", "na", "no", "nas", "nos", "pela", "pelo", "pelas", "pelos", "a", "o", "as", "os", "uma", "um", "minha", "nossa", "sua", "esta", "essa", "chama", "chamada"];
        if (prepositions.includes(lastWord)) {
          return match; // Mantém a palavra intacta pois é objeto da oração!
        }
        return "";
      }).trim();
    }

    const cleanNorm = stripAccents(cleanedQuery).toLowerCase().replace(/[.,!?;:]+$/g, "").trim();
    const queryWords = cleanNorm.split(/\s+/).filter(Boolean);

    // Palavras-chave de tarefas, instruções técnicas ou questionamentos complexos
    const COMPLEX_TASK_PATTERNS = /\b(?:remove|remova|remover|tira|apaga|apagar|deleta|deletar|corrige|corrigir|arruma|arrumar|conserta|consertar|verifica|verificar|checa|checar|cria|criar|faz\s+(?:um\s+)?(?:script|codigo|arquivo|funcao|teste)|continua|continuar|de\s+onde\s+parou|projeto|arquivo|codigo|pasta|branch|commit|git|porque|por\s*que|pq|como|qual|quais|onde|quando|quanto|erro|bug|problema)\b/i;
    const isComplexOrTaskQuery = queryWords.length > 7 || COMPLEX_TASK_PATTERNS.test(cleanNorm) || text.includes("?");

    // 5. Checagem de comandos diretos de gesto/animação (ex: "Nexa, faz um coraçãozinho", "Nexa dança")
    // Só é REACT_ANIMATION_ONLY se for um pedido EXCLUSIVO e direto de gesto (sem outras perguntas/tarefas na frase)
    if (!isComplexOrTaskQuery) {
      for (const gesture of GESTURE_ANIMATION_MAPPINGS) {
        for (const p of gesture.patterns) {
          if (p.test(normalizedText) || p.test(cleanNorm)) {
            return {
              action: "REACT_ANIMATION_ONLY",
              animation: gesture.animation,
              reason: "Pedido direto de gesto (" + gesture.animation + ")"
            };
          }
        }
      }
    }

    // Checagem de conectividade / presença / "Você me ouviu?" / "Tá me ouvindo?"
    const PRESENCE_PATTERNS = [
      /^(?:(?:voc[eê]|vc)\s+)?(?:est[aá]|t[aá]|est[aá]s|tas)?\s*(?:me\s+)?(?:ouvindo|escutando|ouviu|ouve|escuta|escutou|a[ií])$/i,
      /^(?:consegue|pode)\s+(?:me\s+)?(?:ouvir|escutar)$/i,
      /^(?:t[aá]|est[aá])\s+(?:me\s+ouvindo|me\s+escutando|funcionando|aqui|online)$/i,
      /^(?:me\s+)?(?:ouviu|escutou|ouve|escuta)$/i,
      /^(?:ouviu|escutou)$/i
    ];

    if (PRESENCE_PATTERNS.some((p) => p.test(cleanNorm))) {
      return {
        action: "RESPOND_AUDIO_AND_CHAT",
        cleanedQuery: cleanedQuery || "Você está me ouvindo?",
        animationHint: "wave",
        isCasualGreeting: true,
        directVoiceResponse: "Estou te ouvindo perfeitamente! Como posso te ajudar?",
        reason: "Checagem de presença e escuta de voz"
      };
    }

    const GREETING_PATTERNS = [
      /^(?:oi|ola|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|como\s+vai|como\s+voc[eê]\s+t[aá]|como\s+vc\s+t[aá]|e\s+a[ií]|fala\s+a[ií]|opa|al[oô])$/i,
    ];

    if (!cleanedQuery || GREETING_PATTERNS.some((p) => p.test(cleanNorm))) {
      let directReply = "Oi! Tô aqui, pode falar!";
      let anim = "wave";
      if (cleanNorm.includes("tudo bem") || cleanNorm.includes("como vai") || cleanNorm.includes("como voce") || cleanNorm.includes("como vc")) {
        directReply = "Tudo ótimo por aqui! Em que posso ajudar?";
        anim = "cute";
      }
      return {
        action: "RESPOND_AUDIO_AND_CHAT",
        cleanedQuery: cleanedQuery || "Olá!",
        animationHint: anim,
        isCasualGreeting: true,
        directVoiceResponse: directReply,
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
