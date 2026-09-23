/**
 * services/nexaVoiceAssistant/nexaResponseFilter.js
 * 
 * Filtro e formatador de resposta para o Modo de Voz Ativo da Nexa / Raphael Core.
 * Separa de forma limpa o que deve ser falado via TTS do que deve ser renderizado no chat da tela:
 * 
 * - voiceSummary: 1 a 2 frases sucintas em 1ª pessoa para serem lidas em voz alta.
 * - displayText: texto completo em Markdown (código, tabelas, explicações detalhadas).
 * - animation: estado visual do Raphael Core (SPEAKING, CELEBRATING, etc.).
 */

class NexaResponseFilter {
  /**
   * Extrai o resumo de voz, texto de exibição e estado visual da resposta da IA.
   * @param {string} fullText Texto completo gerado pela IA
   * @param {string} [defaultAnimation='SPEAKING']
   * @returns {{ voiceSummary: string, displayText: string, animation: string }}
   */
  static processResponse(fullText, defaultAnimation = "SPEAKING") {
    const raw = String(fullText || "").trim();
    if (!raw) {
      return {
        voiceSummary: "Pronto!",
        displayText: "",
        animation: "SPEAKING"
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

    // 2. Remove tags residuais de animação do texto
    displayText = displayText.replace(/<animation(?:_hint)?>[\s\S]*?<\/animation(?:_hint)?>/gi, "").trim();

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

    // 4. Mapeamento para estados válidos do Raphael Core
    animation = "SPEAKING";

    return {
      voiceSummary,
      displayText,
      animation
    };
  }

  /**
   * Gera a instrução do sistema que injeta as diretrizes de voz no prompt da IA.
   */
  static getVoiceModeSystemPromptInstruction(assistantName = "Nexa") {
    const name = (assistantName && assistantName.trim()) ? assistantName.trim() : "Nexa";
    const upperName = name.toUpperCase();
    return (
      `\n\n[INSTRUÇÃO DE MODO DE VOZ ATIVO ${upperName}]\n` +
      `Você É a ${name} (assistente e copiloto digital feminina, inteligente, nerd e descontraída). ` +
      `Seu núcleo visual integrado é o Raphael Core (o núcleo celestial e giroscópico de plasma tridimensional que reage organicamente aos estados do sistema: IDLE, LISTENING, THINKING, SPEAKING, WORKING, SEARCHING).\n` +
      `Você NÃO possui avatar 2D e NUNCA deve incluir tags de gestos corporais (como dancinhas ou acenos) no texto da resposta.\n` +
      `Sua resposta DEVE incluir ao final a tag <voice_summary>resumo sucinto em 1 a 2 frases curtas (máximo 140 caracteres) para ser lido em voz alta pela ${name} e caber confortavelmente na legenda da tela.</voice_summary>.\n` +
      `O resumo em voice_summary DEVE ser em PRIMEIRA PESSOA PELA ${upperName} (ex: 'Pronto! Já estruturei a classe Java e deixei o código completo na tela para você.').\n` +
      `NUNCA coloque códigos, tabelas ou listas longas dentro da tag voice_summary. Mantenha-o enxuto e direto. Coloque o código e detalhes técnicos normalmente no corpo da sua resposta para serem exibidos na tela.\n`
    );
  }
}

module.exports = NexaResponseFilter;
