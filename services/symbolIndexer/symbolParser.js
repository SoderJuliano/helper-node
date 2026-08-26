// services/symbolIndexer/symbolParser.js
const {
  USAGE_STOPWORDS,
  ENCLOSING_FUNC_RE,
  IDENTIFIER_RE,
  MAX_USAGES_PER_SYMBOL,
  MIN_USAGE_SYMBOL_LEN,
  isDeclarationAt,
} = require('./symbolConstants.js');

function indexUsagesInLine(indexer, normPath, lineText, lineNum, getEnclosing) {
  if (!lineText) return;
  const trimmed = lineText.trim();
  if (!trimmed) return;
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
    || trimmed.startsWith('#') || trimmed.startsWith('<!--')) return;

  const comentarioInline = lineText.indexOf('//');
  IDENTIFIER_RE.lastIndex = 0;
  let m;
  const jaNestaLinha = new Set();
  while ((m = IDENTIFIER_RE.exec(lineText)) !== null) {
    const nome = m[0];
    if (nome.length < MIN_USAGE_SYMBOL_LEN || USAGE_STOPWORDS.has(nome)) continue;
    if (comentarioInline !== -1 && m.index > comentarioInline) continue;
    if (jaNestaLinha.has(nome)) continue;
    jaNestaLinha.add(nome);

    let lista = indexer.usageMap.get(nome);
    if (!lista) { lista = []; indexer.usageMap.set(nome, lista); }
    if (lista.length >= MAX_USAGES_PER_SYMBOL) { indexer.usagesTruncated.add(nome); continue; }
    lista.push({
      filePath: normPath,
      line: lineNum,
      col: m.index + 1,
      lineText: trimmed,
      callerName: getEnclosing() || null,
      isDef: isDeclarationAt(lineText, m.index),
    });
  }
}

