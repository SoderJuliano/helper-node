// services/appRunner/jdkDetector.js
// Descoberta automática e assíncrona de JDKs instalados na máquina do usuário.
// Suporta Windows, Arch Linux (Garuda/Wayland), Pop!_OS Cosmic, Ubuntu, Debian, Fedora e macOS.
// Busca em locais prováveis: IntelliJ (.jdks, jdk.table.xml), VS Code (settings.json, appdata), diretório do usuário (SDKMAN, asdf, jenv) e SO.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function normalizePath(p) {
  if (!p) return '';
  return path.normalize(p).replace(/\\/g, '/');
}

function findExecutable(dir, exeName) {
  if (!dir) return null;
  try {
    if (!fs.existsSync(dir)) return null;
  } catch (_) {
    return null;
  }

  const isWin = process.platform === 'win32';
  const targetName = isWin ? (exeName.endsWith('.exe') ? exeName : `${exeName}.exe`) : exeName;

  const binCandidate = path.join(dir, 'bin', targetName);
  try {
    if (fs.existsSync(binCandidate)) return binCandidate;
  } catch (_) {}

  const directCandidate = path.join(dir, targetName);
  try {
    if (fs.existsSync(directCandidate)) return directCandidate;
  } catch (_) {}

  const homeCandidate = path.join(dir, 'Contents', 'Home', 'bin', targetName);
  try {
    if (fs.existsSync(homeCandidate)) return homeCandidate;
  } catch (_) {}

  return null;
}

function parseReleaseFile(releaseFilePath) {
  const result = {
    javaVersion: '',
    implementor: '',
    implementorVersion: '',
    semanticVersion: '',
    runtimeVersion: '',
    majorVersion: 0,
  };

  if (!releaseFilePath) return result;

  try {
    if (!fs.existsSync(releaseFilePath)) return result;
    const content = fs.readFileSync(releaseFilePath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;

      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      if (key === 'JAVA_VERSION') result.javaVersion = val;
      else if (key === 'IMPLEMENTOR') result.implementor = val;
      else if (key === 'IMPLEMENTOR_VERSION') result.implementorVersion = val;
      else if (key === 'SEMANTIC_VERSION') result.semanticVersion = val;
      else if (key === 'JAVA_RUNTIME_VERSION') result.runtimeVersion = val;
    }

    if (result.javaVersion) {
      const v = result.javaVersion;
      if (v.startsWith('1.')) {
        const sub = v.substring(2).split('.')[0];
        result.majorVersion = parseInt(sub, 10) || 8;
      } else {
        const mainV = v.split('.')[0];
        result.majorVersion = parseInt(mainV, 10) || 0;
      }
    }
  } catch (_) {}

  return result;
}

function parseIntelliJJdkTable() {
  const jdks = [];
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const searchDirs = [];

  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const jetbrainsDir = path.join(appData, 'JetBrains');
    if (fs.existsSync(jetbrainsDir)) {
      try {
        fs.readdirSync(jetbrainsDir, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) {
            searchDirs.push(path.join(jetbrainsDir, ent.name, 'options', 'jdk.table.xml'));
          }
        });
      } catch (_) {}
    }
  } else if (process.platform === 'darwin') {
    const appSupport = path.join(home, 'Library', 'Application Support', 'JetBrains');
    if (fs.existsSync(appSupport)) {
      try {
        fs.readdirSync(appSupport, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) {
            searchDirs.push(path.join(appSupport, ent.name, 'options', 'jdk.table.xml'));
          }
        });
      } catch (_) {}
    }
  } else {
    // Linux (Arch, Pop!_OS, Ubuntu)
    const configDir = path.join(home, '.config', 'JetBrains');
    if (fs.existsSync(configDir)) {
      try {
        fs.readdirSync(configDir, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) {
            searchDirs.push(path.join(configDir, ent.name, 'options', 'jdk.table.xml'));
          }
        });
      } catch (_) {}
    }
  }

  for (const xmlFile of searchDirs) {
    if (!fs.existsSync(xmlFile)) continue;
    try {
      const content = fs.readFileSync(xmlFile, 'utf8');
      const jdkBlocks = content.match(/<jdk\s+version="[^"]*">[\s\S]*?<\/jdk>/gi) || [];

      for (const block of jdkBlocks) {
        const nameMatch = block.match(/<name\s+value="([^"]+)"/i);
        const versionMatch = block.match(/<version\s+value="([^"]+)"/i);
        const homeMatch = block.match(/<homePath\s+value="([^"]+)"/i);

        if (homeMatch && homeMatch[1]) {
          let homePath = homeMatch[1].replace(/\$USER_HOME\$/g, home);
          homePath = normalizePath(homePath);
          const name = nameMatch ? nameMatch[1] : '';
          const version = versionMatch ? versionMatch[1] : '';

          if (fs.existsSync(homePath)) {
            jdks.push({
              name,
              version,
              homePath,
              source: 'IntelliJ (jdk.table.xml)',
            });
          }
        }
      }
    } catch (_) {}
  }

  return jdks;
}

