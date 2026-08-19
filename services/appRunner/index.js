// services/appRunner/index.js
// Fachada pública do módulo App Runner (execução local de aplicações Java, Spring Boot, Gradle, Maven e testes JUnit).

const path = require('path');
const fs = require('fs');
const JdkDetector = require('./jdkDetector');
const BuildToolDetector = require('./buildToolDetector');
const JavaParser = require('./javaParser');
const RunnerProcess = require('./runnerProcess');
const IntelliJConfigExtractor = require('./intellijConfigExtractor');

const activeRunner = new RunnerProcess();

class AppRunnerService {
  static get runner() {
    return activeRunner;
  }

  /**
   * Detecta todas as JDKs disponíveis na máquina do usuário.
   */
  static detectJdks(preferredPath) {
    const all = JdkDetector.detectAll();
    const best = JdkDetector.getBestJdk(preferredPath);
    return {
      all,
      best,
    };
  }

  /**
   * Identifica se a pasta é um projeto Gradle, Maven ou Java.
   */
  static detectProject(projectDir) {
    return BuildToolDetector.detect(projectDir);
  }

  /**
   * Analisa um arquivo fonte Java e extrai métodos main e testes JUnit.
   */
  static parseJavaFile(source, filePath) {
    return JavaParser.parse(source, filePath);
  }

  /**
   * Extrai variáveis de ambiente do projeto do IntelliJ IDEA.
   */
  static extractIntelliJEnv(projectDir) {
    return IntelliJConfigExtractor.extractEnv(projectDir);
  }

  /**
   * Inicia a execução do alvo informado no projeto.
   * @param {string} projectDir Diretório do projeto
   * @param {Object} target Alvo de execução { kind, mainClass, testClass, testMethod, isSpringBoot }
   * @param {string} [preferredJdkPath] Caminho de JDK preferencial
   */
  static runTarget(projectDir, target = {}, preferredJdkPath = null) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      throw new Error(`Diretório do projeto inválido ou inexistente: ${projectDir}`);
    }

    const buildInfo = BuildToolDetector.detect(projectDir);
    const commandInfo = BuildToolDetector.buildCommand(buildInfo, target);
    const jdk = JdkDetector.getBestJdk(preferredJdkPath);
    const customEnv = IntelliJConfigExtractor.getEffectiveEnv(projectDir);

    return activeRunner.start({
      executable: commandInfo.executable,
      args: commandInfo.args,
      cwd: projectDir,
      jdk,
      customEnv,
      runMeta: {
        ...target,
        displayName: commandInfo.displayName,
        fullCommand: commandInfo.fullCommand,
        buildType: buildInfo.type,
      },
    });
  }

  /**
   * Encerra a aplicação ou teste em execução.
   */
  static stopCurrent() {
    return activeRunner.stop();
  }

  /**
   * Retorna o status do processo de execução atual.
   */
  static getStatus() {
    return activeRunner.getStatus();
  }
}

module.exports = {
  AppRunnerService,
  JdkDetector,
  BuildToolDetector,
  JavaParser,
  RunnerProcess,
  IntelliJConfigExtractor,
};
