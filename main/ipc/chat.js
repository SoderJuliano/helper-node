// main/ipc/chat.js
const {
  BackendService, GeminiCliProvider, ClaudeCliProvider, CopilotCliProvider,
  OpenAIService, configService, edition, workspace, agenticWorkflow,
  ollamaAgenticWorkflow, visionGuide, state, helpers, ipcMain,
} = require('../globals.js');

const { handleSendToGemini, handleSendToGeminiVision } = require('./chatNonStreamHandler');
const { handleSendToGeminiStream, handleSendToGeminiImageStream } = require('./chatStreamHandler');

function abortRunningCliProviders() {
  let projectPath = null;
  try { projectPath = workspace.getProjectPath(); } catch (_) {}
  try { ClaudeCliProvider.abortCurrent(projectPath).catch(() => {}); } catch (_) {}
  try { GeminiCliProvider.abortCurrent && GeminiCliProvider.abortCurrent(projectPath).catch(() => {}); } catch (_) {}
  try { CopilotCliProvider.abortCurrent && CopilotCliProvider.abortCurrent().catch(() => {}); } catch (_) {}
}

function broadcastAiModelChange(data = {}) {
  try {
    const { BrowserWindow } = require("electron");
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win && !win.isDestroyed()) win.webContents.send("ai-model-changed", data);
    });
  } catch (err) {
    console.warn("Error broadcasting ai-model-changed:", err);
  }
}