function parseVsCodeJdkSettings() {
  const jdks = [];
  const home = os.homedir();
  const isWin = process.platform === 'win32';
  const settingsPaths = [];

  if (isWin) {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    settingsPaths.push(path.join(appData, 'Code', 'User', 'settings.json'));
    settingsPaths.push(path.join(appData, 'Code - Insiders', 'User', 'settings.json'));
    settingsPaths.push(path.join(appData, 'VSCodium', 'User', 'settings.json'));
  } else if (process.platform === 'darwin') {
    settingsPaths.push(path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json'));
  } else {
    settingsPaths.push(path.join(home, '.config', 'Code', 'User', 'settings.json'));
    settingsPaths.push(path.join(home, '.config', 'VSCodium', 'User', 'settings.json'));
  }

  for (const setPath of settingsPaths) {
    if (!fs.existsSync(setPath)) continue;
    try {
      const raw = fs.readFileSync(setPath, 'utf8');
      const data = JSON.parse(raw);

      if (data['java.home'] && typeof data['java.home'] === 'string') {
        const p = normalizePath(data['java.home']);
        if (fs.existsSync(p)) {
          jdks.push({ homePath: p, source: 'VSCode (java.home)', name: 'VSCode java.home' });
        }
      }

      if (data['java.jdt.ls.java.home'] && typeof data['java.jdt.ls.java.home'] === 'string') {
        const p = normalizePath(data['java.jdt.ls.java.home']);
        if (fs.existsSync(p)) {
          jdks.push({ homePath: p, source: 'VSCode (jdt.ls.java.home)', name: 'VSCode JDT' });
        }
      }

      const runtimes = data['java.configuration.runtimes'];
      if (Array.isArray(runtimes)) {
        for (const rt of runtimes) {
          if (rt && rt.path) {
            const p = normalizePath(rt.path);
            if (fs.existsSync(p)) {
              jdks.push({
                homePath: p,
                source: 'VSCode (runtimes)',
                name: rt.name || '',
                isDefault: !!rt.default,
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  return jdks;
}

function buildJdkDisplayName(jdkName, releaseInfo, homeDirName) {
  const version = releaseInfo.javaVersion;
  const implementor = releaseInfo.implementor || '';
  const implementorVer = releaseInfo.implementorVersion || '';
  const major = releaseInfo.majorVersion;

  if (jdkName) {
    if (implementor.toLowerCase().includes('microsoft')) {
      return `${jdkName} Microsoft OpenJDK ${version}`;
    }
    if (implementor.toLowerCase().includes('adoptium') || implementor.toLowerCase().includes('temurin')) {
      return `${jdkName} Eclipse Temurin ${version}`;
    }
    if (implementor.toLowerCase().includes('oracle')) {
      return `${jdkName} java version "${version}"`;
    }
    if (implementor.toLowerCase().includes('corretto') || implementor.toLowerCase().includes('amazon')) {
      return `${jdkName} Amazon Corretto ${version}`;
    }
    if (implementor.toLowerCase().includes('azul') || implementor.toLowerCase().includes('zulu')) {
      return `${jdkName} Azul Zulu ${version}`;
    }
    if (implementor.toLowerCase().includes('bellsoft') || implementor.toLowerCase().includes('liberica')) {
      return `${jdkName} BellSoft Liberica ${version}`;
    }
    return `${jdkName} (${version || 'Java'})`;
  }

  if (implementor.toLowerCase().includes('microsoft')) {
    return `openjdk-${major || '25'} Microsoft OpenJDK ${version}`;
  }
  if (implementor.toLowerCase().includes('adoptium') || implementor.toLowerCase().includes('temurin')) {
    return `${major || '21'} Eclipse Temurin ${version}`;
  }
  if (implementor.toLowerCase().includes('oracle')) {
    return `openjdk-${major || '27'} java version "${version}"`;
  }
  if (implementor.toLowerCase().includes('corretto') || implementor.toLowerCase().includes('amazon')) {
    return `corretto-${major || '17'} Amazon Corretto ${version}`;
  }
  if (implementor.toLowerCase().includes('azul') || implementor.toLowerCase().includes('zulu')) {
    return `zulu-${major || '21'} Azul Zulu ${version}`;
  }
  if (implementor.toLowerCase().includes('bellsoft') || implementor.toLowerCase().includes('liberica')) {
    return `liberica-${major || '21'} BellSoft Liberica ${version}`;
  }

  if (version) {
    return `${major ? `Java ${major}` : homeDirName} (${version})`;
  }

  return homeDirName || 'Java SDK';
}

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
