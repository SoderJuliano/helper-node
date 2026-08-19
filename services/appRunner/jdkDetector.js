// services/appRunner/jdkDetector.js
// Descoberta automática de JDKs instalados na máquina do usuário.
// Suporta Windows, Arch Linux (Garuda Wayland), Pop!_OS Cosmic, Ubuntu e macOS.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function normalizePath(p) {
  if (!p) return '';
  return path.normalize(p).replace(/\\/g, '/');
}

function findExecutable(dir, exeName) {
  if (!dir || !fs.existsSync(dir)) return null;
  const isWin = process.platform === 'win32';
  const targetName = isWin ? (exeName.endsWith('.exe') ? exeName : `${exeName}.exe`) : exeName;

  const binCandidate = path.join(dir, 'bin', targetName);
  if (fs.existsSync(binCandidate)) return binCandidate;

  const directCandidate = path.join(dir, targetName);
  if (fs.existsSync(directCandidate)) return directCandidate;

  // Em macOS/Linux algumas JDKs têm Home/bin/java ou Contents/Home/bin/java
  const homeCandidate = path.join(dir, 'Contents', 'Home', 'bin', targetName);
  if (fs.existsSync(homeCandidate)) return homeCandidate;

  return null;
}

function extractVersionFromPath(jdkPath) {
  if (!jdkPath) return 'Java';
  const match = jdkPath.match(/(?:jdk|java|openjdk|corretto|temurin|zulu|graalvm|hotspot)[-_]?([0-9]+(?:\.[0-9]+)*)/i);
  if (match) return `Java ${match[1]}`;
  const numMatch = jdkPath.match(/[-_/]([0-9]{1,2})(?:[-_/.]|$)/);
  if (numMatch) return `Java ${numMatch[1]}`;
  return 'Java';
}

class JdkDetector {
  static getCandidateDirectories() {
    const isWin = process.platform === 'win32';
    const home = os.homedir();
    const dirs = [];

    // 1. IntelliJ IDEA downloaded JDKs (.jdks na pasta do usuário)
    const intellijJdks = path.join(home, '.jdks');
    if (fs.existsSync(intellijJdks)) {
      try {
        fs.readdirSync(intellijJdks, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory()) dirs.push({ path: path.join(intellijJdks, ent.name), source: 'IntelliJ (.jdks)' });
        });
      } catch (_) {}
    }

    // 2. SDKMAN (Linux/macOS)
    const sdkmanCandidates = path.join(home, '.sdkman', 'candidates', 'java');
    if (fs.existsSync(sdkmanCandidates)) {
      try {
        fs.readdirSync(sdkmanCandidates, { withFileTypes: true }).forEach(ent => {
          if (ent.isDirectory() && ent.name !== 'current') {
            dirs.push({ path: path.join(sdkmanCandidates, ent.name), source: 'SDKMAN' });
          }
        });
      } catch (_) {}
    }

    // 3. Linux JVM standard directories (Ubuntu, Pop!_OS, Arch Linux / Garuda)
    if (!isWin) {
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
                dirs.push({ path: path.join(jvmRoot, ent.name), source: 'Linux (/usr/lib/jvm)' });
              }
            });
          } catch (_) {}
        }
      });
    }

    // 4. Windows Standard JDK installation directories
    if (isWin) {
      const winRoots = [
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Java') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Eclipse Adoptium') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Amazon Corretto') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Zulu') : null,
        process.env['ProgramFiles'] ? path.join(process.env['ProgramFiles'], 'Microsoft') : null,
        process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Java') : null,
        process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Programs', 'Eclipse Adoptium') : null,
      ].filter(Boolean);

      winRoots.forEach(root => {
        if (fs.existsSync(root)) {
          try {
            fs.readdirSync(root, { withFileTypes: true }).forEach(ent => {
              if (ent.isDirectory()) {
                dirs.push({ path: path.join(root, ent.name), source: 'Windows Program Files' });
              }
            });
          } catch (_) {}
        }
      });
    }

    // 5. JAVA_HOME e JDK_HOME das variáveis de ambiente
    if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
      dirs.unshift({ path: process.env.JAVA_HOME, source: 'JAVA_HOME' });
    }
    if (process.env.JDK_HOME && fs.existsSync(process.env.JDK_HOME)) {
      dirs.unshift({ path: process.env.JDK_HOME, source: 'JDK_HOME' });
    }

    return dirs;
  }

  static detectAll() {
    const rawCandidates = this.getCandidateDirectories();
    const jdks = [];
    const seenPaths = new Set();

    for (const cand of rawCandidates) {
      const javaExe = findExecutable(cand.path, 'java');
      if (javaExe) {
        const homeDir = path.dirname(path.dirname(javaExe));
        const normHome = normalizePath(homeDir);
        if (!seenPaths.has(normHome)) {
          seenPaths.add(normHome);
          const versionLabel = extractVersionFromPath(normHome);
          jdks.push({
            homePath: normHome,
            javaPath: normalizePath(javaExe),
            javacPath: findExecutable(homeDir, 'javac') ? normalizePath(findExecutable(homeDir, 'javac')) : null,
            version: versionLabel,
            source: cand.source,
            isJavaHome: process.env.JAVA_HOME && normalizePath(process.env.JAVA_HOME) === normHome,
          });
        }
      }
    }

    // 6. Se nenhum encontrado ou como fallback adicional: tentar java no PATH
    if (jdks.length === 0) {
      try {
        const isWin = process.platform === 'win32';
        const cmd = isWin ? 'where java' : 'which java';
        const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 1500 }).trim();
        if (out) {
          const firstLine = out.split(/\r?\n/)[0].trim();
          if (fs.existsSync(firstLine)) {
            const javaHome = path.dirname(path.dirname(firstLine));
            jdks.push({
              homePath: normalizePath(javaHome),
              javaPath: normalizePath(firstLine),
              javacPath: null,
              version: 'Java (System PATH)',
              source: 'System PATH',
              isJavaHome: false,
            });
          }
        }
      } catch (_) {}
    }

    return jdks;
  }

  static getBestJdk(preferredPath) {
    const all = this.detectAll();
    if (!all.length) return null;

    if (preferredPath) {
      const normPref = normalizePath(preferredPath);
      const found = all.find(j => j.homePath === normPref || j.javaPath === normPref);
      if (found) return found;
    }

    // Prioridade 1: JAVA_HOME se estiver na lista
    const fromJavaHome = all.find(j => j.isJavaHome);
    if (fromJavaHome) return fromJavaHome;

    // Prioridade 2: IntelliJ (.jdks)
    const fromIntellij = all.find(j => j.source.includes('IntelliJ'));
    if (fromIntellij) return fromIntellij;

    // Prioridade 3: Versões mais modernas (Java 21, Java 17)
    const sorted = [...all].sort((a, b) => {
      const numA = parseInt((a.version.match(/\d+/) || [0])[0], 10);
      const numB = parseInt((b.version.match(/\d+/) || [0])[0], 10);
      return numB - numA;
    });

    return sorted[0];
  }
}

module.exports = JdkDetector;
