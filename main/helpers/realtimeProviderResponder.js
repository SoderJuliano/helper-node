// main/helpers/realtimeProviderResponder.js
const {
  configService,
  REALTIME_COPILOT_INSTRUCTION,
  BackendService,
  OpenAIService,
  state,
} = require('../globals.js');

async function realtimeProviderResponder(transcript, image, onDelta, contextMessages = [], helpers = {}) {
  const aiModel = helpers.getEffectiveAiModel ? helpers.getEffectiveAiModel() : configService.getAiModel();
  console.log(`[realtimeProviderResponder] Processando fala via modelo selecionado: "${aiModel}" (fala: "${transcript}")`);
  const kb = helpers.knowledgeBlockForOllama ? await helpers.knowledgeBlockForOllama(transcript) : '';

  let contextBlock = "";
  if (Array.isArray(contextMessages) && contextMessages.length > 0) {
    const recentQuestions = contextMessages
      .filter(m => m.role === 'user' && m.content && m.content.trim())
      .slice(-3)
      .map(m => `• "${m.content.trim()}"`);
    if (recentQuestions.length > 0) {
      contextBlock = `[Tópicos/Perguntas recentes da conversa]:\n${recentQuestions.join('\n')}\n\n`;
    }
  }

  const promptText = `${contextBlock}${kb ? `${kb}\n\n---\n\n` : ''}Fala capturada: "${transcript}"`;

  const opts = {
    sessionId: "realtime-assistant",
    onDelta,
  };
  if (image) {
    opts.imageBase64 = image;
  }

  if (aiModel === "geminiCli") {
    try {
      const GeminiCliProvider = require('../../services/providers/gemini-cli/GeminiCliProvider');
      const workspace = require('./workspace');
      const projectPath = workspace.getProjectPath();
      let acc = '';
      let lastEmit = 0;
      const streamSender = {
        send: (ch, data) => {
          if (ch === 'gemini-stream-chunk' && typeof onDelta === 'function' && data) {
            const chunkText = typeof data === 'string' ? data : (data.text || data.chunk || '');
            acc += chunkText;
            const now = Date.now();
            if (now - lastEmit > 40) {
              lastEmit = now;
              onDelta(acc);
            }
          }
        }
      };
      const prompt = `${REALTIME_COPILOT_INSTRUCTION}\n\n${promptText}`;
      const res = await GeminiCliProvider.send(prompt, projectPath, streamSender);
      const outputText = typeof res === 'object' ? (res.text || res.response || '') : String(res);
      if (typeof onDelta === 'function') onDelta(outputText);
      console.log(`[realtimeProviderResponder] Resposta obtida do GeminiCliProvider (${configService.getGeminiCliModel()}): "${outputText}"`);
      return outputText;
    } catch (gErr) {
      console.error(`[realtimeProviderResponder] Erro no GeminiCliProvider:`, gErr.message);
      throw gErr;
    }
  }

  if (aiModel === "claudeCli") {
    try {
      const ClaudeCliProvider = require('../../services/providers/claude-cli/ClaudeCliProvider');
      const workspace = require('./workspace');
      const projectPath = workspace.getProjectPath();
      let acc = '';
      let lastEmit = 0;
      const streamSender = {
        send: (ch, data) => {
          if (ch === 'claude-stream-chunk' && typeof onDelta === 'function' && data) {
            const chunkText = typeof data === 'string' ? data : (data.text || data.chunk || '');
            acc += chunkText;
            const now = Date.now();
            if (now - lastEmit > 40) {
              lastEmit = now;
              onDelta(acc);
            }
          }
        }
      };
      const prompt = `${REALTIME_COPILOT_INSTRUCTION}\n\n${promptText}`;
      const res = await ClaudeCliProvider.send(prompt, projectPath, streamSender);
      const outputText = typeof res === 'object' ? (res.text || res.response || '') : String(res);
      if (typeof onDelta === 'function') onDelta(outputText);
      console.log(`[realtimeProviderResponder] Resposta obtida do ClaudeCliProvider: "${outputText}"`);
      return outputText;
    } catch (cErr) {
      console.error(`[realtimeProviderResponder] Erro no ClaudeCliProvider:`, cErr.message);
      throw cErr;
    }
  }

  if (aiModel === "copilotCli") {
    try {
      const CopilotCliProvider = require('../../services/providers/copilot-cli/CopilotCliProvider');
      const workspace = require('./workspace');
      const projectPath = workspace.getProjectPath();
      let acc = '';
      let lastEmit = 0;
      const streamSender = {
        send: (ch, data) => {
          if (ch === 'copilot-stream-chunk' && typeof onDelta === 'function' && data) {
            const chunkText = typeof data === 'string' ? data : (data.text || data.chunk || '');
            acc += chunkText;
            const now = Date.now();
            if (now - lastEmit > 40) {
              lastEmit = now;
              onDelta(acc);
            }
          }
        }
      };
      const prompt = `${REALTIME_COPILOT_INSTRUCTION}\n\n${promptText}`;
      const res = await CopilotCliProvider.send(prompt, projectPath, streamSender);
      const outputText = typeof res === 'object' ? (res.text || res.response || '') : String(res);
      if (typeof onDelta === 'function') onDelta(outputText);
      console.log(`[realtimeProviderResponder] Resposta obtida do CopilotCliProvider: "${outputText}"`);
      return outputText;
    } catch (cpErr) {
      console.error(`[realtimeProviderResponder] Erro no CopilotCliProvider:`, cpErr.message);
      throw cpErr;
    }
  }

  if (aiModel === "ollamaLocal") {
    try {
      const ollamaLocalService = require('../../services/ollamaLocalService');
      const instruction = `${REALTIME_COPILOT_INSTRUCTION}\n\n[CONTEXTO DO ASSISTENTE EM TEMPO REAL]`;
      return await new Promise((resolve, reject) => {
        let acc = '';
        let lastEmit = 0;
        ollamaLocalService.responderStream(
          promptText,
          (chunk) => {
            if (!chunk) return;
            const text = typeof chunk === 'string' ? chunk : (chunk.text || chunk.content || '');
            if (!text) return;
            acc += text;
            const now = Date.now();
            if (now - lastEmit > 40) {
              lastEmit = now;
              if (typeof onDelta === 'function') onDelta(acc);
            }
          },
          () => {
            if (typeof onDelta === 'function') onDelta(acc);
            resolve(acc);
          },
          (err) => reject(err),
          { ...opts, instruction }
        );
      });
    } catch (e) {
      console.error(`[realtimeProviderResponder] Erro no ollamaLocal:`, e.message);
      throw e;
    }
  }

  if (aiModel === "chatGpt") {
    return await OpenAIService.responder(promptText, opts);
  }

  return await BackendService.responder(promptText, opts);
}

module.exports = {
  realtimeProviderResponder,
};
