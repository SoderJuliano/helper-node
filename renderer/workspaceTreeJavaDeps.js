// renderer/workspaceTreeJavaDeps.js
// Synthetic Java dependencies tree loader (Maven/Gradle jars & package exploration)
(function() {
  'use strict';

  async function fetchJavaDepsChildren(e) {
    if (!window.electronAPI || !window.electronAPI.javaDepsListJars) return { entries: [], retry: false };
    let res = null;
    const projectDir = e.projectRoot || e.path.replace(/::dependencies$/, '').replace(/#dependencies$/, '');
    try { res = await window.electronAPI.javaDepsListJars({ dirPath: projectDir }); } catch (_) {}
    if (!res || res.status === 'building') {
      return { entries: [{ path: e.path + '#building', name: 'Resolvendo classpath (mvn/gradle)…', depth: 0, isDir: false, synthetic: 'java-deps-status' }], retry: true };
    }
    if (res.status === 'error') {
      return { entries: [{ path: e.path + '#error', name: 'Erro ao resolver classpath: ' + (res.error || '?'), depth: 0, isDir: false, synthetic: 'java-deps-status' }], retry: false };
    }
    const jars = res.jars || [];
    if (!jars.length) {
      return { entries: [{ path: e.path + '#empty', name: '(nenhuma dependência resolvida)', depth: 0, isDir: false, synthetic: 'java-deps-status' }], retry: false };
    }
    return { entries: jars.map((j) => ({ path: j.path, name: j.name, depth: 0, isDir: true, lazy: true, synthetic: 'java-jar' })), retry: false };
  }

  async function fetchJavaJarChildren(e) {
    if (!window.electronAPI || !window.electronAPI.javaDepsListClasses) return { entries: [], retry: false };
    let res = null;
    try { res = await window.electronAPI.javaDepsListClasses({ jarPath: e.path }); } catch (_) {}
    const classes = (res && res.classes) || [];
    if (!classes.length) {
      return { entries: [{ path: e.path + '#empty', name: '(sem classes)', depth: 0, isDir: false, synthetic: 'java-deps-status' }], retry: false };
    }

    const packageMap = new Map();
    for (const c of classes) {
      const fqcn = c.fqcn;
      const lastDot = fqcn.lastIndexOf('.');
      const pkg = lastDot > 0 ? fqcn.substring(0, lastDot) : '(default package)';
      const simpleName = lastDot > 0 ? fqcn.substring(lastDot + 1) : fqcn;

      if (!packageMap.has(pkg)) {
        packageMap.set(pkg, []);
      }
      packageMap.get(pkg).push({
        path: c.virtualPath,
        name: simpleName,
        depth: 1,
        isDir: false,
        synthetic: 'java-class'
      });
    }

    const sortedPkgs = Array.from(packageMap.keys()).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const entries = [];
    const expPaths = window.expandedDirPaths || new Set();

    for (const pkg of sortedPkgs) {
      const pkgPath = e.path + '#' + pkg;
      const isPkgExpanded = expPaths.has(pkgPath);
      entries.push({
        path: pkgPath,
        name: pkg,
        depth: 0,
        isDir: true,
        lazy: false,
        collapsed: !isPkgExpanded,
        synthetic: 'java-pkg'
      });

      const pkgClasses = packageMap.get(pkg);
      pkgClasses.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      for (const cls of pkgClasses) {
        entries.push(cls);
      }
    }

    return { entries, retry: false };
  }

  window.fetchJavaDepsChildren = fetchJavaDepsChildren;
  window.fetchJavaJarChildren = fetchJavaJarChildren;
})();
