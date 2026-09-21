// services/appRunner/jdkMetadataHelper.js
// Utilitários de extração e parsing de metadados de JDKs (release files, IntelliJ jdk.table.xml, VS Code settings).

const fs = require('fs');
const path = require('path');
const os = require('os');

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
    // Linux (Arch Linux, Garuda, Pop!_OS, Ubuntu, Debian, Fedora)
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

module.exports = {
  normalizePath,
  findExecutable,
  parseReleaseFile,
  parseIntelliJJdkTable,
  parseVsCodeJdkSettings,
  buildJdkDisplayName,
};
