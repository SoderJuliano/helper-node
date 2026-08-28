// Spawns a single `copilot -p <prompt> --allow-all-tools` invocation and
// captures its stdout. One instance per send() call — not a persistent REPL.
//
// Flags conferidas contra `copilot --help` real.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { killProcessTree } = require('../killProcessTree');

const CANDIDATE_BINARIES = ['copilot'];

// `--allow-all-tools` sozinho NÃO basta: ele libera as ferramentas, mas a
// verificação de CAMINHO continua ligada, então o CLI ficava pedindo permissão
// pra ler/escrever fora do diretório e despejando erro na tela — em modo
// não-interativo não existe ninguém pra responder esse prompt.
// `--allow-all` é o equivalente a allow-all-tools + allow-all-paths +
// allow-all-urls (mesmo efeito de `--yolo`).
const ALLOW_ALL_FLAG = '--allow-all';

// Sem isto o agente pode parar e usar a ferramenta `ask_user` esperando resposta
// que nunca vem — o processo fica pendurado até o watchdog matar.
const NO_ASK_FLAG = '--no-ask-user';

// O Copilot CLI é o único provider que recebe o prompt por ARGV (`-p <texto>`):
// Claude e agy leem do stdin justamente pra escapar desse teto. O `copilot --help`
// não expõe forma de passar o prompt por stdin, então o jeito é caber no limite.
// Windows: CreateProcess corta a linha de comando inteira em 32767 chars (spawn
// devolve ENAMETOOLONG); Linux tem teto de 128KB por argumento.
const MAX_CMDLINE_CHARS = process.platform === 'win32' ? 30000 : 100000;

// Quando o prompt excede o limite da linha de comando do SO (ex.: 30k chars no Windows por conta de objetos/JSONs gigantes colados):
// Em vez de fatiar o texto e omitir o meio com [...trecho omitido...], salvamos o prompt COMPLETO
// em um arquivo temporário no workspace e instruímos o Copilot a lê-lo 100% sem nenhuma omissão.
function fitPromptToCommandLine(prompt, command, otherArgs, cwd) {
  const overhead = command.length + otherArgs.reduce((n, a) => n + String(a).length + 3, 0) + 64;
  const budget = Math.max(2000, MAX_CMDLINE_CHARS - overhead);
  if (prompt.length <= budget) {
    return { promptText: prompt, tempFile: null };
  }

  try {
    const tempFileName = `.copilot_prompt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.txt`;
    const tempFilePath = path.join(cwd || process.cwd(), tempFileName);
    fs.writeFileSync(tempFilePath, prompt, 'utf8');
    console.log(`[copilot-cli] Prompt grande (${prompt.length} chars) salvo em ${tempFileName} para envio 100% integral sem omissões.`);

    let currentInstruction = '';
    try {
      const { extractCurrentInstruction } = require('../../historyFormatter');
      currentInstruction = extractCurrentInstruction(prompt);
    } catch (_) {
      const match = prompt.match(/🎯 INSTRUÇÃO ATUAL DO USUÁRIO[^\n]*\r?\n([\s\S]*?)(?:\r?\n═|$)/);
      if (match && match[1]) currentInstruction = match[1].trim();
    }

    let instructionPrompt;
    if (currentInstruction && currentInstruction !== prompt) {
      const preview = currentInstruction.length > 350 ? currentInstruction.slice(0, 350) + '...' : currentInstruction;
      instructionPrompt = `INSTRUÇÃO ATUAL DO USUÁRIO QUE VOCÊ DEVE EXECUTAR/RESPONDER:\n"${preview}"\n\nO contexto completo, histórico de mensagens e arquivos foram salvos INTEGRALMENTE sem omissões no arquivo "${tempFileName}" no diretório do projeto. Por favor, leia "${tempFileName}" para ter todos os detalhes necessários e execute/responda a instrução atual de ponta a ponta sem interrupções.`;
    } else {
      instructionPrompt = `O usuário enviou uma instrução/pergunta com arquivos e código extensos. Todos os detalhes foram salvos INTEGRALMENTE sem omissão em "${tempFileName}" no diretório do projeto. Por favor, leia o arquivo "${tempFileName}" e responda/execute de ponta a ponta sem interrupções.`;
    }

    return { promptText: instructionPrompt, tempFile: tempFilePath };
  } catch (err) {
    console.warn(`[copilot-cli] Falha ao salvar prompt em arquivo temporário:`, err.message);
    return { promptText: prompt, tempFile: null };
  }
}

