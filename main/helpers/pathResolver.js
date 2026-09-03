// main/helpers/pathResolver.js
// Utilitário de resolução canônica e busca resiliente de caminhos no workspace.

const fs = require('fs');
const path = require('path');

const resolvedPathCache = new Map();
const MAX_CACHE_SIZE = 500;

const COMMON_EXTENSIONS = [
  '.java', '.kt', '.js', '.ts', '.jsx', '.tsx',
  '.json', '.xml', '.gradle', '.html', '.css', '.md',
  '.py', '.yml', '.yaml', '.properties', '.sql', '.sh', '.bat'
];

function findFileFast(rootDir, targetBaseName, targetSuffix) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const skipDirs = new Set(['node_modules', '.git', '.gradle', 'build', 'target', '.idea', 'dist', '.gemini', '.metadata', '.cache', '.vscode', '.bin', '.output']);

  let cleanBase = (targetBaseName || '').trim();
  cleanBase = cleanBase.replace(/^[`'"\(\[\{<]+|[`'"\)\]\}>.,;:!]+$/g, '');
  if (!cleanBase) return null;

  const targetBaseLower = cleanBase.toLowerCase();
  const targetAlnum = targetBaseLower.replace(/[^a-z0-9]/g, '');
  const targetSuffNorm = (targetSuffix || '').replace(/\\/g, '/').toLowerCase();
  const hasExt = targetBaseLower.includes('.');

  let exactMatch = null;
  let extMatch = null;
  let alnumMatch = null;
  let partialMatch = null;

  // BFS para encontrar arquivos mais próximos da raiz primeiro
  const queue = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > 10) continue;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    const subdirs = [];

    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name) && depth < 10) {
          subdirs.push(full);
        }
      } else if (ent.isFile()) {
        const entNameLower = ent.name.toLowerCase();
        const entNameNoExt = entNameLower.replace(/\.[^.]+$/, '');
        const entAlnum = entNameLower.replace(/[^a-z0-9]/g, '');
        const entBaseAlnum = entNameNoExt.replace(/[^a-z0-9]/g, '');

        // 1. Match exato de nome de arquivo (case-insensitive)
        if (entNameLower === targetBaseLower) {
          const normFull = full.replace(/\\/g, '/').toLowerCase();
          if (targetSuffNorm && normFull.endsWith(targetSuffNorm)) {
            return full; // Match perfeito de sufixo e nome
          }
          if (!exactMatch) exactMatch = full;
        }

        // 2. Se o alvo não tinha extensão (ex: 'UserService' -> 'UserService.java')
        if (!hasExt && !extMatch) {
          for (const ext of COMMON_EXTENSIONS) {
            if (entNameLower === targetBaseLower + ext) {
              extMatch = full;
              break;
            }
          }
        }

        // 3. Match alfanumérico flexível (ex: 'user service' ou 'usa service' ou 'user_service' -> 'UserService.java')
        if (targetAlnum.length >= 3 && !alnumMatch) {
          if (entBaseAlnum === targetAlnum || entAlnum === targetAlnum) {
            alnumMatch = full;
          }
        }

        // 4. Match parcial se for palavra-chave representativa
        if (targetAlnum.length >= 4 && !partialMatch) {
          if (entBaseAlnum.includes(targetAlnum) || (entBaseAlnum.length >= 4 && targetAlnum.includes(entBaseAlnum))) {
            partialMatch = full;
          }
        }
      }
    }

    // Se já encontramos um match exato ou com extensão nos níveis superiores, encerramos cedo
    if (exactMatch && depth >= 2) break;
    if (extMatch && depth >= 3) break;

    for (const s of subdirs) {
      queue.push({ dir: s, depth: depth + 1 });
    }
  }

  return exactMatch || extMatch || alnumMatch || partialMatch || null;
}

function findFileRecursively(dir, targetBaseName, targetSuffix, depth = 0) {
  return findFileFast(dir, targetBaseName, targetSuffix);
}