function parseFileLines(indexer, normPath, content) {
  const pkgMatch = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  const packageName = pkgMatch ? pkgMatch[1] : '';

  const staticImports = [];
  const RE_STATIC_ALL = /^\s*import\s+static\s+([\w.]+)(?:\.([\w$]+|\*))\s*;/gm;
  let sm;
  while ((sm = RE_STATIC_ALL.exec(content)) !== null) {
    const full = sm[1];
    const member = sm[2] || '*';
    const isWildcard = member === '*';
    const className = full.split('.').pop();
    staticImports.push({
      full: `${full}.${member}`,
      className,
      member,
      isWildcard,
      line: 1
    });
  }

  const lines = content.split(/\r?\n/);
  const fileData = {
    package: packageName,
    classes: [],
    interfaces: [],
    methods: [],
    fields: [],
    imports: [],
    staticImports
  };

  let currentInterface = null;
  let currentClass = null;
  let currentEnclosingFunc = null;

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineNum = i + 1;

    indexUsagesInLine(indexer, normPath, lineText, lineNum, () => currentEnclosingFunc);
    const encMatch = lineText.match(ENCLOSING_FUNC_RE);
    if (encMatch) {
      const fn = encMatch[1] || encMatch[2] || encMatch[3];
      if (fn && !USAGE_STOPWORDS.has(fn)) currentEnclosingFunc = fn;
    }

    // 1. Imports
    const importMatch = lineText.match(/(?:import|using|use|require)\s+([^;'"\n]+)/);
    if (importMatch) {
      fileData.imports.push({ text: importMatch[1].trim(), line: lineNum });
    }

    // 2. Interfaces
    const interfaceMatch = lineText.match(/(?:public\s+|export\s+|protected\s+)?interface\s+([A-Za-z0-9_$]+)/);
    if (interfaceMatch) {
      const interfaceName = interfaceMatch[1];
      currentInterface = interfaceName;
      currentClass = null;
      const col = lineText.indexOf(interfaceName) + 1;
      const item = {
        name: interfaceName,
        fqcn: packageName ? `${packageName}.${interfaceName}` : interfaceName,
        line: lineNum,
        col,
        filePath: normPath,
        kind: 'interface'
      };
      fileData.interfaces.push(item);
      indexer.addSymbol(interfaceName, item);
    }

    // 3. Classes, Enums, Records e Implementações
    const classMatch = lineText.match(/(?:(?:public|export|default|abstract|final)\s+)*(?:class|enum|record)\s+([A-Za-z0-9_$]+)(?:\s+extends\s+[A-Za-z0-9_$.<>]*)?(?:\s+implements\s+([A-Za-z0-9_$,\s<>]+))?/);
    if (classMatch) {
      const className = classMatch[1];
      currentClass = className;
      currentInterface = null;
      const col = lineText.indexOf(className) + 1;
      const implementsClause = classMatch[2];
      const item = {
        name: className,
        fqcn: packageName ? `${packageName}.${className}` : className,
        line: lineNum,
        col,
        filePath: normPath,
        kind: 'class',
        implements: []
      };

      const implList = [];
      if (implementsClause) {
        implList.push(...implementsClause.split(',').map(s => s.trim().replace(/<.*>/, '')));
      }
      if (className.endsWith('Impl')) {
        const inferredIface = className.slice(0, -4);
        if (!implList.includes(inferredIface)) {
          implList.push(inferredIface);
        }
      }

      item.implements = implList;
      for (const implName of implList) {
        if (!indexer.implementationsMap.has(implName)) {
          indexer.implementationsMap.set(implName, new Set());
        }
        indexer.implementationsMap.get(implName).add({ className, filePath: normPath, line: lineNum });
      }

      fileData.classes.push(item);
      indexer.addSymbol(className, item);
    }

    // 3.5 Constantes / Campos / Enums
    const lineClean = lineText.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
    const KEYWORDS = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'return', 'class', 'interface',
      'enum', 'package', 'import', 'new', 'public', 'private', 'protected',
      'static', 'final', 'default', 'void', 'throw', 'throws', 'const', 'let', 'var'
    ]);

    const fieldMatch = lineClean.match(/^(?:(?:public|protected|private|static|final|volatile|transient|const|readonly)\s+)+[A-Za-z0-9_$<>[\].,?]+\s+([A-Za-z0-9_$]+)\s*(?:=|;)/);
    if (fieldMatch && (currentClass || currentInterface)) {
      const fieldName = fieldMatch[1];
      if (!KEYWORDS.has(fieldName)) {
        const col = lineText.indexOf(fieldName) + 1;
        const owner = currentInterface ? { type: 'interface', name: currentInterface } : { type: 'class', name: currentClass };
        const item = {
          name: fieldName,
          line: lineNum,
          col: col > 0 ? col : 1,
          filePath: normPath,
          kind: currentInterface ? 'interface-constant' : 'field',
          owner
        };
        fileData.fields.push(item);
        indexer.addSymbol(fieldName, item);
      }
    } else if (currentClass && /^[A-Z][A-Z0-9_$]*(?:\s*\([^)]*\))?\s*(?:,|;|$)/.test(lineClean)) {
      const enumConstMatch = lineClean.match(/^([A-Z][A-Z0-9_$]*)/);
      if (enumConstMatch && !KEYWORDS.has(enumConstMatch[1])) {
        const constName = enumConstMatch[1];
        const col = lineText.indexOf(constName) + 1;
        const item = {
          name: constName,
          line: lineNum,
          col: col > 0 ? col : 1,
          filePath: normPath,
          kind: 'field',
          owner: { type: 'enum', name: currentClass }
        };
        fileData.fields.push(item);
        indexer.addSymbol(constName, item);
      }
    }

    // 4. Métodos / Funções
    const methodPatterns = [
      { re: /(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
      { re: /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+|\bfunction\b)/, g: 1 },
      { re: /^\s*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:async\s+|get\s+|set\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/, g: 1 },
      { re: /([A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?function/, g: 1 },
      { re: /^(?:(?:public|protected|private|static|final|async|override|synchronized|default|native)\s+)+[A-Za-z0-9_$<>[\].,?]+\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
      { re: /(?:async\s+)?def\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
      { re: /(?:pub\s+)?(?:async\s+)?(?:func|fn)\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_$]+)\s*\(/, g: 1 },
      { re: /^(?:(?:public|protected|default|static|abstract)\s+)*[A-Za-z0-9_$<>[\].,?]+\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
    ];

    for (const pattern of methodPatterns) {
      const m = lineClean.match(pattern.re) || lineText.match(pattern.re);
      if (m && m[pattern.g]) {
        const methodName = m[pattern.g];
        if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'function', 'class', 'return', 'import', 'export', 'require', 'static', 'async', 'get', 'set', 'public', 'private', 'protected', 'def', 'fn', 'func', 'interface', 'package', 'new'].includes(methodName)) {
          continue;
        }
        const col = lineText.indexOf(methodName) + 1;
        const owner = currentInterface ? { type: 'interface', name: currentInterface } : currentClass ? { type: 'class', name: currentClass } : null;
        const item = {
          name: methodName,
          line: lineNum,
          col: col > 0 ? col : 1,
          filePath: normPath,
          kind: currentInterface ? 'interface-method' : 'method',
          owner
        };
        fileData.methods.push(item);
        indexer.addSymbol(methodName, item);
        break;
      }
    }
  }

  return fileData;
}

module.exports = {
  indexUsagesInLine,
  parseFileLines,
};