// Rede de segurança: argv com byte NUL faz o spawn estourar ERR_INVALID_ARG_VALUE
// antes mesmo do CLI subir. A origem (anexo binário inlinado no prompt) já é
// tratada em helpers.appendAttachmentsContext, mas um NUL vindo de qualquer
// outro caminho não pode derrubar o envio.
function stripNulls(text) {
  return typeof text === 'string' && text.includes('\0') ? text.replace(/\0/g, '') : text;
}

const MAX_ATTACHMENTS = 10;

// Um caminho inexistente em `--attachment` faz o CLI abortar a invocação inteira,
// então filtramos antes em vez de deixar o erro voltar como "Copilot falhou".
function dedupeExisting(paths) {
  if (!Array.isArray(paths) || !paths.length) return [];
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (typeof p !== 'string' || !p) continue;
    const abs = path.resolve(p);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      if (!fs.statSync(abs).isFile()) continue;
    } catch (_) { continue; }
    out.push(abs);
    if (out.length >= MAX_ATTACHMENTS) break;
  }
  return out;
}

function getEnrichedEnv() {
  const env = { ...process.env, HOME: process.env.HOME || require('os').homedir() };
  const pathSep = process.platform === 'win32' ? ';' : ':';

  const extraPaths = [];
  if (process.platform === 'win32') {
    if (process.env.APPDATA) extraPaths.push(path.join(process.env.APPDATA, 'npm'));
    if (process.env.LOCALAPPDATA) extraPaths.push(path.join(process.env.LOCALAPPDATA, 'npm'));
    if (process.env.USERPROFILE) {
      extraPaths.push(path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm'));
      extraPaths.push(path.join(process.env.USERPROFILE, '.nvm', 'versions', 'node'));
    }
    extraPaths.push('C:\\Program Files\\nodejs');
  } else {
    const home = env.HOME;
    extraPaths.push('/usr/local/bin', '/usr/bin', '/bin', path.join(home, '.nvm/versions/node'), path.join(home, '.npm-global/bin'));
  }

  const currentPath = env.PATH || env.Path || '';
  env.PATH = [...extraPaths, currentPath].join(pathSep);
  env.Path = env.PATH;

  // Garante memória heap expandida (8GB) para modelos com 400k+ de contexto (ex: GPT-5.6 Terra, Claude 3.7, GPT-4o)
  // e evita bloqueios interativos no terminal
  const existingNodeOpts = env.NODE_OPTIONS || '';
  if (!existingNodeOpts.includes('--max-old-space-size')) {
    env.NODE_OPTIONS = (existingNodeOpts + ' --max-old-space-size=8192').trim();
  }
  env.FORCE_COLOR = '0';
  env.NO_COLOR = '1';
  env.CI = '1';

  return env;
}

async function resolveBinary() {
  if (process.platform === 'win32') {
    const directCandidates = [
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'copilot.cmd'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'copilot.bat'),
      process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'copilot.exe'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'copilot.cmd'),
      process.env.USERPROFILE && path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm', 'copilot.bat'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'npm', 'copilot.cmd'),
      'C:\\Program Files\\nodejs\\copilot.cmd',
    ].filter(Boolean);
    for (const cand of directCandidates) {
      if (fs.existsSync(cand)) return cand;
    }
  }

  const locator = process.platform === 'win32' ? 'where' : 'which';
  const env = getEnrichedEnv();
  for (const cmd of CANDIDATE_BINARIES) {
    try {
      const fullPath = await new Promise((resolve, reject) => {
        execFile(locator, [cmd], { env }, (err, stdout) => {
          const lines = (stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          if (err || !lines.length) return reject(err || new Error('not found'));
          resolve(pickExecutable(lines));
        });
      });
      if (fullPath) return fullPath;
    } catch (_) {}
  }
  return null;
}

// `where copilot` no Windows devolve VÁRIAS linhas quando o pacote veio do npm,
// e a PRIMEIRA é o shim Unix sem extensão (ex.: C:\nvm4w\nodejs\copilot), que o
// Windows não sabe executar → spawn morre com ENOENT e o app diz "não instalado".
// (Não apareceu no Claude/Gemini porque os dois são .exe nativos, uma linha só.)
// Por isso preferimos explicitamente .cmd/.bat/.exe em vez de confiar na ordem.
function pickExecutable(lines) {
  if (process.platform !== 'win32') return lines[0];
  return lines.find(l => /\.(cmd|bat|exe)$/i.test(l)) || lines[0];
}

