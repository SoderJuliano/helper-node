// services/importChecker.js
// Checador de imports/símbolos para JS/TS no modo IDE, via TypeScript Compiler API
// (ts.LanguageService com overlay de conteúdo não salvo do editor).
// Sublinha imports quebrados/símbolos não resolvidos e sugere auto-import,
// igual ao IntelliJ, mas isolado num módulo próprio (não mexe no symbolIndexer).

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const SUPPORTED_EXTS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'target', '.idea', '.vscode', '.claude', '.gemini',
  'vendor', 'bin', 'obj', '.next', '.nuxt', '.cache', '__pycache__', 'venv', '.venv', 'env',
  'coverage', '.output', 'out', 'temp', 'tmp', 'logs', '.bundle'
]);

const PROJECT_FILES_TTL_MS = 15000;
const MAX_PROJECT_FILES = 20000;

// Códigos de diagnóstico do TS relacionados a import/símbolo não resolvido
// (o resto — erros de tipo etc. — fica fora do escopo do "checador de import").
const IMPORT_DIAGNOSTIC_CODES = new Set([
  2307, // Cannot find module 'x'
  2306, // File 'x' is not a module
  2304, // Cannot find name 'x'
  2305, // Module has no exported member 'x'
  2551, // Property does not exist, did you mean 'y'
  2552, // Cannot find name 'x'. Did you mean 'y'?
  2724, // has no exported member named 'x'. Did you mean 'y'?
  2792, // Cannot find module. Did you mean to set moduleResolution?
  7016, // Could not find a declaration file for module 'x'
]);

function normalizePath(p) {
  if (!p) return '';
  let norm = path.normalize(p).replace(/\\/g, '/');
  if (norm.length >= 2 && norm[1] === ':') {
    norm = norm[0].toUpperCase() + norm.substring(1);
  }
  return norm;
}

// Uma "project instance" = um ts.LanguageService cobrindo todos os arquivos
// sob a raiz do projeto (mais próximo tsconfig.json ou package.json/pasta workspace).
// Reaproveitado entre chamadas; conteúdo de arquivos abertos vem do overlay.
class ProjectInstance {
  constructor(rootDir) {
    this.rootDir = normalizePath(rootDir);
    this.overlay = new Map(); // filePath normalizado -> conteúdo em memória (não salvo)
    this.fileVersions = new Map(); // filePath -> number
    this.projectFiles = []; // todos os .js/.ts do projeto (não só os abertos), p/ auto-import entre arquivos
    this.projectFilesScannedAt = 0;
    this.compilerOptions = this.loadCompilerOptions();
    this.languageService = this.createLanguageService();
  }

  // Varre o projeto pra achar todos os arquivos JS/TS — sem isso o LanguageService
  // só enxerga o arquivo aberto no overlay e nunca sugere auto-import de outro arquivo.
  scanProjectFiles() {
    const results = [];
    const stack = [this.rootDir];
    while (stack.length > 0 && results.length < MAX_PROJECT_FILES) {
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
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTS.has(ext)) results.push(normalizePath(full));
        }
      }
    }
    return results;
  }

  ensureProjectFilesFresh() {
    const now = Date.now();
    if (now - this.projectFilesScannedAt > PROJECT_FILES_TTL_MS) {
      this.projectFiles = this.scanProjectFiles();
      this.projectFilesScannedAt = now;
    }
  }

  loadCompilerOptions() {
    const base = {
      allowJs: true,
      checkJs: true,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      noEmit: true,
      skipLibCheck: true,
      strict: false,
    };

    try {
      const tsconfigPath = ts.findConfigFile(this.rootDir, ts.sys.fileExists, 'tsconfig.json');
      if (tsconfigPath) {
        const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
        if (!configFile.error) {
          const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
          if (parsed && parsed.options) {
            return { ...base, ...parsed.options, noEmit: true, checkJs: true, allowJs: true };
          }
        }
      }
    } catch (_) {}

    return base;
  }

  getScriptFileNames() {
    this.ensureProjectFilesFresh();
    const set = new Set(this.projectFiles);
    for (const f of this.overlay.keys()) set.add(f);
    return Array.from(set);
  }

  setFileContent(filePath, content) {
    const norm = normalizePath(filePath);
    const prevVersion = this.fileVersions.get(norm) || 0;
    this.overlay.set(norm, content);
    this.fileVersions.set(norm, prevVersion + 1);
  }

  createLanguageService() {
    const self = this;
    const host = {
      getScriptFileNames: () => self.getScriptFileNames(),
      getScriptVersion: (fileName) => String(self.fileVersions.get(normalizePath(fileName)) || 0),
      getScriptSnapshot: (fileName) => {
        const norm = normalizePath(fileName);
        if (self.overlay.has(norm)) {
          return ts.ScriptSnapshot.fromString(self.overlay.get(norm));
        }
        if (!fs.existsSync(fileName)) return undefined;
        try {
          return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
        } catch (_) {
          return undefined;
        }
      },
      getCurrentDirectory: () => self.rootDir,
      getCompilationSettings: () => self.compilerOptions,
      getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
      resolveModuleNames: undefined, // usa resolução padrão do host
    };
    return ts.createLanguageService(host, ts.createDocumentRegistry());
  }
}

