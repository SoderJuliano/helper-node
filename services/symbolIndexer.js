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
  'node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode', 'vendor', 'bin', 'obj'
]);

function normalizePath(p) {
  if (!p) return '';
  return path.normalize(p).replace(/\\/g, '/');
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
  }

  reset() {
    this.projectPath = null;
    this.fileMap.clear();
    this.implementationsMap.clear();
    this.symbolMap.clear();
  }

  async indexWorkspace(projectPath) {
    if (!projectPath || !fs.existsSync(projectPath)) return;
    this.reset();
    this.projectPath = normalizePath(projectPath);

    const files = this.scanDir(this.projectPath);
    for (const f of files) {
      this.indexSingleFile(f);
    }
  }

  scanDir(dir) {
    const results = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
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
      // JS/TS: import ... from '...'
      // Java: import com.example.Foo;
      // PHP: use App\Services\Foo;
      // C#: using System.IO;
      const importMatch = lineText.match(/(?:import|using|use)\s+([^;'"\n]+)/);
      if (importMatch) {
        fileData.imports.push({ text: importMatch[1].trim(), line: lineNum });
      }

      // 2. Interfaces
      // interface FooService { ... } or public interface FooService extends ...
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
      // class FooImpl implements FooService
      // class FooImpl extends Bar implements FooService, BarService
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
      // Java/C#/C++/PHP: public void myMethod(...) | String getFoo(...)
      // TS/JS: async myMethod(...) | function myMethod(...) | myMethod = (...) =>
      const methodPatterns = [
        // Java/C#/PHP: [public|private|protected] [static] [async] ReturnType methodName(...)
        /(?:public|protected|private|static|final|async|override)\s+(?:[A-Za-z0-9_$<>[\]]+\s+)+([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{?/,
        // TS/JS/PHP: function methodName(...)
        /function\s+([A-Za-z0-9_$]+)\s*\(/,
        // TS/JS: methodName(...) { or async methodName(...) {
        /^\s*(?:async\s+)?([A-Za-z0-9_$]+)\s*\([^)]*\)\s*\{/,
        // TS/JS arrow: const methodName = (...) =>
        /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/
      ];

      for (const pattern of methodPatterns) {
        const m = lineText.match(pattern);
        if (m && m[1]) {
          const methodName = m[1];
          // Ignorar palavras-chave reservadas
          if (['if', 'for', 'while', 'switch', 'catch', 'constructor', 'function', 'class', 'return', 'import', 'export'].includes(methodName)) {
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

  // Encontra as definições/ocorrências de um símbolo clicado
  findDefinition(currentFilePath, symbolName, lineText = '') {
    if (!symbolName) return [];
    const normCurrent = normalizePath(currentFilePath);
    const candidates = this.symbolMap.get(symbolName) || [];

    if (candidates.length === 0) return [];

    const formatted = candidates.map(c => {
      const relPath = this.projectPath ? path.relative(this.projectPath, c.filePath).replace(/\\/g, '/') : c.filePath;
      return {
        filePath: c.filePath,
        relativePath: relPath,
        line: c.line,
        col: c.col,
        symbol: c.name,
        kind: c.kind || 'method',
        className: c.owner ? c.owner.name : (c.kind === 'class' ? c.name : null)
      };
    });

    if (formatted.length === 1) return formatted;

    const currentData = this.fileMap.get(normCurrent);
    const sorted = [...formatted].sort((a, b) => {
      if (a.filePath === normCurrent) return -1;
      if (b.filePath === normCurrent) return 1;
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