// npm install -g cria um shim .cmd/.bat no Windows, e desde o patch de segurança
// do Node 18.20/20.12 o spawn recusa executar .cmd sem `shell: true`.
//
// ⚠️ Só que `shell: true` no Windows NÃO faz quoting dos args: o Node concatena
// tudo com espaço e entrega pro cmd.exe. Aí `-p Diga apenas hello` chega no
// binário como quatro argumentos separados e o Copilot responde
// "Invalid command format ... your prompt was not quoted". Era esse o bug.
//
// Solução: não usar `shell: true`. O shim .cmd do npm é só um wrapper que roda
// `node <pacote>/npm-loader.js %*`, então extraímos o .js de dentro dele e
// chamamos o node direto — spawn sem shell, argv passado como array, zero
// quoting envolvido (e de quebra imune a `%VAR%` sendo expandido pelo cmd.exe
// num prompt do usuário).
function needsShell(bin) {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
}

// Lê o shim .cmd e devolve o caminho do .js que ele executa, ou null.
function extractShimEntry(shimPath) {
  try {
    const content = fs.readFileSync(shimPath, 'utf8');
    // linha final do shim: ... "%_prog%"  "%dp0%\node_modules\@github\copilot\npm-loader.js" %*
    const m = content.match(/"%dp0%\\?([^"]+\.js)"/i) || content.match(/\$basedir\/([^\s"']+\.js)/i);
    if (!m) return null;
    const rel = m[1].replace(/^[\\/]+/, '');
    const entry = path.join(path.dirname(shimPath), rel);
    return fs.existsSync(entry) ? entry : null;
  } catch (_) {
    return null;
  }
}

