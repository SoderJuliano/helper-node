// services/java/autoImport/javaSymbolExtractor.js
// Extrator de simbolos Java nao resolvidos no corpo do codigo (anotacoes, tipos, classes estaticas, genericos).

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const',
  'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float',
  'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native',
  'new', 'package', 'private', 'protected', 'public', 'record', 'return', 'sealed', 'permits',
  'non-sealed', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw',
  'throws', 'transient', 'try', 'var', 'void', 'volatile', 'while', 'yield', 'true', 'false', 'null'
]);

const PRIMITIVES = new Set([
  'boolean', 'byte', 'char', 'short', 'int', 'long', 'float', 'double', 'void'
]);

const JAVA_LANG_CLASSES = new Set([
  'String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Byte', 'Short', 'Character',
  'Object', 'System', 'Math', 'Thread', 'Class', 'Enum', 'Record', 'Exception', 'RuntimeException',
  'Throwable', 'Error', 'NullPointerException', 'IllegalArgumentException', 'IllegalStateException',
  'Override', 'Deprecated', 'SuppressWarnings', 'FunctionalInterface', 'SafeVarargs',
  'StringBuilder', 'StringBuffer', 'CharSequence', 'Comparable', 'Iterable', 'AutoCloseable',
  'Cloneable', 'Runnable', 'Void', 'Number', 'AssertionError', 'NoSuchMethodException',
  'ClassNotFoundException', 'IllegalAccessException', 'NoSuchFieldException',
  'IndexOutOfBoundsException', 'ArrayIndexOutOfBoundsException', 'StringIndexOutOfBoundsException',
  'UnsupportedOperationException', 'SecurityException', 'StackTraceElement'
]);

function stripCommentsAndLiterals(text) {
  if (!text) return '';
  const chars = text.split('');
  const len = chars.length;
  let i = 0;

  while (i < len) {
    // 1. Bloco de texto Java 15+ (""" ... """)
    if (chars[i] === '"' && i + 2 < len && chars[i + 1] === '"' && chars[i + 2] === '"') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      chars[i + 2] = ' ';
      i += 3;

      while (i < len) {
        if (chars[i] === '\\') {
          chars[i] = ' ';
          i++;
          if (i < len && chars[i] !== '\n' && chars[i] !== '\r') {
            chars[i] = ' ';
            i++;
          }
          continue;
        }
        if (chars[i] === '"' && i + 2 < len && chars[i + 1] === '"' && chars[i + 2] === '"') {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          chars[i + 2] = ' ';
          i += 3;
          break;
        }
        if (chars[i] !== '\n' && chars[i] !== '\r') {
          chars[i] = ' ';
        }
        i++;
      }
      continue;
    }

    // 2. String literal padrao (" ... ")
    if (chars[i] === '"') {
      chars[i] = ' ';
      i++;
      while (i < len) {
        if (chars[i] === '\\') {
          chars[i] = ' ';
          i++;
          if (i < len && chars[i] !== '\n' && chars[i] !== '\r') {
            chars[i] = ' ';
            i++;
          }
          continue;
        }
        if (chars[i] === '"') {
          chars[i] = ' ';
          i++;
          break;
        }
        if (chars[i] === '\n' || chars[i] === '\r') {
          // String nao-fechada na linha (limite seguro)
          break;
        }
        chars[i] = ' ';
        i++;
      }
      continue;
    }

    // 3. Character literal (' ... ')
    if (chars[i] === "'") {
      chars[i] = ' ';
      i++;
      while (i < len) {
        if (chars[i] === '\\') {
          chars[i] = ' ';
          i++;
          if (i < len && chars[i] !== '\n' && chars[i] !== '\r') {
            chars[i] = ' ';
            i++;
          }
          continue;
        }
        if (chars[i] === "'") {
          chars[i] = ' ';
          i++;
          break;
        }
        if (chars[i] === '\n' || chars[i] === '\r') {
          break;
        }
        chars[i] = ' ';
        i++;
      }
      continue;
    }

    // 4. Comentario de linha (// ... \n)
    if (chars[i] === '/' && i + 1 < len && chars[i + 1] === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < len && chars[i] !== '\n' && chars[i] !== '\r') {
        chars[i] = ' ';
        i++;
      }
      continue;
    }

    // 5. Comentario de bloco (/* ... */)
    if (chars[i] === '/' && i + 1 < len && chars[i + 1] === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < len && !(chars[i] === '*' && i + 1 < len && chars[i + 1] === '/')) {
        if (chars[i] !== '\n' && chars[i] !== '\r') {
          chars[i] = ' ';
        }
        i++;
      }
      if (i < len) {
        chars[i] = ' ';
        if (i + 1 < len) chars[i + 1] = ' ';
        i += 2;
      }
      continue;
    }

    i++;
  }

  return chars.join('');
}

