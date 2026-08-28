// services/java/javaSourceFinder.js
// Localizador de arquivos de código-fonte Java do projeto e detecção de linhas de símbolos.

const fs = require('fs');
const path = require('path');

function scanDirForFile(dir, targetFileName, maxDepth = 6) {
  if (maxDepth < 0 || !dir || !fs.existsSync(dir)) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === targetFileName.toLowerCase()) {
        return full;
      } else if (entry.isDirectory()) {
        if (['node_modules', '.git', 'target', 'build', '.idea', '.vscode', 'bin', 'obj', '.gradle', 'dist', 'out'].includes(entry.name)) {
          continue;
        }
        const found = scanDirForFile(full, targetFileName, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch (_) {}
  return null;
}

function findSourceFileForFqn(rootDir, fqn, className, fallbackFilePath = null) {
  const simpleName = className || (fqn ? fqn.split('.').pop() : null);
  if (!simpleName) return null;

  // 1. Busca via symbolIndexer se disponível
  try {
    const symbolIndexer = require('../symbolIndexer.js');
    if (symbolIndexer && symbolIndexer.symbolMap) {
      const symList = symbolIndexer.symbolMap.get(simpleName);
      if (symList && symList.length > 0) {
        const classSym = symList.find(s => (s.kind === 'class' || s.kind === 'interface') && (!fqn || s.fqcn === fqn));
        if (classSym && classSym.filePath && fs.existsSync(classSym.filePath)) {
          return classSym.filePath;
        }
      }
    }
  } catch (_) {}

  // Determina diretório base se rootDir for nulo
  let baseDir = rootDir;
  if (!baseDir && fallbackFilePath) {
    const srcIndex = fallbackFilePath.search(/[\\/]src[\\/]/i);
    if (srcIndex !== -1) {
      baseDir = fallbackFilePath.substring(0, srcIndex);
    } else {
      baseDir = path.dirname(fallbackFilePath);
    }
  }

  if (!baseDir || !fs.existsSync(baseDir)) return null;

  // 2. Caminho direto relativo a pastas de fontes padrão
  if (fqn) {
    const relJava = fqn.replace(/\./g, path.sep) + '.java';
    const directCandidates = [
      path.join(baseDir, 'src', 'main', 'java', relJava),
      path.join(baseDir, 'src', 'test', 'java', relJava),
      path.join(baseDir, 'src', relJava),
      path.join(baseDir, relJava),
    ];
    for (const dc of directCandidates) {
      if (fs.existsSync(dc)) return dc;
    }
  }

  // 3. Varredura recursiva em pastas de fontes e submódulos
  const searchDirs = [
    path.join(baseDir, 'src', 'main', 'java'),
    path.join(baseDir, 'src', 'test', 'java'),
    path.join(baseDir, 'src'),
    baseDir
  ];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory() && !['node_modules', '.git', 'target', 'build', '.idea', 'bin', '.gradle'].includes(ent.name)) {
        const subMain = path.join(baseDir, ent.name, 'src', 'main', 'java');
        if (fs.existsSync(subMain)) searchDirs.push(subMain);
      }
    }
  } catch (_) {}

  const targetFileName = `${simpleName}.java`;
  for (const sDir of searchDirs) {
    if (fs.existsSync(sDir)) {
      const found = scanDirForFile(sDir, targetFileName, 8);
      if (found) return found;
    }
  }

  return null;
}

function findSymbolLineInClassSource(content, symbol) {
  if (!content || !symbol) return 1;
  const lines = content.split(/\r?\n/);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Definição de método em Java / classe descompilada (incluindo generics complexos)
  const methodRegex = new RegExp(`^(?:(?:public|protected|private|static|final|async|override|synchronized|default|native|abstract)\\s+)*(?:<[A-Za-z0-9_$,\\s<>?]+>\\s+)?(?:[A-Za-z0-9_$<>[\\].,?]+(?:\\s*<[A-Za-z0-9_$,\\s<>?]+>)?(?:\\[\\])?)\\s+${escaped}\\s*\\(`);
  for (let i = 0; i < lines.length; i++) {
    const lineClean = lines[i].replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
    if (methodRegex.test(lineClean) || methodRegex.test(lines[i].trim())) return i + 1;
  }

  // 2. Campo ou constante enum
  const fieldRegex = new RegExp(`\\b${escaped}\\b\\s*(?:[;=,)]|$)`);
  for (let i = 0; i < lines.length; i++) {
    if (fieldRegex.test(lines[i].trim())) return i + 1;
  }

  // 3. Primeira Ocorrência do identificador
  const wordRegex = new RegExp(`\\b${escaped}\\b`);
  for (let i = 0; i < lines.length; i++) {
    if (wordRegex.test(lines[i])) return i + 1;
  }

  return 1;
}

function collectImports(content) {
  const lines = content.split(/\r?\n/);
  const imports = [];
  const RE = /^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*;/;
  for (let i = 0; i < lines.length; i++) {
    const m = RE.exec(lines[i]);
    if (m) {
      const isStatic = Boolean(m[1]);
      const fqn = m[2];
      const isWildcard = Boolean(m[3]);
      imports.push({ line: i + 1, fqn, isStatic, isWildcard, raw: m[0] });
    }
  }
  return imports;
}

module.exports = {
  scanDirForFile,
  findSourceFileForFqn,
  findSymbolLineInClassSource,
  collectImports,
};
