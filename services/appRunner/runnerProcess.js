// services/appRunner/runnerProcess.js
// Gerenciamento de ciclo de vida de subprocessos de execução (Gradle / Maven / Java),
// streaming de stdout/stderr, parsing de testes JUnit / Spring Boot e encerramento com kill process tree.

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

function findXmlTestReports(dir) {
  const reports = [];
  const searchDirs = [
    path.join(dir, 'build', 'test-results', 'test'),
    path.join(dir, 'build', 'test-results'),
    path.join(dir, 'target', 'surefire-reports'),
    path.join(dir, 'target', 'failsafe-reports'),
  ];

  try {
    const subEntries = fs.readdirSync(dir, { withFileTypes: true });
    for (const sub of subEntries) {
      if (sub.isDirectory() && !sub.name.startsWith('.') && sub.name !== 'node_modules') {
        searchDirs.push(
          path.join(dir, sub.name, 'build', 'test-results', 'test'),
          path.join(dir, sub.name, 'target', 'surefire-reports')
        );
      }
    }
  } catch (_) {}

  for (const sDir of searchDirs) {
    if (fs.existsSync(sDir)) {
      try {
        const files = fs.readdirSync(sDir);
        for (const file of files) {
          if (file.startsWith('TEST-') && file.endsWith('.xml')) {
            reports.push(path.join(sDir, file));
          }
        }
      } catch (_) {}
    }
  }
  return reports;
}

