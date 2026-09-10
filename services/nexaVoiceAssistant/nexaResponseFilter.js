/**
 * services/nexaVoiceAssistant/nexaResponseFilter.js
 * 
 * Filtro e formatador de resposta para o Modo de Voz Ativo da Nexa.
 * Separa de forma limpa o que deve ser falado via TTS do que deve ser renderizado no chat da tela:
 * 
 * - voiceSummary: 1 a 2 frases sucintas em 1ª pessoa para serem lidas em voz alta.
 * - displayText: texto completo em Markdown (código, tabelas, explicações detalhadas).
 * - animation: animação recomendada para a Nexa durante a resposta.
 */

class NexaResponseFilter {
  /**
   * Extrai o resumo de voz, texto de exibição e animação da resposta da IA.
   * @param {string} fullText Texto completo gerado pela IA
   * @param {string} [defaultAnimation='speaking']
   * @returns {{ voiceSummary: string, displayText: string, animation: string }}
   */
  static processResponse(fullText, defaultAnimation = "speaking") {
    const raw = String(fullText || "").trim();
    if (!raw) {
      return {
        voiceSummary: "Pronto!",
        displayText: "",
        animation: "wave"
      };
    }

    let voiceSummary = "";
    let displayText = raw;
    let animation = defaultAnimation;

    // 1. Extração da tag <voice_summary>...</voice_summary>
    const voiceSummaryMatch = raw.match(/<voice_summary>([\s\S]*?)<\/voice_summary>/i);
    if (voiceSummaryMatch && voiceSummaryMatch[1]) {
      voiceSummary = voiceSummaryMatch[1].trim();
      // Remove a tag do texto de exibição para a tela ficar limpa
      displayText = displayText.replace(/<voice_summary>[\s\S]*?<\/voice_summary>/gi, "").trim();
    }

    // 2. Extração da tag <animation_hint>...</animation_hint> (se fornecida pela IA)
    const animMatch = raw.match(/<animation(?:_hint)?>([\s\S]*?)<\/animation(?:_hint)?>/i);
    if (animMatch && animMatch[1]) {
      const suggestedAnim = animMatch[1].trim().toLowerCase();
      if (suggestedAnim) {
        animation = suggestedAnim;
      }
      displayText = displayText.replace(/<animation(?:_hint)?>[\s\S]*?<\/animation(?:_hint)?>/gi, "").trim();
    }

    // 3. Se a IA não forneceu a tag <voice_summary>, gera um fallback inteligente em 1ª pessoa
    if (!voiceSummary) {
      // Pega o primeiro parágrafo antes de blocos de código
      const parts = displayText.split(/```/);
      const textPart = parts[0] ? parts[0].trim() : "";
      const sentences = textPart.split(/(?<=[.!?])\s+/);

      if (sentences.length > 0 && sentences[0].length < 180) {
        voiceSummary = sentences.slice(0, 2).join(" ");
      } else {
        voiceSummary = "Pronto! Analisei e deixei os detalhes na tela para você conferir.";
      }
    }

    // 4. Mapeamento heurístico de animação se não foi fixada
    if (animation === "speaking" || !animation) {
      const lowerDisplay = displayText.toLowerCase();
      if (lowerDisplay.includes("```") || lowerDisplay.includes("function") || lowerDisplay.includes("class ")) {
        animation = "writing_code";
      } else if (lowerDisplay.includes("parabéns") || lowerDisplay.includes("sucesso") || lowerDisplay.includes("comemorar")) {
        animation = "dance";
      } else if (lowerDisplay.includes("café") || lowerDisplay.includes("descanse")) {
        animation = "coffee";
      }
    }

    return {
      voiceSummary,
      displayText,
      animation
    };
  }

  /**
   * Gera a instrução do sistema que injeta as diretrizes de voz no prompt da IA.
   */
  static getVoiceModeSystemPromptInstruction() {
    return (
      "\n\n[INSTRUÇÃO DE MODO DE VOZ ATIVO NEXA]\n" +
      "Você está interagindo no modo de voz contínua com o usuário.\n" +
      "Sua resposta DEVE incluir obrigatoriamente ao final a tag <voice_summary>resumo sucinto em 1 a 2 frases para ser lido em voz alta pela Nexa</voice_summary>.\n" +
      "O resumo em voice_summary DEVE ser em PRIMEIRA PESSOA PELA NEXA (ex: 'Pronto! Já estruturei a classe Java e deixei o código completo na tela para você.').\n" +
      "NUNCA coloque códigos, tabelas ou listas longas dentro da tag voice_summary. Coloque o código e detalhes técnicos normalmente no corpo da sua resposta para serem exibidos na tela.\n"
    );
  }
}

module.exports = NexaResponseFilter;
