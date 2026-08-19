// services/appRunner/runnerProcess.js
// Gerenciamento de ciclo de vida de subprocessos de execução (Gradle / Maven / Java),
// streaming de stdout/stderr, parsing de testes JUnit / Spring Boot e encerramento com kill process tree.

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class RunnerProcess extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
    this._pid = null;
    this._status = 'idle'; // 'idle' | 'starting' | 'running' | 'completed' | 'stopped' | 'error'
    this._currentRun = null;
    this._outputBuffer = '';
    this._exitCode = null;
  }

  getStatus() {
    return {
      status: this._status,
      pid: this._pid,
      currentRun: this._currentRun,
      exitCode: this._exitCode,
    };
  }

  /**
   * Inicia a execução do comando no diretório do projeto.
   * @param {Object} opts
   * @param {string} opts.executable Ex: 'C:\\project\\gradlew.bat' ou './gradlew' ou 'mvn'
   * @param {string[]} opts.args Ex: ['bootRun', '--console=plain']
   * @param {string} opts.cwd Diretório do projeto
   * @param {Object} [opts.jdk] JDK detectada { homePath, javaPath }
   * @param {Record<string, string>} [opts.customEnv] Variáveis de ambiente adicionais (ex: IntelliJ .idea)
   * @param {Object} [opts.runMeta] Metadados da execução (target, displayName, etc.)
   */
  start(opts) {
    if (this._proc) {
      throw new Error('Já existe um processo em execução. Pare o processo atual antes de iniciar um novo.');
    }

    const { executable, args = [], cwd, jdk, customEnv = {}, runMeta } = opts;
    const isWin = process.platform === 'win32';

    this._status = 'starting';
    this._outputBuffer = '';
    this._exitCode = null;
    this._currentRun = {
      executable,
      args,
      cwd,
      jdkHome: jdk ? jdk.homePath : (process.env.JAVA_HOME || ''),
      displayName: (runMeta && runMeta.displayName) || 'App',
      kind: (runMeta && runMeta.kind) || 'app',
      startedAt: Date.now(),
    };

    // Monta ambiente completo do processo
    const env = { ...process.env, ...customEnv };
    if (jdk && jdk.homePath) {
      env.JAVA_HOME = jdk.homePath;
      const binDir = path.join(jdk.homePath, 'bin');
      env.PATH = `${binDir}${path.delimiter}${env.PATH || ''}`;
    }

    // Configurações do spawn cross-platform
    let spawnExe = executable;
    let spawnArgs = args;

    if (isWin) {
      // No Windows, arquivos .bat ou .cmd são executados via cmd.exe /c
      const isBatch = executable.endsWith('.bat') || executable.endsWith('.cmd') || !executable.includes('.');
      if (isBatch) {
        spawnExe = 'cmd.exe';
        spawnArgs = ['/c', executable, ...args];
      }
    }

    const spawnOpts = {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !isWin, // No Linux/Mac detached cria novo process group para kill fácil
    };

    try {
      this._proc = spawn(spawnExe, spawnArgs, spawnOpts);
      this._pid = this._proc.pid;
      this._status = 'running';
      this.emit('status', this.getStatus());

      // Emite chunk inicial de cabeçalho informativo
      const displayCmd = isWin && spawnExe === 'cmd.exe'
        ? `${path.basename(executable)} ${args.join(' ')}`
        : `${executable} ${args.join(' ')}`;

      const intellijEnvKeys = Object.keys(customEnv);
      const intellijInfo = intellijEnvKeys.length > 0
        ? `\x1b[90m⚙ Envs IntelliJ:\x1b[0m ${intellijEnvKeys.join(', ')}\n`
        : '';

      const initHeader = `\x1b[90m▶ Executando:\x1b[0m \x1b[36m${displayCmd}\x1b[0m\n` +
                         `\x1b[90m📁 Diretório:\x1b[0m ${cwd}\n` +
                         (env.JAVA_HOME ? `\x1b[90m☕ JAVA_HOME:\x1b[0m ${env.JAVA_HOME}\n` : '') +
                         intellijInfo +
                         `\x1b[90m────────────────────────────────────────────────────────────\x1b[0m\n`;
      this._emitChunk(initHeader);

      this._proc.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        this._outputBuffer += text;
        this._emitChunk(text);
        this._parseOutputForEvents(text);
      });

      this._proc.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        this._outputBuffer += text;
        this._emitChunk(text);
        this._parseOutputForEvents(text);
      });

      this._proc.on('close', (code) => {
        this._exitCode = code;
        this._proc = null;
        this._pid = null;

        if (this._status !== 'stopped') {
          this._status = code === 0 ? 'completed' : 'error';
        }

        const footer = `\n\x1b[90m────────────────────────────────────────────────────────────\x1b[0m\n` +
                       (code === 0
                         ? `\x1b[32m✔ Processo concluído com código 0\x1b[0m\n`
                         : `\x1b[31m✖ Processo finalizado com código ${code}\x1b[0m\n`);
        this._emitChunk(footer);
        this.emit('status', this.getStatus());
        this.emit('exit', { code, status: this._status });
      });

      this._proc.on('error', (err) => {
        this._status = 'error';
        const errMsg = `\n\x1b[31mErro ao iniciar processo: ${err.message}\x1b[0m\n`;
        this._emitChunk(errMsg);
        this._proc = null;
        this._pid = null;
        this.emit('status', this.getStatus());
        this.emit('error', err);
      });

      return this.getStatus();
    } catch (err) {
      this._status = 'error';
      this.emit('status', this.getStatus());
      throw err;
    }
  }

  _emitChunk(text) {
    this.emit('data', text);
  }

  _parseOutputForEvents(text) {
    // 1. Detecta Spring Boot porta (ex: Tomcat started on port 8080 (http))
    const portMatch = text.match(/(?:Tomcat|Jetty|Undertow|Netty)\s+started\s+on\s+port\(?s?\)?\s*[:\s]*(\d+)/i);
    if (portMatch) {
      this.emit('app-event', { type: 'server-started', port: parseInt(portMatch[1], 10) });
    }

    // 2. Detecta resultados de testes JUnit (Gradle / Maven)
    // Ex Gradle: MyTest > testMethod() PASSED / FAILED
    const gradleTestMatch = text.match(/([a-zA-Z0-9_]+)\s*>\s*([a-zA-Z0-9_]+)\s*\(\)\s*(PASSED|FAILED|SKIPPED)/);
    if (gradleTestMatch) {
      this.emit('test-event', {
        className: gradleTestMatch[1],
        methodName: gradleTestMatch[2],
        status: gradleTestMatch[3].toLowerCase(),
      });
    }

    // Ex Maven: Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
    const mavenSummaryMatch = text.match(/Tests\s+run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
    if (mavenSummaryMatch) {
      this.emit('test-summary', {
        total: parseInt(mavenSummaryMatch[1], 10),
        failures: parseInt(mavenSummaryMatch[2], 10),
        errors: parseInt(mavenSummaryMatch[3], 10),
        skipped: parseInt(mavenSummaryMatch[4], 10),
      });
    }
  }

  /**
   * Encerra o processo e toda a sua árvore de processos filhos (kill process tree).
   */
  stop() {
    if (!this._proc && !this._pid) {
      this._status = 'stopped';
      this.emit('status', this.getStatus());
      return true;
    }

    const pid = this._pid;
    this._status = 'stopped';

    try {
      this._killProcessTree(pid);
    } catch (e) {
      console.warn(`[appRunner] Falha ao matar árvore de processos PID ${pid}:`, e.message);
    }

    this._proc = null;
    this._pid = null;
    this.emit('status', this.getStatus());
    return true;
  }

  _killProcessTree(pid) {
    if (!pid) return;
    const isWin = process.platform === 'win32';

    if (isWin) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 2500 });
      } catch (_) {
        try { process.kill(pid, 'SIGKILL'); } catch (_) {}
      }
    } else {
      // Linux (Arch, Pop!_OS, Ubuntu) e macOS
      try {
        // Encerra todo o process group criado via detached: true
        process.kill(-pid, 'SIGKILL');
      } catch (_) {
        try {
          execSync(`pkill -TERM -P ${pid} || kill -9 -${pid} || pkill -9 -P ${pid}`, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 2000 });
        } catch (_) {
          try { process.kill(pid, 'SIGKILL'); } catch (_) {}
        }
      }
    }
  }
}

module.exports = RunnerProcess;