module.exports = function registerIpc() {
  ipcMain.on("send-to-gemini", handleSendToGemini);
  ipcMain.on("send-to-gemini-vision", handleSendToGeminiVision);
  ipcMain.on("send-to-gemini-stream", handleSendToGeminiStream);
  ipcMain.on("send-to-gemini-image-stream", handleSendToGeminiImageStream);

  ipcMain.on("stop-agentic-workflow", (event, sessionId) => {
    agenticWorkflow.stop(sessionId);
    if (typeof ollamaAgenticWorkflow !== 'undefined') {
      ollamaAgenticWorkflow.stop(sessionId);
    }
    abortRunningCliProviders();
  });

  ipcMain.on("clear-ai-sessions", () => {
    console.log("🧹 Limpando sessões de IA (OpenAI + Backend + Ollama Local + Gemini + Claude)...");
    if (OpenAIService.sessions) OpenAIService.sessions = {};
    BackendService.clearSessions();
    try { require('../../services/ollamaLocalService').resetSession(); } catch (_) {}
    GeminiCliProvider.shutdown().catch((e) => {
      console.warn('[gemini-cli] clear-ai-sessions shutdown error:', e.message);
    });
    ClaudeCliProvider.shutdown().catch((e) => {
      console.warn('[claude-cli] clear-ai-sessions shutdown error:', e.message);
    });
    CopilotCliProvider.shutdown().catch((e) => {
      console.warn('[copilot-cli] clear-ai-sessions shutdown error:', e.message);
    });
  });

  ipcMain.on("cancel-ia-request", () => {
    if (state.waitingNotificationInterval) {
      clearInterval(state.waitingNotificationInterval);
      state.waitingNotificationInterval = null;
    }
    try { BackendService.abortCurrentRequest(); } catch (_) {}
    try { require('../../services/backendAgentService').abortCurrentRequest(); } catch (_) {}
    try {
      const OllamaLocalService = require('../../services/ollamaLocalService');
      OllamaLocalService.abortCurrentRequest();
    } catch (_) {}
    abortRunningCliProviders();
    try { agenticWorkflow.stopAll && agenticWorkflow.stopAll(); } catch (_) {}
    try {
      if (typeof ollamaAgenticWorkflow !== 'undefined' && ollamaAgenticWorkflow.stopAll) {
        ollamaAgenticWorkflow.stopAll();
      }
    } catch (_) {}
    console.log("IA request cancelled");
  });

  ipcMain.handle("get-backend-url", async () => await BackendService.getApiUrl());
  ipcMain.handle("get-backend-api-key", () => configService.getBackendApiKey());
  ipcMain.handle("get-ai-model", () => {
    const m = configService.getAiModel();
    console.log(`[get-ai-model] -> ${JSON.stringify(m)}`);
    return m;
  });
  ipcMain.handle("get-edition", () => edition.getEdition());
  ipcMain.on("open-config-ui", () => helpers.createConfigWindow());
  ipcMain.on("open-preferences-ui", () => helpers.createPreferencesWindow());

  ipcMain.on("set-ai-model", (event, aiModel) => {
    const anterior = configService.getAiModel();
    if (anterior !== aiModel) {
      try { BackendService.abortCurrentRequest(); } catch (_) {}
    }
    configService.setAiModel(aiModel);
    broadcastAiModelChange({ provider: aiModel });
  });

  ipcMain.handle("get-openai-model", () => configService.getOpenAiModel());
  ipcMain.on("set-openai-model", (event, model) => {
    configService.setOpenAiModel(model);
    broadcastAiModelChange({ provider: 'openIa', model });
  });

  ipcMain.handle("get-openai-reasoning-effort", () => configService.getOpenAiReasoningEffort());
  ipcMain.on("set-openai-reasoning-effort", (event, effort) => configService.setOpenAiReasoningEffort(effort));
  ipcMain.handle("get-openai-vision-model", () => configService.getOpenAiVisionModel());
  ipcMain.on("set-openai-vision-model", (event, model) => configService.setOpenAiVisionModel(model));

  ipcMain.handle("get-backend-model", () => configService.getBackendModel ? configService.getBackendModel() : '');
  ipcMain.on("set-backend-model", (event, model) => {
    if (configService.setBackendModel) configService.setBackendModel(model);
    broadcastAiModelChange({ provider: 'llama', model });
  });

  ipcMain.handle("get-ollama-local-model", () => configService.getOllamaLocalModel());
  ipcMain.on("set-ollama-local-model", (event, model) => {
    configService.setOllamaLocalModel(model);
    broadcastAiModelChange({ provider: 'ollamaLocal', model });
  });
  ipcMain.handle("get-ollama-local-host", () => configService.getOllamaLocalHost());

  ipcMain.handle("get-gemini-cli-model", () => configService.getGeminiCliModel());
  ipcMain.on("set-gemini-cli-model", (event, model) => {
    configService.setGeminiCliModel(model);
    GeminiCliProvider.setModel(model);
    broadcastAiModelChange({ provider: 'geminiCli', model });
  });
  ipcMain.handle("get-gemini-cli-models", (event, force) => GeminiCliProvider.getModels(force));
  ipcMain.handle("check-gemini-cli-installed", async () => {
    try {
      const ok = await GeminiCliProvider.checkInstalled();
      return { installed: ok };
    } catch (e) {
      return { installed: false, error: String(e && e.message) };
    }
  });
  ipcMain.handle("gemini-cli-restart-session", async () => {
    const projectPath = workspace.getProjectPath();
    await GeminiCliProvider.changeProject(projectPath, projectPath).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("get-claude-cli-model", () => configService.getClaudeCliModel());
  ipcMain.on("set-claude-cli-model", (event, model) => {
    configService.setClaudeCliModel(model);
    ClaudeCliProvider.setModel(model);
    broadcastAiModelChange({ provider: 'claudeCli', model });
  });
  ipcMain.handle("get-claude-cli-models", () => ClaudeCliProvider.getModels());
  ipcMain.handle("check-claude-cli-installed", async () => {
    try {
      const ok = await ClaudeCliProvider.checkInstalled();
      return { installed: ok };
    } catch (e) {
      return { installed: false, error: String(e && e.message) };
    }
  });
  ipcMain.handle("claude-cli-restart-session", async () => {
    const projectPath = workspace.getProjectPath();
    await ClaudeCliProvider.changeProject(projectPath, projectPath).catch(() => {});
    return { ok: true };
  });

  ipcMain.handle("get-copilot-cli-model", () => configService.getCopilotCliModel());
  ipcMain.on("set-copilot-cli-model", (event, model) => {
    configService.setCopilotCliModel(model);
    CopilotCliProvider.setModel(model);
    broadcastAiModelChange({ provider: 'copilotCli', model });
  });
  ipcMain.handle("get-copilot-cli-reasoning-effort", () => configService.getCopilotCliReasoningEffort());
  ipcMain.on("set-copilot-cli-reasoning-effort", (event, effort) => {
    configService.setCopilotCliReasoningEffort(effort);
    CopilotCliProvider.setEffort(effort);
    broadcastAiModelChange({ provider: 'copilotCli', model: configService.getCopilotCliModel(), effort });
  });
  ipcMain.handle("get-copilot-cli-models", (event, force) => CopilotCliProvider.getModels(force));
  ipcMain.handle("check-copilot-cli-installed", async () => {
    try {
      const ok = await CopilotCliProvider.checkInstalled();
      return { installed: ok };
    } catch (e) {
      return { installed: false, error: String(e && e.message) };
    }
  });
  ipcMain.handle("copilot-cli-reset-blocked-models", async () => {
    try {
      const modelAccess = require("../../services/providers/copilot-cli/CopilotCliModelAccess");
      modelAccess.reset();
      const models = await CopilotCliProvider.getModels(true);
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("check-ollama-local-status", async () => {
    try {
      const svc = require('../../services/ollamaLocalService');
      const ok = await svc.ping();
      if (!ok) return { running: false, models: null };
      const models = await svc.listInstalledModels();
      return { running: true, models: models || [] };
    } catch (e) {
      return { running: false, error: String(e && e.message), models: null };
    }
  });

  ipcMain.handle("get-open-ia-token", () => configService.getOpenIaToken());
  ipcMain.on("set-open-ia-token", (event, token) => configService.setOpenIaToken(token));

  ipcMain.on("send-os-question", async (event, data) => {
    const text = typeof data === 'string' ? data : data.text;
    const image = typeof data === 'object' ? data.image : null;

    if (state.osInputWindow && !state.osInputWindow.isDestroyed()) {
      state.osInputWindow.close();
    }

    if (!image && text && text.trim() && configService.getOsIntegrationStatus() && visionGuide.isActive()) {
      try { visionGuide.askQuestion(text.trim()); } catch (e) { console.warn('[vision-guide] askQuestion falhou:', e.message); }
      return;
    }

    helpers.createOsNotificationWindow('loading', 'Processando pergunta...');

    try {
      await helpers.processOsQuestion(text, image, image ? { forceVision: true } : {});
    } catch (error) {
      console.error('Error processing OS question:', error);
      helpers.createOsNotificationWindow('response', 'Erro ao processar pergunta.');
    }
  });
};
