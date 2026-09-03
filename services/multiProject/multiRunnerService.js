// services/multiProject/multiRunnerService.js
// Orquestrador de múltiplos processos concorrentes de execução no App Runner (Multi-Target / Multi-Project Runner).

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const RunnerProcess = require('../appRunner/runnerProcess');
const BuildToolDetector = require('../appRunner/buildToolDetector');
const JdkDetector = require('../appRunner/jdkDetector');
const IntelliJConfigExtractor = require('../appRunner/intellijConfigExtractor');

class MultiRunnerService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, RunnerProcess>} */
    this._runners = new Map();
    /** @type {Map<string, Object>} */
    this._runnersMeta = new Map();
  }

  /**
   * Constrói ou normaliza o runId único para uma instância de execução.
   */
  getRunId(projectDir, target = {}) {
    const pKey = path.resolve(projectDir).replace(/\\/g, '/').toLowerCase();
    const kind = target.kind || 'app';
    const subTarget = target.mainClass || target.testClass || target.displayName || 'main';
    return `${pKey}::${kind}::${subTarget}`;
  }

  /**
   * Retorna a lista de todas as instâncias ativas ou conhecidas.
   */
  getAllRunners() {
    const list = [];
    for (const [runId, runner] of this._runners.entries()) {
      const meta = this._runnersMeta.get(runId) || {};
      const status = runner.getStatus();
      list.push({
        runId,
        projectDir: meta.projectDir,
        target: meta.target,
        displayName: meta.displayName || path.basename(meta.projectDir || ''),
        status: status.status,
        pid: status.pid,
        exitCode: status.exitCode,
        currentRun: status.currentRun,
        startedAt: meta.startedAt,
      });
    }
    return list;
  }

  /**
   * Retorna a quantidade de processos atualmente em execução.
   */
  getRunningCount() {
    let count = 0;
    for (const runner of this._runners.values()) {
      const s = runner.getStatus().status;
      if (s === 'running' || s === 'starting') count++;
    }
    return count;
  }

  /**
   * Retorna o status de um runner específico ou do último runner ativo.
   */
  getStatus(runId) {
    if (runId && this._runners.has(runId)) {
      return this._runners.get(runId).getStatus();
    }
    // Fallback: pega o primeiro runner em execução ou o mais recente
    for (const runner of this._runners.values()) {
      if (runner.getStatus().status === 'running') return runner.getStatus();
    }
    const last = Array.from(this._runners.values()).pop();
    return last ? last.getStatus() : { status: 'idle', pid: null, currentRun: null, exitCode: null };
  }

  /**
   * Inicia a execução concorrente de um alvo em um projeto específico.
   * @param {string} projectDir Diretório raiz do projeto
   * @param {Object} [target] Alvo de execução { kind, mainClass, testClass, testMethod, isSpringBoot, displayName }
   * @param {string} [preferredJdkPath] Caminho preferencial da JDK
   * @param {string} [explicitRunId] ID customizado opcional
   */
  start(projectDir, target = {}, preferredJdkPath = null, explicitRunId = null) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      throw new Error(`Diretório do projeto inválido ou inexistente: ${projectDir}`);
    }

    const runId = explicitRunId || this.getRunId(projectDir, target);
    const buildInfo = BuildToolDetector.detect(projectDir);
    const projectConfig = IntelliJConfigExtractor.getEffectiveConfig(projectDir);
    const commandInfo = target.executable
      ? { executable: target.executable, args: target.args || [], displayName: target.displayName || 'App', fullCommand: `${target.executable} ${(target.args || []).join(' ')}` }
      : BuildToolDetector.buildCommand(buildInfo, target, projectConfig);
    const jdk = JdkDetector.getBestJdk(preferredJdkPath);
    const customEnv = projectConfig.effectiveEnvs || {};

    let runner = this._runners.get(runId);
    if (!runner) {
      runner = new RunnerProcess();
      this._runners.set(runId, runner);
      this._wireRunnerEvents(runId, projectDir, runner);
    }

    const displayName = target.displayName || commandInfo.displayName || `${path.basename(projectDir)} (${target.kind || 'app'})`;

    this._runnersMeta.set(runId, {
      projectDir,
      target,
      displayName,
      startedAt: Date.now(),
    });

    const status = runner.start({
      executable: commandInfo.executable,
      args: commandInfo.args,
      cwd: projectDir,
      jdk,
      customEnv,
      runMeta: {
        ...target,
        runId,
        projectDir,
        displayName,
        fullCommand: commandInfo.fullCommand,
        buildType: buildInfo.type,
        activeProfiles: projectConfig.activeProfiles || '',
      },
    });

    return {
      runId,
      projectDir,
      displayName,
      status,
    };
  }

  /**
   * Encerra um processo específico.
   */
  stop(runId) {
    if (runId && this._runners.has(runId)) {
      return this._runners.get(runId).stop();
    }
    // Se nenhum runId for fornecido, para todos os ativos
    return this.stopAll();
  }

  /**
   * Encerra todos os processos de execução em paralelo.
   */
  stopAll() {
    let anyStopped = false;
    for (const runner of this._runners.values()) {
      try {
        runner.stop();
        anyStopped = true;
      } catch (_) {}
    }
    return anyStopped;
  }

  /**
   * Remove uma aba/instância do mapa se estiver parada.
   */
  removeRunner(runId) {
    if (this._runners.has(runId)) {
      const runner = this._runners.get(runId);
      try { runner.stop(); } catch (_) {}
      this._runners.delete(runId);
      this._runnersMeta.delete(runId);
      return true;
    }
    return false;
  }

  /**
   * Conecta os eventos de um RunnerProcess individual e os despacha com contexto enriquecido (runId, projectDir).
   */
  _wireRunnerEvents(runId, projectDir, runner) {
    runner.on('data', (chunk) => {
      this.emit('data', { runId, projectDir, chunk });
    });

    runner.on('status', (statusData) => {
      this.emit('status', {
        runId,
        projectDir,
        status: statusData.status,
        pid: statusData.pid,
        exitCode: statusData.exitCode,
        currentRun: statusData.currentRun,
      });
    });

    runner.on('test-event', (testData) => {
      this.emit('test-event', { runId, projectDir, ...testData });
    });

    runner.on('test-summary', (summaryData) => {
      this.emit('test-summary', { runId, projectDir, ...summaryData });
    });

    runner.on('app-event', (appData) => {
      this.emit('app-event', { runId, projectDir, ...appData });
    });

    runner.on('exit', ({ code, status }) => {
      this.emit('exit', { runId, projectDir, code, status });
    });

    runner.on('error', (err) => {
      this.emit('error', { runId, projectDir, error: err });
    });
  }
}

module.exports = MultiRunnerService;
