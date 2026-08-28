// services/java/javaClasspathResolver.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { hashOf } = require('./javaProjectRoot.js');
const { readZipClassEntries } = require('./javaZipReader.js');

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', '.idea', '.vscode', '.gradle', '.mvn',
  'out', 'bin', '.settings', 'dist'
]);
const CLASSPATH_TIMEOUT_MS = 120000;

function walkClassDir(dirRoot) {
  const results = [];
  const stack = [dirRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.class') && !entry.name.includes('module-info')) {
        const rel = path.relative(dirRoot, full).replace(/\\/g, '/');
        results.push(rel);
      }
    }
  }
  return results;
}

function addClassEntry(entryName, allClasses, knownPackages, simpleNameIndex, classSource, sourcePath) {
  if (!entryName.endsWith('.class')) return;
  const dotted = entryName.slice(0, -6).replace(/\//g, '.');
  const variants = dotted.includes('$') ? [dotted, dotted.replace(/\$/g, '.')] : [dotted];
  for (const fqn of variants) {
    allClasses.add(fqn);
    const parts = fqn.split('.');
    for (let i = 1; i < parts.length; i++) {
      knownPackages.add(parts.slice(0, i).join('.'));
    }
    const simpleName = parts[parts.length - 1];
    if (!simpleNameIndex.has(simpleName)) simpleNameIndex.set(simpleName, new Set());
    simpleNameIndex.get(simpleName).add(fqn);
    if (classSource && sourcePath && !classSource.has(fqn)) {
      classSource.set(fqn, sourcePath);
    }
  }
}

function indexProjectSources(rootDir, allClasses, knownPackages, simpleNameIndex) {
  const stack = [rootDir];
  const TYPE_RE = /(?:public\s+|final\s+|abstract\s+)*(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  const PKG_RE = /^\s*package\s+([\w.]+)\s*;/m;

  let filesScanned = 0;
  const MAX_FILES = 8000;

  while (stack.length > 0 && filesScanned < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.java')) {
        filesScanned++;
        let content;
        try {
          content = fs.readFileSync(full, 'utf8');
        } catch (_) {
          continue;
        }
        const pkgMatch = PKG_RE.exec(content);
        const pkg = pkgMatch ? pkgMatch[1] : '';
        let m;
        TYPE_RE.lastIndex = 0;
        while ((m = TYPE_RE.exec(content)) !== null) {
          const typeName = m[1];
          const fqn = pkg ? `${pkg}.${typeName}` : typeName;
          allClasses.add(fqn);
          const parts = fqn.split('.');
          for (let i = 1; i < parts.length; i++) {
            knownPackages.add(parts.slice(0, i).join('.'));
          }
          if (!simpleNameIndex.has(typeName)) simpleNameIndex.set(typeName, new Set());
          simpleNameIndex.get(typeName).add(fqn);
        }
      }
    }
  }
}

