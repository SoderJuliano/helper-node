// services/java/autoImport/javaAutoImportService.js
// Servico orquestrador de Auto-Import para Java e Spring Boot no modo IDE.

const { extractUnresolvedSymbols } = require('./javaSymbolExtractor.js');
const { rankCandidates } = require('./javaRanker.js');
const { injectImport, collapsePackageImports } = require('./javaImportInjector.js');
const { findJavaProjectRoot } = require('../javaProjectRoot.js');
const { getOrBuildProjectIndex } = require('../javaProjectCache.js');

class JavaAutoImportService {
  /**
   * Analisa o codigo fonte Java e retorna diagnosticos com sugestoes de auto-import.
   * @param {string} filePath Caminho do arquivo .java
   * @param {string} content Conteudo do editor
   * @returns {Array} Lista de diagnosticos para o CodeMirror
   */
  static getDiagnostics(filePath, content) {
    if (!filePath || !filePath.toLowerCase().endsWith('.java') || typeof content !== 'string') {
      return [];
    }

    let projectIndex = null;
    try {
      projectIndex = getOrBuildProjectIndex(filePath);
    } catch (_) {}

    const foundRoot = findJavaProjectRoot(filePath);
    const currentPackage = foundRoot ? foundRoot.rootDir : '';

    const symbols = extractUnresolvedSymbols(content, projectIndex);
    const diagnostics = [];

    for (const sym of symbols) {
      const candidates = rankCandidates(sym.name, projectIndex, currentPackage);
      if (candidates.length === 0) continue;

      const topFqn = candidates[0].fqn;
      const suggestions = candidates.map(c => c.fqn);

      diagnostics.push({
        line: sym.line,
        col: sym.col,
        endLine: sym.endLine,
        endCol: sym.endCol,
        symbolName: sym.name,
        message: candidates.length === 1
          ? `Nao foi possivel resolver o simbolo '${sym.name}'. Sugestao: ${topFqn}`
          : `Nao foi possivel resolver o simbolo '${sym.name}' (${candidates.length} opcoes encontradas).`,
        suggestions,
        suggestionDetails: candidates,
        isAutoImport: true,
        recommendedFqn: topFqn,
      });
    }

    // Otimizacao/Colapso: Detecta 2 ou mais imports individuais do mesmo pacote
    const lines = content.split('\n');
    const packageCount = new Map();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const m = line.match(/^import\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)\s*;/);
      if (m && !line.startsWith('import static') && !line.includes('*')) {
        const fqn = m[1];
        const lastDot = fqn.lastIndexOf('.');
        if (lastDot > 0) {
          const pkg = fqn.substring(0, lastDot);
          if (!packageCount.has(pkg)) {
            packageCount.set(pkg, { count: 0, lineIdx: i + 1, imports: [] });
          }
          const entry = packageCount.get(pkg);
          entry.count++;
          entry.imports.push(fqn);
        }
      }
    }

    for (const [pkg, info] of packageCount.entries()) {
      if (info.count >= 2) {
        diagnostics.push({
          line: info.lineIdx,
          col: 1,
          endLine: info.lineIdx,
          endCol: lines[info.lineIdx - 1] ? lines[info.lineIdx - 1].length + 1 : 20,
          symbolName: pkg,
          message: `Otimizar imports: ${info.count} imports do pacote '${pkg}'. Sugestao: substituir por 'import ${pkg}.*;'`,
          suggestions: [`import ${pkg}.*;`],
          isPackageCollapse: true,
          targetPackage: pkg,
          recommendedFqn: `${pkg}.*`,
          severity: 'info'
        });
      }
    }

    return diagnostics;
  }

  /**
   * Insere um import na posicao correta do arquivo Java.
   * @param {string} content Conteudo original
   * @param {string} fqn FQN da classe a ser importada
   * @returns {string} Novo conteudo
   */
  static applyImport(content, fqn) {
    return injectImport(content, fqn);
  }

  /**
   * Agrupa imports de um pacote em um unico wildcard.
   * @param {string} content Conteudo original
   * @param {string} targetPackage Pacote a ser colapsado
   * @returns {string} Novo conteudo
   */
  static applyCollapse(content, targetPackage) {
    return collapsePackageImports(content, targetPackage);
  }
}

module.exports = JavaAutoImportService;