// services/helperTools/index.js
// Fachada pública do módulo. Toda integração externa passa por aqui.

const path = require("path");
const fs = require("fs");
const { DEFAULT_HELPER_TOOLS_CONFIG } = require("./config");
const platform = require("./platforms/detect");
const policy = require("./policy");
const audit = require("./audit");
const backup = require("./backup");
const { shouldEngage, shouldForceHeavyModel } = require("./shouldEngage");
const confirmationDetector = require("./confirmationDetector");
const registry = require("./registry");
const schema = require("./schema");
const executor = require("./executor");

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
  registry.loadBuiltins();
  _initialized = true;
  audit.log("INIT", {
    enabled: _cfg.enabled,
    platform: platform.detect(),
    toolsLoaded: registry.list().map((t) => t.name),
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
    "- Para saber se um app/pacote está instalado, use listPackages com `pattern`",
    "  (NÃO faça searchInFiles em $HOME inteiro — é lento e impreciso).",
    "- Para descobrir QUAIS apps GUI existem por TIPO (editores, navegadores,",
    "  IDEs, players, etc), use listDesktopApps com `category` ou `pattern`.",
    "  Ex: 'quais editores tenho?' → listDesktopApps({category:'TextEditor'}).",
    "  Ex: 'quais navegadores?' → listDesktopApps({category:'WebBrowser'}).",
    "  listDesktopApps tem o nome legível do app (gedit -> 'Text Editor');",
    "  listPackages tem o nome do PACOTE (sem 'editor' no nome). Use o certo!",
    "",
    "NOMES DE PACOTES/APPS (a entrada vem de transcrição de voz, normalize ANTES de buscar):",
    "- Tente PRIMEIRO o pattern curto e simples em lowercase, sem espaços.",
    "  Ex: 'Helper Node' / 'helper traço node' / 'HelperNode' → pattern='helper-node'.",
    "  Ex: 'Visual Studio Code' → pattern='code' ou 'vscode'.",
    "  Ex: 'Google Chrome' → pattern='chrome'.",
    "- Se a primeira tentativa não achar nada, tente variações (com/sem hífen,",
    "  só a primeira palavra, alias comum). NÃO repita a mesma busca.",
    "- Palavras 'traço'/'underline'/'ponto' na fala viram '-' / '_' / '.' no nome.",
    "",
  ].join("\n");
}

module.exports = {
  initialize,
  updateConfig,
  isEnabled,
  getConfig,
  shouldEngage,
  shouldForceHeavyModel,
  getSystemPromptAddon,
  // Execução de tools
  executeTool: (name, args) => executor.execute(name, args, { cfg: _cfg }),
  // Schemas para passar pra IA
  getOpenAIToolsSchema: schema.toOpenAITools,
  getTextToolDescription: schema.toTextDescription,
  // re-exports úteis pra main.js / outros módulos
  policy,
  audit,
  backup,
  platform,
  registry,
  confirmationDetector,
};
