// main/helpers/pathResolver.js
// Utilitário de resolução canônica e busca resiliente de caminhos no workspace.

const fs = require('fs');
const path = require('path');

function findFileRecursively(dir, targetBaseName, targetSuffix, depth = 0) {
  if (depth > 6 || !dir || !fs.existsSync(dir)) return null;
  const skipDirs = new Set(['node_modules', '.git', '.gradle', 'build', 'target', '.idea', 'dist', '.gemini', '.metadata']);

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!skipDirs.has(ent.name)) {
          const subRes = findFileRecursively(full, targetBaseName, targetSuffix, depth + 1);
          if (subRes) return subRes;
        }
      } else if (ent.isFile()) {
        if (ent.name.toLowerCase() === targetBaseName.toLowerCase()) {
          const normFull = full.replace(/\\/g, '/');
          const normSuff = targetSuffix.replace(/\\/g, '/');
          if (normFull.endsWith(normSuff)) return full;
          if (!targetSuffix.includes('/') && !targetSuffix.includes('\\')) return full;
        }
      }
    }
  } catch (_) {}
  return null;
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

  const noLeading = p.replace(/^[/\\]+/, '');

  for (const root of roots) {
    if (!root) continue;

    // 1. Resolução direta sem barra inicial
    const cand1 = path.resolve(root, noLeading);
    if (fs.existsSync(cand1)) return cand1;

    // 2. Remove prefixo do nome da pasta do projeto (ex: helper-node/services/...)
    const baseProject = path.basename(root);
    if (noLeading.startsWith(baseProject + '/') || noLeading.startsWith(baseProject + '\\')) {
      const stripped = noLeading.substring(baseProject.length + 1);
      const cand2 = path.resolve(root, stripped);
      if (fs.existsSync(cand2)) return cand2;
    }

    // 3. Subpastas comuns de código (src, src/main/java, services, etc.)
    const commonSubdirs = ['src', 'src/main/java', 'src/test/java', 'src/main/resources', 'services', 'renderer', 'main', 'main/ipc', 'main/helpers'];
    for (const sub of commonSubdirs) {
      const candSub = path.resolve(root, sub, noLeading);
      if (fs.existsSync(candSub)) return candSub;
    }

    // 4. Busca recursiva por basename
    const baseName = path.basename(noLeading);
    if (baseName && baseName.includes('.')) {
      const found = findFileRecursively(root, baseName, noLeading);
      if (found) return found;
    }
  }

  return path.resolve(roots[0] || cwd, noLeading);
}

module.exports = {
  resolveWorkspaceFilePath,
  findFileRecursively,
};
