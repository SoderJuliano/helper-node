// services/symbolIndexer/symbolFinder.js
const fs = require('fs');
const path = require('path');
const { normalizePath } = require('./symbolConstants.js');
const { scanDir, findUsages: findUsagesInternal } = require('./symbolUsageFinder.js');

function tryResolveFilePath(indexer, currentFilePath, rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  const cleanPath = rawPath.trim().replace(/^['"`]|['"`]$/g, '');
  if (!cleanPath) return null;

  const isExplicitPath = cleanPath.startsWith('./') || cleanPath.startsWith('../') || cleanPath.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(cleanPath);
  const isJavaFile = currentFilePath && currentFilePath.toLowerCase().endsWith('.java');

  if (!isExplicitPath) {
    if (isJavaFile) return null;
    if (!/\.[a-zA-Z0-9]+$/.test(cleanPath)) return null;
  }

  const currentDir = currentFilePath ? path.dirname(currentFilePath) : null;
  const projDir = indexer.projectPath;
  const basePaths = [];

  if (path.isAbsolute(cleanPath)) {
    basePaths.push(cleanPath);
  } else if (cleanPath.startsWith('./') || cleanPath.startsWith('../')) {
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
          const relPath = projDir ? path.relative(projDir, candidate).replace(/\\/g, '/') : candidate;
          return [{
            filePath: candidate,
            relativePath: relPath,
            line: 1,
            col: 1,
            symbol: path.basename(candidate),
            kind: 'file'
          }];
        }
      } catch (_) {}
    }
  }

  return null;
}

