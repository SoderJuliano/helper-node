// services/multiProject/multiProjectService.js
// Gerenciamento e orquestração de múltiplos projetos anexados no workspace (Multi-Project Workspace).

const fs = require('fs');
const path = require('path');
const store = require('../workspace/store');
const pathCmd = require('../workspace/pathCommands');

class MultiProjectService {
  /**
   * Garante que o diretório seja registrado nos workspaces confiáveis do Antigravity CLI.
   */
  static ensureTrustedWorkspace(absPath) {
    try {
      const os = require('os');
      const settingsPath = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
      if (!fs.existsSync(settingsPath)) return;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (!settings.trustedWorkspaces) {
        settings.trustedWorkspaces = [];
      }

      let isTrusted = false;
      let current = absPath;
      while (current && current !== '/' && current !== '.') {
        if (settings.trustedWorkspaces.includes(current)) {
          isTrusted = true;
          break;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }

      if (!isTrusted) {
        settings.trustedWorkspaces.push(absPath);
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`[multiProject] Registrado ${absPath} nos workspaces confiáveis`);
      }
    } catch (e) {
      console.warn(`[multiProject] Falha ao registrar workspace confiável:`, e.message);
    }
  }

  /**
   * Anexa um novo projeto ao workspace sem remover os projetos já abertos.
   * @param {string} absPath Caminho absoluto da pasta do projeto
   * @param {Object} [opts]
   * @returns {Promise<Array>} Lista atualizada de anexos do workspace
   */
  static async attachProject(absPath, opts = {}) {
    if (!absPath) throw new Error('Caminho do projeto não pode ser vazio');
    const resolvedPath = path.resolve(store.resolvePortalPath(absPath));
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Diretório do projeto não existe: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Caminho informado não é um diretório: ${resolvedPath}`);
    }

    if (opts.trustAgy !== false) {
      this.ensureTrustedWorkspace(resolvedPath);
    }

    const fileCount = await pathCmd.dirFileCount(resolvedPath);
    store.add({
      type: 'dir',
      path: resolvedPath,
      sizeBytes: 0,
      fileCount,
      ok: true,
      ...(opts.meta || {}),
    });

    // Inicia indexação de símbolos para o projeto recém anexado
    try {
      const symbolIndexer = require('../symbolIndexer');
      if (symbolIndexer && typeof symbolIndexer.indexWorkspace === 'function') {
        symbolIndexer.indexWorkspace(resolvedPath);
      }
    } catch (err) {
      console.warn('[multiProject] Falha ao indexar símbolos do projeto:', err.message);
    }

    // Inicia watcher para a pasta do novo projeto
    try {
      const workspaceWatcher = require('../workspaceWatcher');
      if (workspaceWatcher && typeof workspaceWatcher.startWatchingProject === 'function') {
        workspaceWatcher.startWatchingProject(resolvedPath);
      }
    } catch (err) {
      console.warn('[multiProject] Falha ao iniciar watcher do projeto:', err.message);
    }

    return store.list();
  }

  /**
   * Remove um projeto anexado pelo id ou caminho.
   * @param {string} idOrPath Id do anexo ou caminho absoluto do diretório
   */
  static detachProject(idOrPath) {
    if (!idOrPath) return store.list();
    const items = store.list();
    const target = items.find(a => a.id === idOrPath || a.path === idOrPath);
    if (target) {
      store.remove(target.id);
    }
    return store.list();
  }

  /**
   * Retorna se existem múltiplos projetos (diretórios) anexados simultaneamente.
   */
  static isMultiProject() {
    const dirs = store.list().filter(a => a.type === 'dir' && a.path && fs.existsSync(a.path));
    return dirs.length > 1;
  }

  /**
   * Retorna os diretórios de todos os projetos anexados.
   */
  static getProjectRoots() {
    return store.list()
      .filter(a => a.type === 'dir' && a.path && fs.existsSync(a.path))
      .map(a => a.path);
  }

  /**
   * Retorna informações ricas sobre todos os projetos anexados (nome, git branch, build tool).
   */
  static async listAttachedProjects() {
    const dirAttachments = store.list().filter(a => a.type === 'dir' && a.path && fs.existsSync(a.path));
    const results = [];
    const { execFile } = require('child_process');

    for (const att of dirAttachments) {
      const pPath = att.path;
      const name = path.basename(pPath);
      let branch = null;

      try {
        branch = await new Promise((resolve) => {
          execFile(
            'git',
            ['--no-optional-locks', '-C', pPath, 'rev-parse', '--abbrev-ref', 'HEAD'],
            { timeout: 2000 },
            (err, stdout) => resolve(err ? null : (stdout || '').trim() || null)
          );
        });
      } catch (_) {}

      let isBuildTool = false;
      let buildType = null;
      try {
        const { BuildToolDetector } = require('../appRunner');
        const info = BuildToolDetector.detect(pPath);
        if (info && (info.type === 'gradle' || info.type === 'maven')) {
          isBuildTool = true;
          buildType = info.type;
        }
      } catch (_) {}

      results.push({
        id: att.id,
        name,
        path: pPath,
        branch,
        isBuildTool,
        buildType,
        fileCount: att.fileCount || 0,
      });
    }

    return results;
  }

  /**
   * Coleta as entradas da árvore unificada quando há múltiplos projetos anexados.
   * @param {Object} helpers Objeto de helpers globais com walkTreeInto e detectJavaProjectType
   * @param {number} [limit] Limite global de entradas
   */
  static collectMultiProjectEntries(helpers, limit = 4000) {
    const roots = this.getProjectRoots();
    if (roots.length === 0) return { roots: [], entries: [] };
    if (roots.length === 1) {
      const singleRoot = roots[0];
      const entries = helpers.collectProjectEntries(singleRoot, limit);
      return {
        isMulti: false,
        roots: [{ name: path.basename(singleRoot), path: singleRoot }],
        entries,
      };
    }

    const allEntries = [];
    const rootsMeta = [];
    const perProjectLimit = Math.max(800, Math.floor(limit / roots.length));

    for (const root of roots) {
      const projName = path.basename(root);
      rootsMeta.push({ name: projName, path: root });

      // Adiciona o nó raiz do projeto no nível 0
      allEntries.push({
        path: root,
        name: projName,
        depth: 0,
        isDir: true,
        isRoot: true,
        projectRoot: root,
      });

      // Coleta filhos imediatos e subárvore iniciando no depth 1
      let topLevel = [];
      try {
        topLevel = fs.readdirSync(root, { withFileTypes: true });
      } catch (_) {
        continue;
      }

      topLevel.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      const topNamesSet = new Set(topLevel.map(d => d.name));

      const rootJavaType = helpers.detectJavaProjectType
        ? helpers.detectJavaProjectType(root, topNamesSet)
        : null;

      if (rootJavaType) {
        allEntries.push({
          path: root + '::dependencies',
          projectRoot: root,
          name: 'Dependencies',
          depth: 1,
          isDir: true,
          lazy: true,
          synthetic: 'java-deps',
          javaType: rootJavaType,
        });
      }

      const TREE_HEAVY_DIRS = new Set(['node_modules', '.git', '.gradle', 'build', 'target', '.idea', 'dist', '.gemini']);

      for (const dirent of topLevel) {
        if (allEntries.length >= limit) break;
        const absPath = path.join(root, dirent.name);
        const isDir = dirent.isDirectory();
        const heavy = isDir && TREE_HEAVY_DIRS.has(dirent.name);

        allEntries.push(
          heavy
            ? { path: absPath, name: dirent.name, depth: 1, isDir: true, lazy: true, projectRoot: root }
            : { path: absPath, name: dirent.name, depth: 1, isDir, projectRoot: root }
        );

        if (!isDir || heavy) continue;
        if (typeof helpers.walkTreeInto === 'function') {
          helpers.walkTreeInto(allEntries, absPath, 2, 25, allEntries.length + perProjectLimit);
        }
      }
    }

    return {
      isMulti: true,
      roots: rootsMeta,
      entries: allEntries,
    };
  }
}

module.exports = MultiProjectService;
