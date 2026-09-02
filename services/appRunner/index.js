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
   * Obtém a configuração completa de execução do projeto (runner-config.json).
   */
  static getProjectConfig(projectDir) {
    return IntelliJConfigExtractor.getProjectConfig(projectDir);
  }

  /**
   * Salva configurações de execução do projeto customizadas pelo usuário no Helper Node.
   */
  static saveProjectConfig(projectDir, config) {
    return IntelliJConfigExtractor.saveProjectConfig(projectDir, config);
  }

  /**
   * Reimporta configurações do IntelliJ (.idea) para o projeto.
   */
  static reimportIntelliJConfig(projectDir) {
    return IntelliJConfigExtractor.reimportFromIntelliJ(projectDir);
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
    const projectConfig = IntelliJConfigExtractor.getEffectiveConfig(projectDir);
    const commandInfo = BuildToolDetector.buildCommand(buildInfo, target, projectConfig);
    const jdk = JdkDetector.getBestJdk(preferredJdkPath);
    const customEnv = projectConfig.effectiveEnvs || {};

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
        activeProfiles: projectConfig.activeProfiles || '',
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

  /**
   * Localiza o arquivo .java e a linha exata de um método de teste JUnit no projeto.
   * @param {string} projectDir Diretório do projeto
   * @param {string} className Nome da classe (ex: 'UserServiceTest' ou 'com.example.UserServiceTest')
   * @param {string} [methodName] Nome do método de teste (ex: 'shouldCreateUser')
   * @returns {{ filePath: string, line: number, className: string, methodName: string } | null}
   */
  static findTestLocation(projectDir, className, methodName) {
    if (!projectDir || !fs.existsSync(projectDir)) {
      return null;
    }

    let rawClass = String(className || '').trim().replace(/\.java$/i, '');
    const cleanMethod = String(methodName || '').trim()
      .replace(/\[\d+\].*$/, '')
      .replace(/\(.*?\)$/, '')
      .trim();

    // Remove package se houver
    let simpleName = rawClass ? rawClass.split('.').pop().trim() : '';
    // Ignora se simpleName for apenas números ou palavras de infraestrutura
    if (/^\d+$/.test(simpleName) || /^Gradle\b/i.test(simpleName) || /^Executor\b/i.test(simpleName) || /^Test\b/i.test(simpleName)) {
      simpleName = '';
    }

    const searchRoots = [projectDir];
    try {
      const parent = path.dirname(projectDir);
      if (parent && parent !== projectDir && fs.existsSync(parent) && (fs.existsSync(path.join(parent, 'settings.gradle')) || fs.existsSync(path.join(parent, 'pom.xml')))) {
        searchRoots.push(parent);
      }
    } catch (_) {}

    const skipDirs = new Set(['node_modules', '.git', '.gradle', 'build', 'target', '.idea', 'dist', '.gemini', '.metadata']);

    const findFileRecursively = (dir, targetBaseName, depth = 0) => {
      if (depth > 10 || !dir || !fs.existsSync(dir)) return null;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const ent of entries) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (!skipDirs.has(ent.name)) {
              const res = findFileRecursively(full, targetBaseName, depth + 1);
              if (res) return res;
            }
          } else if (ent.isFile()) {
            if (ent.name.toLowerCase() === targetBaseName.toLowerCase()) {
              return full;
            }
          }
        }
      } catch (_) {}
      return null;
    };

    let targetFilePath = null;

    // 1. Tenta buscar pelo nome da classe
    if (simpleName) {
      for (const root of searchRoots) {
        targetFilePath = findFileRecursively(root, `${simpleName}.java`);
        if (targetFilePath) break;
      }
    }

    // 2. Se não achou pelo nome da classe, mas temos um método válido, busca nos arquivos .java de teste
    if (!targetFilePath && cleanMethod && cleanMethod.length > 2) {
      const findFileByMethod = (dir, targetMethod, depth = 0) => {
        if (depth > 10 || !dir || !fs.existsSync(dir)) return null;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const ent of entries) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
              if (!skipDirs.has(ent.name)) {
                const res = findFileByMethod(full, targetMethod, depth + 1);
                if (res) return res;
              }
            } else if (ent.isFile() && ent.name.endsWith('.java')) {
              try {
                const content = fs.readFileSync(full, 'utf8');
                if (content.includes(targetMethod) && (content.includes('@Test') || full.includes('test'))) {
                  return full;
                }
              } catch (_) {}
            }
          }
        } catch (_) {}
        return null;
      };

      for (const root of searchRoots) {
        targetFilePath = findFileByMethod(root, cleanMethod);
        if (targetFilePath) break;
      }
    }

    if (!targetFilePath) {
      return null;
    }

    try {
      const source = fs.readFileSync(targetFilePath, 'utf8');
      const parsed = JavaParser.parse(source, targetFilePath);
      let line = parsed.classLine || 1;

      if (cleanMethod) {
        if (parsed.testMethods && parsed.testMethods.length > 0) {
          const foundMethod = parsed.testMethods.find(m =>
            m.name === cleanMethod ||
            m.name.toLowerCase() === cleanMethod.toLowerCase() ||
            cleanMethod.startsWith(m.name) ||
            m.name.startsWith(cleanMethod)
          );
          if (foundMethod) {
            line = foundMethod.line || foundMethod.methodLine || line;
          }
        }

        if (line === (parsed.classLine || 1)) {
          const lines = source.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(cleanMethod)) {
              line = i + 1;
              break;
            }
          }
        }
      }

      return {
        filePath: targetFilePath,
        line,
        className: parsed.className || simpleName || path.basename(targetFilePath, '.java'),
        methodName: cleanMethod,
      };
    } catch (_) {
      return {
        filePath: targetFilePath,
        line: 1,
        className: simpleName || path.basename(targetFilePath, '.java'),
        methodName: cleanMethod,
      };
    }
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
