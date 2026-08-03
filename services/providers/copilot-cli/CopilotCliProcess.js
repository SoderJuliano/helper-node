// Spawns a single `copilot -p <prompt> --allow-all-tools` invocation and
// captures its stdout. One instance per send() call — not a persistent REPL.
//
// ⚠️ Flags abaixo foram confirmados contra a doc oficial (docs.github.com/
// copilot/reference/copilot-cli-reference/cli-programmatic-reference), NÃO
// contra `copilot --help` rodado de verdade nesta máquina (aqui não tem o
// binário instalado). Existe divergência entre fontes sobre o nome exato da
// flag de bypass total: a doc "programmatic reference" usa `--allow-all-tools`,
// mas outra página da mesma doc.github.com (autopilot) cita `--allow-all`
// (alias `--yolo`). Fica ALLOW_ALL_FLAG como constante única — se o binário
// recusar a flag, é o primeiro lugar a corrigir, com `copilot --help` real.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CANDIDATE_BINARIES = ['copilot'];
const ALLOW_ALL_FLAG = '--allow-all-tools'; // ver aviso acima antes de mudar

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

  // opts: { cwd, model, prompt, binary }
  async start({ cwd, model, prompt, binary }) {
    if (this.alive) throw new Error('CopilotCliProcess already running');

    const bin = binary || await resolveBinary();
    if (!bin) {
      throw new Error(
        'GitHub Copilot CLI não encontrado. Instale com (não precisa de admin):\n' +
        '  npm install -g @github/copilot\n' +
        '(requer Node.js 22+) e autentique rodando `copilot` e digitando /login.'
      );
    }

    const args = [
      '-p', prompt,
      ALLOW_ALL_FLAG,
      '--add-dir', cwd,
    ];
    if (model) args.push('--model', model);

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
      if (this._onClose) this._onClose(code, signal);
    });

    this._proc.on('error', (err) => {
      this.alive = false;
      if (this._onError) this._onError(err);
    });

    return this;
  }

  // SIGINT primeiro (equivalente ao Ctrl+C que o usuário daria no terminal),
  // SIGKILL como último recurso — mesmo padrão do ClaudeCliProcess.
  async kill() {
    if (!this.alive || !this._proc) return;
    try { this._proc.kill('SIGINT'); } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 800));
    if (this.alive) {
      try { this._proc.kill('SIGKILL'); } catch (_) {}
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

module.exports = { CopilotCliProcess, resolveBinary, getEnrichedEnv, buildSpawnCommand, ALLOW_ALL_FLAG };
