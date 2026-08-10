// services/javaImportChecker.js
// Checador de imports para Java (Maven e Gradle) no modo IDE, igual ao IntelliJ:
// sublinha import que não existe no classpath e sugere a classe mais parecida.
//
// Não faz checagem semântica completa (isso exigiria um Language Server real,
// tipo Eclipse JDT LS) — só resolve "esse import existe no classpath ou não".
//
// Estratégia (evita compilar o projeto, só resolve dependências):
//  - Maven: `mvn dependency:build-classpath` (ou mvnw se existir) escreve a lista de jars num arquivo.
//  - Gradle: um init-script temporário (não mexe no build.gradle do projeto) roda uma task
//    que imprime o compileClasspath de cada (sub)projeto.
// Os jars viram um índice de nomes de classe (lidos direto do central directory do ZIP,
// sem descompactar nada) + as próprias classes fonte do projeto (scan de `package`/`class`).

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { execFile, execFileSync } = require('child_process');

const JDK_ALWAYS_OK_PREFIXES = ['java.', 'javax.', 'jakarta.', 'sun.', 'jdk.', 'org.w3c.', 'org.xml.'];

const SOURCE_DIR_NAMES = new Set(['src']);
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'target', 'build', '.idea', '.vscode', '.gradle', '.mvn',
  'out', 'bin', '.settings', 'dist'
]);

const CLASSPATH_TIMEOUT_MS = 120000;
const BUILD_FILE_POLL_MS = 4000; // evita reiniciar a resolução repetidas vezes por chamadas seguidas

function normalizePath(p) {
  if (!p) return '';
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (norm.length >= 2 && norm[1] === ':') {
    norm = norm[0].toUpperCase() + norm.substring(1);
  }
  return norm;
}

function safeMtimeMs(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch (_) {
    return 0;
  }
}

