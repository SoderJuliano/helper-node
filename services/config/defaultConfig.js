// services/config/defaultConfig.js
const fs = require('fs');
const { PROMPT_PT } = require('./defaultPrompts.js');

const defaultConfig = {
  promptInstruction: PROMPT_PT,
  debugMode: false,
  printMode: false,
  osIntegration: false,
  realtimeAssistant: false,
  stealthMode: true,
  language: "pt-br",
  aiModel: "llama",
  openAiModel: "gpt-4.1-nano",
  openAiReasoningEffort: "low",
  ollamaLocalModel: "qwen2.5-coder:7b",
  ollamaLocalHost: "http://localhost:11434",
  openAiVisionModel: "gpt-5-nano",
  openIaToken: "",
  helperTools: {
    enabled: false,
  },
  workspaceAccess: {
    enabled: false,
  },
  geminiCliModel: "gemini-2.5-flash",
  claudeCliModel: "sonnet",
  copilotCliModel: "claude-sonnet-4.5",
  copilotCliReasoningEffort: "medium",
  backendApiKey: "",
  micDevice: "",
  translationAssistant: {
    enabled: false,
    userName: "",
    userBackground: "",
    targetLanguage: "pt-br",
    testMode: false,
    micDevice: "",
  },
  knowledgeBase: {
    enabled: true,
    aiRewrite: true,
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
  googleTts: {
    enabled: false,
    keyPathOrKey: fs.existsSync("C:\\Users\\soder\\Documents\\sectrets\\gen-lang-client-0083021392-f898f4b44b05.json")
      ? "C:\\Users\\soder\\Documents\\sectrets\\gen-lang-client-0083021392-f898f4b44b05.json"
      : "",
    voiceName: "pt-BR-Neural2-C",
  },
  nexa: {
    enabled: false,
    onlyNexa: false,
  },
};

module.exports = {
  defaultConfig,
};
