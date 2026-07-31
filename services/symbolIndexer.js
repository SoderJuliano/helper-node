// services/symbolIndexer.js
// Indexador de símbolos autônomo e ultra-rápido para navegação de código (Go to Definition / Implementações)
// Compatível com Windows e Linux (Wayland/KDE/GNOME - Garuda, Arch, Pop!OS, Ubuntu).

const fs = require('fs');
const path = require('path');

// Extensões suportadas
const SUPPORTED_EXTS = new Set([
  '.java', '.ts', '.tsx', '.js', '.jsx', '.cs', '.cpp', '.h', '.hpp', '.php'
]);

// Pastas ignoradas
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode', '.claude', '.gemini',
  'vendor', 'bin', 'obj', '.next', '.nuxt', '.cache', '__pycache__', 'venv', '.venv', 'env',
  'coverage', '.output', 'out', 'temp', 'tmp', 'logs', '.bundle'
]);

function normalizePath(p) {
  if (!p) return '';
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (norm.length >= 2 && norm[1] === ':') {
    norm = norm[0].toUpperCase() + norm.substring(1);
  }
  return norm;
}

class SymbolIndexer {
  constructor() {
    this.projectPath = null;
    // filePath -> { classes: [], interfaces: [], methods: [], imports: [] }
    this.fileMap = new Map();
    // interfaceName -> Set of { className, filePath }
    this.implementationsMap = new Map();
    // symbolName -> Set of { filePath, line, col, kind, className }
    this.symbolMap = new Map();

    this.indexingSessionId = 0;
    this.isIndexing = false;
    this.indexingProgress = { total: 0, processed: 0 };
  }

  reset() {
    this.projectPath = null;
    this.fileMap.clear();
    this.implementationsMap.clear();
    this.symbolMap.clear();
    this.isIndexing = false;
    this.indexingProgress = { total: 0, processed: 0 };
  }

  // Tenta resolver uma referencia de arquivo (ex: require('./foo'), import 'bar.js')
  tryResolveFilePath(currentFilePath, rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const cleanPath = rawPath.replace(/^['"`]|['"`]$/g, '').trim();
    if (!cleanPath) return null;

    const normCurrent = normalizePath(currentFilePath);
    const currentDir = normCurrent ? path.dirname(normCurrent) : '';
    const projDir = this.projectPath || currentDir;

    const basePaths = [];
    if (path.isAbsolute(cleanPath)) {
      basePaths.push(cleanPath);
    } else if (cleanPath.startsWith('./') || cleanPath.startsWith('../') || cleanPath.startsWith('.\\') || cleanPath.startsWith('..\\')) {
      if (currentDir) basePaths.push(path.resolve(currentDir, cleanPath));
    } else {
      if (currentDir) basePaths.push(path.resolve(currentDir, cleanPath));
      if (projDir) basePaths.push(path.resolve(projDir, cleanPath));
    }

    const extsToTry = ['', '.js', '.ts', '.jsx', '.tsx', '.json', '.html', '.css', '/index.js', '/index.ts'];

    for (const base of basePaths) {
      for (const ext of extsToTry) {
        const candidate = normalizePath(base + ext);
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            const relPath = this.projectPath ? path.relative(this.projectPath, candidate).replace(/\\/g, '/') : candidate;
            return [{
              filePath: candidate,
              relativePath: relPath,
              line: 1,
              col: 1,
              symbol: path.basename(candidate),
              kind: 'file',
              className: null
            }];
          }
        } catch (_) {}
      }
    }
    return null;
  }

  /**
   * Indexa todo o workspace em segundo plano sem bloquear o event loop ou a UI do Windows.
   */
  async indexWorkspace(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) return;

    const currentSession = ++this.indexingSessionId;
    this.reset();
    this.projectPath = normalizePath(projectPath);
    this.isIndexing = true;
    this.notifyStatus('indexing', { processed: 0, total: 0 });