function resolveClasspathMaven(rootDir, callback) {
  const mvnwCmd = process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw';
  const mvnwPath = path.join(rootDir, mvnwCmd);
  const cmd = fs.existsSync(mvnwPath) ? mvnwPath : (process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
  const outFile = path.join(os.tmpdir(), `helper-ide-cp-${hashOf(rootDir)}.txt`);
  try { fs.unlinkSync(outFile); } catch (_) {}

  const args = ['-q', '-B', 'dependency:build-classpath', `-Dmdep.outputFile=${outFile}`];
  execFile(cmd, args, { cwd: rootDir, timeout: CLASSPATH_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, shell: true }, (err) => {
    if (err) { callback(err); return; }
    try {
      const cp = fs.readFileSync(outFile, 'utf8').trim();
      const sep = process.platform === 'win32' ? ';' : ':';
      const entries = cp.split(sep).map((s) => s.trim()).filter(Boolean);
      callback(null, entries);
    } catch (e) {
      callback(e);
    } finally {
      try { fs.unlinkSync(outFile); } catch (_) {}
    }
  });
}

function resolveClasspathGradle(rootDir, callback) {
  const gradlewCmd = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
  const gradlewPath = path.join(rootDir, gradlewCmd);
  const cmd = fs.existsSync(gradlewPath) ? gradlewPath : (process.platform === 'win32' ? 'gradle.bat' : 'gradle');

  const runId = hashOf(rootDir);
  const outPrefix = path.join(os.tmpdir(), `helper-ide-cp-${runId}-`);
  const initFile = path.join(os.tmpdir(), `helper-ide-cp-${runId}.init.gradle`);

  const initScript = `
allprojects { proj ->
  def registerAction = {
    if (proj.tasks.findByName('helperIdePrintClasspath') == null) {
      proj.tasks.register('helperIdePrintClasspath') {
        doLast {
          def safeName = (proj.path == ':' ? '_root_' : proj.path.replaceAll('[^a-zA-Z0-9]', '_'))
          def out = new File(${JSON.stringify(outPrefix)} + safeName + '.txt')
          def lines = new LinkedHashSet<String>()
          try {
            if (proj.hasProperty('sourceSets')) {
              proj.sourceSets.each { ss ->
                try { ss.compileClasspath.files.each { if (it.exists()) lines.add(it.absolutePath) } } catch (e) {}
                try { ss.runtimeClasspath.files.each { if (it.exists()) lines.add(it.absolutePath) } } catch (e) {}
                try { ss.output.classesDirs.files.each { if (it.exists()) lines.add(it.absolutePath) } } catch (e) {}
              }
            }
          } catch (e) {}
          try {
            proj.configurations.each { cfg ->
              try {
                def name = cfg.name.toLowerCase()
                if (cfg.canBeResolved && (name.contains('classpath') || name.contains('compile') || name.contains('runtime') || name == 'implementation' || name == 'api')) {
                  cfg.files.each { if (it.exists()) lines.add(it.absolutePath) }
                }
              } catch (e) {}
            }
          } catch (e) {}
          out.text = lines.join(System.lineSeparator())
        }
      }
    }
  }
  if (proj.state.executed) {
    registerAction()
  } else {
    proj.afterEvaluate { registerAction() }
  }
}
`;

  try {
    fs.writeFileSync(initFile, initScript, 'utf8');
  } catch (e) {
    callback(e);
    return;
  }

  const args = ['-q', '--console=plain', '--init-script', initFile, 'helperIdePrintClasspath'];
  execFile(cmd, args, { cwd: rootDir, timeout: CLASSPATH_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, shell: true }, (err) => {
    try { fs.unlinkSync(initFile); } catch (_) {}
    if (err) { callback(err); return; }

    try {
      const dir = os.tmpdir();
      const prefixName = path.basename(outPrefix);
      const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefixName) && f.endsWith('.txt'));
      const entries = [];
      for (const f of files) {
        const full = path.join(dir, f);
        try {
          const txt = fs.readFileSync(full, 'utf8').trim();
          if (txt) entries.push(...txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
        } catch (_) {}
        try { fs.unlinkSync(full); } catch (_) {}
      }
      callback(null, entries);
    } catch (e) {
      callback(e);
    }
  });
}

function compareVersionsDesc(a, b) {
  if (a === b) return 0;
  const parsePart = (p) => {
    const num = parseInt(p, 10);
    return isNaN(num) ? p : num;
  };
  const pa = String(a).split(/[-._+]/).map(parsePart);
  const pb = String(b).split(/[-._+]/).map(parsePart);
  const maxLen = Math.max(pa.length, pb.length);
  for (let i = 0; i < maxLen; i++) {
    const va = pa[i] !== undefined ? pa[i] : 0;
    const vb = pb[i] !== undefined ? pb[i] : 0;
    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== vb) return vb - va;
    } else {
      const sa = String(va);
      const sb = String(vb);
      if (sa !== sb) return sb.localeCompare(sa);
    }
  }
  return String(b).localeCompare(String(a));
}

