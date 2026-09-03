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
  let outPrefix = null;
  let mavenOutFile = null;

  if (type === 'maven') {
    const mvnw = path.join(rootDir, isWin ? 'mvnw.cmd' : 'mvnw');
    cmd = fs.existsSync(mvnw) ? mvnw : (isWin ? 'mvn.cmd' : 'mvn');
    mavenOutFile = path.join(os.tmpdir(), `helper-ide-sync-${hashOf(rootDir)}.txt`);
    try { fs.unlinkSync(mavenOutFile); } catch (_) {}
    args = ['-U', '-B', 'dependency:resolve', 'dependency:build-classpath', `-Dmdep.outputFile=${mavenOutFile}`];
  } else {
    const gradlew = path.join(rootDir, isWin ? 'gradlew.bat' : 'gradlew');
    cmd = fs.existsSync(gradlew) ? gradlew : (isWin ? 'gradle.bat' : 'gradle');
    const runId = hashOf(rootDir);
    outPrefix = path.join(os.tmpdir(), `helper-ide-sync-${runId}-`);
    initFile = path.join(os.tmpdir(), `helper-ide-sync-${runId}.init.gradle`);
    try {
      const initScript = generateGradleInitScript(outPrefix, rootDir);
      fs.writeFileSync(initFile, initScript, 'utf8');
      args = ['-q', '--console=plain', '--refresh-dependencies', '--init-script', initFile, 'helperIdePrintClasspath'];
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

  const collectResolvedEntries = () => {
    const entries = [];
    if (outPrefix) {
      try {
        const dir = os.tmpdir();
        const prefixName = path.basename(outPrefix);
        const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefixName) && f.endsWith('.txt'));
        for (const f of files) {
          const full = path.join(dir, f);
          try {
            const txt = fs.readFileSync(full, 'utf8').trim();
            if (txt) entries.push(...txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
          } catch (_) {}
          try { fs.unlinkSync(full); } catch (_) {}
        }
      } catch (_) {}
    }
    if (mavenOutFile && fs.existsSync(mavenOutFile)) {
      try {
        const txt = fs.readFileSync(mavenOutFile, 'utf8').trim();
        const sep = process.platform === 'win32' ? ';' : ':';
        if (txt) entries.push(...txt.split(sep).map((s) => s.trim()).filter(Boolean));
        fs.unlinkSync(mavenOutFile);
      } catch (_) {}
    }
    return entries;
  };

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
    callback(collectResolvedEntries());
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
    callback(collectResolvedEntries());
  });

  proc.on('error', (err) => {
    clearTimeout(timeout);
    if (initFile) { try { fs.unlinkSync(initFile); } catch (_) {} }
    logBuffer.push(`\n[erro] ${err.message}\n`);
    syncLogsMap.set(norm, logBuffer.join(''));
    callback(collectResolvedEntries());
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

  let resolvedEntries = [];
  if (forceDownload) {
    resolvedEntries = await new Promise((resolve) => {
      downloadDependenciesAsync(found, (entries) => resolve(entries || []));
    });
  }

  const key = normalizePath(found.rootDir) + '|' + found.type;
  let entry = projectCache.get(key);
  if (!entry) {
    entry = getOrBuildProjectIndex(found.rootDir);
  }

  if (resolvedEntries && resolvedEntries.length > 0 && entry) {
    const { buildIndexFromClasspathEntries } = require('./javaProjectCache.js');
    buildIndexFromClasspathEntries(resolvedEntries, found.moduleDir || found.rootDir, entry, key);
  }

  let waited = 0;
  while (entry && entry.status === 'building' && waited < 15000) {
    await new Promise(r => setTimeout(r, 500));
    waited += 500;
  }

  const jarCount = (entry && entry.classpathEntries ? entry.classpathEntries.length : 0);
  const classCount = (entry && entry.allClasses ? entry.allClasses.size : 0);

  notifyJavaDepsChanged(found.rootDir, 'ready');

  return {
    ok: entry ? entry.status !== 'error' : false,
    status: entry ? entry.status : 'ready',
    type: found.type,
    rootDir: found.rootDir,
    buildFile: found.buildFile,
    jarCount,
    classCount,
    error: entry ? entry.error : null,
    message: entry && entry.status === 'ready'
      ? `Dependencias ${found.type === 'maven' ? 'Maven' : 'Gradle'} sincronizadas com sucesso! (${jarCount} bibliotecas indexadas)`
      : ((entry && entry.error) || 'Sincronizacao de dependencias em andamento...'),
  };
}

module.exports = {
  detectProjectType,
  clearCacheForProject,
  syncDependencies,
  getSyncLog,
};