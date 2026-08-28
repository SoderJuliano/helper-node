// services/java/javaSyncDependencies.js
// Sincronizacao, download e log de dependencias Maven e Gradle (estilo IntelliJ).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { findJavaProjectRoot, normalizePath, hashOf } = require('./javaProjectRoot.js');
const { getOrBuildProjectIndex, projectCache, projectCacheDisk, saveDiskCache, notifyJavaDepsChanged } = require('./javaProjectCache.js');
const { getJavaProcessEnv, generateGradleInitScript } = require('./javaPropertiesBridge.js');

const DOWNLOAD_TIMEOUT_MS = 180000; // 3 minutos
const syncLogsMap = new Map();

function detectProjectType(filePath) {
  const found = findJavaProjectRoot(filePath);
  if (!found) {
    return { isJavaProject: false, type: null, rootDir: null, buildFile: null, hasWrapper: false };
  }
  const isWin = process.platform === 'win32';
  let hasWrapper = false;
  if (found.type === 'maven') {
    hasWrapper = fs.existsSync(path.join(found.rootDir, isWin ? 'mvnw.cmd' : 'mvnw'));
  } else if (found.type === 'gradle') {
    hasWrapper = fs.existsSync(path.join(found.rootDir, isWin ? 'gradlew.bat' : 'gradlew'));
  }
  return {
    isJavaProject: true,
    type: found.type,
    rootDir: found.rootDir,
    buildFile: found.buildFile,
    hasWrapper,
  };
}

function clearCacheForProject(rootDir) {
  const norm = normalizePath(rootDir);
  for (const k of projectCache.keys()) {
    if (k.startsWith(norm + '|')) projectCache.delete(k);
  }
  for (const k of projectCacheDisk.keys()) {
    if (k.startsWith(norm + '|')) projectCacheDisk.delete(k);
  }
  saveDiskCache();
}

function getSyncLog(rootDir) {
  if (!rootDir) {
    for (const log of syncLogsMap.values()) {
      if (log) return log;
    }
    return 'Sem logs de sincronizacao disponiveis.';
  }
  const norm = normalizePath(rootDir);
  if (syncLogsMap.has(norm)) return syncLogsMap.get(norm);
  for (const [k, v] of syncLogsMap.entries()) {
    if (k.includes(norm) || norm.includes(k)) return v;
  }
  return 'Sem logs de sincronizacao disponiveis.';
}

