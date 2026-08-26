// services/symbolIndexer/symbolUsageFinder.js
const fs = require('fs');
const path = require('path');
const {
  SUPPORTED_EXTS,
  shouldIgnoreDir,
  isDeclarationAt,
  normalizePath,
} = require('./symbolConstants.js');

function scanDir(startDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(startDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(startDir, entry.name);
      if (entry.isDirectory()) {
        if (shouldIgnoreDir(entry.name, startDir)) continue;
        results.push(...scanDir(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SUPPORTED_EXTS.has(ext)) {
          results.push(normalizePath(fullPath));
        }
      }
    }
  } catch (_) {}
  return results;
}

function findUsages(indexer, currentFilePath, symbolName, searchDefinitionInFile) {
  if (!symbolName || typeof symbolName !== 'string') return [];
  const cleanSymbol = symbolName.trim();
  if (!cleanSymbol || !/^[A-Za-z_$][\w$]*$/.test(cleanSymbol)) return [];

  const normCurrent = normalizePath(currentFilePath);

  const indexados = indexer.usageMap.get(cleanSymbol);
  if (indexados && indexados.length > 0) {
    const resp = [];
    for (const u of indexados) {
      if (u.isDef) continue;
      if (u.filePath === normCurrent && u.lineText && isDeclarationAt(u.lineText, Math.max(0, u.col - 1))) {
        continue;
      }
      const relPath = indexer.projectPath ? path.relative(indexer.projectPath, u.filePath).replace(/\\/g, '/') : u.filePath;
      const fileName = path.basename(u.filePath);
      resp.push({
        filePath: u.filePath,
        relativePath: relPath,
        fileName,
        line: u.line,
        col: u.col,
        lineText: u.lineText,
        callerName: u.callerName,
      });
    }
    return resp;
  }

  const filesToScan = [];
  if (indexer.projectPath) {
    filesToScan.push(...scanDir(indexer.projectPath));
  }
  if (normCurrent && !filesToScan.includes(normCurrent) && fs.existsSync(normCurrent)) {
    filesToScan.push(normCurrent);
  }

  const defLinesByFile = new Map();
  for (const f of filesToScan) {
    const defs = searchDefinitionInFile(f, cleanSymbol);
    if (defs && defs.length > 0) {
      defLinesByFile.set(f, new Set(defs.map(d => d.line)));
    }
  }

  const escaped = cleanSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordRegex = new RegExp(`\\b${escaped}\\b`);
  const funcHeaderRegex = /(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=|([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/;

  const usages = [];

  for (const filePath of filesToScan) {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (_) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const defLines = defLinesByFile.get(filePath) || new Set();
    let currentEnclosingFunc = null;

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNum = i + 1;

      const funcMatch = lineText.match(funcHeaderRegex);
      if (funcMatch) {
        const fnName = funcMatch[1] || funcMatch[2] || funcMatch[3];
        const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'return', 'import', 'export', 'require', 'const', 'let', 'var', 'new', 'typeof', 'instanceof', 'void', 'delete', 'true', 'false', 'null', 'undefined', 'this', 'super', 'async', 'await', 'yield', 'try', 'finally', 'else', 'case', 'break']);
        if (fnName && !KEYWORDS.has(fnName) && fnName !== cleanSymbol) {
          currentEnclosingFunc = fnName;
        }
      }

      if (!wordRegex.test(lineText)) continue;
      if (defLines.has(lineNum)) continue;

      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#') || trimmed.startsWith('<!--')) {
        continue;
      }

      const col = lineText.indexOf(cleanSymbol) + 1;
      const lineCommentIdx = lineText.indexOf('//');
      if (lineCommentIdx !== -1 && col > lineCommentIdx) continue;
      const relPath = indexer.projectPath ? path.relative(indexer.projectPath, filePath).replace(/\\/g, '/') : filePath;
      const fileName = path.basename(filePath);

      usages.push({
        filePath,
        relativePath: relPath,
        fileName,
        line: lineNum,
        col: col > 0 ? col : 1,
        lineText: trimmed,
        callerName: currentEnclosingFunc || null
      });
    }
  }

  return usages;
}

module.exports = {
  scanDir,
  findUsages,
};
