// services/javaImportChecker.js
// Checador de imports para Java (Maven e Gradle) no modo IDE, igual ao IntelliJ:
// sublinha imports quebrados e simbolos nao resolvidos com sugestoes de auto-import (Spring/JDK).

const { JDK_ALWAYS_OK_PREFIXES } = require('./java/javaJdkConstants.js');
const { findJavaProjectRoot, normalizePath } = require('./java/javaProjectRoot.js');
const { projectCache, getOrBuildProjectIndex } = require('./java/javaProjectCache.js');
const { suggestForSimpleName } = require('./java/javaLevenshtein.js');
const JavaAutoImportService = require('./java/autoImport/javaAutoImportService.js');
const {
  isSupported,
  collectImports,
  resolveSymbolToJar,
  encodeVirtualPath,
  parseVirtualPath,
  isVirtualPath,
  getClassSource,
  listDependencyJars,
  listJarClasses,
} = require('./java/javaSourceResolver.js');

function getStatus(filePath) {
  const found = findJavaProjectRoot(filePath);
  if (!found) return { recognized: false };
  const key = normalizePath(found.rootDir) + '|' + found.type;
  const entry = projectCache.get(key);
  return {
    recognized: true,
    type: found.type,
    rootDir: found.rootDir,
    status: entry ? entry.status : 'idle',
    error: entry ? entry.error : null,
  };
}

function reset() {
  projectCache.clear();
}

function getDiagnostics(filePath, content) {
  if (!isSupported(filePath) || typeof content !== 'string') return [];
  const diagnostics = [];

  // Extrai simbolos, anotacoes e classes nao resolvidos no corpo do codigo
  // (ex: ObjectUtils.isNull, Arrays.stream, @RestController, ArrayList)
  // e sugere auto-imports corretos (Spring Boot, JDK, Projeto).
  // Nunca sublinha as linhas de 'import ...' existentes no topo do arquivo.
  try {
    const autoImportDiags = JavaAutoImportService.getDiagnostics(filePath, content);
    if (Array.isArray(autoImportDiags)) {
      diagnostics.push(...autoImportDiags);
    }
  } catch (e) {
    console.warn('[javaImportChecker] Erro ao extrair auto-imports:', e.message);
  }

  return diagnostics;
}

const { detectProjectType, syncDependencies, clearCacheForProject, getSyncLog } = require('./java/javaSyncDependencies.js');

module.exports = {
  isSupported,
  getDiagnostics,
  getStatus,
  reset,
  resolveSymbolToJar,
  encodeVirtualPath,
  parseVirtualPath,
  isVirtualPath,
  getClassSource,
  listDependencyJars,
  listJarClasses,
  JavaAutoImportService,
  detectProjectType,
  syncDependencies,
  clearCacheForProject,
  getSyncLog,
};

