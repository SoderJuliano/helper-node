const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const PROMPT_PT = [
  "Você é um copiloto técnico que ASSISTE o usuário em tempo real (estudo, código, reuniões).",
  "",
  "REGRAS DE RESPOSTA (obrigatórias):",
  "1. Se houver uma CONTA / EXPRESSÃO MATEMÁTICA → RESOLVA passo a passo e dê o resultado final em destaque.",
  "2. Se houver uma PERGUNTA OBJETIVA (múltipla escolha, verdadeiro/falso, definição) → indique a alternativa correta e justifique em 1 linha.",
  "3. Se for um CONCEITO TÉCNICO → explique de forma direta e dê um exemplo curto (código, fórmula ou caso prático).",
  "4. Se for um PEDIDO DE CÓDIGO → entregue o código funcional, sem encher de comentário.",
  "5. Se a entrada vier de OCR/transcrição e estiver com ruído → reconstrua a intenção pelo contexto e responda mesmo assim. NUNCA diga 'não consegui ler' — chute o melhor entendimento.",
  "",
  "FORMATO:",
  "- Texto explicativo: máximo 65 palavras.",
  "- Código, fórmulas e contas resolvidas: SEM limite de palavras.",
  "- Em PT-BR. Direto. Sem floreio. Sem 'Claro!', 'Posso ajudar', 'Espero ter ajudado'.",
  "- Use **negrito** para o resultado final.",
  "- NUNCA use LaTeX nem barras invertidas. Sem \\(, \\), \\[, \\], \\frac, \\times, \\cdot, \\sqrt etc.",
  "- Use símbolos UNICODE direto: × ÷ ² ³ √ π ≈ ≤ ≥ → ∞.",
  "- Para multiplicação escreva '×' ou '*'. Para potência use ² ³ ou ^.",
  "- Para frações escreva 'a/b' em texto puro.",
].join("\n");

const PROMPT_EN = [
  "You are a technical copilot that ASSISTS the user in real time (study, code, meetings).",
  "",
  "RESPONSE RULES (mandatory):",
  "1. If there is a MATH EXPRESSION / CALCULATION → SOLVE it step by step and highlight the final result.",
  "2. If there is an OBJECTIVE QUESTION (multiple choice, true/false, definition) → give the correct option and justify in 1 line.",
  "3. If it is a TECHNICAL CONCEPT → explain directly and give a short example (code, formula, or practical case).",
  "4. If it is a CODE REQUEST → deliver working code, no fluff comments.",
  "5. If the input comes from OCR/transcription and is noisy → reconstruct intent from context and answer anyway. NEVER say 'I cannot read' — take the best guess.",
  "",
  "FORMAT:",
  "- Explanatory text: max 65 words.",
  "- Code, formulas, solved calculations: NO word limit.",
  "- Direct. No fluff. No 'Sure!', 'Hope this helps'.",
  "- Use **bold** for the final result.",
  "- NEVER use LaTeX or backslashes. No \\(, \\), \\[, \\], \\frac, \\times, \\cdot, \\sqrt etc.",
  "- Use UNICODE symbols directly: × ÷ ² ³ √ π ≈ ≤ ≥ → ∞.",
  "- For multiplication use '×' or '*'. For powers use ² ³ or ^.",
  "- For fractions write 'a/b' in plain text.",
].join("\n");

const defaultConfig = {
  promptInstruction: PROMPT_PT,
  debugMode: false,
  printMode: false,
  osIntegration: false,
  realtimeAssistant: false,
  language: "pt-br",
  aiModel: "llama",
  openAiModel: "gpt-4.1-nano",
  // Modelo dedicado pra modo VISÃO. nano é fraco demais em visão (confunde
  // 11x2 com 11x²). gpt-4o-mini ainda é barato e MUITO mais preciso em
  // imagens (~US$ 0.15 / 1M tokens input + ~150 tokens por imagem high).
  openAiVisionModel: "gpt-4o-mini",
  openIaToken: "",
};

let configPath;

function getConfigPath() {
  if (!configPath) {
    const userDataPath = app.getPath("userData");
    configPath = path.join(userDataPath, "config.json");
  }
  return configPath;
}

function getDefaultPromptInstruction(lang) {
  return lang === "pt-br" ? PROMPT_PT : PROMPT_EN;
}

