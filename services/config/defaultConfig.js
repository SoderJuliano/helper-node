// services/config/defaultConfig.js
const { PROMPT_PT } = require('./defaultPrompts.js');

const defaultConfig = {
  promptInstruction: PROMPT_PT,
  debugMode: false,
  printMode: false,
  osIntegration: false,
  realtimeAssistant: false,
  stealthMode: true,
  terminalLogs: false,
  language: "pt-br",
  aiModel: "llama",
  openAiModel: "gpt-4.1-nano",
  openAiReasoningEffort: "low",
  ollamaLocalModel: "qwen2.5-coder:7b",
  ollamaLocalHost: "http://localhost:11434",
  openAiVisionModel: "gpt-4o",
  openIaToken: "",
  helperTools: {
    enabled: true,
  },
  workspaceAccess: {
    enabled: true,
  },
  geminiCliModel: "gemini-3.7-flash-high",
  claudeCliModel: "sonnet",
  copilotCliModel: "claude-sonnet-4.5",
  copilotCliReasoningEffort: "medium",
  backendApiKey: "",
  micDevice: "",
  translationAssistant: {
    enabled: false,
    userName: "",
    userBackground: "",
    userTechExperiences: "",
    userBehavioral: "",
    targetLanguage: "pt-br",
    testMode: false,
    micDevice: "",
  },
  knowledgeBase: {
    enabled: true,
    aiRewrite: true,
  },
  preferenceMemory: {
    enabled: true,
  },
  answerBank: {
    enabled: true,
    minScore: 4,
  },
  visionGuide: {
    enabled: false,
    intervalSeconds: 5,
    minInterventionSeconds: 0,
    listenAudio: true,
    useKnowledgeBase: true,
  },
  googleApiKey: "",
  zaiApiKey: "b210cf3d04bf4c73916d4878692b7b46.NrhCaCvIMge8oDRF",
  zaiBaseUrl: "https://api.z.ai/api/paas/v4/",
  zaiModel: "glm-4.7-flash",
  hasCompletedWelcome: false,
  geminiLiveVoice: "Aoede", // Voz feminina calorosa, natural e expressiva (padrão Nexa)
  geminiLiveModel: "models/gemini-3.8-live",
  transcriptionProvider: "auto", // "auto" | "google" | "openai" | "local" | "macos"
  nexa: {
    name: "Nexa",
    enabled: true,
    onlyNexa: false,
    avatarMode: "raphael", // Raphael Core exclusivo (núcleo cósmico de plasma 3D)
  },
};

module.exports = {
  defaultConfig,
};