function downloadDependenciesAsync(found, callback) {
  const { rootDir, type } = found;
  const isWin = process.platform === 'win32';
  let cmd = '';
  let args = [];
  let initFile = null;

  if (type === 'maven') {
    const mvnw = path.join(rootDir, isWin ? 'mvnw.cmd' : 'mvnw');
    cmd = fs.existsSync(mvnw) ? mvnw : (isWin ? 'mvn.cmd' : 'mvn');
    args = ['-U', '-B', 'dependency:resolve'];
  } else {
    const gradlew = path.join(rootDir, isWin ? 'gradlew.bat' : 'gradlew');
    cmd = fs.existsSync(gradlew) ? gradlew : (isWin ? 'gradle.bat' : 'gradle');
    const runId = hashOf(rootDir);
    const outPrefix = path.join(os.tmpdir(), `helper-ide-sync-${runId}-`);
    initFile = path.join(os.tmpdir(), `helper-ide-sync-${runId}.init.gradle`);
    try {
      const initScript = generateGradleInitScript(outPrefix, rootDir);
      fs.writeFileSync(initFile, initScript, 'utf8');
      args = ['--refresh-dependencies', '--console=plain', '--init-script', initFile, 'dependencies'];
    } catch (_) {
      args = ['--refresh-dependencies', '--console=plain', 'dependencies'];
    }
  }

  const { env, bestJdk, properties } = getJavaProcessEnv(rootDir);
  const norm = normalizePath(rootDir);
  const logBuffer = [
    `[helper-node] Iniciando download e sincronizacao de dependencias (${type}) em: ${rootDir}\n` +
    (bestJdk ? `[helper-node] Usando JDK: ${bestJdk.version} (${bestJdk.homePath})\n` : '') +
    `Executando: ${cmd} ${args.join(' ')}\n\n`
  ];
  syncLogsMap.set(norm, logBuffer.join(''));

  let proc;
  try {
    proc = spawn(cmd, args, { cwd: rootDir, env, shell: true });
  } catch (err) {
    if (initFile) { try { fs.unlinkSync(initFile); } catch (_) {} }
    logBuffer.push(`Erro ao iniciar processo: ${err.message}\n`);
    syncLogsMap.set(norm, logBuffer.join(''));
    callback(null);
    return;
  }

  const timeout = setTimeout(() => {
    try { proc.kill(); } catch (_) {}
    logBuffer.push('\n[aviso] Timeout de download atingido.\n');
    syncLogsMap.set(norm, logBuffer.join(''));
    callback(null);
  }, DOWNLOAD_TIMEOUT_MS);

  proc.stdout.on('data', (d) => {
    logBuffer.push(d.toString());
    if (logBuffer.length > 2000) logBuffer.splice(0, logBuffer.length - 2000);
    syncLogsMap.set(norm, logBuffer.join(''));
  });

  proc.stderr.on('data', (d) => {
    logBuffer.push(d.toString());
    if (logBuffer.length > 2000) logBuffer.splice(0, logBuffer.length - 2000);
    syncLogsMap.set(norm, logBuffer.join(''));
  });

  proc.on('close', (code) => {
    clearTimeout(timeout);
    if (initFile) { try { fs.unlinkSync(initFile); } catch (_) {} }
    logBuffer.push(`\n[helper-node] Processo finalizado com codigo ${code}\n`);
    syncLogsMap.set(norm, logBuffer.join(''));
    callback(null);
  });

  proc.on('error', (err) => {
    clearTimeout(timeout);
    if (initFile) { try { fs.unlinkSync(initFile); } catch (_) {} }
    logBuffer.push(`\n[erro] ${err.message}\n`);
    syncLogsMap.set(norm, logBuffer.join(''));
    callback(null);
  });
}

async function syncDependencies(dirPath, { forceDownload = true } = {}) {
  const detected = detectProjectType(dirPath);
  if (!detected.isJavaProject) {
    return { ok: false, error: 'Projeto Maven ou Gradle nao encontrado neste diretorio.' };
  }

  const found = findJavaProjectRoot(dirPath);
  notifyJavaDepsChanged(found.rootDir, 'building');
  clearCacheForProject(found.rootDir);

  if (forceDownload) {
    await new Promise((resolve) => {
      downloadDependenciesAsync(found, () => resolve());
    });
  }

  const entry = getOrBuildProjectIndex(found.rootDir);
  if (!entry) {
    return { ok: false, error: 'Nao foi possivel inicializar o indice do projeto.' };
  }

  let waited = 0;
  while (entry.status === 'building' && waited < 15000) {
    await new Promise(r => setTimeout(r, 500));
    waited += 500;
  }

  const jarCount = (entry.classpathEntries || []).length;
  const classCount = (entry.allClasses && entry.allClasses.size) || 0;

  return {
    ok: entry.status !== 'error',
    status: entry.status,
    type: found.type,
    rootDir: found.rootDir,
    buildFile: found.buildFile,
    jarCount,
    classCount,
    error: entry.error,
    message: entry.status === 'ready'
      ? `Dependencias ${found.type === 'maven' ? 'Maven' : 'Gradle'} sincronizadas com sucesso! (${jarCount} bibliotecas indexadas)`
      : (entry.error || 'Sincronizacao de dependencias em andamento...'),
  };
}

module.exports = {
  detectProjectType,
  clearCacheForProject,
  syncDependencies,
  getSyncLog,
};