function hashOf(str) {
  return crypto.createHash('md5').update(str).digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------------------
// Detecção de projeto Maven/Gradle
// ---------------------------------------------------------------------------

// Sobe a árvore de diretórios a partir do arquivo .java procurando pom.xml ou
// build.gradle(.kts). Pra Gradle, continua subindo até achar a raiz de verdade
// (settings.gradle / gradlew) porque o wrapper só existe lá.
function findJavaProjectRoot(filePath) {
  let dir = path.dirname(filePath);
  const fsRoot = path.parse(dir).root;
  let type = null;
  let moduleDir = null;
  let buildFile = null;

  while (dir && dir.length >= fsRoot.length) {
    if (!type) {
      if (fs.existsSync(path.join(dir, 'pom.xml'))) {
        type = 'maven';
        moduleDir = dir;
        buildFile = path.join(dir, 'pom.xml');
        return { type, rootDir: dir, moduleDir, buildFile };
      }
      const bg = path.join(dir, 'build.gradle');
      const bgk = path.join(dir, 'build.gradle.kts');
      if (fs.existsSync(bg) || fs.existsSync(bgk)) {
        type = 'gradle';
        moduleDir = dir;
        buildFile = fs.existsSync(bg) ? bg : bgk;
      }
    }

    if (type === 'gradle') {
      const hasSettings = fs.existsSync(path.join(dir, 'settings.gradle')) ||
        fs.existsSync(path.join(dir, 'settings.gradle.kts'));
      const hasWrapper = fs.existsSync(path.join(dir, 'gradlew')) ||
        fs.existsSync(path.join(dir, 'gradlew.bat'));
      if (hasSettings || hasWrapper) {
        return { type: 'gradle', rootDir: dir, moduleDir, buildFile };
      }
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (type === 'gradle') {
    // Não achou settings.gradle/gradlew acima — assume módulo único (raiz = onde está o build.gradle)
    return { type: 'gradle', rootDir: moduleDir, moduleDir, buildFile };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Leitor de entradas ZIP (só nomes, sem descompactar) — jars são ZIPs comuns
// ---------------------------------------------------------------------------

function readZipClassEntries(jarPath) {
  const results = [];
  let fd;
  try {
    fd = fs.openSync(jarPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return results;

    const tailSize = Math.min(size, 65557); // EOCD (22) + comentário máx (65535)
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize);

    let eocdOffset = -1;
    for (let i = tailBuf.length - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return results; // não é zip válido ou é ZIP64 sem EOCD clássico

    const totalEntries = tailBuf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = tailBuf.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset >= size) return results;

    const cdSize = size - centralDirOffset;
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, centralDirOffset);

    let pos = 0;
    let count = 0;
    while (pos + 46 <= cdBuf.length && count < totalEntries) {
      const sig = cdBuf.readUInt32LE(pos);
      if (sig !== 0x02014b50) break;
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const nameStart = pos + 46;
      if (nameStart + nameLen > cdBuf.length) break;
      const name = cdBuf.toString('utf8', nameStart, nameStart + nameLen);
      if (name.endsWith('.class') && !name.startsWith('META-INF/')) {
        results.push(name);
      }
      pos = nameStart + nameLen + extraLen + commentLen;
      count++;
    }
  } catch (_) {
    // jar corrompido/inacessível — ignora silenciosamente
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
  return results;
}

// Extrai o conteúdo (descomprimido) de UMA entrada específica do zip — usado
// pra ler o .java de dentro de um "-sources.jar". Reaproveita a busca no
// central directory de readZipClassEntries, mas também segue o local file
// header (que pode ter name/extra length diferentes do central dir) pra achar
// onde os bytes de dados realmente começam.
function readZipEntryContent(zipPath, entryName) {
  let fd;
  try {
    fd = fs.openSync(zipPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return null;

    const tailSize = Math.min(size, 65557);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize);

    let eocdOffset = -1;
    for (let i = tailBuf.length - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return null;

    const totalEntries = tailBuf.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = tailBuf.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset >= size) return null;

    const cdSize = size - centralDirOffset;
    const cdBuf = Buffer.alloc(cdSize);
    fs.readSync(fd, cdBuf, 0, cdSize, centralDirOffset);

    let pos = 0;
    let count = 0;
    let localHeaderOffset = -1;
    let compMethod = -1;
    let compSize = -1;
    while (pos + 46 <= cdBuf.length && count < totalEntries) {
      const sig = cdBuf.readUInt32LE(pos);
      if (sig !== 0x02014b50) break;
      const method = cdBuf.readUInt16LE(pos + 10);
      const csize = cdBuf.readUInt32LE(pos + 20);
      const nameLen = cdBuf.readUInt16LE(pos + 28);
      const extraLen = cdBuf.readUInt16LE(pos + 30);
      const commentLen = cdBuf.readUInt16LE(pos + 32);
      const lho = cdBuf.readUInt32LE(pos + 42);
      const nameStart = pos + 46;
      if (nameStart + nameLen > cdBuf.length) break;
      const name = cdBuf.toString('utf8', nameStart, nameStart + nameLen);
      if (name === entryName) {
        localHeaderOffset = lho;
        compMethod = method;
        compSize = csize;
        break;
      }
      pos = nameStart + nameLen + extraLen + commentLen;
      count++;
    }
    if (localHeaderOffset === -1) return null;

    const lfhBuf = Buffer.alloc(30);
    fs.readSync(fd, lfhBuf, 0, 30, localHeaderOffset);
    if (lfhBuf.readUInt32LE(0) !== 0x04034b50) return null;
    const lNameLen = lfhBuf.readUInt16LE(26);
    const lExtraLen = lfhBuf.readUInt16LE(28);
    const dataOffset = localHeaderOffset + 30 + lNameLen + lExtraLen;

    const dataBuf = Buffer.alloc(compSize);
    fs.readSync(fd, dataBuf, 0, compSize, dataOffset);

    if (compMethod === 0) return dataBuf.toString('utf8');
    if (compMethod === 8) return zlib.inflateRawSync(dataBuf).toString('utf8');
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

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

// Adiciona uma entrada "com/foo/Bar$Inner.class" ao índice como
// com.foo.Bar$Inner e com.foo.Bar.Inner (import usa notação com ponto).
// `classSource`/`sourcePath`, quando informados, registram de qual jar (ou
// diretório de classes) a classe veio — é o que permite "ir para dentro da
// dependência" ao clicar num import (ver resolveSymbolToJar).
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

// Indexa as próprias classes-fonte do projeto (útil mesmo antes de compilar)
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

// ---------------------------------------------------------------------------
// Resolução do classpath (Maven / Gradle) — assíncrona, não bloqueia a UI
// ---------------------------------------------------------------------------

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

  // Task registrada em todo (sub)projeto que tenha sourceSets — cada um grava seu
  // próprio arquivo (por project.path) pra não haver colisão em builds multi-módulo.
  // Não toca no build.gradle real do usuário: só um init-script temporário.
  const initScript = `
allprojects { proj ->
  proj.afterEvaluate {
    def sourceSetsExt = proj.extensions.findByName('sourceSets')
    if (sourceSetsExt != null) {
      proj.tasks.register('helperIdePrintClasspath') {
        doLast {
          def main = sourceSetsExt.findByName('main')
          if (main != null) {
            def safeName = proj.path.replaceAll('[^a-zA-Z0-9]', '_')
            def out = new File(${JSON.stringify(outPrefix)} + safeName + '.txt')
            def lines = []
            try { main.compileClasspath.files.each { lines << it.absolutePath } } catch (ignored) {}
            try { main.output.classesDirs.files.each { lines << it.absolutePath } } catch (ignored) {}
            out.text = lines.join(System.lineSeparator())
          }
        }
      }
    }
  }
}
`;

  try {
    fs.writeFileSync(initFile, initScript, 'utf8');
  } catch (e) {
    callback(e);
    return;
  }

  const args = ['-q', '--init-script', initFile, 'helperIdePrintClasspath'];
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

// ---------------------------------------------------------------------------
// Índice por projeto (cache em memória, invalidado por mtime do arquivo de build)
// ---------------------------------------------------------------------------

// key (rootDir|type) -> { status, buildFileMtime, allClasses, knownPackages, simpleNameIndex, error, lastAttemptAt }
const projectCache = new Map();

function buildIndexFromClasspathEntries(entries, moduleDir, entry) {
  entry.classpathEntries = entries.filter((p) => p.toLowerCase().endsWith('.jar'));

  // Processa em lotes pra não travar o event loop com muitos jars grandes
  const items = [...entries];
  let idx = 0;

  function processBatch() {
    const BATCH = 8;
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
      } catch (_) {
        // entrada do classpath não existe mais / inacessível — ignora
      }
    }

    if (idx < items.length) {
      setImmediate(processBatch);
    } else {
      indexProjectSources(moduleDir, entry.allClasses, entry.knownPackages, entry.simpleNameIndex);
      entry.status = 'ready';
    }
  }

  processBatch();
}

function buildClasspathIndexAsync(found, entry) {
  const resolve = found.type === 'maven' ? resolveClasspathMaven : resolveClasspathGradle;
  resolve(found.rootDir, (err, cpEntries) => {
    if (err) {
      entry.status = 'error';
      entry.error = err.code === 'ENOENT'
        ? `Comando de build não encontrado (${found.type === 'maven' ? 'mvn/mvnw' : 'gradle/gradlew'})`
        : err.message;
      console.warn(`[javaImportChecker] Falha ao resolver classpath (${found.type}) em ${found.rootDir}:`, entry.error);
      return;
    }
    buildIndexFromClasspathEntries(cpEntries, found.moduleDir, entry);
  });
}

function getOrBuildProjectIndex(filePath) {
  const found = findJavaProjectRoot(filePath);
  if (!found) return null;

  const key = normalizePath(found.rootDir) + '|' + found.type;
  const mtime = safeMtimeMs(found.buildFile);
  const existing = projectCache.get(key);

  if (existing && existing.buildFileMtime === mtime) {
    return existing;
  }
  if (existing && existing.status === 'building' && (Date.now() - existing.lastAttemptAt) < BUILD_FILE_POLL_MS) {
    return existing; // já está resolvendo, evita disparar de novo a cada keystroke
  }

  const entry = {
    status: 'building',
    buildFileMtime: mtime,
    allClasses: new Set(),
    knownPackages: new Set(),
    simpleNameIndex: new Map(),
    classSource: new Map(),
    classpathEntries: [],
    error: null,
    lastAttemptAt: Date.now(),
  };
  projectCache.set(key, entry);
  buildClasspathIndexAsync(found, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// Sugestão por distância de edição (Levenshtein) — igual ao "did you mean" do IntelliJ
// ---------------------------------------------------------------------------

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function suggestForSimpleName(simpleName, simpleNameIndex, limit = 5) {
  const target = simpleName.toLowerCase();
  const candidates = [];
  for (const [name, fqns] of simpleNameIndex.entries()) {
    if (Math.abs(name.length - simpleName.length) > 3) continue;
    const dist = levenshtein(target, name.toLowerCase());
    if (dist <= 2) {
      for (const fqn of fqns) candidates.push({ fqn, dist });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const out = [];
  const seen = new Set();
  for (const c of candidates) {
    if (seen.has(c.fqn)) continue;
    seen.add(c.fqn);
    out.push(c.fqn);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

function isSupported(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.java');
}

function collectImports(content) {
  const lines = content.split(/\r?\n/);
  const imports = [];
  const IMPORT_RE = /^(\s*import\s+(?:static\s+)?)([\w.]+)(\.\*)?\s*;/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(IMPORT_RE);
    if (!m) continue;
    const isStatic = /\bstatic\b/.test(m[1]);
    const fqn = m[2];
    const isWildcard = !!m[3];
    const startCh = m[1].length;
    imports.push({ line: i + 1, isStatic, fqn, isWildcard, startCh, endCh: startCh + fqn.length });
  }
  return imports;
}

/**
 * Diagnósticos de import não resolvido pro arquivo .java (conteúdo do editor,
 * pode ter alterações não salvas). Retorna [] enquanto o classpath ainda está
 * sendo resolvido (evita sublinhar tudo de vermelho até o mvn/gradle terminar)
 * ou se o projeto não é Maven/Gradle reconhecível.
 */
function getDiagnostics(filePath, content) {
  if (!isSupported(filePath)) return [];
  let proj;
  try {
    proj = getOrBuildProjectIndex(filePath);
  } catch (e) {
    console.warn('[javaImportChecker] Erro ao preparar índice de projeto:', e.message);
    return [];
  }
  if (!proj || proj.status !== 'ready') return [];

  const diagnostics = [];
  for (const imp of collectImports(content)) {
    if (JDK_ALWAYS_OK_PREFIXES.some((p) => imp.fqn.startsWith(p))) continue;

    let classFqn = imp.fqn;
    if (imp.isStatic && !imp.isWildcard) {
      const idx = imp.fqn.lastIndexOf('.');
      if (idx === -1) continue;
      classFqn = imp.fqn.slice(0, idx);
    }

    const resolved = imp.isWildcard
      ? proj.knownPackages.has(classFqn) || proj.allClasses.has(classFqn)
      : proj.allClasses.has(classFqn);

    if (!resolved) {
      const simpleName = classFqn.split('.').pop();
      const suggestions = imp.isWildcard ? [] : suggestForSimpleName(simpleName, proj.simpleNameIndex);
      diagnostics.push({
        code: 'java-unresolved-import',
        message: imp.isWildcard
          ? `Pacote não encontrado no classpath: ${classFqn}.*`
          : `Não foi possível resolver o import: ${imp.fqn}`,
        severity: 'error',
        line: imp.line,
        col: imp.startCh + 1,
        endLine: imp.line,
        endCol: imp.endCh + 1,
        suggestions,
      });
    }
  }
  return diagnostics;
}

// ---------------------------------------------------------------------------
// "Ir para dentro da dependência" — resolve o import clicado pra um jar do
// classpath, e dá acesso ao código-fonte (.java) de dentro dele, igual ao
// IntelliJ abrir uma classe de "External Libraries".
// ---------------------------------------------------------------------------

// Caminho virtual usado como "filePath" nas abas do editor pra uma classe
// dentro de um jar: <jar>!<pacote/Classe>.java — nunca existe no disco de
// verdade, é interceptado em read-file-content (main/ipc/workspace.js).
function encodeVirtualPath(jarPath, fqcn) {
  return String(jarPath).replace(/\\/g, '/') + '!' + fqcn.replace(/\./g, '/') + '.java';
}

function parseVirtualPath(vpath) {
  const norm = String(vpath).replace(/\\/g, '/');
  const m = /^(.*\.jar)!(.+)\.java$/.exec(norm);
  if (!m) return null;
  return { jarPath: m[1], fqcn: m[2].replace(/\//g, '.') };
}

function isVirtualPath(vpath) {
  return typeof vpath === 'string' && /\.jar!.+\.java$/.test(vpath.replace(/\\/g, '/'));
}

// Dado o clique num símbolo (linha do import, ou uso do símbolo em outro
// lugar do arquivo — nesse caso precisa do conteúdo pra achar o import
// correspondente), acha se ele resolve pra uma classe vinda de um jar do
// classpath (e não do código-fonte do próprio projeto, que o symbolIndexer
// já resolve sozinho).
function resolveSymbolToJar(filePath, symbol, lineText, content) {
  if (!isSupported(filePath) || !symbol) return null;
  let proj;
  try {
    proj = getOrBuildProjectIndex(filePath);
  } catch (_) {
    return null;
  }
  if (!proj || proj.status !== 'ready') return null;

  let fqn = null;
  const impMatch = lineText && lineText.match(/^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/);
  if (impMatch && !impMatch[2] && impMatch[1].split('.').pop() === symbol) {
    fqn = impMatch[1];
  } else if (content) {
    const found = collectImports(content).find((i) => !i.isWildcard && i.fqn.split('.').pop() === symbol);
    if (found) fqn = found.fqn;
  }
  if (!fqn) return null;

  const jarPath = proj.classSource.get(fqn);
  if (!jarPath || !jarPath.toLowerCase().endsWith('.jar')) return null; // veio de diretório de classes, não de jar — sem source pra mostrar
  return { fqn, jarPath };
}

// Deriva groupId:artifactId:version a partir do layout padrão do repositório
// local do Maven (~/.m2/repository/<grupo/.../artefato/versão/artefato-versão.jar>).
// Só funciona se o jar realmente veio de lá (é o caso comum).
function mavenCoordsFromJarPath(jarPath) {
  const norm = String(jarPath).replace(/\\/g, '/');
  const idx = norm.toLowerCase().indexOf('/repository/');
  if (idx === -1) return null;
  const rel = norm.slice(idx + '/repository/'.length);
  const parts = rel.split('/');
  if (parts.length < 4) return null;
  const fileName = parts[parts.length - 1];
  const version = parts[parts.length - 2];
  const artifactId = parts[parts.length - 3];
  const groupId = parts.slice(0, parts.length - 3).join('.');
  if (!groupId || !fileName.startsWith(`${artifactId}-${version}`)) return null;
  return { groupId, artifactId, version };
}

// Baixa o "-sources.jar" pro repositório local via `mvn dependency:get`
// (não altera o pom do projeto — só popula o cache local do Maven, igual o
// IntelliJ faz quando você clica numa dependência sem source baixado ainda).
function downloadMavenSourcesJar(coords) {
  const cmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const artifact = `${coords.groupId}:${coords.artifactId}:${coords.version}:jar:sources`;
  try {
    execFileSync(cmd, ['-q', '-B', 'dependency:get', `-Dartifact=${artifact}`], {
      cwd: os.tmpdir(),
      timeout: 30000,
      shell: true,
      stdio: 'ignore',
    });
    return true;
  } catch (_) {
    return false;
  }
}

// Conteúdo .java de uma classe de dependência. Tenta o "-sources.jar" irmão
// do jar binário no repositório local; se não existir, tenta baixar (só
// Maven — Gradle usa outro layout de cache e ficaria fora do escopo aqui).
function getClassSource(jarPath, fqcn) {
  const rel = fqcn.replace(/\./g, '/') + '.java';
  const sourcesJar = jarPath.replace(/\.jar$/i, '-sources.jar');

  if (fs.existsSync(sourcesJar)) {
    const content = readZipEntryContent(sourcesJar, rel);
    if (content != null) return { available: true, content };
  }

  const coords = mavenCoordsFromJarPath(jarPath);
  if (coords && downloadMavenSourcesJar(coords) && fs.existsSync(sourcesJar)) {
    const content = readZipEntryContent(sourcesJar, rel);
    if (content != null) return { available: true, content };
  }

  return { available: false, reason: 'Sem código-fonte disponível para esta dependência (sources jar não encontrado nem baixável).' };
}

// Lista os jars do classpath resolvido de um projeto Java (Maven/Gradle),
// dada a pasta do projeto (não um arquivo) — usado pelo nó "Dependencies" da
// árvore de arquivos. `status` pode ser 'building' enquanto mvn/gradle roda.
function listDependencyJars(dirPath) {
  const proj = getOrBuildProjectIndex(path.join(dirPath, '__helper_ide_dep_probe__.java'));
  if (!proj) return { status: 'unsupported' };
  if (proj.status !== 'ready') return { status: proj.status, error: proj.error };
  const jars = (proj.classpathEntries || []).map((p) => ({ path: p, name: path.basename(p) }));
  jars.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { status: 'ready', jars };
}

// Lista as classes (FQN) dentro de um jar — filhos do nó do jar na árvore.
function listJarClasses(jarPath) {
  const fqns = new Set();
  for (const entryName of readZipClassEntries(jarPath)) {
    if (!entryName.endsWith('.class')) continue;
    const dotted = entryName.slice(0, -6).replace(/\//g, '.');
    if (/\$\d/.test(dotted)) continue; // classes anônimas/sintéticas (Foo$1) não interessam na navegação
    fqns.add(dotted.replace(/\$/g, '.'));
  }
  return Array.from(fqns).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Status da resolução de classpath pro arquivo (pra UI mostrar "indexando..." se quiser)
function getStatus(filePath) {
  const found = findJavaProjectRoot(filePath);
  if (!found) return { recognized: false };
  const key = normalizePath(found.rootDir) + '|' + found.type;
  const entry = projectCache.get(key);
  return {
    recognized: true,
    type: found.type,
    rootDir: found.rootDir,
    status: entry ? entry.status : 'idle',
    error: entry ? entry.error : null,
  };
}

function reset() {
  projectCache.clear();
}

module.exports = {
  isSupported,
  getDiagnostics,
  getStatus,
  reset,
  resolveSymbolToJar,
  encodeVirtualPath,
  parseVirtualPath,
  isVirtualPath,
  getClassSource,
  listDependencyJars,
  listJarClasses,
};
