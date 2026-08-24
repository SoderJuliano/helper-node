// services/symbolIndexer.js
// Indexador de símbolos autônomo e ultra-rápido para navegação de código (Go to Definition / Implementações)
// Compatível com Windows e Linux (Wayland/KDE/GNOME - Garuda, Arch, Pop!OS, Ubuntu).

const fs = require('fs');
const path = require('path');

// Extensões suportadas
const SUPPORTED_EXTS = new Set([
  '.java', '.ts', '.tsx', '.js', '.jsx', '.cs', '.cpp', '.h', '.hpp', '.php'
]);

// Pastas ignoradas por padrão
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', '.idea', '.vscode', '.claude', '.gemini',
  'vendor', 'bin', 'obj', '.next', '.nuxt', '.cache', '__pycache__', 'venv', '.venv', 'env',
  'coverage', '.output', 'out', 'temp', 'tmp', 'logs', '.bundle', 'whisper', 'assets', 'images', 'audio'
]);

function shouldIgnoreDir(dirName, parentDir) {
  if (IGNORED_DIRS.has(dirName)) return true;
  if (dirName === 'target' || dirName === 'build') {
    const generatedPath = path.join(parentDir || '', dirName, dirName === 'target' ? 'generated-sources' : 'generated');
    const generatedSourcesPath = path.join(parentDir || '', dirName, 'generated-sources');
    if (fs.existsSync(generatedPath) || fs.existsSync(generatedSourcesPath)) {
      return false;
    }
    return true;
  }
  const normParent = parentDir ? parentDir.replace(/\\/g, '/').toLowerCase() : '';
  if (normParent.endsWith('/target')) {
    if (dirName !== 'generated-sources' && dirName !== 'generated-test-sources') return true;
  } else if (normParent.endsWith('/build')) {
    if (dirName !== 'generated' && dirName !== 'generated-sources') return true;
  }
  return false;
}

// Palavras que nunca valem como "uso" — encher o índice com elas é só custo.
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