function resolveWorkspaceFilePath(rawPath, workspace) {
  if (!rawPath || typeof rawPath !== 'string') return null;
  let p = rawPath.trim();

  try {
    if (p.includes('%')) p = decodeURIComponent(p);
  } catch (_) {}

  // Remove sufixos de linha: (lines 1-50), #L42, :42
  p = p.replace(/\s*\(lines?\s+\d+.*?\)$/i, '');
  p = p.replace(/#L?\d+(?:-L?\d+)?$/i, '');
  p = p.replace(/:\d+(?::\d+)?(?:-\d+)?$/, '');
  p = p.replace(/\s*\(lines?\s+\d+.*?\)$/i, '');

  // Remove pontuação externa, aspas, parênteses e colchetes
  p = p.replace(/^[`'"\(\[\{<]+|[`'"\)\]\}>.,;:!]+$/g, '');

  // Remove protocolo file:/// ou file://
  p = p.replace(/^file:\/\/\/?([a-zA-Z]:)/i, '$1').replace(/^file:\/\//i, '');
  p = p.replace(/#L?\d+(?:-L?\d+)?$/i, '').replace(/:\d+(?::\d+)?$/, '');
  p = p.replace(/^[`'"\(\[\{<]+|[`'"\)\]\}>.,;:!]+$/g, '');

  // Remove prefixos de elipse .../ ou ...\
  p = p.replace(/^\.{2,}[/\\]/, '');

  if (!p) return null;

  if (workspace && workspace.resolvePortalPath) {
    p = workspace.resolvePortalPath(p);
  }

  // Se é caminho de jar/zip virtual
  if (p.includes('.jar!') || p.includes('.zip!')) return p;

  // Se já é caminho absoluto existente no disco
  if (path.isAbsolute(p) && fs.existsSync(p)) {
    return p;
  }

  // Cache lookup
  const cacheKey = `${p}__${(workspace && workspace.getProjectPath ? workspace.getProjectPath() : '')}`;
  if (resolvedPathCache.has(cacheKey)) {
    const cached = resolvedPathCache.get(cacheKey);
    if (fs.existsSync(cached)) return cached;
    resolvedPathCache.delete(cacheKey);
  }

  // Coleta raízes candidatas do projeto
  const roots = [];
  const projectPath = (workspace && workspace.getProjectPath) ? workspace.getProjectPath() : null;
  if (projectPath && fs.existsSync(projectPath)) roots.push(projectPath);

  const attachments = (workspace && workspace.list) ? workspace.list() : [];
  for (const a of attachments) {
    if (a.type === 'dir' && a.path && fs.existsSync(a.path) && !roots.includes(a.path)) {
      roots.push(a.path);
    } else if (a.type === 'file' && a.path && fs.existsSync(a.path)) {
      const parent = path.dirname(a.path);
      if (parent && !roots.includes(parent)) roots.push(parent);
    }
  }

  const cwd = process.cwd();
  if (cwd && cwd !== '/' && fs.existsSync(cwd) && !roots.includes(cwd)) {
    roots.push(cwd);
  }

  // Remove barra inicial e letra de unidade do Windows se for caminho relativo ou incorreto
  const noLeading = p.replace(/^[a-zA-Z]:[/\\]+/, '').replace(/^[/\\]+/, '');

  for (const root of roots) {
    if (!root) continue;

    // 1. Resolução direta sem barra inicial
    const cand1 = path.resolve(root, noLeading);
    if (fs.existsSync(cand1)) {
      setCached(cacheKey, cand1);
      return cand1;
    }

    // 2. Remove prefixo do nome da pasta do projeto (ex: helper-node/services/...)
    const baseProject = path.basename(root);
    if (noLeading.startsWith(baseProject + '/') || noLeading.startsWith(baseProject + '\\')) {
      const stripped = noLeading.substring(baseProject.length + 1);
      const cand2 = path.resolve(root, stripped);
      if (fs.existsSync(cand2)) {
        setCached(cacheKey, cand2);
        return cand2;
      }
    }

    // 3. Subpastas comuns de código (src, src/main/java, services, etc.)
    const commonSubdirs = ['src', 'src/main/java', 'src/test/java', 'src/main/resources', 'services', 'renderer', 'main', 'main/ipc', 'main/helpers'];
    for (const sub of commonSubdirs) {
      const candSub = path.resolve(root, sub, noLeading);
      if (fs.existsSync(candSub)) {
        setCached(cacheKey, candSub);
        return candSub;
      }
    }

    // 4. Busca rápida e resiliente no projeto por basename / sufixo / alnum
    const baseName = path.basename(noLeading);
    if (baseName) {
      const found = findFileFast(root, baseName, noLeading);
      if (found && fs.existsSync(found)) {
        setCached(cacheKey, found);
        return found;
      }
    }
  }

  // 5. Se nenhuma raiz continha o arquivo exato, tenta busca global nos anexos
  for (const root of roots) {
    const baseName = path.basename(p);
    if (baseName) {
      const found = findFileFast(root, baseName, p);
      if (found && fs.existsSync(found)) {
        setCached(cacheKey, found);
        return found;
      }
    }
  }

  const fallback = path.resolve(roots[0] || cwd, noLeading);
  return fallback;
}

function setCached(k, v) {
  if (resolvedPathCache.size >= MAX_CACHE_SIZE) {
    const firstKey = resolvedPathCache.keys().next().value;
    resolvedPathCache.delete(firstKey);
  }
  resolvedPathCache.set(k, v);
}

module.exports = {
  resolveWorkspaceFilePath,
  findFileRecursively,
  findFileFast,
};
