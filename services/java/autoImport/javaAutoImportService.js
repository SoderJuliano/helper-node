// services/java/autoImport/javaAutoImportService.js
// Servico orquestrador de Auto-Import para Java e Spring Boot no modo IDE.

const { extractUnresolvedSymbols } = require('./javaSymbolExtractor.js');
const { rankCandidates } = require('./javaRanker.js');
const { injectImport } = require('./javaImportInjector.js');
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
}

module.exports = JavaAutoImportService;