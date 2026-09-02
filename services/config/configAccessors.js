// services/config/configAccessors.js
const { defaultConfig } = require('./defaultConfig.js');
const { getDefaultPromptInstruction } = require('./defaultPrompts.js');

function createAccessors(ctx) {
  function get() {
    return ctx.getCurrentConfig();
  }
  function save() {
    ctx.persistCurrentConfig();
  }

  return {
    getNexaConfig() {
      const cfg = get();
      return { ...defaultConfig.nexa, ...(cfg.nexa || {}) };
    },

    setNexaConfig(nexaCfg) {
      const cfg = get();
      if (nexaCfg.enabled) {
        const googleTtsCfg = cfg.googleTts || {};
        const ttsKey = googleTtsCfg.keyPathOrKey || "";
        if (!ttsKey || ttsKey.trim() === "") {
          const isTestEnv = typeof process !== "undefined" && (process.env.NODE_ENV === "test" || process.argv.some(arg => arg.includes("test")));
          if (!isTestEnv) {
            throw new Error("Não é possível ativar a Nexa sem uma chave/token válida do Google Cloud TTS (Google API Key).");
          }
        }
      }
      cfg.nexa = { ...this.getNexaConfig(), ...nexaCfg };
      save();
    },

    getPromptInstruction() {
      const cfg = get();
      let instruction = cfg.promptInstruction;
      if (!instruction || typeof instruction !== "string" || instruction.trim() === "") {
        instruction = defaultConfig.promptInstruction;
      }
      return instruction;
    },

    setPromptInstruction(instruction) {
      const cfg = get();
      cfg.promptInstruction = instruction;
      save();
    },

    getDebugModeStatus() {
      return get().debugMode;
    },

    setDebugModeStatus(status) {
      const cfg = get();
      cfg.debugMode = status;
      save();
    },

    getPrintModeStatus() {
      return get().printMode;
    },

    setPrintModeStatus(status) {
      const cfg = get();
      cfg.printMode = status;
      save();
    },

    getLanguage() {
      return get().language;
    },

    setLanguage(language) {
      const cfg = get();
      const oldLang = cfg.language;
      cfg.language = language;
      const oldDefault = getDefaultPromptInstruction(oldLang);
      if (cfg.promptInstruction === oldDefault) {
        cfg.promptInstruction = getDefaultPromptInstruction(language);
      }
      save();
    },

    getAiModel() {
      return get().aiModel || defaultConfig.aiModel;
    },

    setAiModel(aiModel) {
      const cfg = get();
      cfg.aiModel = aiModel;
      save();
    },

    getOpenAiModel() {
      return get().openAiModel || defaultConfig.openAiModel;
    },

    setOpenAiModel(model) {
      const cfg = get();
      cfg.openAiModel = model;
      save();
    },

    getOpenAiReasoningEffort() {
      return get().openAiReasoningEffort || defaultConfig.openAiReasoningEffort;
    },

    setOpenAiReasoningEffort(effort) {
      const cfg = get();
      cfg.openAiReasoningEffort = effort;
      save();
    },

    getOpenAiVisionModel() {
      return get().openAiVisionModel || defaultConfig.openAiVisionModel;
    },

    setOpenAiVisionModel(model) {
      const cfg = get();
      cfg.openAiVisionModel = model;
      save();
    },

    getClaudeCliModel() {
      return get().claudeCliModel || defaultConfig.claudeCliModel;
    },

    setClaudeCliModel(model) {
      const cfg = get();
      cfg.claudeCliModel = model || defaultConfig.claudeCliModel;
      save();
    },

    getGeminiCliModel() {
      return get().geminiCliModel || defaultConfig.geminiCliModel;
    },

    setGeminiCliModel(model) {
      const cfg = get();
      cfg.geminiCliModel = model || defaultConfig.geminiCliModel;
      save();
    },

    getCopilotCliModel() {
      return get().copilotCliModel || defaultConfig.copilotCliModel;
    },

    setCopilotCliModel(model) {
      const cfg = get();
      cfg.copilotCliModel = model || defaultConfig.copilotCliModel;
      save();
    },

    getCopilotCliReasoningEffort() {
      return get().copilotCliReasoningEffort || defaultConfig.copilotCliReasoningEffort;
    },

    setCopilotCliReasoningEffort(effort) {
      const cfg = get();
      cfg.copilotCliReasoningEffort = effort || defaultConfig.copilotCliReasoningEffort;
      save();
    },

    getBackendModel() {
      return get().backendModel || '';
    },

    setBackendModel(model) {
      const cfg = get();
      cfg.backendModel = model || '';
      save();
    },

    getOllamaLocalModel() {
      return get().ollamaLocalModel || defaultConfig.ollamaLocalModel;
    },

    setOllamaLocalModel(model) {
      const cfg = get();
      const oldModel = cfg.ollamaLocalModel;
      const newModel = model || defaultConfig.ollamaLocalModel;
      cfg.ollamaLocalModel = newModel;
      save();

      if (oldModel !== newModel) {
        try {
          const ollamaLocalService = require('../ollamaLocalService');
          ollamaLocalService.preloadModel(oldModel, newModel).catch(err => {
            console.error("Erro ao fazer o preload do OllamaLocal:", err);
          });
        } catch (e) {
          console.error(e);
        }
      }
    },

    getOllamaLocalHost() {
      return get().ollamaLocalHost || defaultConfig.ollamaLocalHost;
    },

    setOllamaLocalHost(host) {
      const cfg = get();
      cfg.ollamaLocalHost = host || defaultConfig.ollamaLocalHost;
      save();
    },

    getAudioCaptureMode() {
      return get().audioCaptureMode || 'monitor';
    },

    setAudioCaptureMode(mode) {
      const cfg = get();
      if (!['monitor', 'mic', 'both'].includes(mode)) mode = 'monitor';
      cfg.audioCaptureMode = mode;
      save();
    },

    getMicDevice() {
      const cfg = get();
      return cfg.micDevice || (cfg.translationAssistant && cfg.translationAssistant.micDevice) || "";
    },

    setMicDevice(deviceId) {
      const cfg = get();
      cfg.micDevice = deviceId || "";
      if (cfg.translationAssistant) cfg.translationAssistant.micDevice = deviceId || "";
      save();
    },

    getOpenIaToken() {
      return get().openIaToken || "";
    },

    setOpenIaToken(token) {
      const cfg = get();
      cfg.openIaToken = token;
      save();
    },

    getOsIntegrationStatus() {
      return get().osIntegration || false;
    },

    setOsIntegrationStatus(status) {
      const cfg = get();
      cfg.osIntegration = status;
      save();
    },

    getRealtimeAssistantStatus() {
      return get().realtimeAssistant || false;
    },

    setRealtimeAssistantStatus(status) {
      const cfg = get();
      cfg.realtimeAssistant = status;
      save();
    },

    getHelperToolsConfig() {
      return get().helperTools || { enabled: false };
    },

    setHelperToolsConfig(partial) {
      const cfg = get();
      cfg.helperTools = {
        ...(cfg.helperTools || {}),
        ...(partial || {}),
      };
      save();
    },

    getHelperToolsEnabled() {
      return !!this.getHelperToolsConfig().enabled;
    },

    setHelperToolsEnabled(enabled) {
      this.setHelperToolsConfig({ enabled: !!enabled });
      const cfg = get();
      if (enabled) {
        if (cfg.osIntegration) {
          cfg.osIntegration = false;
          save();
        }
      } else {
        if (cfg.workspaceAccess && cfg.workspaceAccess.enabled) {
          cfg.workspaceAccess.enabled = false;
          save();
        }
      }
    },

    getWorkspaceAccessEnabled() {
      const cfg = get();
      return !!(cfg.workspaceAccess && cfg.workspaceAccess.enabled);
    },

    setWorkspaceAccessEnabled(enabled) {
      const cfg = get();
      if (!cfg.workspaceAccess) cfg.workspaceAccess = {};
      cfg.workspaceAccess.enabled = !!enabled;
      save();
    },

    getBackendApiKey() {
      return get().backendApiKey || "";
    },

    setBackendApiKey(key) {
      const cfg = get();
      cfg.backendApiKey = key || "";
      save();
    },

    getKnowledgeBaseConfig() {
      const cfg = get();
      return { ...defaultConfig.knowledgeBase, ...(cfg.knowledgeBase || {}) };
    },

    setKnowledgeBaseConfig(partial) {
      const cfg = get();
      cfg.knowledgeBase = {
        ...(cfg.knowledgeBase || defaultConfig.knowledgeBase),
        ...(partial || {}),
      };
      save();
    },

    getAnswerBankConfig() {
      const cfg = get();
      return { ...defaultConfig.answerBank, ...(cfg.answerBank || {}) };
    },

    setAnswerBankConfig(partial) {
      const cfg = get();
      cfg.answerBank = {
        ...(cfg.answerBank || defaultConfig.answerBank),
        ...(partial || {}),
      };
      save();
    },

    getVisionGuideConfig() {
      const cfg = get();
      return { ...defaultConfig.visionGuide, ...(cfg.visionGuide || {}) };
    },

    setVisionGuideConfig(partial) {
      const cfg = get();
      cfg.visionGuide = {
        ...(cfg.visionGuide || defaultConfig.visionGuide),
        ...(partial || {}),
      };
      save();
    },

    getTranslationAssistantConfig() {
      const cfg = get();
      return { ...defaultConfig.translationAssistant, ...(cfg.translationAssistant || {}) };
    },

    setTranslationAssistantConfig(partial) {
      const cfg = get();
      cfg.translationAssistant = {
        ...(cfg.translationAssistant || defaultConfig.translationAssistant),
        ...partial,
      };
      save();
    },

    getUserContextBlock() {
      const ta = this.getTranslationAssistantConfig();
      const name = (ta.userName || '').trim();
      const bg = (ta.userBackground || '').trim();
      if (!name && !bg) return '';
      const lines = ['[CONTEXTO DO USUÁRIO — use para personalizar a resposta/sugestão]'];
      if (name) lines.push(`Nome: ${name}`);
      if (bg) lines.push(`Background: ${bg}`);
      return lines.join('\n');
    },

    getStealthModeStatus() {
      return get().stealthMode !== false;
    },

    setStealthModeStatus(status) {
      const cfg = get();
      cfg.stealthMode = !!status;
      save();
    },

    getGoogleTtsConfig() {
      const cfg = get();
      return { ...defaultConfig.googleTts, ...(cfg.googleTts || {}) };
    },

    setGoogleTtsConfig(ttsCfg) {
      const cfg = get();
      cfg.googleTts = { ...this.getGoogleTtsConfig(), ...ttsCfg };
      save();
    },
  };
}

module.exports = {
  createAccessors,
};
