// main/helpers/realtimeProviderResponder.js
const {
  configService,
  REALTIME_COPILOT_INSTRUCTION,
  BackendService,
  OpenAIService,
  state,
  workspace,
} = require('../globals.js');

async function realtimeProviderResponder(transcript, image, onDelta, contextMessages = [], helpers = {}) {
  const aiModel = helpers.getEffectiveAiModel ? helpers.getEffectiveAiModel() : configService.getAiModel();
  console.log(`[realtimeProviderResponder] Processando fala via modelo selecionado: "${aiModel}" (fala: "${transcript}")`);
  const kb = helpers.knowledgeBlockForOllama ? await helpers.knowledgeBlockForOllama(transcript) : '';

  let contextBlock = "";
  if (Array.isArray(contextMessages) && contextMessages.length > 0) {
    const validMessages = contextMessages.filter(m => m && m.content && m.content.trim());
    if (validMessages.length > 0) {
      const turns = [];
      let currentTurn = null;
      for (const msg of validMessages.slice(-6)) {
        if (msg.role === 'user') {
          if (currentTurn) turns.push(currentTurn);
          currentTurn = { user: msg.content.trim(), assistant: '' };
        } else if (msg.role === 'assistant' && currentTurn) {
          const firstLine = msg.content.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
          currentTurn.assistant = firstLine.slice(0, 140);
        }
      }
      if (currentTurn) turns.push(currentTurn);

      if (turns.length > 0) {
        const lines = turns.map((t, idx) => {
          const isImmediatePrev = idx === turns.length - 1;
          const label = isImmediatePrev ? '• Tópico Imediatamente Anterior' : '• Tópico Anterior';
          return `${label}: "${t.user}"${t.assistant ? ` (Resposta dada: ${t.assistant})` : ''}`;
        });
        contextBlock = `[HISTÓRICO RECENTE DA CONVERSA - Ordem Cronológica]:\n${lines.join('\n')}\n*(Se a fala atual for um follow-up ou usar termos como "cada um", "isso", "eles", "vantagens", resolva SEMPRE com base no(s) Tópico(s) Imediatamente Anterior(es))*\n\n`;
      }
    }
  }

  const userContext = (configService.getUserContextBlock && configService.getUserContextBlock()) || '';
  const promptText = `${userContext ? `${userContext}\n\n---\n\n` : ''}${contextBlock}${kb ? `${kb}\n\n---\n\n` : ''}Fala capturada: "${transcript}"`;

  const opts = {
    sessionId: "realtime-assistant",
    onDelta,
  };
  if (image) {
    opts.imageBase64 = image;
  }

  const getProjectPathSafe = () => {
    try {
      if (workspace && typeof workspace.getProjectPath === 'function') {
        return workspace.getProjectPath();
      }
      const ws = require('../../services/workspace');
      if (ws && typeof ws.getProjectPath === 'function') {
        return ws.getProjectPath();
      }
    } catch (_) {}
    return null;
  };

  if (aiModel === "geminiCli") {
    try {
      const GeminiCliProvider = require('../../services/providers/gemini-cli/GeminiCliProvider');
      const projectPath = getProjectPathSafe();
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
      const projectPath = getProjectPathSafe();
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
      const projectPath = getProjectPathSafe();
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

  if (aiModel === "openIa" || aiModel === "openIaCodex" || aiModel === "chatGpt") {
    return await OpenAIService.responder(promptText, opts);
  }

  return await BackendService.responder(promptText, opts);
}

module.exports = {
  realtimeProviderResponder,
};
