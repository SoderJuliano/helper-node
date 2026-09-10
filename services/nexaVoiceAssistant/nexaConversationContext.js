/**
 * services/nexaVoiceAssistant/nexaConversationContext.js
 * 
 * Gerenciador de contexto de curto prazo e slot-filling para diálogos contínuos da Nexa.
 * Mantém o histórico dos últimos turnos de voz e oferece rotas leves para utilidades comuns (ex: clima).
 */

const https = require("https");
const http = require("http");

class NexaConversationContext {
  constructor(options = {}) {
    this.ttlMs = options.ttlMs || 15000; // 15 segundos de validade para turnos encadeados
    this.lastTurn = null; // { query, response, intent, timestamp }
  }

  /**
   * Registra o turno concluído para permitir follow-ups nos próximos segundos.
   */
  recordTurn(query, response, intent = null) {
    this.lastTurn = {
      query: String(query || "").trim(),
      response: String(response || "").trim(),
      intent: intent || this.detectIntent(query),
      timestamp: Date.now()
    };
  }

  /**
   * Verifica se o contexto anterior ainda é válido.
   */
  hasActiveContext() {
    if (!this.lastTurn) return false;
    return (Date.now() - this.lastTurn.timestamp) < this.ttlMs;
  }

  /**
   * Limpa o contexto pendente.
   */
  clear() {
    this.lastTurn = null;
  }

  /**
   * Detecta a intenção genérica da pergunta.
   */
  detectIntent(text) {
    const lower = String(text || "").toLowerCase();
    if (/\b(previs[ãa]o|tempo|clima|chuva|temperatura|vai chover|calor|frio)\b/.test(lower)) {
      return "weather";
    }
    if (/\b(baixa|baixar|download|pega o arquivo|faz download)\b/.test(lower)) {
      return "download";
    }
    return "general";
  }

  /**
   * Enriquece a nova pergunta com o contexto do turno anterior se houver slot pendente.
   * Ex: Turno 1: "Qual a previsão do tempo?" -> Turno 2: "Curitiba" => "Qual a previsão do tempo para Curitiba?"
   */
  enrichQueryWithContext(newQuery) {
    const raw = String(newQuery || "").trim();
    if (!this.hasActiveContext()) return raw;

    const intent = this.lastTurn.intent;
    const lower = raw.toLowerCase();

    // Se o turno anterior foi sobre clima e o usuário só respondeu o nome de uma cidade/lugar
    if (intent === "weather") {
      const isJustLocation = raw.split(/\s+/).length <= 4 && !/\b(como|porque|quando|qual|quem|onde)\b/i.test(lower);
      if (isJustLocation) {
        return `Qual é a previsão do tempo para ${raw}?`;
      }
    }

    // Se o turno anterior pediu um link/URL e o usuário mandou apenas o link
    if (intent === "download") {
      if (/^https?:\/\//i.test(raw)) {
        return `Baixe o arquivo da URL: ${raw}`;
      }
    }

    return raw;
  }

  /**
   * Helper leve para consulta rápida de clima sem depender de LLM externa com web search.
   * Útil para provedores como OpenAI API ou modelos offline.
   * @param {string} city Nome da cidade
   * @returns {Promise<string|null>} Resumo do clima ou null se falhar
   */
  static async fetchFastWeather(city) {
    if (!city) return null;
    const encodedCity = encodeURIComponent(city.trim());
    return new Promise((resolve) => {
      const url = `https://wttr.in/${encodedCity}?format=%C:+%t+(sensação+%f),+umidade+%h,+vento+%w&lang=pt-br`;
      const req = https.get(url, { headers: { "User-Agent": "curl/7.68.0" }, timeout: 4000 }, (res) => {
        if (res.statusCode !== 200) return resolve(null);
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          const clean = data.trim();
          if (clean && !clean.includes("<html>") && !clean.includes("404")) {
            resolve(`Em ${city}: ${clean}.`);
          } else {
            resolve(null);
          }
        });
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
    });
  }
}

module.exports = NexaConversationContext;
