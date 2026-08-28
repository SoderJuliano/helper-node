// services/java/javaSourceResolver.js
const fs = require('fs');
const path = require('path');
const { JDK_ALWAYS_OK_PREFIXES, JDK_FQN_MAP, getJdkSrcZip } = require('./javaJdkConstants.js');
const { readZipClassEntries, readZipEntryContent, readZipEntryRawBuffer } = require('./javaZipReader.js');
const { decompileClassFile } = require('./javaDecompiler.js');
const { findJavaProjectRoot } = require('./javaProjectRoot.js');
const { findJarForFqn, findGradleSourcesJar } = require('./javaClasspathResolver.js');
const { getOrBuildProjectIndex } = require('./javaProjectCache.js');
const {
  scanDirForFile,
  findSourceFileForFqn,
  findSymbolLineInClassSource,
  collectImports,
} = require('./javaSourceFinder.js');

function encodeVirtualPath(jarPath, fqcn) {
  return String(jarPath).replace(/\\/g, '/') + '!' + fqcn.replace(/\./g, '/') + '.java';
}

function parseVirtualPath(vpath) {
  const norm = String(vpath).replace(/\\/g, '/');
  const m = /^(.*\.(?:jar|zip))!(.+)\.java$/.exec(norm);
  if (!m) return null;
  return { jarPath: m[1], fqcn: m[2].replace(/\//g, '.') };
}

function isVirtualPath(vpath) {
  return typeof vpath === 'string' && /\.(?:jar|zip)!.+\.java$/.test(vpath.replace(/\\/g, '/'));
}

function isSupported(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.java');
}

function resolveClassFqn(proj, className, lineText, content, rootDir, fallbackFilePath = null) {
  if (!className) return null;
  let fqn = null;
  const effectiveRoot = rootDir || (proj && proj.rootDir);

  // 1. Import explícito na própria linha
  const impMatch = lineText && lineText.match(/^\s*import\s+(?:static\s+)?([\w.]+)(\.\*)?\s*;/);
  if (impMatch && !impMatch[2]) {
    const fullImport = impMatch[1];
    const parts = fullImport.split('.');
    const lastPart = parts[parts.length - 1];
    if (lastPart === className || fullImport.includes(className)) {
      fqn = fullImport;
    }
  }

  // 2. Direct & wildcard imports no arquivo
  if (!fqn && content) {
    const imports = collectImports(content);
    const foundDirect = imports.find((i) => !i.isStatic && !i.isWildcard && i.fqn.split('.').pop() === className);
    if (foundDirect) {
      fqn = foundDirect.fqn;
    } else {
      const wildcards = imports.filter((i) => !i.isStatic && i.isWildcard);
      for (const w of wildcards) {
        const candidate = `${w.fqn}.${className}`;
        const localSrc = findSourceFileForFqn(effectiveRoot, candidate, className, fallbackFilePath);
        if (localSrc) {
          return { fqn: candidate, filePath: localSrc, isSource: true };
        }
        if (proj && proj.allClasses && proj.allClasses.has(candidate) && proj.classSource.has(candidate)) {
          fqn = candidate;
          break;
        }
        const jarFound = findJarForFqn(candidate, effectiveRoot);
        if (jarFound) {
          fqn = candidate;
          if (proj && proj.classSource) proj.classSource.set(candidate, jarFound);
          return { fqn: candidate, jarPath: jarFound };
        }
      }
    }
  }

  // 3. Mesmo pacote
  if (!fqn && content) {
    const pkgMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(content);
    if (pkgMatch) {
      const samePkgCandidate = `${pkgMatch[1]}.${className}`;
      const localSrc = findSourceFileForFqn(effectiveRoot, samePkgCandidate, className, fallbackFilePath);
      if (localSrc) {
        return { fqn: samePkgCandidate, filePath: localSrc, isSource: true };
      }
      if (proj && proj.allClasses && proj.allClasses.has(samePkgCandidate) && proj.classSource.has(samePkgCandidate)) {
        fqn = samePkgCandidate;
      }
    }
  }

  // 4. Checa se é um fonte do projeto antes de buscar em bibliotecas externas
  const localSrc = findSourceFileForFqn(effectiveRoot, fqn, className, fallbackFilePath);
  if (localSrc) {
    return { fqn: fqn || className, filePath: localSrc, isSource: true };
  }

  // 5. Busca por nome simples no índice de dependências
  if (!fqn && proj && proj.simpleNameIndex && proj.simpleNameIndex.has(className)) {
    const candidates = Array.from(proj.simpleNameIndex.get(className));
    for (const cand of candidates) {
      if (proj.classSource.has(cand)) {
        fqn = cand;
        break;
      }
    }
  }

  // 6. Verificação de classes padrão do JDK
  if (!fqn && JDK_FQN_MAP.has(className)) {
    fqn = JDK_FQN_MAP.get(className);
    const jdkSrc = getJdkSrcZip();
    return { fqn, jarPath: jdkSrc || 'JDK' };
  }

  if (!fqn) return null;

  if (JDK_ALWAYS_OK_PREFIXES.some(p => fqn.startsWith(p))) {
    const jdkSrc = getJdkSrcZip();
    return { fqn, jarPath: jdkSrc || 'JDK' };
  }

  let jarPath = proj && proj.classSource ? proj.classSource.get(fqn) : null;
  if (!jarPath) {
    jarPath = findJarForFqn(fqn, effectiveRoot);
    if (jarPath && proj && proj.classSource) {
      proj.classSource.set(fqn, jarPath);
    }
  }

  if (jarPath && (fs.existsSync(jarPath) || jarPath === 'JDK' || jarPath.includes('src.zip'))) {
    return { fqn, jarPath };
  }

  return null;
}

function resolveSymbolToJar(filePath, symbol, lineText, content) {
  if (!isSupported(filePath) && !isVirtualPath(filePath)) return null;
  if (!symbol) return null;
  let proj = null;
  try {
    proj = getOrBuildProjectIndex(filePath);
  } catch (_) {}

  const foundRoot = findJavaProjectRoot(filePath);
  const rootDir = (proj && proj.rootDir) || (foundRoot && foundRoot.rootDir) || null;

  // 0. Clique em import estático
  const staticImpMatch = lineText && lineText.match(/^\s*import\s+static\s+([\w.]+)(?:\.\*)?\s*;/);
  if (staticImpMatch) {
    const fullStatic = staticImpMatch[1];
    const parts = fullStatic.split('.');
    let classParts = [...parts];
    let memberName = null;
    if (parts.length >= 2 && /^[A-Z]/.test(parts[parts.length - 2])) {
      memberName = classParts.pop();
    }
    const classFqn = classParts.join('.');
    const classNameFromFqn = classParts[classParts.length - 1];

    const localSrc = findSourceFileForFqn(rootDir, classFqn, classNameFromFqn, filePath);
    if (localSrc && fs.existsSync(localSrc)) {
      let fileContent = '';
      try { fileContent = fs.readFileSync(localSrc, 'utf8'); } catch (_) {}
      const targetSymbol = memberName || symbol;
      const targetLine = findSymbolLineInClassSource(fileContent, targetSymbol);
      return {
        fqn: classFqn,
        fqcn: classFqn,
        filePath: localSrc,
        targetLine,
        className: classNameFromFqn,
        isMethod: Boolean(memberName),
        isSource: true,
      };
    }

    let jarFound = (proj && proj.classSource && proj.classSource.get(classFqn)) || findJarForFqn(classFqn, rootDir || (proj && proj.rootDir));
    if (jarFound) {
      const src = getClassSource(jarFound, classFqn);
      const targetSymbol = memberName || symbol;
      const targetLine = src && src.available ? findSymbolLineInClassSource(src.content, targetSymbol) : 1;
      return {
        fqn: classFqn,
        fqcn: classFqn,
        jarPath: jarFound,
        targetLine,
        className: classNameFromFqn,
        isMethod: Boolean(memberName),
      };
    }
  }

  // A. Resolver diretamente como classe
  const classRes = resolveClassFqn(proj, symbol, lineText, content, rootDir, filePath);
  if (classRes) {
    if (classRes.isSource && classRes.filePath) {
      let fileContent = '';
      try { fileContent = fs.readFileSync(classRes.filePath, 'utf8'); } catch (_) {}
      const targetLine = findSymbolLineInClassSource(fileContent, symbol);
      return {
        fqn: classRes.fqn,
        fqcn: classRes.fqn,
        filePath: classRes.filePath,
        targetLine,
        className: classRes.fqn.split('.').pop() || symbol,
        isMethod: false,
        isSource: true,
      };
    }
    if (classRes.jarPath) {
      return {
        fqn: classRes.fqn,
        fqcn: classRes.fqn,
        jarPath: classRes.jarPath,
        targetLine: 1,
        className: classRes.fqn.split('.').pop() || symbol,
        isMethod: false,
      };
    }
  }

  const escapedSym = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // B. Chamada com receptor (ex: userService.saveUser(...) ou PaymentService.process(...))
  if (lineText) {
    const mRec = lineText.match(new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\.\\s*${escapedSym}\\b`));
    if (mRec && mRec[1] && mRec[1] !== 'this' && mRec[1] !== 'super') {
      const receptor = mRec[1];
      let targetClassName = null;

      if (/^[A-Z]/.test(receptor)) {
        targetClassName = receptor;
      } else if (content) {
        const mType = content.match(new RegExp(`([A-Z][A-Za-z0-9_$]*)(?:<[^>]*>)?\\s+${receptor}\\b`));
        if (mType) targetClassName = mType[1];
      }

      if (!targetClassName && receptor.length > 0) {
        targetClassName = receptor.charAt(0).toUpperCase() + receptor.slice(1);
      }

      if (targetClassName) {
        const recRes = resolveClassFqn(proj, targetClassName, lineText, content, rootDir, filePath);
        if (recRes) {
          if (recRes.isSource && recRes.filePath) {
            let fileContent = '';
            try { fileContent = fs.readFileSync(recRes.filePath, 'utf8'); } catch (_) {}
            let targetLine = findSymbolLineInClassSource(fileContent, symbol);

            // Se for interface e não achou implementação no arquivo, tenta a classe Impl
            if (targetLine === 1 || fileContent.includes('interface ' + targetClassName)) {
              const implPath = findSourceFileForFqn(rootDir, null, targetClassName + 'Impl', filePath);
              if (implPath && fs.existsSync(implPath)) {
                let implContent = '';
                try { implContent = fs.readFileSync(implPath, 'utf8'); } catch (_) {}
                const implLine = findSymbolLineInClassSource(implContent, symbol);
                if (implLine > 1) {
                  return {
                    fqn: recRes.fqn + 'Impl',
                    fqcn: recRes.fqn + 'Impl',
                    filePath: implPath,
                    targetLine: implLine,
                    className: targetClassName + 'Impl',
                    isMethod: true,
                    isSource: true,
                  };
                }
              }
            }

            return {
              fqn: recRes.fqn,
              fqcn: recRes.fqn,
              filePath: recRes.filePath,
              targetLine,
              className: targetClassName,
              isMethod: true,
              isSource: true,
            };
          }

          if (recRes.jarPath) {
            const src = getClassSource(recRes.jarPath, recRes.fqn);
            const targetLine = src && src.available ? findSymbolLineInClassSource(src.content, symbol) : 1;
            return {
              fqn: recRes.fqn,
              fqcn: recRes.fqn,
              jarPath: recRes.jarPath,
              targetLine,
              className: targetClassName,
              isMethod: true,
            };
          }
        }
      }
    }
  }

  // C. Imports estáticos
  if (content) {
    const staticImports = [];
    const RE_STATIC = /^\s*import\s+static\s+([\w.]+)(\.\*)?\s*;/gm;
    let m;
    while ((m = RE_STATIC.exec(content)) !== null) {
      staticImports.push({ fqn: m[1], isWildcard: Boolean(m[2]) });
    }

    const foundDirectStatic = staticImports.find((i) => !i.isWildcard && i.fqn.split('.').pop() === symbol);
    if (foundDirectStatic) {
      const parts = foundDirectStatic.fqn.split('.');
      parts.pop();
      const classFqn = parts.join('.');
      const className = classFqn.split('.').pop();

      const localSrc = findSourceFileForFqn(rootDir, classFqn, className, filePath);
      if (localSrc && fs.existsSync(localSrc)) {
        let fileContent = '';
        try { fileContent = fs.readFileSync(localSrc, 'utf8'); } catch (_) {}
        const targetLine = findSymbolLineInClassSource(fileContent, symbol);
        return { fqn: classFqn, fqcn: classFqn, filePath: localSrc, targetLine, className, isMethod: true, isSource: true };
      }

      let jarFound = (proj && proj.classSource && proj.classSource.get(classFqn)) || findJarForFqn(classFqn, rootDir || (proj && proj.rootDir));
      if (jarFound) {
        const src = getClassSource(jarFound, classFqn);
        const targetLine = src && src.available ? findSymbolLineInClassSource(src.content, symbol) : 1;
        return { fqn: classFqn, fqcn: classFqn, jarPath: jarFound, targetLine, className, isMethod: true };
      }
    }

    const wildcardStatics = staticImports.filter((i) => i.isWildcard);
    for (const ws of wildcardStatics) {
      const classFqn = ws.fqn;
      const className = classFqn.split('.').pop();
      const localSrc = findSourceFileForFqn(rootDir, classFqn, className, filePath);
      if (localSrc && fs.existsSync(localSrc)) {
        let fileContent = '';
        try { fileContent = fs.readFileSync(localSrc, 'utf8'); } catch (_) {}
        if (new RegExp(`\\b${escapedSym}\\b`).test(fileContent)) {
          const targetLine = findSymbolLineInClassSource(fileContent, symbol);
          return { fqn: classFqn, fqcn: classFqn, filePath: localSrc, targetLine, className, isMethod: true, isSource: true };
        }
      }

      let jarFound = (proj && proj.classSource && proj.classSource.get(classFqn)) || findJarForFqn(classFqn, rootDir || (proj && proj.rootDir));
      if (jarFound) {
        const src = getClassSource(jarFound, classFqn);
        if (src && src.available && new RegExp(`\\b${escapedSym}\\b`).test(src.content)) {
          const targetLine = findSymbolLineInClassSource(src.content, symbol);
          return { fqn: classFqn, fqcn: classFqn, jarPath: jarFound, targetLine, className, isMethod: true };
        }
      }
    }
  }

  return null;
}

function getClassSource(jarPath, fqcn) {
  if (!fqcn) return { available: false, reason: 'Classe não especificada.' };
  const relJava = fqcn.replace(/\./g, '/') + '.java';

  const jdkSrc = (jarPath && (jarPath.includes('src.zip') || jarPath === 'JDK'))
    ? (jarPath.includes('src.zip') ? jarPath : getJdkSrcZip())
    : (JDK_ALWAYS_OK_PREFIXES.some(p => fqcn.startsWith(p)) ? getJdkSrcZip() : null);

  if (jdkSrc && fs.existsSync(jdkSrc)) {
    const content = readZipEntryContent(jdkSrc, relJava);
    if (content != null) return { available: true, content };
  }

  let effectiveJar = jarPath;
  if (!effectiveJar || !fs.existsSync(effectiveJar)) {
    const diskJar = findJarForFqn(fqcn);
    if (diskJar) effectiveJar = diskJar;
  }

  if (effectiveJar && (effectiveJar.toLowerCase().endsWith('.jar') || effectiveJar.toLowerCase().endsWith('.zip')) && fs.existsSync(effectiveJar)) {
    const mavenSourcesJar = effectiveJar.replace(/\.jar$/i, '-sources.jar');
    if (fs.existsSync(mavenSourcesJar)) {
      const content = readZipEntryContent(mavenSourcesJar, relJava);
      if (content != null) return { available: true, content };
    }

    const gradleSourcesJar = findGradleSourcesJar(effectiveJar);
    if (gradleSourcesJar && fs.existsSync(gradleSourcesJar)) {
      const content = readZipEntryContent(gradleSourcesJar, relJava);
      if (content != null) return { available: true, content };
    }

    const relClass = fqcn.replace(/\./g, '/') + '.class';
    const classBuf = readZipEntryRawBuffer(effectiveJar, relClass);
    if (classBuf) {
      const decompiled = decompileClassFile(classBuf, effectiveJar, fqcn);
      if (decompiled) return { available: true, content: decompiled };
    }
  }

  const parts = fqcn.split('.');
  const simpleName = parts.pop();
  const pkgName = parts.join('.');
  let code = `// Dependência: ${path.basename(jarPath || 'library.jar')}!${fqcn.replace(/\\./g, '/')}.class\n\n`;
  if (pkgName) code += `package ${pkgName};\n\n`;
  code += `public class ${simpleName} {\n    // Informações de bytecode não disponíveis localmente\n}\n`;
  return { available: true, content: code };
}

function listDependencyJars(dirPath) {
  const proj = getOrBuildProjectIndex(path.join(dirPath, '__helper_ide_dep_probe__.java'));
  if (!proj) return { status: 'unsupported' };
  const jars = (proj.classpathEntries || []).map((p) => ({ path: p, name: path.basename(p) }));
  jars.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  if (proj.status === 'building' && jars.length === 0) return { status: 'building' };
  if (proj.status === 'error' && jars.length === 0) return { status: 'error', error: proj.error };
  return { status: 'ready', jars, warning: proj.error || proj.warning };
}

function listJarClasses(jarPath) {
  const fqns = new Set();
  for (const entryName of readZipClassEntries(jarPath)) {
    if (!entryName.endsWith('.class')) continue;
    const dotted = entryName.slice(0, -6).replace(/\//g, '.');
    if (/\$\d/.test(dotted)) continue;
    fqns.add(dotted.replace(/\$/g, '.'));
  }
  return Array.from(fqns).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

module.exports = {
  isSupported,
  collectImports,
  encodeVirtualPath,
  parseVirtualPath,
  isVirtualPath,
  findSymbolLineInClassSource,
  resolveClassFqn,
  resolveSymbolToJar,
  getClassSource,
  listDependencyJars,
  listJarClasses,
};
