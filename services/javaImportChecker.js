// services/javaImportChecker.js
// Checador de imports para Java (Maven e Gradle) no modo IDE, igual ao IntelliJ:
// sublinha import que não existe no classpath e sugere a classe mais parecida.
//
// Suporta Maven e Gradle 9, Java 21 a Java 26, descompilação de .class (quando sem -sources.jar),
// busca de sources no cache do Gradle e persistência de índice em disco para abertura instantânea.

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
const BUILD_FILE_POLL_MS = 4000;

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
// Cache em Disco (Persistência para Abertura Instantânea sem Re-indexar)
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(os.homedir(), '.config', 'helper-node', 'cache');
const DISK_CACHE_FILE = path.join(CACHE_DIR, 'java-deps-cache.json');

// jarPath|mtime -> Array<classEntryNames>
const jarClassCache = new Map();
// projKey -> diskEntry
const projectCacheDisk = new Map();

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

// Carrega o cache do disco logo na inicialização
loadDiskCache();

// ---------------------------------------------------------------------------
// Detecção de projeto Maven/Gradle
// ---------------------------------------------------------------------------

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
    return { type: 'gradle', rootDir: moduleDir, moduleDir, buildFile };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Leitor de entradas ZIP (com cache por mtime do JAR)
// ---------------------------------------------------------------------------

function readZipClassEntries(jarPath) {
  const mtime = safeMtimeMs(jarPath);
  const cacheKey = jarPath + '|' + mtime;
  if (jarClassCache.has(cacheKey)) {
    return jarClassCache.get(cacheKey);
  }

  const results = [];
  let fd;
  try {
    fd = fs.openSync(jarPath, 'r');
    const size = fs.fstatSync(fd).size;
    if (size < 22) return results;

    const tailSize = Math.min(size, 65557);
    const tailBuf = Buffer.alloc(tailSize);
    fs.readSync(fd, tailBuf, 0, tailSize, size - tailSize);

    let eocdOffset = -1;
    for (let i = tailBuf.length - 22; i >= 0; i--) {
      if (tailBuf.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) return results;

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
      if (name.endsWith('.class')) {
        if (name.startsWith('META-INF/versions/')) {
          const m = /^META-INF\/versions\/\d+\/(.+)$/.exec(name);
          if (m && !m[1].startsWith('META-INF/')) results.push(m[1]);
        } else if (!name.startsWith('META-INF/')) {
          results.push(name);
        }
      }
      pos = nameStart + nameLen + extraLen + commentLen;
      count++;
    }
  } catch (_) {
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }

  jarClassCache.set(cacheKey, results);
  return results;
}