function scanJarMatchingClass(dir, fqn, maxDepth = 3) {
  if (maxDepth < 0 || !dir || !fs.existsSync(dir)) return null;
  const relClass = fqn.replace(/\./g, '/') + '.class';

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jar') && !entry.name.endsWith('-sources.jar') && !entry.name.endsWith('-javadoc.jar')) {
        const classes = readZipClassEntries(full);
        if (classes.includes(relClass) || classes.some((c) => c.endsWith('/' + relClass) || c.replace(/\.class$/, '').replace(/\//g, '.') === fqn)) {
          return full;
        }
      } else if (entry.isDirectory() && maxDepth > 0) {
        const sub = scanJarMatchingClass(full, fqn, maxDepth - 1);
        if (sub) return sub;
      }
    }
  } catch (_) {}
  return null;
}

function findJarForFqn(fqn, rootDir) {
  if (!fqn || typeof fqn !== 'string') return null;
  const home = os.homedir();
  const parts = fqn.split('.');
  if (parts.length < 2) return null;

  // 1. Maven local repository (~/.m2/repository)
  const m2Repo = path.join(home, '.m2', 'repository');
  if (fs.existsSync(m2Repo)) {
    for (let i = parts.length - 1; i >= 1; i--) {
      const groupSubpath = path.join(...parts.slice(0, i));
      const candidateDir = path.join(m2Repo, groupSubpath);
      if (fs.existsSync(candidateDir)) {
        const found = scanJarMatchingClass(candidateDir, fqn, 3);
        if (found) return found;
      }
    }
  }

  // 2. Gradle cache (~/.gradle/caches/modules-2/files-2.1)
  const gradleCache = path.join(home, '.gradle', 'caches', 'modules-2', 'files-2.1');
  if (fs.existsSync(gradleCache)) {
    for (let i = parts.length - 1; i >= 1; i--) {
      const groupSubpath = parts.slice(0, i).join('.');
      const candidateDir = path.join(gradleCache, groupSubpath);
      if (fs.existsSync(candidateDir)) {
        const found = scanJarMatchingClass(candidateDir, fqn, 4);
        if (found) return found;
      }
    }
  }

  // 3. Pastas locais do projeto
  if (rootDir && fs.existsSync(rootDir)) {
    const localDirs = [
      path.join(rootDir, 'target', 'dependency'),
      path.join(rootDir, 'target'),
      path.join(rootDir, 'build', 'libs'),
      path.join(rootDir, 'lib'),
      path.join(rootDir, 'libs'),
    ];
    for (const ld of localDirs) {
      if (fs.existsSync(ld)) {
        const found = scanJarMatchingClass(ld, fqn, 1);
        if (found) return found;
      }
    }
  }

  return null;
}

