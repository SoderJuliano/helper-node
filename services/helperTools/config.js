// services/helperTools/config.js
// Defaults do módulo helperTools. Lidos via configService quando carregado.
// Desligado por padrão; usuário liga no toggle "Ferramentas avançadas".

const os = require("os");
const path = require("path");

const HOME = os.homedir();

const DEFAULT_HELPER_TOOLS_CONFIG = Object.freeze({
  enabled: false, // ⚠️ DEFAULT OFF — usuário tem que ligar conscientemente

  // Modelos por tipo de operação. Quando aiModel = 'openIa', usa estes
  // identificadores prefixados 'openai:'. Quando aiModel = 'llama' (server
  // Java), usa estes prefixados 'server:'. Sem fallback automático entre
  // os dois (decisão do usuário).
  modelClassifier: "openai:gpt-4.1-nano", // decide se engaja o módulo (rápido)
  modelSimple: "openai:gpt-4.1-nano", // ler arquivo, comandos simples
  modelHeavy: "openai:gpt-4o-mini", // editar/gerar código (mais capaz)

  // Equivalentes no server (quando usuário trocar pra Ollama):
  // modelClassifier: "server:llamatiny"
  // modelSimple:     "server:gemma3"
  // modelHeavy:      "server:qwen25"

  // Confirmação por voz/texto
  voiceConfirmation: true,
  confirmationWords: [
    "sim",
    "pode",
    "ok",
    "manda",
    "claro",
    "isso",
    "vai",
    "aceito",
    "confirmo",
    "pode editar",
    "pode rodar",
    "pode executar",
    "yes",
  ],

  // Sudo
  rememberSudoMinutes: 0, // 0 = sempre pede; >0 = cacheia em RAM por X minutos

  // Sandbox de escrita
  writeRoots: [HOME, "/tmp/helper-node"],
  // Glob simples (sem suporte a {a,b}). Comparado com endsWith / includes.
  deniedPathFragments: [
    "/.ssh/",
    "/.aws/credentials",
    "/.config/gcloud/",
    "/.gnupg/",
    "wallet",
    "keystore",
  ],
  deniedFileSuffixes: [
    ".pem",
    ".key",
    ".p12",
    ".jks",
    ".kdbx",
    ".gpg",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
  ],
  allowEnvFiles: false, // .env (sem .example) bloqueado por padrão

  // Backup automático antes de escrever
  autoBackup: true,
  backupDir: path.join(HOME, ".config", "helper-node", "backups"),
  maxBackupsPerFile: 50,

  // Audit log
  auditLogPath: path.join(HOME, ".config", "helper-node", "audit.log"),

  // Limites do loop de tool-calling
  maxToolCallsPerRequest: 5,
  maxFileSizeForRead: 2 * 1024 * 1024, // 2 MB
  maxLinesForFullRead: 500,
});

// Whitelists de extensões e nomes de arquivos para WRITE.
// Read é mais permissivo (qualquer coisa que o usuário possa ler), mas
// também respeita deniedPaths/deniedSuffixes.
const ALLOWED_EXTENSIONS_FOR_WRITE = Object.freeze([
  // Texto / docs
  ".txt",
  ".md",
  ".markdown",
  ".rst",
  ".adoc",

  // Configs
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".cfg",
  ".env.example",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",

  // Shell
  ".sh",
  ".bash",
  ".zsh",
  ".fish",

  // JS/TS ecosystem
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".vue",
  ".svelte",

  // Java/Kotlin/Groovy
  ".java",
  ".kt",
  ".kts",
  ".groovy",
  ".gradle",

  // Python / Go / Rust / outros
  ".py",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".lua",

  // Web
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",

  // Data / DB
  ".sql",
  ".csv",
  ".tsv",
  ".xml",

  // Docker
  ".dockerfile",
]);

const NAMED_FILES_ALLOWED_FOR_WRITE = Object.freeze([
  // Shell configs
  ".bashrc",
  ".zshrc",
  ".profile",
  ".bash_profile",
  ".zprofile",
  ".bash_aliases",
  ".aliases",
  "config.fish",

  // Git
  ".gitconfig",
  ".gitignore_global",

  // Node
  ".npmrc",
  ".nvmrc",
  ".node-version",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.json",
  "jsconfig.json",

  // Java / Spring / Quarkus
  "pom.xml",
  "build.gradle",
  "settings.gradle",
  "application.properties",
  "application.yml",
  "application.yaml",

  // Docker
  "Dockerfile",
  "Dockerfile.dev",
  "Dockerfile.prod",
  "docker-compose.yml",
  "docker-compose.yaml",
  "docker-compose.override.yml",
  "compose.yml",
  "compose.yaml",

  // Build
  "Makefile",
  "makefile",
  "GNUmakefile",
  "CMakeLists.txt",
  "Cargo.toml",
  "go.mod",
  "go.sum",

  // Angular/Vue/Nest/Vite
  "angular.json",
  "vue.config.js",
  "vite.config.js",
  "vite.config.ts",
  "nest-cli.json",
  "webpack.config.js",
  "next.config.js",
  "nuxt.config.js",
  "svelte.config.js",
]);

// Whitelist de comandos que rodam SEM confirmação (read-only do sistema).
// Qualquer coisa fora disso cai em runShellAdvanced que pede confirmação.
const SAFE_COMMANDS = Object.freeze({
  // Texto / arquivos (read-only)
  echo: "*",
  cat: "*",
  head: "*",
  tail: "*",
  wc: "*",
  ls: "*",
  pwd: [],
  whoami: [],
  date: "*",
  uname: "*",
  hostname: [],

  // Disco / sistema (read-only)
  df: ["-h", "-T", "-i"],
  du: ["-sh", "-h"],
  free: ["-h", "-m"],
  uptime: [],
  env: [],
  printenv: "*",
  which: "*",
  whereis: "*",
  type: "*",

  // Versões
  java: ["-version", "--version"],
  javac: ["-version"],
  node: ["--version", "-v"],
  npm: ["--version", "-v"],
  pnpm: ["--version", "-v"],
  yarn: ["--version", "-v"],
  python: ["--version", "-V"],
  python3: ["--version", "-V"],
  pip: ["--version"],
  pip3: ["--version"],
  go: ["version"],
  rustc: ["--version"],
  cargo: ["--version"],
  ruby: ["--version", "-v"],
  php: ["--version", "-v"],
  docker: ["--version", "ps", "images", "info"],
  "docker-compose": ["--version"],
  kubectl: ["version", "--client"],

  // Git (read-only)
  git: [
    "status",
    "log",
    "diff",
    "branch",
    "remote",
    "show",
    "rev-parse",
    "config",
    "--version",
  ],
});

module.exports = {
  DEFAULT_HELPER_TOOLS_CONFIG,
  ALLOWED_EXTENSIONS_FOR_WRITE,
  NAMED_FILES_ALLOWED_FOR_WRITE,
  SAFE_COMMANDS,
  HOME,
};