// Declaração não é "uso" — é onde a coisa nasce. O findUsages antigo descobria
// isso montando uma regex por símbolo e relendo o arquivo; aqui a checagem é
// pelo texto que ANTECEDE o identificador, com regex fixa, então custa quase
// nada e roda uma vez só, na indexação.
const DECL_PREFIX_RES = [
  /(?:const|let|var|class|interface|enum|function|def)\s+$/,             // const foo / class Foo
  /(?:async\s+)?function\*?\s+$/,                                        // function foo
  /(?:public|private|protected|static|final|abstract|readonly)\s+(?:[A-Za-z0-9_$<>[\],]+\s+)*$/, // private String campo / public void foo
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

// Teto por símbolo. Sem isto, um identificador comum num projeto grande gera
// dezenas de milhares de entradas — medido: 120.000 usos de um único método.
// Ninguém lê 120 mil ocorrências, e serializar isso por IPC custa mais que a
// própria busca.
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

class SymbolIndexer {
  constructor() {
    this.projectPath = null;
    // filePath -> { classes: [], interfaces: [], methods: [], imports: [] }
    this.fileMap = new Map();
    // interfaceName -> Set of { className, filePath }
    this.implementationsMap = new Map();
    // symbolName -> Set of { filePath, line, col, kind, className }
    this.symbolMap = new Map();
    // symbolName -> [{ filePath, line, col, lineText, callerName }]
    // Índice invertido de USOS, montado na indexação do projeto. É o que
    // permite responder "onde isto é usado" sem tocar no disco.
    this.usageMap = new Map();
    this.usagesTruncated = new Set(); // símbolos que bateram o teto

    this.indexingSessionId = 0;
    this.isIndexing = false;
    this.indexingProgress = { total: 0, processed: 0 };
  }

  reset() {
    this.projectPath = null;
    this.fileMap.clear();
    this.implementationsMap.clear();
    this.symbolMap.clear();
    this.usageMap.clear();
    this.usagesTruncated.clear();
    this.isIndexing = false;
    this.indexingProgress = { total: 0, processed: 0 };
  }

  // Tenta resolver uma referencia de arquivo (ex: require('./foo'), import 'bar.js')
  tryResolveFilePath(currentFilePath, rawPath) {
    if (!rawPath || typeof rawPath !== 'string') return null;
    const cleanPath = rawPath.replace(/^['"`]|['"`]$/g, '').trim();
    if (!cleanPath) return null;

    const normCurrent = normalizePath(currentFilePath);
    const isJavaFile = normCurrent.toLowerCase().endsWith('.java');

    // Se for arquivo Java ou símbolo sem / ou \ e sem extensão de arquivo explícita,
    // NÃO tratar como caminho relativo de arquivo no projeto para evitar falsos positivos
    // (ex: resolver um tipo Java "User" ou "Service" para "User.html" no projeto).
    const isExplicitPath = cleanPath.startsWith('./') || cleanPath.startsWith('../') ||
      cleanPath.startsWith('.\\') || cleanPath.startsWith('..\\') ||
      cleanPath.includes('/') || cleanPath.includes('\\');

    if (!isExplicitPath) {
      if (isJavaFile) return null;
      if (!/\.[a-zA-Z0-9]+$/.test(cleanPath)) return null;
    }

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

    const extsToTry = isJavaFile
      ? ['', '.java']
      : ['', '.js', '.ts', '.jsx', '.tsx', '.json', '/index.js', '/index.ts'];

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

      // 2. Processa a indexação dos arquivos em micro-lotes (5 arquivos por vez com pausa real)
      const BATCH_SIZE = 5;
      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        if (this.indexingSessionId !== currentSession) return; // cancelado

        const chunk = files.slice(i, i + BATCH_SIZE);
        for (const f of chunk) {
          this.indexSingleFile(f);
        }

        this.indexingProgress.processed = Math.min(i + BATCH_SIZE, files.length);

        // Libera o Event Loop para processar eventos de UI e IPC com pausa real
        await new Promise((resolve) => setTimeout(resolve, 20));
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
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            if (shouldIgnoreDir(entry.name, currentDir)) continue;
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
      if (dirsVisited % 20 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10));
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
        const stat = fs.statSync(filePath);
        if (stat.size > 200 * 1024) return; // ignora arquivos gigantes (>200KB)
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
    let currentEnclosingFunc = null;

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNum = i + 1; // 1-indexed

      // 0. Índice invertido de usos (símbolo → onde aparece).
      // Construído aqui porque já estamos varrendo cada linha do projeto uma
      // vez. Sem ele, findUsages relia TODOS os arquivos do disco a cada hover.
      this.indexUsagesInLine(normPath, lineText, lineNum, () => currentEnclosingFunc);
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
      // Limpa anotações inline (ex: @Mapping(...), @Override) para não quebrar casamento de regex
      const lineClean = lineText.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();

      const methodPatterns = [
        // async function foo(...) / function foo(...) / function* foo(...) / static function foo(...)
        { re: /(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:async\s+)?function\*?\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
        // const foo = (...) => / let foo = async () => / var foo = function()
        { re: /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+|\bfunction\b)/, g: 1 },
        // foo(...) { / static foo(...) { / static async foo(...) { / public static foo(...) { (métodos JS/TS)
        { re: /^\s*(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:async\s+|get\s+|set\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/, g: 1 },
        // foo: function(...) / foo: async function(...)
        { re: /([A-Za-z0-9_$]+)\s*:\s*(?:async\s+)?function/, g: 1 },
        // Java/C#/PHP/C++/Kotlin: public void foo(...) / static async Task<Bar> foo(...) / public static <K, V> Map<K, V> foo(...)
        { re: /(?:public|protected|private|static|final|async|override|synchronized|default|native)\s+(?:[A-Za-z0-9_$<>[\].,\s]+\s+)+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
        // Python: def foo(...) / async def foo(...)
        { re: /(?:async\s+)?def\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
        // Go / Rust: func foo / fn foo
        { re: /(?:pub\s+)?(?:async\s+)?(?:func|fn)\s+(?:\([^)]+\)\s+)?([A-Za-z0-9_$]+)\s*\(/, g: 1 },
        // Declaração de método de interface Java / TS (ex: UserDto map(User user); ou assinatura multilinha UserDto toDto(...)
        { re: /^(?:public\s+|protected\s+|default\s+|static\s+|abstract\s+)*[A-Za-z0-9_$<>[\],\s]+?\s+([A-Za-z0-9_$]+)\s*\(/, g: 1 },
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
          this.addSymbol(methodName, item);
          break;
        }
      }
    }

    this.fileMap.set(normPath, fileData);
  }

  // Extrai identificadores da linha e registra onde cada um aparece.
  // Chamado uma vez por linha durante a indexação — o custo fica na abertura do
  // projeto (em segundo plano), não no hover do usuário.
  indexUsagesInLine(normPath, lineText, lineNum, getEnclosing) {
    if (!lineText) return;
    const trimmed = lineText.trim();
    if (!trimmed) return;
    // Linha inteira de comentário não é uso.
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
      if (jaNestaLinha.has(nome)) continue; // uma entrada por símbolo por linha
      jaNestaLinha.add(nome);

      let lista = this.usageMap.get(nome);
      if (!lista) { lista = []; this.usageMap.set(nome, lista); }
      if (lista.length >= MAX_USAGES_PER_SYMBOL) { this.usagesTruncated.add(nome); continue; }
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

    // Sem isto, reindexar um arquivo salvo duplicaria os usos dele no índice.
    this.usageMap.forEach((list, name) => {
      const filtrada = list.filter(u => u.filePath !== normPath);
      if (filtrada.length) this.usageMap.set(name, filtrada);
      else this.usageMap.delete(name);
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
      new RegExp(`(?:public\\s+|protected\\s+|private\\s+)?(?:static\\s+)?(?:async\\s+)?function\\*?\\s+${escaped}\\s*\\(`),
      // const foo / let foo / var foo (com ou sem = e qualquer valor)
      new RegExp(`(?:const|let|var)\\s+${escaped}\\b`),
      // this.foo = ... / foo = ...
      new RegExp(`(?:this\\.)?${escaped}\\s*=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z0-9_$]+|function)`),
      // foo(...) { / async foo(...) { / get foo() / set foo() / static foo()
      new RegExp(`(?:public\\s+|protected\\s+|private\\s+|static\\s+|async\\s+|get\\s+|set\\s+)*${escaped}\\s*\\([^)]*\\)\\s*\\{`),
      // foo: function / foo: async function / foo: (
      new RegExp(`${escaped}\\s*:\\s*(?:async\\s+)?(?:function|\\()`),
      // class Foo / interface Foo / enum Foo / record Foo
      new RegExp(`(?:class|interface|enum|record)\\s+${escaped}\\b`),
      // Java/C#/C++/PHP: tipoRetorno foo(...) ou interface método
      new RegExp(`(?:public|protected|private|static|final|async|override|synchronized|default|native|abstract)?\\s*(?:[A-Za-z0-9_$<>\\[\\],\\s]+\\s+)+${escaped}\\s*\\(`),
      // Python: def foo(...)
      new RegExp(`(?:async\\s+)?def\\s+${escaped}\\s*\\(`),
      // Go / Rust: func foo / fn foo
      new RegExp(`(?:func|fn)\\s+(?:\\([^)]+\\)\\s+)?${escaped}\\s*\\(`)
    ];

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineClean = lineText.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
      for (const rx of defRegexes) {
        if (rx.test(lineClean) || rx.test(lineText)) {
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
        const fullPath = path.join(startDir, entry.name);
        if (entry.isDirectory()) {
          if (shouldIgnoreDir(entry.name, startDir)) continue;
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

    const normCurrent = normalizePath(currentFilePath);

    // Fast-path: índice invertido montado na abertura do projeto
    const indexados = this.usageMap.get(cleanSymbol);
    if (indexados && indexados.length > 0) {
      const resp = [];
      for (const u of indexados) {
        if (u.isDef) continue;
        if (u.filePath === normCurrent && u.lineText && isDeclarationAt(u.lineText, Math.max(0, u.col - 1))) {
          continue;
        }
        const relPath = this.projectPath ? path.relative(this.projectPath, u.filePath).replace(/\\/g, '/') : u.filePath;
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

    // Fallback: varredura no disco se o índice não tiver o símbolo (ex: arquivo novo fora do workspace)
    const filesToScan = [];
    if (this.projectPath) {
      filesToScan.push(...this.scanDir(this.projectPath));
    }
    if (normCurrent && !filesToScan.includes(normCurrent) && fs.existsSync(normCurrent)) {
      filesToScan.push(normCurrent);
    }

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
          // Ignorar palavras reservadas que não são métodos customizados
          const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'class', 'return', 'import', 'export', 'require', 'const', 'let', 'var', 'new', 'typeof', 'instanceof', 'void', 'delete', 'true', 'false', 'null', 'undefined', 'this', 'super', 'async', 'await', 'yield', 'try', 'finally', 'else', 'case', 'break']);
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
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#') || trimmed.startsWith('<!--')) {
          continue;
        }

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

    // Se temos métodos de interface ou classe abstrata, inclui também as implementações concretas (ex: UserMapperImpl)
    const implCandidates = [];
    for (const c of candidates) {
      if (c.kind === 'interface-method' || c.kind === 'interface') {
        const ownerName = c.owner ? c.owner.name : c.name;
        if (ownerName) {
          const impls = this.implementationsMap.get(ownerName);
          if (impls) {
            for (const impl of impls) {
              const implFileData = this.fileMap.get(impl.filePath);
              const implMethod = implFileData ? implFileData.methods.find(m => m.name === symbolName) : null;
              if (implMethod) {
                implCandidates.push(implMethod);
              }
            }
          }
        }
      }
    }
    for (const ic of implCandidates) {
      if (!candidates.some(c => c.filePath === ic.filePath && c.line === ic.line)) {
        candidates.push(ic);
      }
    }

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

    // Tipo do RECEPTOR da chamada: em `pagamentoService.processar(id)`, descobre
    // que `pagamentoService` é do tipo `PagamentoService` e põe a definição
    // dentro desse tipo em primeiro lugar.
    const tipoReceptor = this.resolveReceiverType(normCurrent, symbolName, lineText);

    const pontos = (c) => {
      let p = 0;
      if (tipoReceptor) {
        const base = path.basename(c.filePath, path.extname(c.filePath));
        if (c.className === tipoReceptor) p += 100;
        if (base === tipoReceptor) p += 80;
        if (c.className === tipoReceptor + 'Impl') p += 95;
        if (base === tipoReceptor + 'Impl') p += 75;
      }
      if (currentData && currentData.imports.length > 0) {
        const base = path.basename(c.filePath, path.extname(c.filePath));
        if (currentData.imports.some(imp => imp.text.includes(base))) p += 20;
      }
      // Se estamos dentro do arquivo da própria interface/mapper e clicamos no método,
      // a implementação correspondente (ex: UserMapperImpl.java) deve ter prioridade máxima para ir até o código
      if (c.filePath === normCurrent && (c.kind === 'interface-method' || c.kind === 'interface')) {
        p -= 50;
      } else if (!tipoReceptor && c.filePath === normCurrent) {
        p += 50;
      }
      return p;
    };

    return [...formatted].sort((a, b) => pontos(b) - pontos(a));
  }

  // Descobre o tipo declarado da variável que recebe a chamada.
  // Só olha o arquivo atual — é uma leitura só, e é onde a declaração está em
  // praticamente todo caso real (campo injetado ou variável local).
  resolveReceiverType(normCurrent, symbolName, lineText) {
    if (!lineText || !symbolName) return null;
    const mRec = lineText.match(
      new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\.\\s*${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    );
    if (!mRec) return null;
    const receptor = mRec[1];
    // `this.foo()` / `super.foo()` não dizem nada sobre tipo externo.
    if (receptor === 'this' || receptor === 'super') return null;
    // O próprio receptor pode ser um tipo (chamada estática: Service.metodo()).
    if (/^[A-Z]/.test(receptor)) return receptor;

    let conteudo = '';
    try { conteudo = fs.readFileSync(normCurrent, 'utf8'); } catch (_) { return null; }
    // `private PagamentoService pagamentoService;`, `PagamentoService x = ...`,
    // parâmetro `(PagamentoService pagamentoService)`.
    const mTipo = conteudo.match(
      new RegExp(`([A-Z][A-Za-z0-9_$]*)(?:<[^>]*>)?\\s+${receptor}\\b\\s*[;=,)]`)
    );
    return mTipo ? mTipo[1] : null;
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