// rootDir normalizado -> ProjectInstance
const projectCache = new Map();

function findProjectRoot(filePath) {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    if (fs.existsSync(path.join(dir, 'tsconfig.json')) || fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(filePath);
}

function getProjectInstance(filePath) {
  const rootDir = normalizePath(findProjectRoot(filePath));
  let proj = projectCache.get(rootDir);
  if (!proj) {
    proj = new ProjectInstance(rootDir);
    projectCache.set(rootDir, proj);
  }
  return proj;
}

function isSupported(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return SUPPORTED_EXTS.has(ext);
}

function toDiagnosticItem(diag, sourceFile) {
  const messageText = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
  let line = 1, col = 1, endLine = 1, endCol = 1;
  if (typeof diag.start === 'number' && sourceFile) {
    const start = sourceFile.getLineAndCharacterOfPosition(diag.start);
    const end = sourceFile.getLineAndCharacterOfPosition(diag.start + (diag.length || 0));
    line = start.line + 1;
    col = start.character + 1;
    endLine = end.line + 1;
    endCol = end.character + 1;
  }
  return {
    code: diag.code,
    message: messageText,
    severity: diag.category === ts.DiagnosticCategory.Error ? 'error' : 'warning',
    line, col, endLine, endCol,
    start: diag.start,
    length: diag.length,
  };
}

/**
 * Retorna diagnósticos de import/símbolo não resolvido para o arquivo, usando
 * o conteúdo do editor (pode ter alterações não salvas).
 */
function getDiagnostics(filePath, content) {
  if (!filePath || !isSupported(filePath)) return [];
  try {
    const proj = getProjectInstance(filePath);
    const norm = normalizePath(filePath);
    proj.setFileContent(norm, content != null ? content : (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''));

    const semantic = proj.languageService.getSemanticDiagnostics(norm);
    const syntactic = proj.languageService.getSyntacticDiagnostics(norm);
    const all = [...syntactic, ...semantic];

    const sourceFile = proj.languageService.getProgram()?.getSourceFile(norm);

    return all
      .filter((d) => IMPORT_DIAGNOSTIC_CODES.has(d.code))
      .map((d) => toDiagnosticItem(d, sourceFile));
  } catch (e) {
    console.warn('[importChecker] Erro ao obter diagnósticos:', e.message);
    return [];
  }
}

/**
 * Retorna quick fixes (inclui auto-import) disponíveis na posição de um diagnóstico.
 */
function getQuickFixes(filePath, content, start, length, errorCodes) {
  if (!filePath || !isSupported(filePath)) return [];
  try {
    const proj = getProjectInstance(filePath);
    const norm = normalizePath(filePath);
    proj.setFileContent(norm, content != null ? content : (fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''));

    const fixes = proj.languageService.getCodeFixesAtPosition(
      norm, start, start + length, errorCodes, ts.getDefaultFormatCodeSettings(), {}
    );

    return fixes.map((fix, idx) => ({
      id: idx,
      description: fix.description,
      fixName: fix.fixName,
      changes: fix.changes.map((c) => ({
        fileName: c.fileName,
        textChanges: c.textChanges.map((tc) => ({
          start: tc.span.start,
          length: tc.span.length,
          newText: tc.newText,
        })),
      })),
    }));
  } catch (e) {
    console.warn('[importChecker] Erro ao obter quick fixes:', e.message);
    return [];
  }
}

// Limpa a instância de projeto em cache (ex.: ao trocar de workspace)
function reset() {
  projectCache.clear();
}

module.exports = {
  isSupported,
  getDiagnostics,
  getQuickFixes,
  reset,
};
