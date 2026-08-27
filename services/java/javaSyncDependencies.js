// services/java/javaSyncDependencies.js
// Sincronizacao e download de dependencias Maven e Gradle (estilo IntelliJ).

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { findJavaProjectRoot, normalizePath } = require('./javaProjectRoot.js');
const { getOrBuildProjectIndex, projectCache, projectCacheDisk, saveDiskCache, notifyJavaDepsChanged } = require('./javaProjectCache.js');

const DOWNLOAD_TIMEOUT_MS = 180000; // 3 minutos

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

function downloadDependenciesAsync(found, callback) {
  const { rootDir, type } = found;
  const isWin = process.platform === 'win32';

  let cmd = '';
  let args = [];

  if (type === 'maven') {
    const mvnw = path.join(rootDir, isWin ? 'mvnw.cmd' : 'mvnw');
    cmd = fs.existsSync(mvnw) ? mvnw : (isWin ? 'mvn.cmd' : 'mvn');
    args = ['dependency:resolve', '-B', '-q'];
  } else {
    const gradlew = path.join(rootDir, isWin ? 'gradlew.bat' : 'gradlew');
    cmd = fs.existsSync(gradlew) ? gradlew : (isWin ? 'gradle.bat' : 'gradle');
    args = ['--refresh-dependencies', 'dependencies', '-q'];
  }

  execFile(cmd, args, { cwd: rootDir, timeout: DOWNLOAD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, shell: true }, (err) => {
    if (err) {
      // Fallback tranquilo se go-offline falhar
      console.warn('[javaSyncDependencies] Nota ao baixar dependencias (aviso)', err.message);
    }
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

  // Aguarda ate o status ficar ready ou error (ate 10 segundos sync ou retorna building)
  let waited = 0;
  while (entry.status === 'building' && waited < 10000) {
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
      ? `Dependencias ${found.type === 'maven' ? 'Maven' : 'Gradle'} sincronizadas com sucesso! (${-jarCount} bibliotecas indexadas)`
      : (entry.error || 'Sincronizacao de dependencias em andamento...'),
  };
}

module.exports = {
  detectProjectType,
  clearCacheForProject,
  syncDependencies,
};