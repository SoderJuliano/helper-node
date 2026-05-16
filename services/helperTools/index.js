// services/helperTools/index.js
// Fachada pública do módulo. Toda integração externa passa por aqui.

const path = require("path");
const fs = require("fs");
const { DEFAULT_HELPER_TOOLS_CONFIG } = require("./config");
const platform = require("./platforms/detect");
const policy = require("./policy");
const audit = require("./audit");
const backup = require("./backup");
const { shouldEngage } = require("./shouldEngage");
const confirmationDetector = require("./confirmationDetector");

let _cfg = { ...DEFAULT_HELPER_TOOLS_CONFIG };
let _initialized = false;

/**
 * Inicializa o módulo. Deve ser chamado uma vez no boot do app (main.js)
 * com o snapshot atual da config do helperTools.
 */
function initialize(userConfig) {
  _cfg = { ...DEFAULT_HELPER_TOOLS_CONFIG, ...(userConfig || {}) };
  audit.init(_cfg.auditLogPath);
  backup.init(_cfg.backupDir, _cfg.maxBackupsPerFile);
  _initialized = true;
  audit.log("INIT", {
    enabled: _cfg.enabled,
    platform: platform.detect(),
  });
}

/**
 * Atualiza config em runtime (quando user mexe nas options).
 */
function updateConfig(userConfig) {
  initialize(userConfig);
}

function isEnabled() {
  return _initialized && !!_cfg.enabled;
}

function getConfig() {
  return { ..._cfg };
}

/**
 * Bloco de system prompt addon que descreve plataforma + regras desse modo.
 * Vai concatenado ao prompt padrão SOMENTE quando isEnabled() e shouldEngage().
 */
function getSystemPromptAddon() {
  return [
    "",
    "═══ MODO FERRAMENTAS ATIVO — regras abaixo SOBRESCREVEM as anteriores ═══",
    "",
    "Você tem acesso a ferramentas para ler/editar arquivos e executar comandos",
    "no sistema do usuário. Use-as quando o pedido envolver o sistema.",
    "",
    "PLATAFORMA DETECTADA:",
    platform.describeForPrompt(),
    "",
    "REGRAS DESTE MODO (sobrescrevem o prompt padrão):",
    "- Sem limite de 65 palavras.",
    "- Antes de propor edição, SEMPRE leia o arquivo primeiro (readFile/readFileChunk).",
    "- Explique brevemente o que vai fazer ANTES de invocar a tool.",
    "- Para edições ou comandos destrutivos, peça confirmação humana explícita.",
    "- Use SEMPRE comandos nativos da plataforma acima (não sugira pacman se for apt).",
    "- Prefira caminhos absolutos (~/foo expandido para /home/usuario/foo).",
    "- Se uma operação for arriscada (sudo, rm, mv massivo), pare e peça confirmação.",
    "- Se não encontrar o arquivo, use searchInFiles ou findFiles antes de desistir.",
    "",
  ].join("\n");
}

module.exports = {
  initialize,
  updateConfig,
  isEnabled,
  getConfig,
  shouldEngage,
  getSystemPromptAddon,
  // re-exports úteis pra main.js / outros módulos
  policy,
  audit,
  backup,
  platform,
  confirmationDetector,
};