// Plano B caso o formato do shim mude: o npm sempre instala o pacote em
// <dir do shim>/node_modules/@github/copilot, então dá pra achar o entrypoint
// pelo package.json sem depender de como o .cmd é escrito.
function findPackageEntry(shimPath) {
  try {
    const pkgDir = path.join(path.dirname(shimPath), 'node_modules', '@github', 'copilot');
    const pkgJson = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJson)) return null;
    const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
    const candidates = [];
    if (typeof pkg.bin === 'string') candidates.push(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === 'object') candidates.push(...Object.values(pkg.bin));
    if (pkg.main) candidates.push(pkg.main);
    for (const rel of candidates) {
      const entry = path.join(pkgDir, rel);
      if (fs.existsSync(entry)) return entry;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Acha um node.exe utilizável pra rodar o entrypoint do shim.
function findNodeExecutable(nearPath) {
  const candidates = [];
  if (nearPath) candidates.push(path.join(path.dirname(nearPath), process.platform === 'win32' ? 'node.exe' : 'node'));
  // process.execPath é o Electron quando rodando no app — serve como node só
  // com ELECTRON_RUN_AS_NODE, tratado em buildSpawnCommand.
  for (const c of candidates) {
    if (fs.existsSync(c)) return { node: c, viaElectron: false };
  }
  return { node: process.execPath, viaElectron: !/[\\/]node(\.exe)?$/i.test(process.execPath) };
}

// Monta { command, args, options, strategy } pro spawn, resolvendo o shim do
// Windows sem recorrer a shell: true.
function buildSpawnCommand(bin, args, baseOptions = {}) {
  const options = { ...baseOptions };

  if (!needsShell(bin)) {
    return { command: bin, args, options: { ...options, shell: false }, strategy: 'direct' };
  }

  const entry = extractShimEntry(bin) || findPackageEntry(bin);
  if (entry) {
    const { node, viaElectron } = findNodeExecutable(bin);
    const env = { ...(options.env || process.env) };
    if (viaElectron) env.ELECTRON_RUN_AS_NODE = '1';
    return {
      command: node,
      args: [entry, ...args],
      options: { ...options, env, shell: false },
      strategy: viaElectron ? 'node-entry (electron-as-node)' : 'node-entry',
    };
  }

  // Sem entrypoint resolvível não dá pra fugir do cmd.exe — e o quoting do cmd
  // é justamente o que estourava o "Invalid command format". Melhor falhar com
  // mensagem clara do que mandar um prompt corrompido pro modelo.
  throw new Error(
    `Não consegui resolver o entrypoint do Copilot CLI a partir de "${bin}". ` +
    'Reinstale com: npm install -g @github/copilot'
  );
}

class CopilotCliProcess {
  constructor() {
    this._proc    = null;
    this._onData  = null;
    this._onError = null;
    this._onClose = null;
    this._onStderr = null;
    this.alive    = false;
  }

  get pid() { return this._proc ? this._proc.pid : null; }

  // opts: { cwd, model, prompt, binary, attachments }
  // `attachments` = caminhos de imagem/PDF que vão em `--attachment` em vez de
  // serem transcritos no prompt (o CLI só aceita a flag em modo não-interativo,
  // que é exatamente o nosso `-p`).
  async start({ cwd, model, prompt, binary, attachments }) {
    if (this.alive) throw new Error('CopilotCliProcess already running');

    const bin = binary || await resolveBinary();
    if (!bin) {
      throw new Error(
        'GitHub Copilot CLI não encontrado. Instale com (não precisa de admin):\n' +
        '  npm install -g @github/copilot\n' +
        '(requer Node.js 22+) e autentique rodando `copilot` e digitando /login.'
      );
    }

    const tailArgs = [
      ALLOW_ALL_FLAG,
      NO_ASK_FLAG,
      '--stream', 'on',
      '--no-color',
      '--add-dir', cwd
    ];
    if (model) tailArgs.push('--model', model);
    for (const att of dedupeExisting(attachments)) tailArgs.push('--attachment', att);

    const { promptText, tempFile } = fitPromptToCommandLine(stripNulls(prompt || ''), bin, tailArgs, cwd);
    this._tempPromptFile = tempFile;
    const args = ['-p', promptText, ...tailArgs];

    const env = getEnrichedEnv();

    const plan = buildSpawnCommand(bin, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    console.log('[copilot-cli] spawn via', plan.strategy, '->', plan.command);

    this._proc = spawn(plan.command, plan.args, plan.options);

    this.alive = true;

    this._proc.stdout.setEncoding('utf8');
    this._proc.stderr.setEncoding('utf8');

    const cleanupTempFile = () => {
      if (this._tempPromptFile) {
        try {
          if (fs.existsSync(this._tempPromptFile)) {
            fs.unlinkSync(this._tempPromptFile);
          }
        } catch (_) {}
        this._tempPromptFile = null;
      }
    };

    this._proc.stdout.on('data', (chunk) => {
      if (this._onData) this._onData(chunk);
    });

    this._proc.stderr.on('data', (chunk) => {
      const line = chunk && chunk.trim();
      if (!line) return;
      console.warn('[copilot-cli] stderr:', line.slice(0, 200));
      if (this._onStderr) this._onStderr(line);
    });

    this._proc.on('close', (code, signal) => {
      this.alive = false;
      cleanupTempFile();
      if (this._onClose) this._onClose(code, signal);
    });

    this._proc.on('error', (err) => {
      this.alive = false;
      cleanupTempFile();
      if (this._onError) this._onError(err);
    });

    return this;
  }

  // SIGINT primeiro (equivalente ao Ctrl+C que o usuário daria no terminal),
  // SIGKILL como último recurso — mesmo padrão do ClaudeCliProcess.
  async kill() {
    if (!this.alive || !this._proc) return;
    // killProcessTree: mesmo sem shell aqui, o `copilot` roda ferramentas em
    // subprocessos próprios — matar só o pai deixava esses filhos vivos
    // escrevendo nos arquivos depois do "Parar IA".
    const proc = this._proc;
    await killProcessTree(proc, 'SIGINT');
    await new Promise(resolve => setTimeout(resolve, 800));
    if (this.alive) {
      await killProcessTree(proc, 'SIGKILL');
    }
    this.alive = false;
    this._proc = null;
  }

  onData(fn)   { this._onData   = fn; }
  onError(fn)  { this._onError  = fn; }
  onClose(fn)  { this._onClose  = fn; }
  onStderr(fn) { this._onStderr = fn; }

  static async checkInstalled() {
    return (await resolveBinary()) !== null;
  }

  static async resolveBinary() {
    return resolveBinary();
  }
}

module.exports = {
  CopilotCliProcess, resolveBinary, getEnrichedEnv, buildSpawnCommand,
  ALLOW_ALL_FLAG, NO_ASK_FLAG,
  fitPromptToCommandLine, stripNulls, dedupeExisting, MAX_CMDLINE_CHARS,
};
