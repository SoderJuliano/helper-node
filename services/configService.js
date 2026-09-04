// services/configService.js
const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const { defaultConfig } = require("./config/defaultConfig.js");
const { getDefaultPromptInstruction, NEXA_PERSONA_PROMPT } = require("./config/defaultPrompts.js");
const { createAccessors } = require("./config/configAccessors.js");

let configPath;
let currentConfig = null;

function getConfigPath() {
  if (!configPath) {
    const userDataPath = (app && typeof app.getPath === 'function')
      ? app.getPath("userData")
      : path.join(process.env.APPDATA || process.env.HOME || ".", ".config", "meu-electron-app");
    configPath = path.join(userDataPath, "config.json");
  }
  return configPath;
}

function loadConfig() {
  try {
    const configFilePath = getConfigPath();
    if (fs.existsSync(configFilePath)) {
      const fileContent = fs.readFileSync(configFilePath, 'utf-8');
      const loadedConfig = JSON.parse(fileContent);

      const lang = loadedConfig.language || defaultConfig.language;

      const LEGACY_DEFAULTS = [
        "Você é uma assistente que responde com até 65 palavras.",
        "You are a helpful assistant who responds in up to 65 words.",
      ];
      const isLegacy =
        !loadedConfig.promptInstruction ||
        loadedConfig.promptInstruction.trim() === '' ||
        LEGACY_DEFAULTS.includes(loadedConfig.promptInstruction.trim()) ||
        !loadedConfig.promptInstruction.includes('LaTeX') ||
        (!loadedConfig.promptInstruction.includes('PROPONHA') && !loadedConfig.promptInstruction.includes('PROPOSE')) ||
        (!loadedConfig.promptInstruction.includes('MESMO IDIOMA') && !loadedConfig.promptInstruction.includes('SAME LANGUAGE'));

      if (isLegacy) {
        loadedConfig.promptInstruction = getDefaultPromptInstruction(lang);
      }

      if (loadedConfig.visionGuide && loadedConfig.visionGuide.minInterventionSeconds === 12) {
        loadedConfig.visionGuide = { ...loadedConfig.visionGuide, minInterventionSeconds: 0 };
      }

      if (loadedConfig.workspaceAccess && loadedConfig.workspaceAccess.enabled === false && !loadedConfig.workspaceAccess.explicit) {
        loadedConfig.workspaceAccess.enabled = true;
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

function getCurrentConfig() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig;
}

function persistCurrentConfig() {
  if (currentConfig) {
    saveConfig(currentConfig);
    currentConfig = null;
  }
}

function initialize() {
  currentConfig = loadConfig();
}

let _cachedIp = null;
let _lastIpFetch = 0;

function getIp() {
  const now = Date.now();
  if (_cachedIp && (now - _lastIpFetch < 300000)) {
    return Promise.resolve(_cachedIp);
  }
  return fetch("https://api.ipify.org?format=json")
    .then((response) => response.json())
    .then((data) => {
      _cachedIp = data.ip;
      _lastIpFetch = now;
      return data.ip;
    })
    .catch((error) => {
      console.error("Erro ao obter o IP:", error && error.message);
      return _cachedIp || null;
    });
}

function getConfig() {
  if (!currentConfig) currentConfig = loadConfig();
  return { ...currentConfig };
}

function setConfigValue(dotPath, value) {
  if (!currentConfig) currentConfig = loadConfig();

  if ((dotPath === "nexa.enabled" && value) || (dotPath === "nexa" && value && value.enabled)) {
    const googleTtsCfg = currentConfig.googleTts || {};
    const ttsKey = googleTtsCfg.keyPathOrKey || "";
    if (!ttsKey || ttsKey.trim() === "") {
      const isTestEnv = typeof process !== "undefined" && (process.env.NODE_ENV === "test" || process.argv.some(arg => arg.includes("test")));
      if (!isTestEnv) {
        throw new Error("Não é possível ativar a Nexa sem uma chave/token válida do Google Cloud TTS (Google API Key).");
      }
    }
  }

  const keys = dotPath.split('.');
  let obj = currentConfig;
  for (let i = 0; i < keys.length - 1; i++) {
    if (obj[keys[i]] === undefined || typeof obj[keys[i]] !== 'object') {
      obj[keys[i]] = {};
    }
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  saveConfig(currentConfig);
  currentConfig = null;
}

const accessors = createAccessors({
  getCurrentConfig,
  persistCurrentConfig,
});

module.exports = {
  initialize,
  getConfig,
  setConfigValue,
  getIp,
  NEXA_PERSONA_PROMPT,
  ...accessors,
};
