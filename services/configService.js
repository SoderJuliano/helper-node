const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const defaultConfig = {
  promptInstruction: "Você é uma assistente que responde com até 65 palavras.",
  debugMode: false,
  printMode: false,
  osIntegration: false,
  language: "pt-br",
  aiModel: "llama",
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
  return lang === "pt-br"
    ? "Você é uma assistente que responde com até 65 palavras."
    : "You are a helpful assistant who responds in up to 65 words.";
}

function loadConfig() {
  try {
    const configFilePath = getConfigPath();
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      const lang = loadedConfig.language || defaultConfig.language;

      if (!loadedConfig.promptInstruction || loadedConfig.promptInstruction.trim() === '') {
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
  getLanguage,
  setLanguage,
  getAiModel,
  setAiModel,
  getOpenIaToken,
  setOpenIaToken,
  getIp,
};
