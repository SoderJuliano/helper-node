/**
 * services/geminiLive/index.js
 * Ponto de entrada do serviço Gemini Multimodal Live.
 */

const { GeminiLiveSession } = require('./geminiLiveSession');
const configService = require('../configService');

let activeSession = null;

function getLiveSession() {
  return activeSession;
}

function isLiveSessionActive() {
  return !!(activeSession && activeSession.isConnected);
}

async function startLiveSession(options = {}) {
  if (activeSession && activeSession.isConnected) {
    return activeSession;
  }

  const apiKey = options.apiKey || configService.getGoogleApiKey();
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Google API Key não informada. Configure nas Configurações do Helper Node.');
  }

  const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : {};
  const assistantName = (nexaCfg && nexaCfg.name) ? nexaCfg.name.trim() : 'Raphael';

  const systemInstruction = `Você é ${assistantName}, a assistente e copiloto digital feminina, inteligente, nerd e descontraída do Helper Node. Responda em áudio natural e curto de forma conversacional e humana. O usuário é o desenvolvedor Juliano.`;

  activeSession = new GeminiLiveSession({
    apiKey,
    systemInstruction,
    ...options
  });

  await activeSession.connect();
  return activeSession;
}

function stopLiveSession() {
  if (activeSession) {
    activeSession.disconnect();
    activeSession = null;
  }
}

module.exports = {
  GeminiLiveSession,
  getLiveSession,
  isLiveSessionActive,
  startLiveSession,
  stopLiveSession
};