function loadConfig() {
  try {
    const configFilePath = getConfigPath();
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      const lang = loadedConfig.language || defaultConfig.language;

      // Lista de prompts default antigos que devem ser auto-migrados para o novo
      const LEGACY_DEFAULTS = [
        "Você é uma assistente que responde com até 65 palavras.",
        "You are a helpful assistant who responds in up to 65 words.",
      ];
      const isLegacy =
        !loadedConfig.promptInstruction ||
        loadedConfig.promptInstruction.trim() === '' ||
        LEGACY_DEFAULTS.includes(loadedConfig.promptInstruction.trim()) ||
        // Prompt antigo (sem a regra anti-LaTeX adicionada nesta versão).
        // Detecta pela ausência da palavra-chave única.
        !loadedConfig.promptInstruction.includes('LaTeX');
      if (isLegacy) {
        loadedConfig.promptInstruction = getDefaultPromptInstruction(lang);
      }

      return { ...defaultConfig, ...loadedConfig };
    }
  } catch (error) {
    console.error('Erro ao carregar o arquivo de configuração:', error);
  }
  return defaultConfig;
}

function saveConfig(config) {
  try {
    const configFilePath = getConfigPath();
    const configDir = path.dirname(configFilePath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    console.error("Erro ao salvar o arquivo de configuração:", error);
  }
}

let currentConfig = null;

function getPromptInstruction() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  const instruction = currentConfig.promptInstruction;
  if (
    instruction &&
    typeof instruction === "string" &&
    instruction.trim() !== ""
  ) {
    return instruction;
  }
  return defaultConfig.promptInstruction;
}

function setPromptInstruction(instruction) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.promptInstruction = instruction;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getDebugModeStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.debugMode;
}

function setDebugModeStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.debugMode = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getPrintModeStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.printMode;
}

function setPrintModeStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.printMode = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getLanguage() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.language;
}

function setLanguage(language) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }

  const oldLang = currentConfig.language;
  currentConfig.language = language;

  const oldDefault = getDefaultPromptInstruction(oldLang);
  if (currentConfig.promptInstruction === oldDefault) {
    currentConfig.promptInstruction = getDefaultPromptInstruction(language);
  }

  saveConfig(currentConfig);
  currentConfig = null;
}

function initialize() {
  currentConfig = loadConfig();
}

function getIp() {
  return fetch("https://api.ipify.org?format=json")
    .then((response) => response.json())
    .then((data) => {
      console.log("O IP do usuário é:", data.ip);
      return data.ip;
    })
    .catch((error) => {
      console.error("Erro ao obter o IP:", error);
      return null;
    });
}

function getAiModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.aiModel || defaultConfig.aiModel;
}

function setAiModel(aiModel) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.aiModel = aiModel;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenAiModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.openAiModel || defaultConfig.openAiModel;
}

function setOpenAiModel(model) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.openAiModel = model;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenAiVisionModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.openAiVisionModel || defaultConfig.openAiVisionModel;
}

function setOpenAiVisionModel(model) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.openAiVisionModel = model;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getAudioCaptureMode() {
  if (!currentConfig) currentConfig = loadConfig();
  // 'monitor' (default, sistema) | 'mic' (microfone) | 'both' (mix experimental)
  return currentConfig.audioCaptureMode || 'monitor';
}

function setAudioCaptureMode(mode) {
  if (!currentConfig) currentConfig = loadConfig();
  if (!['monitor', 'mic', 'both'].includes(mode)) mode = 'monitor';
  currentConfig.audioCaptureMode = mode;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getOpenIaToken() {
    if (!currentConfig) {
        currentConfig = loadConfig();
    }
    return currentConfig.openIaToken || "";
}

function setOpenIaToken(token) {
    if (!currentConfig) {
        currentConfig = loadConfig();
    }
    currentConfig.openIaToken = token;
    saveConfig(currentConfig);
    currentConfig = null;
}

function getOsIntegrationStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.osIntegration || false;
}

function setOsIntegrationStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.osIntegration = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

function getRealtimeAssistantStatus() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.realtimeAssistant || false;
}

function setRealtimeAssistantStatus(status) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.realtimeAssistant = status;
  saveConfig(currentConfig);
  currentConfig = null;
}

module.exports = {
  initialize,
  getPromptInstruction,
  setPromptInstruction,
  getDebugModeStatus,
  setDebugModeStatus,
  getPrintModeStatus,
  setPrintModeStatus,
  getOsIntegrationStatus,
  setOsIntegrationStatus,
  getRealtimeAssistantStatus,
  setRealtimeAssistantStatus,
  getLanguage,
  setLanguage,
  getAiModel,
  setAiModel,
  getOpenIaToken,
  setOpenIaToken,
  getOpenAiModel,
  setOpenAiModel,
  getOpenAiVisionModel,
  setOpenAiVisionModel,
  getAudioCaptureMode,
  setAudioCaptureMode,
  getIp,
};