function searchDefinitionInFile(filePath, symbolName) {
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

  const defRegexes = [
    new RegExp(`^(?:(?:public|protected|private|static|async|export|default)\\s+)*function\\*?\\s+${escaped}\\s*\\(`),
    new RegExp(`^(?:(?:export|default)\\s+)*(?:const|let|var)\\s+${escaped}\\b`),
    new RegExp(`^(?:this\\.)?${escaped}\\s*=\\s*`),
    new RegExp(`^(?:(?:public|protected|private|static|async|get|set)\\s+)*${escaped}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`^${escaped}\\s*:\\s*(?:async\\s+)?(?:function|\\()`),
    new RegExp(`^(?:(?:public|protected|private|abstract|final|export|default)\\s+)*(?:class|interface|enum|record)\\s+${escaped}\\b`),
    new RegExp(`^(?:(?:public|protected|private|static|final|async|override|synchronized|default|native|abstract)\\s+)*(?:<[A-Za-z0-9_$,\\s<>?]+>\\s+)?(?:[A-Za-z0-9_$<>[\\].,?]+(?:\\s*<[A-Za-z0-9_$,\\s<>?]+>)?(?:\\[\\])?)\\s+${escaped}\\s*\\(`),
    new RegExp(`^(?:(?:public|protected|default|abstract)\\s+)*(?:<[A-Za-z0-9_$,\\s<>?]+>\\s+)?(?:[A-Za-z0-9_$<>[\\].,?]+(?:\\s*<[A-Za-z0-9_$,\\s<>?]+>)?(?:\\[\\])?)\\s+${escaped}\\s*\\(`),
    new RegExp(`^(?:(?:public|protected|private|static|final|volatile|transient|const|readonly)\\s+)+[A-Za-z0-9_$<>\\[\\],.?]+\\s+${escaped}\\s*(?:=|;|,|\\)|$)`),
    new RegExp(`^${escaped}(?:\\s*\\([^)]*\\))?\\s*(?:,|;|$)`),
    new RegExp(`^(?:async\\s+)?def\\s+${escaped}\\s*\\(`),
    new RegExp(`^(?:pub\\s+)?(?:async\\s+)?(?:func|fn)\\s+(?:\\([^)]+\\)\\s+)?${escaped}\\s*\\(`)
  ];

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const lineClean = lineText.replace(/@\w+(?:\([^)]*\))?\s*/g, '').trim();
    for (const rx of defRegexes) {
      if (rx.test(lineClean) || rx.test(lineText.trim())) {
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

function findUsages(indexer, currentFilePath, symbolName) {
  return findUsagesInternal(indexer, currentFilePath, symbolName, searchDefinitionInFile);
}

function resolveReceiverType(indexer, normCurrent, symbolName, lineText) {
  if (!symbolName) return null;
  const currentData = normCurrent ? indexer.fileMap.get(normCurrent) : null;
  const escapedSym = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  if (lineText) {
    const mRec = lineText.match(
      new RegExp(`([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\.\\s*${escapedSym}\\b`)
    );
    if (mRec) {
      const receptor = mRec[1];
      if (receptor !== 'this' && receptor !== 'super') {
        const mChain = lineText.match(new RegExp(`([A-Z][A-Za-z0-9_$]*)\\s*\\.\\s*${receptor}\\s*\\.\\s*${escapedSym}\\b`));
        if (mChain && mChain[1]) {
          return mChain[1];
        }

        const mMapper = lineText.match(new RegExp(`(?:getMapper|Mappers\\.getMapper)\\s*\\(\\s*([A-Z][A-Za-z0-9_$]*)\\.class\\s*\\)\\s*\\.\\s*${escapedSym}\\b`));
        if (mMapper && mMapper[1]) {
          return mMapper[1];
        }

        if (currentData && currentData.staticImports) {
          const staticImp = currentData.staticImports.find(si => si.member === receptor || si.isWildcard);
          if (staticImp) {
            return staticImp.className;
          }
        }

        const constSyms = indexer.symbolMap.get(receptor);
        if (constSyms && constSyms.length > 0) {
          const foundField = constSyms.find(s => s.fieldType || (s.owner && s.owner.name));
          if (foundField) {
            return foundField.fieldType || foundField.owner.name;
          }
        }

        if (/_?MAPPER$/i.test(receptor)) {
          const pascal = receptor.toLowerCase()
            .split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
          if (indexer.implementationsMap.has(pascal) || indexer.symbolMap.has(pascal) || indexer.symbolMap.has(pascal + 'Impl')) {
            return pascal;
          }
        }

        if (/^[A-Z]/.test(receptor) && receptor !== 'INSTANCE') {
          return receptor;
        }

        let conteudo = '';
        try { conteudo = fs.readFileSync(normCurrent, 'utf8'); } catch (_) {}
        if (conteudo) {
          const mTipo = conteudo.match(
            new RegExp(`([A-Z][A-Za-z0-9_$]*)(?:<[^>]*>)?\\s+${receptor}\\b\\s*[;=,)]`)
          );
          if (mTipo) return mTipo[1];
        }

        const inferredPascal = receptor.charAt(0).toUpperCase() + receptor.slice(1);
        if (indexer.implementationsMap.has(inferredPascal) || indexer.symbolMap.has(inferredPascal) || indexer.symbolMap.has(inferredPascal + 'Impl')) {
          return inferredPascal;
        }
      }
    }
  }

  if (currentData && currentData.staticImports) {
    const staticImp = currentData.staticImports.find(si => si.member === symbolName || si.isWildcard);
    if (staticImp) {
      return staticImp.className;
    }
  }

  if (normCurrent) {
    try {
      const fileContent = fs.readFileSync(normCurrent, 'utf8');
      const mStaticDirect = fileContent.match(new RegExp(`import\\s+static\\s+[\\w.]+\\.([A-Z][A-Za-z0-9_$]*)\\.${escapedSym}\\s*;`));
      if (mStaticDirect && mStaticDirect[1]) return mStaticDirect[1];

      const mStaticConst = fileContent.match(/import\s+static\s+[\w.]+\.([A-Z][A-Za-z0-9_$]*)\.([A-Z0-9_$]+)\s*;/);
      if (mStaticConst && mStaticConst[1]) return mStaticConst[1];

      const mStaticWildcard = fileContent.match(/import\s+static\s+[\w.]+\.([A-Z][A-Za-z0-9_$]*)\.\*\s*;/);
      if (mStaticWildcard && mStaticWildcard[1]) return mStaticWildcard[1];
    } catch (_) {}
  }

  return null;
}

function findDefinition(indexer, currentFilePath, symbolName, lineText = '') {
  if (!symbolName) return [];
  const normCurrent = normalizePath(currentFilePath);

  if (normCurrent && !indexer.fileMap.has(normCurrent) && fs.existsSync(normCurrent)) {
    indexer.indexSingleFile(normCurrent);
  }

  const fileMatches = tryResolveFilePath(indexer, normCurrent, symbolName);
  if (fileMatches && fileMatches.length > 0) {
    return fileMatches;
  }

  let candidates = [...(indexer.symbolMap.get(symbolName) || [])];

  const implCandidates = [];
  for (const c of candidates) {
    if (c.kind === 'interface-method' || c.kind === 'interface') {
      const ownerName = c.owner ? c.owner.name : c.name;
      if (ownerName) {
        const impls = indexer.implementationsMap.get(ownerName);
        if (impls) {
          for (const impl of impls) {
            const implFileData = indexer.fileMap.get(impl.filePath);
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

  if (candidates.length === 0 && normCurrent && fs.existsSync(normCurrent)) {
    const localMatches = searchDefinitionInFile(normCurrent, symbolName);
    if (localMatches.length > 0) {
      candidates = localMatches;
    }
  }

  if (candidates.length === 0) return [];

  const formatted = candidates.map(c => {
    const relPath = indexer.projectPath ? path.relative(indexer.projectPath, c.filePath).replace(/\\/g, '/') : c.filePath;
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

  const currentData = indexer.fileMap.get(normCurrent);
  const tipoReceptor = resolveReceiverType(indexer, normCurrent, symbolName, lineText);

  const pontos = (c) => {
    let p = 0;
    const isImplClass = c.kind === 'method' && (
      (c.className && c.className.endsWith('Impl')) ||
      (c.filePath && (c.filePath.includes('/generated-sources/') || c.filePath.includes('\\generated-sources\\') || c.filePath.includes('/generated/') || c.filePath.includes('\\generated\\')))
    );

    if (tipoReceptor) {
      const base = path.basename(c.filePath, path.extname(c.filePath));
      const isDirectImpl = c.className === tipoReceptor + 'Impl' || base === tipoReceptor + 'Impl';
      const isDirectInterface = c.className === tipoReceptor || base === tipoReceptor;
      const isMapper = tipoReceptor.toLowerCase().includes('mapper') || (c.className && c.className.toLowerCase().includes('mapper'));

      if (isMapper && isDirectImpl) {
        p += 200;
      } else if (isDirectInterface) {
        p += 150;
      } else if (isDirectImpl) {
        p += 120;
      } else if (c.className && c.className.includes(tipoReceptor)) {
        p += 80;
      } else if (base.includes(tipoReceptor)) {
        p += 70;
      }
    }

    if (isImplClass) {
      p += 30;
    }

    if (currentData && currentData.imports && currentData.imports.length > 0) {
      const base = path.basename(c.filePath, path.extname(c.filePath));
      if (currentData.imports.some(imp => imp.text.includes(base) || (tipoReceptor && imp.text.includes(tipoReceptor)))) {
        p += 25;
      }
    }

    if (c.filePath === normCurrent && (c.kind === 'interface-method' || c.kind === 'interface')) {
      p -= 50;
    } else if (!tipoReceptor && c.filePath === normCurrent) {
      p += 50;
    }

    return p;
  };

  return [...formatted].sort((a, b) => pontos(b) - pontos(a));
}

function findImplementations(indexer, currentFilePath, lineNum, symbolName) {
  const normCurrent = normalizePath(currentFilePath);
  const fileData = indexer.fileMap.get(normCurrent);
  if (!fileData) return [];

  const matchedInterface = fileData.interfaces.find(i => i.line === Number(lineNum) || i.name === symbolName);
  let targetInterfaceName = matchedInterface ? matchedInterface.name : symbolName;

  const matchedMethod = fileData.methods.find(m => m.line === Number(lineNum) && m.kind === 'interface-method');
  if (matchedMethod && matchedMethod.owner && matchedMethod.owner.name) {
    targetInterfaceName = matchedMethod.owner.name;
  }

  const implClasses = indexer.implementationsMap.get(targetInterfaceName);
  if (!implClasses || implClasses.size === 0) {
    const fallbackName = targetInterfaceName + 'Impl';
    const fallbackCandidates = indexer.symbolMap.get(fallbackName) || [];
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
    if (matchedMethod) {
      const implFileData = indexer.fileMap.get(impl.filePath);
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

function getGutterInfo(indexer, currentFilePath) {
  const normCurrent = normalizePath(currentFilePath);
  const fileData = indexer.fileMap.get(normCurrent);
  if (!fileData) return [];

  const gutters = [];

  for (const interf of fileData.interfaces) {
    const impls = findImplementations(indexer, normCurrent, interf.line, interf.name);
    if (impls.length > 0) {
      gutters.push({
        line: interf.line,
        symbol: interf.name,
        kind: 'interface',
        target: impls[0]
      });
    }
  }

  for (const method of fileData.methods) {
    if (method.kind === 'interface-method') {
      const impls = findImplementations(indexer, normCurrent, method.line, method.name);
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

module.exports = {
  tryResolveFilePath,
  searchDefinitionInFile,
  scanDir,
  findUsages,
  resolveReceiverType,
  findDefinition,
  findImplementations,
  getGutterInfo,
};