function scanLocalJarsImmediately(found, entry) {
  try {
    const jarCandidates = [];
    const rootDir = found.rootDir;
    const home = os.homedir();

    const localDirs = [
      path.join(rootDir, 'target', 'dependency'),
      path.join(rootDir, 'target'),
      path.join(rootDir, 'build', 'libs'),
      path.join(rootDir, 'lib'),
      path.join(rootDir, 'libs'),
    ];

    for (const ld of localDirs) {
      if (fs.existsSync(ld)) {
        try {
          const files = fs.readdirSync(ld);
          for (const f of files) {
            if (f.endsWith('.jar') && !f.endsWith('-sources.jar') && !f.endsWith('-javadoc.jar')) {
              jarCandidates.push(path.join(ld, f));
            }
          }
        } catch (_) {}
      }
    }

    const pomFile = path.join(rootDir, 'pom.xml');
    if (fs.existsSync(pomFile)) {
      try {
        const pomContent = fs.readFileSync(pomFile, 'utf8');
        const m2Repo = path.join(home, '.m2', 'repository');
        if (fs.existsSync(m2Repo)) {
          const DEP_RE = /<dependency>[\s\S]*?<groupId>([\w.-]+)<\/groupId>[\s\S]*?<artifactId>([\w.-]+)<\/artifactId>(?:[\s\S]*?<version>([\w.-]+)<\/version>)?[\s\S]*?<\/dependency>/g;
          let m;
          while ((m = DEP_RE.exec(pomContent)) !== null) {
            const groupId = m[1];
            const artifactId = m[2];
            const version = m[3];
            const groupPath = path.join(m2Repo, ...groupId.split('.'), artifactId);
            if (fs.existsSync(groupPath)) {
              if (version) {
                const jarPath = path.join(groupPath, version, `${artifactId}-${version}.jar`);
                if (fs.existsSync(jarPath)) jarCandidates.push(jarPath);
              } else {
                try {
                  const versions = fs.readdirSync(groupPath).sort(compareVersionsDesc);
                  for (const v of versions) {
                    const jarPath = path.join(groupPath, v, `${artifactId}-${v}.jar`);
                    if (fs.existsSync(jarPath)) { jarCandidates.push(jarPath); break; }
                  }
                } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}
    }

    const gradleFiles = [path.join(rootDir, 'build.gradle'), path.join(rootDir, 'build.gradle.kts')];
    for (const gf of gradleFiles) {
      if (fs.existsSync(gf)) {
        try {
          const content = fs.readFileSync(gf, 'utf8');
          const gradleCache = path.join(home, '.gradle', 'caches', 'modules-2', 'files-2.1');
          if (fs.existsSync(gradleCache)) {
            const GDEP_RE = /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*[\('"]+([\w.-]+):([\w.-]+)(?::([\w.-]+))?[\)'"]/g;
            let m;
            while ((m = GDEP_RE.exec(content)) !== null) {
              const groupId = m[1];
              const artifactId = m[2];
              const version = m[3];
              const groupPath = path.join(gradleCache, groupId, artifactId);
              if (fs.existsSync(groupPath)) {
                try {
                  const versions = version ? [version] : fs.readdirSync(groupPath).sort(compareVersionsDesc);
                  for (const v of versions) {
                    const vDir = path.join(groupPath, v);
                    if (fs.existsSync(vDir)) {
                      const hashDirs = fs.readdirSync(vDir);
                      for (const hd of hashDirs) {
                        const candidate = path.join(vDir, hd, `${artifactId}-${v}.jar`);
                        if (fs.existsSync(candidate)) { jarCandidates.push(candidate); break; }
                      }
                    }
                  }
                } catch (_) {}
              }
            }
          }
        } catch (_) {}
      }
    }

    const uniqueJars = Array.from(new Set(jarCandidates));
    if (uniqueJars.length > 0) {
      entry.classpathEntries = uniqueJars;
      let jIdx = 0;
      function processNextJarBatch() {
        const BATCH = 4;
        for (let i = 0; i < BATCH && jIdx < uniqueJars.length; i++, jIdx++) {
          const j = uniqueJars[jIdx];
          try {
            for (const name of readZipClassEntries(j)) {
              addClassEntry(name, entry.allClasses, entry.knownPackages, entry.simpleNameIndex, entry.classSource, j);
            }
          } catch (_) {}
        }
        if (jIdx < uniqueJars.length) {
          setImmediate(processNextJarBatch);
        } else {
          entry.status = 'ready';
        }
      }
      setImmediate(processNextJarBatch);
    }
  } catch (_) {}
}

function findGradleSourcesJar(jarPath) {
  const norm = String(jarPath).replace(/\\/g, '/');
  if (!norm.toLowerCase().includes('/caches/modules-2/files-2.1/')) return null;
  const hashDir = path.dirname(norm);
  const versionDir = path.dirname(hashDir);
  const fileName = path.basename(norm);
  const baseName = fileName.replace(/\.jar$/i, '');
  const sourcesName = `${baseName}-sources.jar`;

  try {
    const hashDirs = fs.readdirSync(versionDir);
    for (const hd of hashDirs) {
      const candidate = path.join(versionDir, hd, sourcesName);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch (_) {}
  return null;
}

module.exports = {
  CLASSPATH_TIMEOUT_MS,
  walkClassDir,
  addClassEntry,
  indexProjectSources,
  resolveClasspathMaven,
  resolveClasspathGradle,
  scanJarMatchingClass,
  findJarForFqn,
  scanLocalJarsImmediately,
  findGradleSourcesJar,
};