function parseJUnitXmlReport(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const testcases = [];
    const caseRe = /<testcase\s+([^>]+?)(\/>|>([\s\S]*?)<\/testcase>)/g;
    let match;
    while ((match = caseRe.exec(content)) !== null) {
      const attrsStr = match[1];
      const body = match[3] || '';

      const nameMatch = attrsStr.match(/name="([^"]+)"/);
      const classMatch = attrsStr.match(/classname="([^"]+)"/);
      const timeMatch = attrsStr.match(/time="([^"]+)"/);

      if (nameMatch) {
        let rawName = nameMatch[1];
        const cleanMethodName = rawName.replace(/\(\)$/, '');
        const className = classMatch ? classMatch[1].split('.').pop() : '';
        const fullClassName = classMatch ? classMatch[1] : '';
        const duration = timeMatch ? parseFloat(timeMatch[1]) : 0;

        let status = 'passed';
        let failureMessage = '';

        if (/<failure\b|<error\b/i.test(body)) {
          status = 'failed';
          const msgMatch = body.match(/message="([^"]*)"/);
          failureMessage = msgMatch ? msgMatch[1] : 'Test failed';
        } else if (/<skipped\b/i.test(body)) {
          status = 'skipped';
        }

        testcases.push({
          methodName: cleanMethodName,
          className,
          fullClassName,
          status,
          duration,
          failureMessage
        });
      }
    }
    return testcases;
  } catch (_) {
    return [];
  }
}

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
    if (this._proc || this._pid || this._status === 'running' || this._status === 'starting') {
      try {
        this.stop();
      } catch (err) {
        console.warn('[appRunner] Erro ao encerrar processo anterior antes de reiniciar:', err.message);
      }
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

    // Monta ambiente completo do processo preservando PATH e System32 no Windows
    const env = { ...process.env, ...customEnv };
    const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') || (isWin ? 'Path' : 'PATH');
    let currentPath = env[pathKey] || process.env.PATH || process.env.Path || '';

    if (isWin) {
      const sysRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
      const system32 = path.join(sysRoot, 'System32');
      if (!currentPath.toLowerCase().includes('system32')) {
        currentPath = `${system32}${path.delimiter}${sysRoot}${path.delimiter}${currentPath}`;
      }
    }

    if (jdk && jdk.homePath) {
      env.JAVA_HOME = jdk.homePath;
      const binDir = path.join(jdk.homePath, 'bin');
      currentPath = `${binDir}${path.delimiter}${currentPath}`;
    }

    env[pathKey] = currentPath;
    env.PATH = currentPath;
    if (isWin) env.Path = currentPath;

    // Configurações do spawn cross-platform
    let spawnExe = executable;
    let spawnArgs = args;

    if (isWin) {
      // Localiza o executável absoluto do cmd.exe via ComSpec ou System32
      const cmdExe = process.env.ComSpec || process.env.COMSPEC || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
      const isBatch = executable.endsWith('.bat') || executable.endsWith('.cmd') || !executable.includes('.');
      if (isBatch) {
        spawnExe = cmdExe;
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
      const procInstance = spawn(spawnExe, spawnArgs, spawnOpts);
      this._proc = procInstance;
      this._pid = procInstance.pid;
      this._status = 'running';
      this.emit('status', this.getStatus());

      // Emite chunk inicial de cabeçalho informativo
      const displayCmd = isWin && (spawnExe.toLowerCase().endsWith('cmd.exe'))
        ? `${path.basename(executable)} ${args.join(' ')}`
        : `${executable} ${args.join(' ')}`;

      const envKeys = Object.keys(customEnv);
      const envInfo = envKeys.length > 0
        ? `\x1b[90m⚙ Variáveis (${envKeys.length}):\x1b[0m ${envKeys.join(', ')}\n`
        : '';
      const profilesInfo = (runMeta && runMeta.activeProfiles)
        ? `\x1b[90m🌱 Perfis Ativos:\x1b[0m \x1b[32m${runMeta.activeProfiles}\x1b[0m\n`
        : '';

      const initHeader = `\x1b[90m▶ Executando:\x1b[0m \x1b[36m${displayCmd}\x1b[0m\n` +
                         `\x1b[90m📁 Diretório:\x1b[0m ${cwd}\n` +
                         (env.JAVA_HOME ? `\x1b[90m☕ JAVA_HOME:\x1b[0m ${env.JAVA_HOME}\n` : '') +
                         profilesInfo +
                         envInfo +
                         `\x1b[90m────────────────────────────────────────────────────────────\x1b[0m\n`;
      this._emitChunk(initHeader);

      procInstance.stdout.on('data', (chunk) => {
        if (this._proc !== procInstance) return;
        const text = chunk.toString();
        this._outputBuffer += text;
        this._emitChunk(text);
        this._parseOutputForEvents(text);
      });

      procInstance.stderr.on('data', (chunk) => {
        if (this._proc !== procInstance) return;
        const text = chunk.toString();
        this._outputBuffer += text;
        this._emitChunk(text);
        this._parseOutputForEvents(text);
      });

      procInstance.on('close', (code) => {
        if (this._proc !== procInstance && this._pid !== procInstance.pid) {
          return;
        }
        this._exitCode = code;
        this._proc = null;
        this._pid = null;

        // Se foi execução de teste, lê os relatórios XML gerados pelo Gradle/Maven
        if (this._currentRun && this._currentRun.kind && this._currentRun.kind.startsWith('test')) {
          this._loadAndEmitXmlTestResults();
        }

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

      procInstance.on('error', (err) => {
        if (this._proc !== procInstance && this._pid !== procInstance.pid) {
          return;
        }
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

  _loadAndEmitXmlTestResults() {
    if (!this._currentRun || !this._currentRun.cwd) return;
    const projectDir = this._currentRun.cwd;
    const startTime = this._currentRun.startedAt || 0;

    const xmlFiles = findXmlTestReports(projectDir);
    let totalTests = 0;
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const file of xmlFiles) {
      try {
        const stat = fs.statSync(file);
        // Apenas relatórios gerados ou modificados nesta execução (com margem de 10s)
        if (stat.mtimeMs >= startTime - 10000) {
          const testcases = parseJUnitXmlReport(file);
          for (const tc of testcases) {
            totalTests++;
            if (tc.status === 'passed') passedCount++;
            else if (tc.status === 'failed') failedCount++;
            else if (tc.status === 'skipped') skippedCount++;

            this.emit('test-event', tc);
          }
        }
      } catch (_) {}
    }

    if (totalTests > 0) {
      this.emit('test-summary', {
        total: totalTests,
        passed: passedCount,
        failures: failedCount,
        errors: 0,
        skipped: skippedCount,
      });
    }
  }

  _parseOutputForEvents(text) {
    if (!text) return;

    // 1. Detecta Spring Boot porta (ex: Tomcat started on port 8080 (http))
    const portMatch = text.match(/(?:Tomcat|Jetty|Undertow|Netty)\s+started\s+on\s+port\(?s?\)?\s*[:\s]*(\d+)/i);
    if (portMatch) {
      this.emit('app-event', { type: 'server-started', port: parseInt(portMatch[1], 10) });
    }

    // 2. Divide em linhas completas e analisa cada uma em tempo real
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 2a. Análise avançada de linhas Gradle (ex: 'Gradle Test Executor 1 > DemoTests > contextLoads() PASSED')
      const statusMatch = trimmed.match(/\b(PASSED|FAILED|SKIPPED|SUCCESS|FAILURE)\s*$/i);
      if (statusMatch && trimmed.includes('>')) {
        const rawStatus = statusMatch[1].toUpperCase();
        const status = (rawStatus === 'PASSED' || rawStatus === 'SUCCESS') ? 'passed' :
                       (rawStatus === 'FAILED' || rawStatus === 'FAILURE') ? 'failed' : 'skipped';

        const beforeStatus = trimmed.slice(0, statusMatch.index).trim();
        const rawParts = beforeStatus.split('>').map(p => p.trim()).filter(Boolean);

        // Remove prefixos de infraestrutura do Gradle (Test Run, Test Executor, :test task)
        const cleanParts = rawParts.filter(p => {
          if (/^Gradle\s+Test\s+(?:Run|Executor)\b/i.test(p)) return false;
          if (/^:\S*test\b/i.test(p)) return false;
          if (/^Test\s+Executor\s+\d+/i.test(p)) return false;
          return true;
        });

        if (cleanParts.length >= 2) {
          const classNamePart = cleanParts[cleanParts.length - 2];
          const methodNamePart = cleanParts[cleanParts.length - 1];

          const cleanMethodName = methodNamePart.replace(/\(\)$/, '').trim();
          const simpleClassName = classNamePart.split('.').pop().trim();

          // Evita ruídos como números puros ou método igual à classe
          if (simpleClassName && !/^\d+$/.test(simpleClassName) && cleanMethodName && cleanMethodName !== simpleClassName) {
            this.emit('test-event', {
              className: simpleClassName,
              fullClassName: classNamePart,
              methodName: cleanMethodName,
              status,
            });
            continue;
          }
        }
      }

      // 2b. Ex Maven Surefire: [ERROR] Failures: / com.example.DemoTests.testMethod:42
      const mavenFailMatch = trimmed.match(/\[ERROR\]\s+(?:Failures:\s+)?([A-Za-z0-9_$.]+)\.([A-Za-z0-9_$]+)(?::\d+)?\s*(.*)/);
      if (mavenFailMatch) {
        const fullClass = mavenFailMatch[1];
        const methodName = mavenFailMatch[2];
        const failureMessage = mavenFailMatch[3] || 'Falha no teste';
        const simpleClass = fullClass.split('.').pop();
        if (simpleClass && methodName && !/^\d+$/.test(simpleClass)) {
          this.emit('test-event', {
            className: simpleClass,
            fullClassName: fullClass,
            methodName,
            status: 'failed',
            failureMessage,
          });
          continue;
        }
      }

      // 2c. Ex Maven: Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
      const mavenSummaryMatch = trimmed.match(/Tests\s+run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i);
      if (mavenSummaryMatch) {
        this.emit('test-summary', {
          total: parseInt(mavenSummaryMatch[1], 10),
          failures: parseInt(mavenSummaryMatch[2], 10),
          errors: parseInt(mavenSummaryMatch[3], 10),
          skipped: parseInt(mavenSummaryMatch[4], 10),
        });
      }
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
    const oldProc = this._proc;
    this._status = 'stopped';
    this._proc = null;
    this._pid = null;

    if (oldProc) {
      try {
        oldProc.removeAllListeners('close');
        oldProc.removeAllListeners('error');
        oldProc.removeAllListeners('data');
        if (oldProc.stdout) oldProc.stdout.removeAllListeners('data');
        if (oldProc.stderr) oldProc.stderr.removeAllListeners('data');
      } catch (_) {}
    }

    try {
      this._killProcessTree(pid);
    } catch (e) {
      console.warn(`[appRunner] Falha ao matar árvore de processos PID ${pid}:`, e.message);
    }

    this.emit('status', this.getStatus());
    return true;
  }

  _killProcessTree(pid) {
    if (!pid) return;
    const isWin = process.platform === 'win32';

    if (isWin) {
      try {
        const p = spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
          windowsHide: true,
          stdio: 'ignore',
          detached: true,
        });
        if (p && typeof p.unref === 'function') p.unref();
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
          const p = spawn('pkill', ['-9', '-P', String(pid)], { stdio: 'ignore', detached: true });
          if (p && typeof p.unref === 'function') p.unref();
        } catch (_) {
          try { process.kill(pid, 'SIGKILL'); } catch (_) {}
        }
      }
    }
  }
}

module.exports = RunnerProcess;
