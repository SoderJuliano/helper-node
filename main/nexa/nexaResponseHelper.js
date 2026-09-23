/**
 * main/nexa/nexaResponseHelper.js
 * Utilitários para parsear respostas JSON da Nexa em tempo real (streaming)
 * e executar ações (memórias, TTS).
 */

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
  if (!rawText) return { response: "", remember: null };
  
  let cleanText = rawText.trim();
  
  // Remove invólucros markdown se existirem
  if (cleanText.startsWith("```")) {
    cleanText = cleanText.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  }
  
  // Tenta parsear direto se já for um JSON limpo
  try {
    const parsed = JSON.parse(cleanText);
    if (parsed && typeof parsed === "object" && parsed.response !== undefined) {
      return {
        response: parsed.response || "",
        remember: parsed.remember || null
      };
    }
  } catch (e) {
    // Tenta encontrar um bloco JSON dentro da string
  }

  // Tenta extrair qualquer objeto JSON que contenha "response"
  const jsonMatch = cleanText.match(/\{[\s\S]*?"response"\s*:[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        response: parsed.response || "",
        remember: parsed.remember || null
      };
    } catch (e) {
      // Ignora erro e cai no fallback
    }
  }
  
  const response = fallbackText || rawText;
  return {
    response,
    remember: null
  };
}

function handleNexaActions(parsedResult) {
  if (!parsedResult) return;
  const { remember } = parsedResult;

  // Adiciona fato à memória se sugerido
  if (remember) {
    addMemoryFact(remember);
  }
}

module.exports = {
  NexaJsonStreamParser,
  parseNexaResponse,
  handleNexaActions
};
