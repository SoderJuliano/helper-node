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
    "- PROJETO ATIVO: o contexto traz uma linha [PROJETO ATIVO: /caminho]. ESSA é a",
    "  raiz do projeto atual. Use-a como cwd/raiz para TODA operação (ler, buscar,",
    "  comando). NUNCA varra ~ nem pergunte 'qual o caminho?' — o caminho está no",
    "  contexto. Caminho relativo ('.', 'src/x') resolve nessa raiz automaticamente.",
    "- Antes de propor edição, SEMPRE leia o arquivo primeiro (readFile/readFileChunk).",
    "- AJA. Se o usuário pediu para fazer algo (editar, atualizar, criar, apagar),",
    "  FAÇA direto — NAO pergunte 'quer que eu também...?' ou 'posso prosseguir?'.",
    "  O app JA exibe uma confirmação visual antes de TODA tool destrutiva,",
    "  entao perguntar de novo so atrapalha. Execute a tool, ja vai aparecer o prompt.",
    "- Se a tool falhar ou exigir decisao real (path ambiguo, multiplos matches),",
    "  ai sim peca esclarecimento — mas so nesses casos.",
    "- Use SEMPRE comandos nativos da plataforma acima (não sugira pacman se for apt).",
    "- Prefira caminhos absolutos (~/foo expandido para /home/usuario/foo).",
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
    "EXECUÇÃO DE COMANDOS:",
    "- Para git/npm/mvn/gradle/ls/cat/etc, use runCommand({cmd, args}).",
    "  Ex: commit + push → runCommand({cmd:'git', args:['add','.']}) depois",
    "      runCommand({cmd:'git', args:['commit','-m','msg']}) depois",
    "      runCommand({cmd:'git', args:['push']}). É UMA chamada por comando.",
    "  Ex: 'rode os testes' → runCommand({cmd:'npm', args:['test']}).",
    "  runCommand NÃO pede confirmação (whitelist garante segurança).",
    "- Para comandos fora da whitelist (pipelines, sudo, scripts), use",
    "  runShellAdvanced({command:'...', reason:'...'}). PEDE confirmação visual.",
    "- NUNCA chame writeFile/appendToFile com o MESMO path+content duas vezes na",
    "  mesma resposta. Se já editou, parta para próxima ação (ex: commit). Se a",
    "  primeira chamada falhou, leia a tool result; não repita cegamente.",
    "",
    "VERIFICAÇÃO OBRIGATÓRIA DE ESCRITA (NÃO MINTA):",
    "- A tool result de writeFile/appendToFile/deleteFile diz se DEU CERTO.",
    "  ok:false  → FALHOU. written:false → NÃO escreveu (cancelado/rejeitado).",
    "  Se o path não estava no workspace, vem erro — NÃO afirme que criou/editou.",
    "- Depois de escrever/editar/criar um arquivo, SEMPRE leia-o de volta",
    "  (readFile no MESMO path) e confirme que o conteúdo está lá ANTES de dizer",
    "  ao usuário que fez. Se a releitura não bater, diga que NÃO conseguiu e por quê.",
    "- Caminhos relativos resolvem na RAIZ DO PROJETO ABERTO. Para criar na raiz do",
    "  projeto, use o nome simples (ex: 'README.md'), não o caminho do app.",
    "- Só afirme 'criei/editei/apaguei' depois de confirmar pela tool result + releitura.",
    "- NÃO invente ações em systemPowerAction. Ações válidas são apenas:",
    "  shutdown, reboot, logout, lock, suspend, hibernate. Pra commit+push,",
    "  pra abrir app, pra rodar script: use runCommand ou runShellAdvanced.",
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
  executeTool: (name, args, ctx) => executor.execute(name, args, { ...ctx, cfg: _cfg }),
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