    try {
      // 1. Varredura assíncrona de arquivos em segundo plano
      const files = await this.scanDirAsync(this.projectPath, currentSession);
      if (this.indexingSessionId !== currentSession) return; // cancelado por novo projeto

      this.indexingProgress = { total: files.length, processed: 0 };
      this.notifyStatus('indexing', this.indexingProgress);

      // 2. Processa a indexação dos arquivos em micro-lotes (30 arquivos por vez)
      const BATCH_SIZE = 30;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        if (this.indexingSessionId !== currentSession) return; // cancelado

        const chunk = files.slice(i, i + BATCH_SIZE);
        for (const f of chunk) {
          this.indexSingleFile(f);
        }

        this.indexingProgress.processed = Math.min(i + BATCH_SIZE, files.length);

        // Libera o Event Loop para processar eventos de UI e IPC do Windows
        await new Promise((resolve) => setImmediate(resolve));
      }

      if (this.indexingSessionId === currentSession) {
        this.isIndexing = false;
        this.notifyStatus('completed', { total: files.length, processed: files.length });
        console.log(`[symbolIndexer] Indexação em segundo plano concluída (${files.length} arquivos).`);
      }
    } catch (e) {
      if (this.indexingSessionId === currentSession) {
        this.isIndexing = false;
        this.notifyStatus('error', { error: e.message });
        console.warn('[symbolIndexer] Erro na indexação assíncrona:', e.message);
      }
    }
  }

  /**
   * Varredura assíncrona não-bloqueante usando fila iterativa
   */
  async scanDirAsync(startDir, sessionId) {
    const results = [];
    const queue = [startDir];
    let dirsVisited = 0;

    while (queue.length > 0) {
      if (this.indexingSessionId !== sessionId) return results;

      const currentDir = queue.pop();
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            queue.push(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (SUPPORTED_EXTS.has(ext)) {
              results.push(normalizePath(fullPath));
            }
          }
        }
      } catch (_) {}

      dirsVisited++;
      if (dirsVisited % 40 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    return results;
  }

  notifyStatus(status, details = {}) {
    try {
      const { state } = require('../main/globals.js');
      if (state && state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.mainWindow.webContents.send('symbol-indexer-status', {
          status,
          projectPath: this.projectPath,
          ...details
        });
      }
    } catch (_) {}
  }

  indexSingleFile(filePath, contentOverride = null) {
    const normPath = normalizePath(filePath);
    let content = contentOverride;
    if (content === null) {
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (_) {
        return;
      }
    }

    // Remove símbolo antigo deste arquivo antes de re-indexar
    this.removeFileFromMaps(normPath);

    const lines = content.split(/\r?\n/);
    const fileData = {
      classes: [],
      interfaces: [],
      methods: [],
      imports: []
    };

    let currentInterface = null;
    let currentClass = null;

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNum = i + 1; // 1-indexed

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
        const item = { name: interfaceName, line: lineNum, col, filePath: normPath, kind: 'interface' };
        fileData.interfaces.push(item);
        this.addSymbol(interfaceName, item);
      }

      // 3. Classes e Implementações
      const classMatch = lineText.match(/(?:public\s+|export\s+|default\s+|abstract\s+)*class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+[A-Za-z0-9_$.<>]*)?(?:\s+implements\s+([A-Za-z0-9_$,\s<>]+))?/);
      if (classMatch) {
        const className = classMatch[1];
        currentClass = className;
        currentInterface = null;
        const col = lineText.indexOf(className) + 1;
        const implementsClause = classMatch[2];
        const item = { name: className, line: lineNum, col, filePath: normPath, kind: 'class', implements: [] };

        if (implementsClause) {
          const implList = implementsClause.split(',').map(s => s.trim().replace(/<.*>/, ''));
          item.implements = implList;
          for (const implName of implList) {
            if (!this.implementationsMap.has(implName)) {
              this.implementationsMap.set(implName, new Set());
            }
            this.implementationsMap.get(implName).add({ className, filePath: normPath, line: lineNum });
          }
        }

        fileData.classes.push(item);
        this.addSymbol(className, item);
      }

      // 4. Métodos / Funções
      const methodPatterns = [
        // async function foo(...) / function foo(...) / function* foo(...)
        /(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)\s*\(/,
        // const foo = (...) => / let foo = async () => / var foo = function()
        /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+|\bfunction\b)/,
        // foo(...) { / async foo(...) { (métodos de classe/objeto)
        /^\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/,
        // foo: function(...) / foo: async function(...)
        /([A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?function/,
        // Java/C#/PHP/C++: public void foo(...) / static async Task<Bar> foo(...)
        /(?:public|protected|private|static|final|async|override)\s+(?:[A-Za-z0-9_$<>[\]]+\s+)+([A-Za-z0-9_$]+)\s*\([^)]*\)/
      ];

      for (const pattern of methodPatterns) {
        const m = lineText.match(pattern);
        if (m && m[1]) {
          const methodName = m[1];
          if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'function', 'class', 'return', 'import', 'export', 'require'].includes(methodName)) {
            continue;
          }
          const col = lineText.indexOf(methodName) + 1;
          const owner = currentInterface ? { type: 'interface', name: currentInterface } : currentClass ? { type: 'class', name: currentClass } : null;
          const item = {
            name: methodName,
            line: lineNum,
            col,
            filePath: normPath,
            kind: currentInterface ? 'interface-method' : 'method',
            owner
          };
          fileData.methods.push(item);
          this.addSymbol(methodName, item);
          break;
        }
      }
    }

    this.fileMap.set(normPath, fileData);
  }

  addSymbol(name, item) {
    if (!this.symbolMap.has(name)) {
      this.symbolMap.set(name, []);
    }
    this.symbolMap.get(name).push(item);
  }

  removeFileFromMaps(normPath) {
    const existing = this.fileMap.get(normPath);
    if (!existing) return;

    // Remover dos símbolos globais
    this.symbolMap.forEach((list, name) => {
      this.symbolMap.set(name, list.filter(item => item.filePath !== normPath));
    });

    // Remover das implementações
    this.implementationsMap.forEach((set, implName) => {
      const updated = new Set([...set].filter(item => item.filePath !== normPath));
      this.implementationsMap.set(implName, updated);
    });

    this.fileMap.delete(normPath);
  }

  // Busca rápida e precisa por padrão de definição de um símbolo em um arquivo específico
  searchDefinitionInFile(filePath, symbolName) {
    const normPath = normalizePath(filePath);
    let content = '';
    try {
      content = fs.readFileSync(normPath, 'utf8');
    } catch (_) {
      return [];
    }

    const lines = content.split(/\r?\n/);
    const results = [];
    const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Expressões regulares para capturar declaração/definição de símbolo
    const defRegexes = [
      // async function foo / function foo / function* foo
      new RegExp(`(?:async\\s+)?function\\*?\\s+${escaped}\\s*\\(`),
      // const foo = / let foo = / var foo = / this.foo = / foo =
      new RegExp(`(?:const|let|var|this\\.)?\\s*${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z0-9_$]+|function)`),
      // foo(...) { / async foo(...) { / get foo() / set foo() / static foo()
      new RegExp(`(?:async\\s+|get\\s+|set\\s+|static\\s+)?${escaped}\\s*\\([^)]*\\)\\s*\\{`),
      // foo: function / foo: async function / foo: (
      new RegExp(`${escaped}\\s*:\\s*(?:async\\s+)?(?:function|\\()`),
      // class Foo / interface Foo
      new RegExp(`(?:class|interface)\\s+${escaped}\\b`),
      // Java/C#/C++: tipoRetorno foo(...)
      new RegExp(`(?:public|protected|private|static|final|async|override)\\s+(?:[A-Za-z0-9_$<>\\[\\]]+\\s+)+${escaped}\\s*\\(`)
    ];

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      for (const rx of defRegexes) {
        if (rx.test(lineText)) {
          const col = lineText.indexOf(symbolName) + 1;
          results.push({
            name: symbolName,
            line: i + 1,
            col: col > 0 ? col : 1,
            filePath: normPath,
            kind: 'method'
          });
          break;
        }
      }
    }

    return results;
  }

  scanDir(startDir) {
    const results = [];
    try {
      const entries = fs.readdirSync(startDir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(startDir, entry.name);
        if (entry.isDirectory()) {
          results.push(...this.scanDir(fullPath));
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

  // Encontra todos os pontos onde um método/função é chamado/usado no projeto (usages / callers)
  findUsages(currentFilePath, symbolName) {
    if (!symbolName || typeof symbolName !== 'string') return [];
    const cleanSymbol = symbolName.trim();
    if (!cleanSymbol || !/^[A-Za-z_$][\w$]*$/.test(cleanSymbol)) return [];

    // Ignora palavras reservadas da linguagem que não são métodos customizados
    const KEYWORDS = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'return',
      'import', 'export', 'require', 'const', 'let', 'var', 'new', 'typeof',
      'instanceof', 'void', 'delete', 'true', 'false', 'null', 'undefined', 'this',
      'super', 'async', 'await', 'yield', 'try', 'finally', 'else', 'case', 'break'
    ]);
    if (KEYWORDS.has(cleanSymbol)) return [];

    const normCurrent = normalizePath(currentFilePath);
    if (normCurrent && !this.fileMap.has(normCurrent) && fs.existsSync(normCurrent)) {
      this.indexSingleFile(normCurrent);
    }

    // 1. Obter lista de todos os arquivos a verificar
    const filesToScan = new Set();
    if (this.fileMap.size > 0) {
      for (const f of this.fileMap.keys()) {
        filesToScan.add(f);
      }
    }
    if (normCurrent) filesToScan.add(normCurrent);

    if (this.projectPath && filesToScan.size < 5 && fs.existsSync(this.projectPath)) {
      const projFiles = this.scanDir(this.projectPath);
      for (const f of projFiles) filesToScan.add(f);
    }

    // Identificar as linhas de definição/declaração do método no projeto para desconsiderá-las como uso
    const defLinesByFile = new Map();
    for (const f of filesToScan) {
      const defs = this.searchDefinitionInFile(f, cleanSymbol);
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

        // Atualizar o método contêiner para contextualizar chamadas
        const funcMatch = lineText.match(funcHeaderRegex);
        if (funcMatch) {
          const fnName = funcMatch[1] || funcMatch[2] || funcMatch[3];
          if (fnName && !KEYWORDS.has(fnName) && fnName !== cleanSymbol) {
            currentEnclosingFunc = fnName;
          }
        }

        // Se a linha não contém o símbolo, continua
        if (!wordRegex.test(lineText)) continue;

        // Se é a própria linha de definição do método, ignora
        if (defLines.has(lineNum)) continue;

        // Ignorar linhas de comentários (//, /*, *, #, <!--)
        const trimmed = lineText.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#') || trimmed.startsWith('<!--')) continue;

        const col = lineText.indexOf(cleanSymbol) + 1;

        // Se a ocorrência do símbolo está dentro de um comentário inline (ex: code; // symbol)
        const lineCommentIdx = lineText.indexOf('//');
        if (lineCommentIdx !== -1 && col > lineCommentIdx) continue;
        const relPath = this.projectPath ? path.relative(this.projectPath, filePath).replace(/\\/g, '/') : filePath;
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

  // Encontra as definições/ocorrências de um símbolo clicado
  findDefinition(currentFilePath, symbolName, lineText = '') {
    if (!symbolName) return [];

    const normCurrent = normalizePath(currentFilePath);

    // Garante que o arquivo atual esteja indexado
    if (normCurrent && !this.fileMap.has(normCurrent) && fs.existsSync(normCurrent)) {
      this.indexSingleFile(normCurrent);
    }

    // 1. Tentar resolver como referência de arquivo (require / import / caminho)
    const fileMatches = this.tryResolveFilePath(normCurrent, symbolName);
    if (fileMatches && fileMatches.length > 0) {
      return fileMatches;
    }

    let candidates = [...(this.symbolMap.get(symbolName) || [])];

    // 2. Fallback: se o mapa global não tem a definição, busca diretamente no arquivo atual e no workspace
    if (candidates.length === 0 && normCurrent && fs.existsSync(normCurrent)) {
      const localMatches = this.searchDefinitionInFile(normCurrent, symbolName);
      if (localMatches.length > 0) {
        candidates = localMatches;
      } else if (this.projectPath) {
        const projFiles = this.scanDir(this.projectPath);
        for (const f of projFiles) {
          if (f === normCurrent) continue;
          const found = this.searchDefinitionInFile(f, symbolName);
          if (found.length > 0) {
            candidates.push(...found);
            break;
          }
        }
      }
    }

    if (candidates.length === 0) return [];

    const formatted = candidates.map(c => {
      const relPath = this.projectPath ? path.relative(this.projectPath, c.filePath).replace(/\\/g, '/') : c.filePath;
      return {
        filePath: c.filePath,
        relativePath: relPath,
        line: c.line,
        col: c.col,
        symbol: c.name || c.symbol || symbolName,
        kind: c.kind || 'method',
        className: c.owner ? c.owner.name : (c.className || (c.kind === 'class' ? c.name : null))
      };
    });

    if (formatted.length === 1) return formatted;

    const currentData = this.fileMap.get(normCurrent);
    const sorted = [...formatted].sort((a, b) => {
      if (a.filePath === normCurrent && b.filePath !== normCurrent) return -1;
      if (b.filePath === normCurrent && a.filePath !== normCurrent) return 1;
      if (currentData && currentData.imports.length > 0) {
        const aImport = currentData.imports.some(imp => imp.text.includes(path.basename(a.filePath, path.extname(a.filePath))));
        const bImport = currentData.imports.some(imp => imp.text.includes(path.basename(b.filePath, path.extname(b.filePath))));
        if (aImport && !bImport) return -1;
        if (!aImport && bImport) return 1;
      }
      return 0;
    });

    return sorted;
  }

  // Encontra implementações para uma interface ou método de interface
  findImplementations(currentFilePath, lineNum, symbolName) {
    const normCurrent = normalizePath(currentFilePath);
    const fileData = this.fileMap.get(normCurrent);
    if (!fileData) return [];

    // Verificar se a linha atual declara uma interface
    const matchedInterface = fileData.interfaces.find(i => i.line === Number(lineNum) || i.name === symbolName);
    let targetInterfaceName = matchedInterface ? matchedInterface.name : symbolName;

    // Se é um método de interface
    const matchedMethod = fileData.methods.find(m => m.line === Number(lineNum) && m.kind === 'interface-method');
    if (matchedMethod && matchedMethod.owner && matchedMethod.owner.name) {
      targetInterfaceName = matchedMethod.owner.name;
    }

    const implClasses = this.implementationsMap.get(targetInterfaceName);
    if (!implClasses || implClasses.size === 0) {
      // Fallback: busca por convenção Foo -> FooImpl ou FooService -> FooServiceImpl
      const fallbackName = targetInterfaceName + 'Impl';
      const fallbackCandidates = this.symbolMap.get(fallbackName) || [];
      if (fallbackCandidates.length > 0) {
        return fallbackCandidates.map(c => ({
          filePath: c.filePath,
          line: c.line,
          col: c.col,
          className: c.name
        }));
      }
      return [];
    }

    const results = [];
    for (const impl of implClasses) {
      // Se for método específico, busca a linha do método na classe implementadora
      if (matchedMethod) {
        const implFileData = this.fileMap.get(impl.filePath);
        const implMethod = implFileData ? implFileData.methods.find(m => m.name === matchedMethod.name) : null;
        if (implMethod) {
          results.push({
            filePath: impl.filePath,
            line: implMethod.line,
            col: implMethod.col,
            className: impl.className
          });
          continue;
        }
      }

      results.push({
        filePath: impl.filePath,
        line: impl.line,
        col: 1,
        className: impl.className
      });
    }

    return results;
  }

  // Retorna os ícones do gutter para um determinado arquivo (linhas que declaram interfaces ou métodos de interface)
  getGutterInfo(currentFilePath) {
    const normCurrent = normalizePath(currentFilePath);
    const fileData = this.fileMap.get(normCurrent);
    if (!fileData) return [];

    const gutters = [];

    // Interfaces no arquivo
    for (const interf of fileData.interfaces) {
      const impls = this.findImplementations(normCurrent, interf.line, interf.name);
      if (impls.length > 0) {
        gutters.push({
          line: interf.line,
          symbol: interf.name,
          kind: 'interface',
          target: impls[0]
        });
      }
    }

    // Métodos de interface no arquivo
    for (const method of fileData.methods) {
      if (method.kind === 'interface-method') {
        const impls = this.findImplementations(normCurrent, method.line, method.name);
        if (impls.length > 0) {
          gutters.push({
            line: method.line,
            symbol: method.name,
            kind: 'interface-method',
            target: impls[0]
          });
        }
      }
    }

    return gutters;
  }
}

const instance = new SymbolIndexer();
module.exports = instance;