function readZipEntryRawBuffer(zipPath, entryName) {
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
      if (name === entryName || name.endsWith('/' + entryName)) {
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

    if (compMethod === 0) return dataBuf;
    if (compMethod === 8) return zlib.inflateRawSync(dataBuf);
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function readZipEntryContent(zipPath, entryName) {
  const buf = readZipEntryRawBuffer(zipPath, entryName);
  return buf ? buf.toString('utf8') : null;
}

// ---------------------------------------------------------------------------
// Descompilador Bytecode Java (.class) — Gera Modelo/Propriedades quando sem source
// ---------------------------------------------------------------------------

function parseJavaTypeDescriptor(desc) {
  if (!desc) return 'void';
  if (desc === 'V') return 'void';
  if (desc === 'Z') return 'boolean';
  if (desc === 'B') return 'byte';
  if (desc === 'C') return 'char';
  if (desc === 'S') return 'short';
  if (desc === 'I') return 'int';
  if (desc === 'J') return 'long';
  if (desc === 'F') return 'float';
  if (desc === 'D') return 'double';
  if (desc.startsWith('[')) return parseJavaTypeDescriptor(desc.slice(1)) + '[]';
  if (desc.startsWith('L') && desc.endsWith(';')) {
    let raw = desc.slice(1, -1).replace(/\//g, '.');
    if (raw.startsWith('java.lang.')) raw = raw.slice(10);
    return raw;
  }
  return desc.replace(/\//g, '.');
}

function parseMethodDescriptor(desc) {
  if (!desc || !desc.startsWith('(')) return { params: [], returnType: 'void' };
  const closingParen = desc.indexOf(')');
  if (closingParen === -1) return { params: [], returnType: 'void' };
  const paramStr = desc.slice(1, closingParen);
  const retStr = desc.slice(closingParen + 1);
  const params = [];
  let pos = 0;
  while (pos < paramStr.length) {
    let dims = '';
    while (paramStr[pos] === '[') { dims += '[]'; pos++; }
    const ch = paramStr[pos];
    if (['Z','B','C','S','I','J','F','D'].includes(ch)) {
      params.push(parseJavaTypeDescriptor(ch) + dims);
      pos++;
    } else if (ch === 'L') {
      const end = paramStr.indexOf(';', pos);
      if (end === -1) break;
      params.push(parseJavaTypeDescriptor(paramStr.slice(pos, end + 1)) + dims);
      pos = end + 1;
    } else {
      pos++;
    }
  }
  return { params, returnType: parseJavaTypeDescriptor(retStr) };
}

function decompileClassFile(buf, jarPath, fqcn) {
  try {
    if (!buf || buf.length < 10) return null;
    if (buf.readUInt32BE(0) !== 0xCAFEBABE) return null;

    const minorVer = buf.readUInt16BE(4);
    const majorVer = buf.readUInt16BE(6);

    const cpCount = buf.readUInt16BE(8);
    const cp = new Array(cpCount);
    let offset = 10;

    for (let i = 1; i < cpCount; i++) {
      const tag = buf[offset++];
      if (tag === 1) {
        const len = buf.readUInt16BE(offset); offset += 2;
        cp[i] = { tag: 1, val: buf.toString('utf8', offset, offset + len) };
        offset += len;
      } else if (tag === 3 || tag === 4) {
        offset += 4;
      } else if (tag === 5 || tag === 6) {
        offset += 8;
        i++;
      } else if (tag === 7) {
        const nameIdx = buf.readUInt16BE(offset); offset += 2;
        cp[i] = { tag: 7, nameIdx };
      } else if (tag === 8) {
        offset += 2;
      } else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) {
        offset += 4;
      } else if (tag === 15) {
        offset += 3;
      } else if (tag === 16 || tag === 19 || tag === 20) {
        offset += 2;
      } else {
        break;
      }
    }

    if (offset + 6 > buf.length) return null;

    const getUtf8 = (idx) => (cp[idx] && cp[idx].tag === 1) ? cp[idx].val : '';
    const getClassName = (idx) => (cp[idx] && cp[idx].tag === 7) ? getUtf8(cp[idx].nameIdx).replace(/\//g, '.') : '';

    const accessFlags = buf.readUInt16BE(offset); offset += 2;
    const thisClassIdx = buf.readUInt16BE(offset); offset += 2;
    const superClassIdx = buf.readUInt16BE(offset); offset += 2;

    const thisClassName = getClassName(thisClassIdx) || fqcn;
    const superClassName = getClassName(superClassIdx);

    const interfacesCount = buf.readUInt16BE(offset); offset += 2;
    const interfaces = [];
    for (let i = 0; i < interfacesCount; i++) {
      const ifaceIdx = buf.readUInt16BE(offset); offset += 2;
      interfaces.push(getClassName(ifaceIdx));
    }

    const isInterface = (accessFlags & 0x0200) !== 0;
    const isAnnotation = (accessFlags & 0x2000) !== 0;
    const isEnum = (accessFlags & 0x4000) !== 0;
    const isRecord = superClassName === 'java.lang.Record';
    const isAbstract = (accessFlags & 0x0400) !== 0;
    const isFinal = (accessFlags & 0x0010) !== 0;

    let classKind = 'class';
    if (isRecord) classKind = 'record';
    else if (isAnnotation) classKind = '@interface';
    else if (isInterface) classKind = 'interface';
    else if (isEnum) classKind = 'enum';

    const fieldsCount = buf.readUInt16BE(offset); offset += 2;
    const fields = [];
    for (let i = 0; i < fieldsCount; i++) {
      if (offset + 8 > buf.length) break;
      const fFlags = buf.readUInt16BE(offset); offset += 2;
      const fNameIdx = buf.readUInt16BE(offset); offset += 2;
      const fDescIdx = buf.readUInt16BE(offset); offset += 2;
      const fAttrCount = buf.readUInt16BE(offset); offset += 2;

      for (let a = 0; a < fAttrCount; a++) {
        if (offset + 6 > buf.length) break;
        const attrLen = buf.readUInt32BE(offset + 2);
        offset += 6 + attrLen;
      }

      const fName = getUtf8(fNameIdx);
      const fDesc = getUtf8(fDescIdx);
      if (fName && !fName.includes('$')) {
        fields.push({ flags: fFlags, name: fName, type: parseJavaTypeDescriptor(fDesc) });
      }
    }

    const methodsCount = buf.readUInt16BE(offset); offset += 2;
    const methods = [];
    for (let i = 0; i < methodsCount; i++) {
      if (offset + 8 > buf.length) break;
      const mFlags = buf.readUInt16BE(offset); offset += 2;
      const mNameIdx = buf.readUInt16BE(offset); offset += 2;
      const mDescIdx = buf.readUInt16BE(offset); offset += 2;
      const mAttrCount = buf.readUInt16BE(offset); offset += 2;

      for (let a = 0; a < mAttrCount; a++) {
        if (offset + 6 > buf.length) break;
        const attrLen = buf.readUInt32BE(offset + 2);
        offset += 6 + attrLen;
      }

      const mName = getUtf8(mNameIdx);
      const mDesc = getUtf8(mDescIdx);
      if (mName && mName !== '<clinit>' && !mName.includes('$')) {
        methods.push({ flags: mFlags, name: mName, parsed: parseMethodDescriptor(mDesc) });
      }
    }

    const jarFileName = path.basename(jarPath);
    const parts = thisClassName.split('.');
    const simpleName = parts.pop();
    const pkgName = parts.join('.');

    let code = `// Decompiled from: ${jarFileName}!${thisClassName.replace(/\./g, '/')}.class\n`;
    code += `// (Class file format version ${majorVer}.${minorVer})\n\n`;
    if (pkgName) code += `package ${pkgName};\n\n`;

    if (isRecord) {
      const recordParams = fields.map(f => `${f.type} ${f.name}`).join(', ');
      code += `public record ${simpleName}(${recordParams}) {\n\n`;
    } else {
      let decl = 'public ';
      if (isAbstract && classKind === 'class') decl += 'abstract ';
      if (isFinal && classKind === 'class') decl += 'final ';
      decl += `${classKind} ${simpleName}`;

      if (superClassName && superClassName !== 'java.lang.Object' && superClassName !== 'java.lang.Enum' && classKind === 'class') {
        decl += ` extends ${superClassName}`;
      }
      if (interfaces.length > 0 && classKind !== '@interface') {
        decl += ` implements ${interfaces.join(', ')}`;
      }
      decl += ' {\n\n';
      code += decl;
    }

    if (isEnum) {
      const enumConstants = fields.filter(f => (f.flags & 0x4000) !== 0 || ((f.flags & 0x0008) !== 0 && f.type === simpleName));
      if (enumConstants.length > 0) {
        code += `    ${enumConstants.map(c => c.name).join(', ')};\n\n`;
      }
    }

    if (!isRecord) {
      const normalFields = isEnum ? fields.filter(f => (f.flags & 0x4000) === 0 && f.type !== simpleName) : fields;
      for (const f of normalFields) {
        let fVisibility = 'private ';
        if ((f.flags & 0x0001) !== 0) fVisibility = 'public ';
        else if ((f.flags & 0x0004) !== 0) fVisibility = 'protected ';
        let fMod = '';
        if ((f.flags & 0x0008) !== 0) fMod += 'static ';
        if ((f.flags & 0x0010) !== 0) fMod += 'final ';
        code += `    ${fVisibility}${fMod}${f.type} ${f.name};\n`;
      }
      if (normalFields.length > 0) code += '\n';
    }

    for (const f of fields) {
      let fVisibility = 'private ';
      if ((f.flags & 0x0001) !== 0) fVisibility = 'public ';
      else if ((f.flags & 0x0004) !== 0) fVisibility = 'protected ';
      let fMod = '';
      if ((f.flags & 0x0008) !== 0) fMod += 'static ';
      if ((f.flags & 0x0010) !== 0) fMod += 'final ';
      code += `    ${fVisibility}${fMod}${f.type} ${f.name};\n`;
    }
    if (fields.length > 0) code += '\n';

    for (const m of methods) {
      let mVisibility = 'public ';
      if ((m.flags & 0x0002) !== 0) mVisibility = 'private ';
      else if ((m.flags & 0x0004) !== 0) mVisibility = 'protected ';
      let mMod = '';
      if ((m.flags & 0x0008) !== 0) mMod += 'static ';
      if ((m.flags & 0x0010) !== 0) mMod += 'final ';
      if ((m.flags & 0x0400) !== 0 && classKind === 'class') mMod += 'abstract ';

      const paramList = m.parsed.params.map((p, idx) => `${p} arg${idx}`).join(', ');
      if (m.name === '<init>') {
        code += `    ${mVisibility}${simpleName}(${paramList}) { /* compiled code */ }\n`;
      } else {
        if (classKind === 'interface' || classKind === '@interface' || (m.flags & 0x0400) !== 0) {
          code += `    ${mVisibility}${mMod}${m.parsed.returnType} ${m.name}(${paramList});\n`;
        } else {
          code += `    ${mVisibility}${mMod}${m.parsed.returnType} ${m.name}(${paramList}) { /* compiled code */ }\n`;
        }
      }
    }

    code += '}\n';
    return code;
  } catch (err) {
    return null;
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

// ---------------------------------------------------------------------------
// Resolução do Classpath (Maven / Gradle 9) — Assíncrona
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

  const initScript = `
allprojects { proj ->
  def registerAction = {
    def sourceSetsExt = proj.extensions.findByName('sourceSets')
    if (sourceSetsExt != null && proj.tasks.findByName('helperIdePrintClasspath') == null) {
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
// Índice por projeto (Cache em memória + Persistência em Disco)
// ---------------------------------------------------------------------------

const projectCache = new Map();

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

function notifyJavaDepsChanged(rootDir, status) {
  try {
    const { state } = require('../main/globals.js');
    if (state && state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send('java-deps-changed', { rootDir, status });
    }
  } catch (_) {}
}

function buildClasspathIndexAsync(found, entry, key) {
  const resolve = found.type === 'maven' ? resolveClasspathMaven : resolveClasspathGradle;
  resolve(found.rootDir, (err, cpEntries) => {
    if (err) {
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
      existing.status = 'error';
      existing.error = 'Timeout ao resolver classpath (mais de 2min)';
      notifyJavaDepsChanged(found.rootDir, 'error');
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
  buildClasspathIndexAsync(found, entry, key);
  return entry;
}

// ---------------------------------------------------------------------------
// Sugestão por distância de edição (Levenshtein)
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
// Navegação para Dependências (Sources Jar + Cache Gradle + Descompilador)
// ---------------------------------------------------------------------------

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

function findSymbolLineInClassSource(content, symbol) {
  if (!content || !symbol) return 1;
  const lines = content.split(/\r?\n/);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Definição de método em Java / classe descompilada
  const methodRegex = new RegExp(`(?:public|protected|private|static|final|async|synchronized|default|native|abstract|\\s)+\\b${escaped}\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    if (methodRegex.test(lines[i])) return i + 1;
  }

  // 2. Campo ou constante enum
  const fieldRegex = new RegExp(`\\b${escaped}\\b\\s*(?:[;=,)]|$)`);
  for (let i = 0; i < lines.length; i++) {
    if (fieldRegex.test(lines[i])) return i + 1;
  }

  // 3. Primeira Ocorrência do identificador
  const wordRegex = new RegExp(`\\b${escaped}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (wordRegex.test(lines[i])) return i + 1;
  }

  return 1;
}

function resolveClassFqn(proj, className, lineText, content) {
  if (!proj || !className) return null;
  let fqn = null;

  // 1. Import explícito na própria linha
  const impMatch = lineText && lineText.match(/^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/);
  if (impMatch && !impMatch[2] && impMatch[1].split('.').pop() === className) {
    fqn = impMatch[1];
  }

  // 2. Direct & wildcard imports no arquivo
  if (!fqn && content) {
    const imports = collectImports(content);
    const foundDirect = imports.find((i) => !i.isWildcard && i.fqn.split('.').pop() === className);
    if (foundDirect) {
      fqn = foundDirect.fqn;
    } else {
      const wildcards = imports.filter((i) => i.isWildcard);
      for (const w of wildcards) {
        const candidate = `${w.fqn}.${className}`;
        if (proj.allClasses.has(candidate) && proj.classSource.has(candidate)) {
          fqn = candidate;
          break;
        }
      }
    }
  }

  // 3. Mesmo pacote
  if (!fqn && content) {
    const pkgMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(content);
    if (pkgMatch) {
      const samePkgCandidate = `${pkgMatch[1]}.${className}`;
      if (proj.allClasses.has(samePkgCandidate) && proj.classSource.has(samePkgCandidate)) {
        fqn = samePkgCandidate;
      }
    }
  }

  // 4. Busca por nome simples no índice de dependências (simpleNameIndex)
  if (!fqn && proj.simpleNameIndex && proj.simpleNameIndex.has(className)) {
    const candidates = Array.from(proj.simpleNameIndex.get(className));
    for (const cand of candidates) {
      if (proj.classSource.has(cand)) {
        fqn = cand;
        break;
      }
    }
  }

  if (!fqn) return null;

  const jarPath = proj.classSource.get(fqn);
  if (!jarPath || !jarPath.toLowerCase().endsWith('.jar')) return null;
  return { fqn, jarPath };
}

function resolveSymbolToJar(filePath, symbol, lineText, content) {
  if (!isSupported(filePath) || !symbol) return null;
  let proj;
  try {
    proj = getOrBuildProjectIndex(filePath);
  } catch (_) {
    return null;
  }
  if (!proj || proj.status !== 'ready') return null;

  // A. Primeiro tenta resolver `symbol` diretamente como uma Classe
  const classRes = resolveClassFqn(proj, symbol, lineText, content);
  if (classRes) {
    return {
      fqn: classRes.fqn,
      jarPath: classRes.jarPath,
      targetLine: 1,
      className: symbol,
      isMethod: false,
    };
  }

  const escapedSym = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // B. Método/Campo estático chamado com receptor de Classe ou Variável: `Receptor.symbol(...)`
  if (lineText) {
    const mRec = lineText.match(new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\.\\s*${escapedSym}\\b`));
    if (mRec && mRec[1] && mRec[1] !== 'this' && mRec[1] !== 'super') {
      const receptor = mRec[1];
      let targetClassName = null;

      if (/^[A-Z]/.test(receptor)) {
        // Receptor com inicial maiúscula (chamada estática tipo StringUtils.isBlank)
        targetClassName = receptor;
      } else if (content) {
        // Receptor com inicial minúscula (variável local, ex: `userDto.getId()`)
        const mType = content.match(new RegExp(`([A-Z][A-Za-z0-9_$]*)(?:<[^>]*>)?\\s+${receptor}\\b`));
        if (mType) targetClassName = mType[1];
      }

      if (targetClassName) {
        const recRes = resolveClassFqn(proj, targetClassName, lineText, content);
        if (recRes) {
          const src = getClassSource(recRes.jarPath, recRes.fqn);
          const targetLine = src && src.available ? findSymbolLineInClassSource(src.content, symbol) : 1;
          return {
            fqn: recRes.fqn,
            jarPath: recRes.jarPath,
            targetLine,
            className: targetClassName,
            isMethod: true,
          };
        }
      }
    }
  }

  // C. Import estático explícito no arquivo: `import static com.acme.Utils.myMethod;` ou wildcard `import static com.acme.Utils.*;`
  if (content) {
    const staticImports = [];
    const RE_STATIC = /^\s*import\s+static\s+([\w.]+)(\.\*)?\s*;/gm;
    let m;
    while ((m = RE_STATIC.exec(content)) !== null) {
      staticImports.push({ fqn: m[1], isWildcard: Boolean(m[2]) });
    }

    // 1. Direct static import: `import static com.acme.Utils.symbol;`
    const foundDirectStatic = staticImports.find((i) => !i.isWildcard && i.fqn.split('.').pop() === symbol);
    if (foundDirectStatic) {
      const parts = foundDirectStatic.fqn.split('.');
      parts.pop(); // Remove o nome do método/campo
      const classFqn = parts.join('.');
      const className = classFqn.split('.').pop();
      if (proj.classSource.has(classFqn)) {
        const jarPath = proj.classSource.get(classFqn);
        if (jarPath && jarPath.toLowerCase().endsWith('.jar')) {
          const src = getClassSource(jarPath, classFqn);
          const targetLine = src && src.available ? findSymbolLineInClassSource(src.content, symbol) : 1;
          return { fqn: classFqn, jarPath, targetLine, className, isMethod: true };
        }
      }
    }

    // 2. Wildcard static import: `import static com.acme.Utils.*;`
    const wildcardStatics = staticImports.filter((i) => i.isWildcard);
    for (const ws of wildcardStatics) {
      const classFqn = ws.fqn;
      if (proj.classSource.has(classFqn)) {
        const jarPath = proj.classSource.get(classFqn);
        if (jarPath && jarPath.toLowerCase().endsWith('.jar')) {
          const src = getClassSource(jarPath, classFqn);
          if (src && src.available && new RegExp(`\\b${escapedSym}\\b`).test(src.content)) {
            const targetLine = findSymbolLineInClassSource(src.content, symbol);
            return { fqn: classFqn, jarPath, targetLine, className: classFqn.split('.').pop(), isMethod: true };
          }
        }
      }
    }
  }

  return null;
}

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

function downloadMavenSourcesJar(coords) {
  const cmd = process.platform === 'win32' ? 'mvn.cmd' : 'mvn';
  const artifact = `${coords.groupId}:${coords.artifactId}:${coords.version}:jar:sources`;
  try {
    execFileSync(cmd, ['-q', '-B', 'dependency:get', `-Dartifact=${artifact}`], {
      cwd: os.tmpdir(),
      timeout: 10000,
      shell: true,
      stdio: 'ignore',
    });
    return true;
  } catch (_) {
    return false;
  }
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

function getClassSource(jarPath, fqcn) {
  const relJava = fqcn.replace(/\./g, '/') + '.java';

  const mavenSourcesJar = jarPath.replace(/\.jar$/i, '-sources.jar');
  if (fs.existsSync(mavenSourcesJar)) {
    const content = readZipEntryContent(mavenSourcesJar, relJava);
    if (content != null) return { available: true, content };
  }

  const gradleSourcesJar = findGradleSourcesJar(jarPath);
  if (gradleSourcesJar && fs.existsSync(gradleSourcesJar)) {
    const content = readZipEntryContent(gradleSourcesJar, relJava);
    if (content != null) return { available: true, content };
  }

  const coords = mavenCoordsFromJarPath(jarPath);
  if (coords && downloadMavenSourcesJar(coords) && fs.existsSync(mavenSourcesJar)) {
    const content = readZipEntryContent(mavenSourcesJar, relJava);
    if (content != null) return { available: true, content };
  }

  const relClass = fqcn.replace(/\./g, '/') + '.class';
  const classBuf = readZipEntryRawBuffer(jarPath, relClass);
  if (classBuf) {
    const decompiled = decompileClassFile(classBuf, jarPath, fqcn);
    if (decompiled) return { available: true, content: decompiled };
  }

  return { available: false, reason: 'Sem código-fonte disponível para esta dependência.' };
}

function listDependencyJars(dirPath) {
  const proj = getOrBuildProjectIndex(path.join(dirPath, '__helper_ide_dep_probe__.java'));
  if (!proj) return { status: 'unsupported' };
  if (proj.status !== 'ready') return { status: proj.status, error: proj.error };
  const jars = (proj.classpathEntries || []).map((p) => ({ path: p, name: path.basename(p) }));
  jars.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { status: 'ready', jars };
}

function listJarClasses(jarPath) {
  const fqns = new Set();
  for (const entryName of readZipClassEntries(jarPath)) {
    if (!entryName.endsWith('.class')) continue;
    const dotted = entryName.slice(0, -6).replace(/\//g, '.');
    if (/\$\d/.test(dotted)) continue;
    fqns.add(dotted.replace(/\$/g, '.'));
  }
  return Array.from(fqns).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

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

// ---------------------------------------------------------------------------
// Checagem de Imports
// ---------------------------------------------------------------------------

function isSupported(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.java');
}

function collectImports(content) {
  const lines = content.split(/\r?\n/);
  const imports = [];
  const RE = /^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/;
  for (let i = 0; i < lines.length; i++) {
    const m = RE.exec(lines[i]);
    if (m) {
      const fqn = m[1];
      const isWildcard = Boolean(m[2]);
      imports.push({ line: i + 1, fqn, isWildcard, raw: m[0] });
    }
  }
  return imports;
}

function getDiagnostics(filePath, content) {
  if (!isSupported(filePath) || typeof content !== 'string') return [];
  const proj = getOrBuildProjectIndex(filePath);
  if (!proj || proj.status !== 'ready') return [];

  const imports = collectImports(content);
  const diagnostics = [];

  for (const imp of imports) {
    if (JDK_ALWAYS_OK_PREFIXES.some((p) => imp.fqn.startsWith(p))) continue;
    if (imp.isWildcard) {
      if (!proj.knownPackages.has(imp.fqn)) {
        diagnostics.push({
          line: imp.line,
          fqn: imp.fqn,
          message: `Pacote '${imp.fqn}' não foi encontrado no classpath.`,
          suggestions: [],
        });
      }
    } else {
      if (!proj.allClasses.has(imp.fqn)) {
        const simpleName = imp.fqn.split('.').pop();
        const suggestions = suggestForSimpleName(simpleName, proj.simpleNameIndex);
        diagnostics.push({
          line: imp.line,
          fqn: imp.fqn,
          message: `Não foi possível resolver o import '${imp.fqn}'.`,
          suggestions,
        });
      }
    }
  }

  return diagnostics;
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
