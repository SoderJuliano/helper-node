// services/appRunner/jdkDetector.js
// Descoberta automática e assíncrona de JDKs instalados na máquina do usuário.
// Suporta Windows, Arch Linux (Garuda/Wayland), Pop!_OS Cosmic, Ubuntu, Debian, Fedora e macOS.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const {
  normalizePath,
  findExecutable,
  parseReleaseFile,
  parseIntelliJJdkTable,
  parseVsCodeJdkSettings,
  buildJdkDisplayName,
} = require('./jdkMetadataHelper');

class JdkDetector {
  static _cachedJdks = null;
  static _lastScan = 0;
  static _scanPromise = null;

  static getCandidateDirectories() {
    const isWin = process.platform === 'win32';
    const home = os.homedir();
    const dirs = [];

    // 1. IntelliJ IDEA downloaded JDKs (.jdks na pasta do usuário)
    const intellijJdks = path.join(home, '.jdks');
    if (fs.existsSync(intellijJdks)) {
      try {
        fs.readdirSync(intellijJdks, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) {
            dirs.push({ path: path.join(intellijJdks, ent.name), source: 'IntelliJ (.jdks)' });
          }
        });
      } catch (_) {}
    }

    // 1b. IntelliJ jdk.table.xml entries
    const intellijTable = parseIntelliJJdkTable();
    for (const item of intellijTable) {
      dirs.push({ path: item.homePath, source: item.source, intellijName: item.name, intellijVersion: item.version });
    }

    // 2. VS Code configured JDKs (settings.json / appdata)
    const vscodeJdks = parseVsCodeJdkSettings();
    for (const item of vscodeJdks) {
      dirs.push({ path: item.homePath, source: item.source, vscodeName: item.name });
    }

    // 3. Version managers (SDKMAN, asdf, jenv, mise)
    const sdkmanCandidates = path.join(home, '.sdkman', 'candidates', 'java');
    if (fs.existsSync(sdkmanCandidates)) {
      try {
        fs.readdirSync(sdkmanCandidates, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory() && ent.name !== 'current') {
            dirs.push({ path: path.join(sdkmanCandidates, ent.name), source: 'SDKMAN (~/.sdkman)' });
          }
        });
      } catch (_) {}
    }

    const asdfCandidates = path.join(home, '.asdf', 'installs', 'java');
    if (fs.existsSync(asdfCandidates)) {
      try {
        fs.readdirSync(asdfCandidates, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) {
            dirs.push({ path: path.join(asdfCandidates, ent.name), source: 'asdf (~/.asdf)' });
          }
        });
      } catch (_) {}
    }

    const jenvCandidates = path.join(home, '.jenv', 'versions');
    if (fs.existsSync(jenvCandidates)) {
      try {
        fs.readdirSync(jenvCandidates, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) {
            dirs.push({ path: path.join(jenvCandidates, ent.name), source: 'jenv (~/.jenv)' });
          }
        });
      } catch (_) {}
    }

    // 4. Linux JVM standard directories (Arch Linux, Garuda, Pop!_OS, Ubuntu, Debian, Fedora)
    if (!isWin && process.platform !== 'darwin') {
      const linuxJvmPaths = [
        '/usr/lib/jvm',
        '/usr/lib64/jvm',
        '/usr/java',
        '/opt/jdk',
        '/opt/java',
        path.join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'apps'),
      ];
      linuxJvmPaths.forEach(jvmRoot => {
        if (fs.existsSync(jvmRoot)) {
          try {
            fs.readdirSync(jvmRoot, { withFileTypes: true }).forEach(ent => {
              if (ent.isDirectory()) {
                dirs.push({ path: path.join(jvmRoot, ent.name), source: `Linux (${jvmRoot})` });
              }
            });
          } catch (_) {}
        }
      });
    }

    // 4b. macOS JVM standard directories & Homebrew OpenJDK
    if (process.platform === 'darwin') {
      const macJvmRoots = [
        '/Library/Java/JavaVirtualMachines',
        path.join(home, 'Library', 'Java', 'JavaVirtualMachines'),
        '/System/Library/Java/JavaVirtualMachines',
        '/opt/homebrew/opt/openjdk',
        '/opt/homebrew/opt/openjdk@11',
        '/opt/homebrew/opt/openjdk@17',
        '/opt/homebrew/opt/openjdk@21',
        '/opt/homebrew/opt/openjdk@25',
        '/opt/homebrew/opt/openjdk@27',
        '/usr/local/opt/openjdk',
        '/usr/local/opt/openjdk@11',
        '/usr/local/opt/openjdk@17',
        '/usr/local/opt/openjdk@21',
        path.join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'apps'),
      ];
      macJvmRoots.forEach(jvmRoot => {
        if (fs.existsSync(jvmRoot)) {
          try {
            dirs.push({ path: jvmRoot, source: 'macOS (Homebrew/System)' });
            fs.readdirSync(jvmRoot, { withFileTypes: true }).forEach(ent => {
              if (ent.isDirectory()) {
                dirs.push({ path: path.join(jvmRoot, ent.name), source: 'macOS (JavaVirtualMachines)' });
              }
            });
          } catch (_) {}
        }
      });
    }

    // 5. Windows Standard JDK installation directories
    if (isWin) {
      const winRoots = [
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Java') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Eclipse Adoptium') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Amazon Corretto') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Zulu') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Microsoft') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'BellSoft') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Semeru') : null,
        process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Java') : null,
        'C:\\Java',
        'C:\\JDK',
        process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs', 'Eclipse Adoptium') : null,
        process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs', 'Microsoft') : null,
        process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs', 'Java') : null,
        process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'JetBrains', 'Toolbox', 'apps') : null,
      ].filter(Boolean);

      winRoots.forEach(root => {
        try {
          if (fs.existsSync(root)) {
            fs.readdirSync(root, { withFileTypes: true }).forEach(ent => {
              if (ent.isDirectory()) {
                dirs.push({ path: path.join(root, ent.name), source: `Windows (${path.basename(root)})` });
              }
            });
          }
        } catch (_) {}
      });
    }

    // 6. JAVA_HOME e JDK_HOME das variáveis de ambiente
    if (process.env.JAVA_HOME) {
      try {
        if (fs.existsSync(process.env.JAVA_HOME)) {
          dirs.unshift({ path: process.env.JAVA_HOME, source: 'JAVA_HOME (Ambiente)' });
        }
      } catch (_) {}
    }
    if (process.env.JDK_HOME) {
      try {
        if (fs.existsSync(process.env.JDK_HOME)) {
          dirs.unshift({ path: process.env.JDK_HOME, source: 'JDK_HOME (Ambiente)' });
        }
      } catch (_) {}
    }

    return dirs;
  }

  /**
   * Varre e detecta todos os JDKs instalados na máquina de forma assíncrona.
   */
  static async detectAllAsync(preferredPath = null) {
    if (this._cachedJdks && Date.now() - this._lastScan < 10000) {
      return this._cachedJdks;
    }

    if (this._scanPromise) {
      return this._scanPromise;
    }

    this._scanPromise = (async () => {
      try {
        const jdks = this.detectAll(preferredPath);
        this._cachedJdks = jdks;
        this._lastScan = Date.now();
        return jdks;
      } finally {
        this._scanPromise = null;
      }
    })();

    return this._scanPromise;
  }

  /**
   * Varre e detecta todos os JDKs instalados na máquina (síncrono/cached).
   */
  static detectAll(preferredPath = null) {
    const rawCandidates = this.getCandidateDirectories();
    const jdks = [];
    const seenPaths = new Set();

    for (const cand of rawCandidates) {
      try {
        const javaExe = findExecutable(cand.path, 'java');
        if (javaExe) {
          const homeDir = path.dirname(path.dirname(javaExe));
          const normHome = normalizePath(homeDir);

          if (!seenPaths.has(normHome)) {
            seenPaths.add(normHome);

            const releaseFilePath = path.join(homeDir, 'release');
            const releaseInfo = parseReleaseFile(releaseFilePath);
            const javacExe = findExecutable(homeDir, 'javac');
            const homeDirName = path.basename(normHome);

            let displayName = cand.intellijVersion
              ? `${cand.intellijName} ${cand.intellijVersion}`
              : buildJdkDisplayName(cand.intellijName || cand.vscodeName, releaseInfo, homeDirName);

            const majorVer = releaseInfo.majorVersion || parseInt((displayName.match(/\d+/) || [0])[0], 10) || 0;
            const isJavaHome = process.env.JAVA_HOME && normalizePath(process.env.JAVA_HOME) === normHome;

            jdks.push({
              id: normHome,
              name: cand.intellijName || homeDirName,
              displayName,
              version: releaseInfo.javaVersion || (majorVer ? `Java ${majorVer}` : 'Java'),
              majorVersion: majorVer,
              implementor: releaseInfo.implementor || '',
              homePath: normHome,
              javaPath: normalizePath(javaExe),
              javacPath: javacExe ? normalizePath(javacExe) : null,
              source: cand.source,
              isJavaHome: !!isJavaHome,
              isPreviewSupported: majorVer >= 21,
            });
          }
        }
      } catch (_) {}
    }

    // Se nenhum encontrado via diretórios, tenta fallback no PATH
    if (jdks.length === 0) {
      try {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'where java' : 'which java';
        const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
        if (out) {
          const firstLine = out.split(/\r?\n/)[0].trim();
          if (fs.existsSync(firstLine)) {
            const javaHome = path.dirname(path.dirname(firstLine));
            const normHome = normalizePath(javaHome);
            const releaseInfo = parseReleaseFile(path.join(javaHome, 'release'));
            const majorVer = releaseInfo.majorVersion || 0;

            jdks.push({
              id: normHome,
              name: path.basename(normHome) || 'System Java',
              displayName: buildJdkDisplayName('', releaseInfo, path.basename(normHome)),
              version: releaseInfo.javaVersion || 'Java (System PATH)',
              majorVersion: majorVer,
              implementor: releaseInfo.implementor || '',
              homePath: normHome,
              javaPath: normalizePath(firstLine),
              javacPath: findExecutable(javaHome, 'javac') ? normalizePath(findExecutable(javaHome, 'javac')) : null,
              source: 'System PATH',
              isJavaHome: false,
              isPreviewSupported: majorVer >= 21,
            });
          }
        }
      } catch (_) {}
    }

    // Ordenação: Versões mais modernas primeiro (Java 27, 25, 21, 17, etc.)
    jdks.sort((a, b) => {
      if (b.majorVersion !== a.majorVersion) {
        return b.majorVersion - a.majorVersion;
      }
      if (a.isJavaHome && !b.isJavaHome) return -1;
      if (!a.isJavaHome && b.isJavaHome) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    this._cachedJdks = jdks;
    this._lastScan = Date.now();
    return jdks;
  }

  /**
   * Adiciona e valida uma JDK a partir de um diretório escolhido no disco.
   */
  static addCustomJdk(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw new Error('Caminho de diretório inválido.');
    }

    const norm = normalizePath(dirPath.trim());
    if (!fs.existsSync(norm)) {
      throw new Error(`Diretório não encontrado: ${norm}`);
    }

    const javaExe = findExecutable(norm, 'java');
    if (!javaExe) {
      throw new Error(`Nenhum executável 'java' encontrado no diretório informado: ${norm}`);
    }

    const homeDir = path.dirname(path.dirname(javaExe));
    const normHome = normalizePath(homeDir);
    const releaseFilePath = path.join(homeDir, 'release');
    const releaseInfo = parseReleaseFile(releaseFilePath);
    const javacExe = findExecutable(homeDir, 'javac');
    const homeDirName = path.basename(normHome);
    const displayName = buildJdkDisplayName('', releaseInfo, homeDirName);
    const majorVer = releaseInfo.majorVersion || parseInt((displayName.match(/\d+/) || [0])[0], 10) || 0;

    const customJdk = {
      id: normHome,
      name: homeDirName,
      displayName,
      version: releaseInfo.javaVersion || (majorVer ? `Java ${majorVer}` : 'Java'),
      majorVersion: majorVer,
      implementor: releaseInfo.implementor || '',
      homePath: normHome,
      javaPath: normalizePath(javaExe),
      javacPath: javacExe ? normalizePath(javacExe) : null,
      source: 'Disco Local (Custom)',
      isJavaHome: process.env.JAVA_HOME && normalizePath(process.env.JAVA_HOME) === normHome,
      isPreviewSupported: majorVer >= 21,
    };

    if (this._cachedJdks) {
      const idx = this._cachedJdks.findIndex(j => j.homePath === normHome);
      if (idx !== -1) {
        this._cachedJdks[idx] = customJdk;
      } else {
        this._cachedJdks.unshift(customJdk);
      }
    }

    return customJdk;
  }

  /**
   * Retorna a melhor JDK disponível ou a preferida pelo usuário.
   */
  static getBestJdk(preferredPath) {
    const all = this._cachedJdks || this.detectAll();
    if (!all.length) return null;

    if (preferredPath) {
      const normPref = normalizePath(preferredPath).toLowerCase();
      const found = all.find(j =>
        normalizePath(j.homePath).toLowerCase() === normPref ||
        normalizePath(j.javaPath).toLowerCase() === normPref ||
        j.id.toLowerCase() === normPref ||
        j.displayName.toLowerCase() === normPref ||
        j.name.toLowerCase() === normPref
      );
      if (found) return found;
    }

    // Prioridade 1: JAVA_HOME se estiver na lista
    const fromJavaHome = all.find(j => j.isJavaHome);
    if (fromJavaHome) return fromJavaHome;

    // Prioridade 2: IntelliJ (.jdks)
    const fromIntellij = all.find(j => j.source && j.source.includes('IntelliJ'));
    if (fromIntellij) return fromIntellij;

    // Prioridade 3: Mais moderna (Java 27, 25, 21)
    return all[0];
  }
}

module.exports = JdkDetector;
