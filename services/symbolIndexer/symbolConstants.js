// services/symbolIndexer/symbolConstants.js
const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTS = new Set([
  '.java', '.ts', '.tsx', '.js', '.jsx', '.cs', '.cpp', '.h', '.hpp', '.php'
]);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.idea', '.vscode', '.claude', '.gemini',
  'vendor', 'bin', 'obj', '.next', '.nuxt', '.cache', '__pycache__', 'venv', '.venv', 'env',
  'coverage', '.output', 'out', 'temp', 'tmp', 'logs', '.bundle', 'whisper', 'assets', 'images', 'audio'
]);

function shouldIgnoreDir(dirName, parentDir) {
  if (IGNORED_DIRS.has(dirName)) return true;
  const normParent = parentDir ? parentDir.replace(/\\/g, '/').toLowerCase() : '';

  if (dirName === 'target' || dirName === 'build') {
    const generatedPath = path.join(parentDir || '', dirName, dirName === 'target' ? 'generated-sources' : 'generated');
    const generatedSourcesPath = path.join(parentDir || '', dirName, 'generated-sources');
    if (fs.existsSync(generatedPath) || fs.existsSync(generatedSourcesPath)) {
      return false;
    }
    return true;
  }

  if (normParent.endsWith('/target') || normParent.includes('/target/')) {
    if (!normParent.includes('/target/generated-sources') && !normParent.includes('/target/generated-test-sources')) {
      if (dirName !== 'generated-sources' && dirName !== 'generated-test-sources') return true;
    }
  } else if (normParent.endsWith('/build') || normParent.includes('/build/')) {
    if (!normParent.includes('/build/generated') && !normParent.includes('/build/generated-sources')) {
      if (dirName !== 'generated' && dirName !== 'generated-sources') return true;
    }
  }

  return false;
}

const USAGE_STOPWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'return',
  'import', 'export', 'require', 'const', 'let', 'var', 'new', 'typeof',
  'instanceof', 'void', 'delete', 'true', 'false', 'null', 'undefined', 'this',
  'super', 'async', 'await', 'yield', 'try', 'finally', 'else', 'case', 'break',
  'public', 'private', 'protected', 'static', 'final', 'package', 'interface',
  'extends', 'implements', 'throws', 'throw', 'int', 'boolean', 'double', 'float',
  'long', 'char', 'byte', 'short', 'String', 'default', 'continue', 'abstract',
]);

const ENCLOSING_FUNC_RE = /(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=|([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/;
const IDENTIFIER_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;

const DECL_PREFIX_RES = [
  /(?:const|let|var|class|interface|enum|function|def)\s+$/,
  /(?:async\s+)?function\*?\s+$/,
  /(?:(?:public|private|protected|static|final|abstract|readonly)\s+)+[A-Za-z0-9_$<>[\],.?]*\s*$/,
  /(?:import|from|package)\s+$/,
];

function isDeclarationAt(lineText, index) {
  if (index === 0) return false;
  const antes = lineText.slice(0, index);
  for (const re of DECL_PREFIX_RES) {
    if (re.test(antes)) return true;
  }
  return false;
}

const MAX_USAGES_PER_SYMBOL = 300;
const MIN_USAGE_SYMBOL_LEN = 3;

function normalizePath(p) {
  if (!p) return '';
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (norm.length >= 2 && norm[1] === ':') {
    norm = norm[0].toUpperCase() + norm.substring(1);
  }
  return norm;
}

module.exports = {
  SUPPORTED_EXTS,
  IGNORED_DIRS,
  USAGE_STOPWORDS,
  ENCLOSING_FUNC_RE,
  IDENTIFIER_RE,
  DECL_PREFIX_RES,
  MAX_USAGES_PER_SYMBOL,
  MIN_USAGE_SYMBOL_LEN,
  shouldIgnoreDir,
  isDeclarationAt,
  normalizePath,
};