function parseFileHeaders(sanitized) {
  const lines = sanitized.split('\n');
  let packageName = '';
  const importedSimpleNames = new Set();
  const wildcardPackages = new Set();
  const locallyDefinedTypes = new Set();
  const typeParameters = new Set();

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const trimmed = line.trim();

    const pkgMatch = trimmed.match(/^package\s+([a-zA-Z0-9_.]+)\s*;/);
    if (pkgMatch) {
      packageName = pkgMatch[1];
      continue;
    }

    const isWildcard = /^import(?:\s+static)?\s+[a-zA-Z0-9_.]+\s*\.\s*\*\s*;/.test(trimmed);
    const impMatch = trimmed.match(/^import(?:\s+static)?\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)(?:\s*\.\s*\*|\.\*)?\s*;/);
    if (impMatch) {
      if (isWildcard) {
        wildcardPackages.add(impMatch[1]);
      } else {
        const fqn = impMatch[1];
        const simpleName = fqn.split('.').pop();
        importedSimpleNames.add(simpleName);
      }
      continue;
    }

    const declMatches = trimmed.matchAll(/(?:public|protected|private|abstract|static|final|sealed|non-sealed)?\s*(?:class|interface|enum|record|@interface)\s+([A-Z][a-zA-Z0-9_]*)/g);
    for (const dm of declMatches) {
      locallyDefinedTypes.add(dm[1]);
    }

    const genericMatches = trimmed.matchAll(/<([A-Z0-9_\s,extends\?&]+)>/g);
    for (const gm of genericMatches) {
      const parts = gm[1].split(/[,&]/);
      for (const p of parts) {
        const m = p.trim().match(/^([A-Z][a-zA-Z0-9_]*)/);
        if (m && m[1].length <= 2) {
          typeParameters.add(m[1]);
        }
      }
    }
  }

  return {
    packageName,
    importedSimpleNames,
    wildcardPackages,
    locallyDefinedTypes,
    typeParameters,
  };
}

const { SPRING_BOOT_CANONICAL_TYPES, JDK_CANONICAL_TYPES } = require('./javaSpringDictionary.js');
const { JDK_FQN_MAP } = require('../javaJdkConstants.js');

