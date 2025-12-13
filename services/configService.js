const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const defaultConfig = {
  promptInstruction: "Como responder essa questão em com até 65 palavras: ",
  debugMode: false,
  language: "pt-br", // Add default language
  voiceModel: "llama", // Add default voice model
};

// O caminho para o diretório de dados do usuário do app
// app.getPath('userData') só está disponível após o app estar 'ready'
// Por isso, inicializamos a variável de caminho mais tarde.
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
    ? "Como responder essa questão em com até 65 palavras: "
    : "How to answer this question in up to 65 words: ";
}

function loadConfig() {
  try {
    const configFilePath = getConfigPath();
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      // Garante que existe language
      const lang = loadedConfig.language || defaultConfig.language;

      // Garante promptInstruction padrão baseado no lang
      if (!loadedConfig.promptInstruction || loadedConfig.promptInstruction.trim() === '') {
        loadedConfig.promptInstruction = getDefaultPromptInstruction(lang);
      }

      // Mescla com o padrão para garantir que todas as chaves existam
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
  // Fallback para o valor padrão
  return defaultConfig.promptInstruction;
}

function setPromptInstruction(instruction) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.promptInstruction = instruction;
  saveConfig(currentConfig);
  // Força a recarga na proxima chamada
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
  // Força a recarga na proxima chamada
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

  // Só troca o prompt se for o prompt padrão antigo
  const oldDefault = getDefaultPromptInstruction(oldLang);
  if (currentConfig.promptInstruction === oldDefault) {
    currentConfig.promptInstruction = getDefaultPromptInstruction(language);
  }

  saveConfig(currentConfig);
  currentConfig = null;
}

// Carrega a configuração inicial
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

function getVoiceModel() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig.voiceModel || defaultConfig.voiceModel;
}

function setVoiceModel(voiceModel) {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  currentConfig.voiceModel = voiceModel;
  saveConfig(currentConfig);
  currentConfig = null;
}

module.exports = {
  initialize,
  getPromptInstruction,
  setPromptInstruction,
  getDebugModeStatus,
  setDebugModeStatus,
  getLanguage,
  setLanguage,
  getVoiceModel,
  setVoiceModel,
  getIp,
};
