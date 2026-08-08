/**
 * main/nexa/nexaHistory.js
 * Gerenciador de Histórico Temporário de Animações da Sessão.
 */

let animationHistory = [];

function clearHistory() {
  console.log("[NexaHistory] Histórico de animações da sessão limpo.");
  animationHistory = [];
}

function addHistoryEvent(event) {
  if (!event || typeof event !== "object") return;
  animationHistory.push({
    timestamp: Date.now(),
    ...event
  });
  
  // Limita a 20 eventos recentes de animação na sessão
  if (animationHistory.length > 20) {
    animationHistory.shift();
  }
}

function getHistoryForPrompt() {
  if (animationHistory.length === 0) {
    return "Nenhuma animação ou reação visual ocorreu nesta sessão ainda.";
  }
  return animationHistory.map(evt => {
    const timeStr = new Date(evt.timestamp).toLocaleTimeString();
    if (evt.event === "played") {
      return `[${timeStr}] Animação reproduzida: "${evt.animation}"${evt.description ? ` (${evt.description})` : ""}`;
    }
    if (evt.event === "user_feedback") {
      return `[${timeStr}] Reação do usuário: ${evt.description}`;
    }
    if (evt.event === "nexa_response") {
      return `[${timeStr}] Resposta da Nexa: ${evt.description}`;
    }
    return `[${timeStr}] Evento: ${evt.description || JSON.stringify(evt)}`;
  }).join("\n");
}

module.exports = {
  clearHistory,
  addHistoryEvent,
  getHistoryForPrompt
};