function isSymbolResolvedByWildcard(name, wildcardPackages, packageName, projectIndex) {
  if (wildcardPackages && wildcardPackages.size > 0) {
    for (const wp of wildcardPackages) {
      const fullCandidate = `${wp}.${name}`;

      // 1. projectIndex.allClasses
      if (projectIndex && projectIndex.allClasses && projectIndex.allClasses.has(fullCandidate)) {
        return true;
      }

      // 2. projectIndex.simpleNameIndex
      if (projectIndex && projectIndex.simpleNameIndex) {
        const fqns = projectIndex.simpleNameIndex.get(name);
        if (fqns) {
          const list = Array.isArray(fqns) ? fqns : Array.from(fqns);
          if (list.some((f) => f === fullCandidate || f.startsWith(`${wp}.`))) {
            return true;
          }
        }
      }

      // 3. Dicionario Canonico Spring Boot (ex: org.springframework.web.bind.annotation.* cobre PostMapping)
      const springMatches = SPRING_BOOT_CANONICAL_TYPES.get(name);
      if (springMatches && springMatches.some((f) => f === fullCandidate || f.startsWith(`${wp}.`))) {
        return true;
      }

      // 4. Dicionario Canonico JDK (ex: java.util.* cobre List, Map, ArrayList)
      const jdkMatches = JDK_CANONICAL_TYPES.get(name);
      if (jdkMatches && jdkMatches.some((f) => f === fullCandidate || f.startsWith(`${wp}.`))) {
        return true;
      }

      // 5. Mapa Classico JDK Constants
      const jdkConstant = JDK_FQN_MAP.get(name);
      if (jdkConstant && (jdkConstant === fullCandidate || jdkConstant.startsWith(`${wp}.`))) {
        return true;
      }
    }
  }

  // Checa se o simbolo pertence ao mesmo pacote do arquivo atual
  if (packageName) {
    const localCandidate = `${packageName}.${name}`;
    if (projectIndex && projectIndex.allClasses && projectIndex.allClasses.has(localCandidate)) {
      return true;
    }
    if (projectIndex && projectIndex.simpleNameIndex) {
      const fqns = projectIndex.simpleNameIndex.get(name);
      if (fqns) {
        const list = Array.isArray(fqns) ? fqns : Array.from(fqns);
        if (list.some((f) => f === localCandidate)) {
          return true;
        }
      }
    }
  }

  return false;
}

function extractUnresolvedSymbols(content, projectIndex = null) {
  if (!content || typeof content !== 'string') return [];

  const sanitized = stripCommentsAndLiterals(content);
  const headerInfo = parseFileHeaders(sanitized);
  const { importedSimpleNames, wildcardPackages, locallyDefinedTypes, typeParameters, packageName } = headerInfo;

  const lines = sanitized.split('\n');
  const results = [];
  const seenLineSymbols = new Set();

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineText = lines[lineIdx];
    const trimmed = lineText.trim();
    if (trimmed.startsWith('package ') || trimmed.startsWith('import ')) continue;

    // 1. Anotacoes: @RestController, @Autowired, @GetMapping etc.
    const annoRegex = /@([A-Z][a-zA-Z0-9_]*)\b/g;
    let match;
    while ((match = annoRegex.exec(lineText)) !== null) {
      const name = match[1];
      const startCol = match.index + 2;
      const endCol = startCol + name.length;
      checkAndAdd(name, lineIdx + 1, startCol, lineIdx + 1, endCol, 'annotation');
    }

    // 2. Tipos e classes estaticas PascalCase no codigo
    const typeRegex = /(?<![a-zA-Z0-9_$.])([A-Z][a-zA-Z0-9_]*)\b/g;
    while ((match = typeRegex.exec(lineText)) !== null) {
      const name = match[1];
      const matchIdx = match.index;

      if (matchIdx > 0 && lineText[matchIdx - 1] === '.') continue;
      if (matchIdx > 0 && lineText[matchIdx - 1] === '@') continue;

      const startCol = matchIdx + 1;
      const endCol = startCol + name.length;
      checkAndAdd(name, lineIdx + 1, startCol, lineIdx + 1, endCol, 'type');
    }
  }

  function checkAndAdd(name, line, col, endLine, endCol, kind) {
    if (JAVA_KEYWORDS.has(name)) return;
    if (PRIMITIVES.has(name)) return;
    if (JAVA_LANG_CLASSES.has(name)) return;
    if (typeParameters.has(name)) return;
    if (locallyDefinedTypes.has(name)) return;
    if (importedSimpleNames.has(name)) return;

    if (isSymbolResolvedByWildcard(name, wildcardPackages, packageName, projectIndex)) {
      return;
    }

    const key = `${line}:${col}:${name}`;
    if (seenLineSymbols.has(key)) return;
    seenLineSymbols.add(key);

    results.push({ name, line, col, endLine, endCol, kind });
  }

  return results;
}

module.exports = {
  stripCommentsAndLiterals,
  parseFileHeaders,
  extractUnresolvedSymbols,
  isSymbolResolvedByWildcard,
  JAVA_LANG_CLASSES,
};