// services/java/javaProjectCache.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { normalizePath, safeMtimeMs, findJavaProjectRoot } = require('./javaProjectRoot.js');
const { jarClassCache, readZipClassEntries } = require('./javaZipReader.js');
const {
  CLASSPATH_TIMEOUT_MS,
  walkClassDir,
  addClassEntry,
  indexProjectSources,
  resolveClasspathMaven,
  resolveClasspathGradle,
  scanLocalJarsImmediately,
} = require('./javaClasspathResolver.js');

const CACHE_DIR = path.join(os.homedir(), '.config', 'helper-node', 'cache');
const DISK_CACHE_FILE = path.join(CACHE_DIR, 'java-deps-cache.json');

const projectCacheDisk = new Map();
const projectCache = new Map();

function loadDiskCache() {
  try {
    if (!fs.existsSync(DISK_CACHE_FILE)) return;
    const raw = fs.readFileSync(DISK_CACHE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.jars)) {
      for (const [k, v] of data.jars) jarClassCache.set(k, v);
    }
    if (data && Array.isArray(data.projects)) {
      for (const [k, v] of data.projects) projectCacheDisk.set(k, v);
    }
  } catch (_) {}
}

function saveDiskCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    const jarsArr = Array.from(jarClassCache.entries()).slice(-1000);
    const projArr = Array.from(projectCacheDisk.entries()).slice(-100);
    const data = JSON.stringify({ jars: jarsArr, projects: projArr });
    fs.writeFileSync(DISK_CACHE_FILE, data, 'utf8');
  } catch (_) {}
}

loadDiskCache();

function notifyJavaDepsChanged(rootDir, status) {
  try {
    const { state } = require('../../main/globals.js');
    if (state && state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('java-deps-changed', { rootDir, status });
    }
  } catch (_) {}
}

function buildIndexFromClasspathEntries(entries, moduleDir, entry, key) {
  entry.classpathEntries = entries.filter((p) => p.toLowerCase().endsWith('.jar'));
  const items = [...entries];
  let idx = 0;

  function processBatch() {
    const BATCH = 12;
    for (let i = 0; i < BATCH && idx < items.length; i++, idx++) {
      const p = items[idx];
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          for (const rel of walkClassDir(p)) {
            addClassEntry(rel, entry.allClasses, entry.knownPackages, entry.simpleNameIndex, entry.classSource, p);
          }
        } else if (p.toLowerCase().endsWith('.jar')) {
          for (const name of readZipClassEntries(p)) {
            addClassEntry(name, entry.allClasses, entry.knownPackages, entry.simpleNameIndex, entry.classSource, p);
          }
        }
      } catch (_) {}
    }

    if (idx < items.length) {
      setImmediate(processBatch);
    } else {
      indexProjectSources(moduleDir, entry.allClasses, entry.knownPackages, entry.simpleNameIndex);
      entry.status = 'ready';

      if (key) {
        const simpleArr = [];
        for (const [k, v] of entry.simpleNameIndex.entries()) {
          simpleArr.push([k, Array.from(v)]);
        }
        const classSourceArr = Array.from(entry.classSource.entries());
        projectCacheDisk.set(key, {
          buildFileMtime: entry.buildFileMtime,
          classpathEntries: entry.classpathEntries,
          allClasses: Array.from(entry.allClasses),
          knownPackages: Array.from(entry.knownPackages),
          simpleNameIndex: simpleArr,
          classSource: classSourceArr,
        });
        saveDiskCache();
      }
      notifyJavaDepsChanged(moduleDir, 'ready');
    }
  }

  processBatch();
}

