// services/javaImportChecker.js
// Checador de imports para Java (Maven e Gradle) no modo IDE, igual ao IntelliJ:
// sublinha import que não existe no classpath e sugere a classe mais parecida.

const { JDK_ALWAYS_OK_PREFIXES } = require('./java/javaJdkConstants.js');
const { findJavaProjectRoot, normalizePath } = require('./java/javaProjectRoot.js');
const { projectCache, getOrBuildProjectIndex } = require('./java/javaProjectCache.js');
const { suggestForSimpleName } = require('./java/javaLevenshtein.js');
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
  const proj = getOrBuildProjectIndex(filePath);
  if (!proj || proj.status !== 'ready') return [];

  const imports = collectImports(content);
  const diagnostics = [];

  for (const imp of imports) {
    if (JDK_ALWAYS_OK_PREFIXES.some((p) => imp.fqn.startsWith(p))) continue;
    if (imp.isWildcard) {
      if (!proj.knownPackages.has(imp.fqn)) {
        diagnostics.push({
          line: imp.line,
          fqn: imp.fqn,
          message: `Pacote '${imp.fqn}' não foi encontrado no classpath.`,
          suggestions: [],
        });
      }
    } else {
      if (!proj.allClasses.has(imp.fqn)) {
        const simpleName = imp.fqn.split('.').pop();
        const suggestions = suggestForSimpleName(simpleName, proj.simpleNameIndex);
        diagnostics.push({
          line: imp.line,
          fqn: imp.fqn,
          message: `Não foi possível resolver o import '${imp.fqn}'.`,
          suggestions,
        });
      }
    }
  }

  return diagnostics;
}

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
};
