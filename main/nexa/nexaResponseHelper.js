/**
 * main/nexa/nexaResponseHelper.js
 * Utilitários para parsear respostas JSON da Nexa em tempo real (streaming)
 * e executar ações (animações, memórias, TTS).
 */

const { NEXA_ANIMATIONS } = require("./nexaAnimations.js");
const { addHistoryEvent } = require("./nexaHistory.js");
const { addMemoryFact } = require("./nexaMemory.js");

class NexaJsonStreamParser {
  constructor() {
    this.buffer = "";
    this.inResponseValue = false;
    this.responseFinished = false;
    this.responseText = "";
    this.hasJsonStructure = false;
  }

  processChunk(chunk) {
    this.buffer += chunk;
    
    // Verifica se a stream se parece com uma estrutura JSON
    if (!this.hasJsonStructure && this.buffer.trim().length > 0) {
      const trimmed = this.buffer.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("`")) {
        this.hasJsonStructure = true;
      }
    }

    // Se após receber alguns caracteres não parecer JSON, trata como texto puro
    if (!this.hasJsonStructure && this.buffer.trim().length > 5) {
      this.responseText += chunk;
      return chunk;
    }

    // Se for JSON, tenta encontrar a chave "response"
    if (!this.inResponseValue && !this.responseFinished) {
      const startMarker = '"response"';
      const markerIndex = this.buffer.indexOf(startMarker);
      if (markerIndex !== -1) {
        const afterMarker = this.buffer.slice(markerIndex + startMarker.length);
        const colonIndex = afterMarker.indexOf(":");
        if (colonIndex !== -1) {
          const afterColon = afterMarker.slice(colonIndex + 1);
          const quoteIndex = afterColon.indexOf('"');
          if (quoteIndex !== -1) {
            this.inResponseValue = true;
            this.buffer = afterColon.slice(quoteIndex + 1);
          }
        }
      }
    }

    let output = "";
    if (this.inResponseValue && !this.responseFinished) {
      let i = 0;
      while (i < this.buffer.length) {
        const char = this.buffer[i];
        if (char === "\\") {
          if (i + 1 < this.buffer.length) {
            const nextChar = this.buffer[i + 1];
            if (nextChar === "n") output += "\n";
            else if (nextChar === "t") output += "\t";
            else if (nextChar === '"') output += '"';
            else if (nextChar === "\\") output += "\\";
            else output += nextChar;
            i += 2;
          } else {
            break; // Aguarda o próximo chunk para resolver o escape
          }
        } else if (char === '"') {
          this.inResponseValue = false;
          this.responseFinished = true;
          this.buffer = this.buffer.slice(i + 1);
          break;
        } else {
          output += char;
          i++;
        }
      }
      if (i > 0) {
        this.buffer = this.buffer.slice(i);
      }
      this.responseText += output;
    }

    return output;
  }
}

function parseNexaResponse(rawText, fallbackText = "") {
  if (!rawText) return { response: "", animation: null, remember: null };
  
  let cleanText = rawText.trim();
  
  // Remove invólucros markdown se existirem
  if (cleanText.startsWith("```")) {
    cleanText = cleanText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  }
  
  try {
    const parsed = JSON.parse(cleanText);
    return {
      response: parsed.response || "",
      animation: parsed.animation || null,
      remember: parsed.remember || null
    };
  } catch (err) {
    console.warn("[NexaResponseHelper] Falha ao parsear resposta JSON da Nexa, usando fallback:", err.message);
    const response = fallbackText || rawText;
    return {
      response,
      animation: null,
      remember: null
    };
  }
}

function handleNexaActions(parsedResult) {
  const { response, animation, remember } = parsedResult;
  
  // 1. Valida e executa a animação retornada
  if (animation && NEXA_ANIMATIONS[animation]) {
    const animDef = NEXA_ANIMATIONS[animation];
    console.log(`[NexaResponseHelper] Executando animação validada: ${animation}`);
    
    // Registra no histórico da sessão
    addHistoryEvent({
      animation,
      event: "played",
      description: animDef.description
    });
    
    // Dispara evento para a janela da Nexa
    try {
      const { state } = require("../globals.js");
      if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
        state.nexaWindow.webContents.send("nexa:play-animation", { name: animation });
      }
    } catch (err) {
      console.error("[NexaResponseHelper] Erro ao enviar evento de animação:", err.message);
    }
  } else if (animation) {
    console.warn(`[NexaResponseHelper] Animação sugerida inválida ou ausente no catálogo: ${animation}`);
  }

  // 2. Adiciona fato à memória se sugerido
  if (remember) {
    addMemoryFact(remember);
  }
}

module.exports = {
  NexaJsonStreamParser,
  parseNexaResponse,
  handleNexaActions
};