function buildClasspathIndexAsync(found, entry, key) {
  const resolve = found.type === 'maven' ? resolveClasspathMaven : resolveClasspathGradle;
  resolve(found.rootDir, (err, cpEntries) => {
    if (err) {
      if (entry.classpathEntries && entry.classpathEntries.length > 0) {
        entry.status = 'ready';
        entry.error = null;
        entry.warning = err.code === 'ENOENT'
          ? `Comando de build não encontrado (${found.type === 'maven' ? 'mvn/mvnw' : 'gradle/gradlew'})`
          : err.message;
        notifyJavaDepsChanged(found.rootDir, 'ready');
        return;
      }
      entry.status = 'error';
      entry.error = err.code === 'ENOENT'
        ? `Comando de build não encontrado (${found.type === 'maven' ? 'mvn/mvnw' : 'gradle/gradlew'})`
        : err.message;
      console.warn(`[javaImportChecker] Falha ao resolver classpath (${found.type}) em ${found.rootDir}:`, entry.error);
      notifyJavaDepsChanged(found.rootDir, 'error');
      return;
    }
    buildIndexFromClasspathEntries(cpEntries, found.moduleDir, entry, key);
  });
}

function getOrBuildProjectIndex(filePath) {
  const found = findJavaProjectRoot(filePath);
  if (!found) return null;

  const key = normalizePath(found.rootDir) + '|' + found.type;
  const mtime = safeMtimeMs(found.buildFile);
  const existing = projectCache.get(key);

  if (existing && existing.buildFileMtime === mtime) {
    if (existing.status === 'building' && (Date.now() - existing.lastAttemptAt) > CLASSPATH_TIMEOUT_MS) {
      if (existing.classpathEntries && existing.classpathEntries.length > 0) {
        existing.status = 'ready';
        existing.warning = 'Timeout ao resolver classpath (mais de 2min) — mantendo bibliotecas locais.';
      } else {
        existing.status = 'error';
        existing.error = 'Timeout ao resolver classpath (mais de 2min)';
      }
      notifyJavaDepsChanged(found.rootDir, existing.status);
    }
    return existing;
  }
  if (existing && existing.status === 'building') {
    if ((Date.now() - existing.lastAttemptAt) < CLASSPATH_TIMEOUT_MS) {
      return existing;
    }
  }

  const diskEntry = projectCacheDisk.get(key);
  if (diskEntry && diskEntry.buildFileMtime === mtime) {
    const restored = {
      status: 'ready',
      rootDir: found.rootDir,
      buildFileMtime: mtime,
      allClasses: new Set(diskEntry.allClasses || []),
      knownPackages: new Set(diskEntry.knownPackages || []),
      simpleNameIndex: new Map((diskEntry.simpleNameIndex || []).map(([k, v]) => [k, new Set(v)])),
      classSource: new Map(diskEntry.classSource || []),
      classpathEntries: diskEntry.classpathEntries || [],
      error: null,
      lastAttemptAt: Date.now(),
    };
    projectCache.set(key, restored);
    return restored;
  }

  const entry = {
    status: 'building',
    rootDir: found.rootDir,
    buildFileMtime: mtime,
    allClasses: new Set(existing ? existing.allClasses : (diskEntry ? diskEntry.allClasses : [])),
    knownPackages: new Set(existing ? existing.knownPackages : (diskEntry ? diskEntry.knownPackages : [])),
    simpleNameIndex: existing ? new Map(existing.simpleNameIndex) : (diskEntry ? new Map((diskEntry.simpleNameIndex || []).map(([k, v]) => [k, new Set(v)])) : new Map()),
    classSource: existing ? new Map(existing.classSource) : (diskEntry ? new Map(diskEntry.classSource || []) : new Map()),
    classpathEntries: (existing && existing.classpathEntries) ? [...existing.classpathEntries] : ((diskEntry && diskEntry.classpathEntries) ? [...diskEntry.classpathEntries] : []),
    error: null,
    lastAttemptAt: Date.now(),
  };
  projectCache.set(key, entry);
  scanLocalJarsImmediately(found, entry);
  buildClasspathIndexAsync(found, entry, key);
  return entry;
}

module.exports = {
  projectCache,
  projectCacheDisk,
  loadDiskCache,
  saveDiskCache,
  notifyJavaDepsChanged,
  getOrBuildProjectIndex,
  buildIndexFromClasspathEntries,
};
