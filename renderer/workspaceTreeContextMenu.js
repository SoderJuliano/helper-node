// renderer/workspaceTreeContextMenu.js
// Menu de contexto dos itens da arvore do projeto (IDE mode), incluindo
// execucao de apps/testes, criacao de arquivos/classes Java e sincronizacao
// de dependencias Maven / Gradle (estilo IntelliJ).
(function() {
  'use strict';

  const SVGI_NEW_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
  const SVGI_NEW_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
  const SVGI_CLIPBOARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
  const SVGI_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const SVGI_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  const SVGI_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#ff5252;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  const SVGI_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#4ade80;"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  const SVGI_TEST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#38bdf8;"><path d="M10 2v7.31L4.62 17.5A2 2 0 0 0 6.35 20.5h11.3a2 2 0 0 0 1.73-3L14 9.31V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/></svg>';
  const SVGI_JAVA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#f87171;"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>';
  const SVGI_SYNC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#38bdf8;"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>';
  const SVGI_MAVEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#f59e0b;"><path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.2Z"/><path d="m21 12-4.5 2.6v-5.2Z"/></svg>';
  const SVGI_GRADLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#0284c7;"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V17a1 1 0 0 1-2 0v-.07A7.003 7.003 0 0 1 5.07 11H5a1 1 0 0 1 0-2h.07A7.003 7.003 0 0 1 11 5.07V5a1 1 0 0 1 2 0v.07A7.003 7.003 0 0 1 18.93 11H19a1 1 0 0 1 0 2h-.07A7.003 7.003 0 0 1 13 16.93z"/></svg>';
  const SVGI_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#a78bfa;"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  const SVGI_DIFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#61afef;"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';

  async function triggerSyncDependencies(targetPath, forceDownload = true) {
    if (typeof window.triggerJavaSync === 'function') {
      window.triggerJavaSync(targetPath, forceDownload);
    } else if (window.electronAPI && window.electronAPI.javaDepsSync) {
      if (typeof showToast === 'function') showToast('Sincronizando dependências (Maven/Gradle)...');
      try {
        const res = await window.electronAPI.javaDepsSync({ projectDir: targetPath, forceDownload });
        if (res && res.ok && typeof showToast === 'function') {
          const tool = res.type === 'maven' ? 'Maven' : (res.type === 'gradle' ? 'Gradle' : 'Java');
          showToast(`✓ Dependências ${tool} sincronizadas! (${res.jarCount || 0} bibliotecas)`);
        }
      } catch (err) {
        if (typeof showToast === 'function') showToast('Erro: ' + err.message);
      }
      if (typeof window.renderTree === 'function') window.renderTree();
    }
  }

  function showTreeContextMenu(event, item) {
    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll('.ws-tree-context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'ws-tree-context-menu';
    menu.style.cssText = 'position:fixed; z-index:10000; background:var(--bg-elevated, #1b1e24); border:1px solid var(--border, #2d2d38); border-radius:var(--radius-sm, 4px); padding:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); min-width:180px; font-family:var(--font-ui); font-size:12px; color:var(--text, #e3e3e6); -webkit-app-region: no-drag;';

    const mkItem = (iconHtml, label, fn) => {
      const b = document.createElement('button');
      b.innerHTML = `<span style="margin-right:8px; opacity:0.8; display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px;">${iconHtml}</span>${label}`;
      b.style.cssText = 'display:flex; align-items:center; width:100%; text-align:left; background:transparent; border:none; color:inherit; font-size:inherit; font-family:inherit; padding:6px 10px; cursor:pointer; border-radius:4px; transition:background .15s;';
      b.addEventListener('mouseenter', () => (b.style.background = 'rgba(255,255,255,0.06)'));
      b.addEventListener('mouseleave', () => (b.style.background = 'transparent'));
      b.addEventListener('click', () => {
        menu.remove();
        fn();
      });
      return b;
    };

    const addSeparator = () => {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
      menu.appendChild(hr);
    };

    const wsProjectMain = document.getElementById('ws-project-main');
    const projectRootPath = (wsProjectMain && wsProjectMain.dataset.path) || (item.isRoot ? item.path : '');
    const isSyntheticDeps = item.synthetic === 'java-deps' || item.synthetic === 'java-deps-status' || (item.path && item.path.includes('::dependencies'));
    const isPom = item.name === 'pom.xml' || (item.path && item.path.endsWith('/pom.xml')) || (item.path && item.path.endsWith('\\pom.xml'));
    const isGradle = item.name && (item.name.startsWith('build.gradle') || item.name.startsWith('settings.gradle'));

    if (item.isRoot) {
      menu.appendChild(mkItem(SVGI_DIFF, 'Visualizar Diff (Alterações Locais)', () => {
        if (typeof window.openGitDiffModal === 'function') window.openGitDiffModal(item.path);
      }));
      menu.appendChild(mkItem(SVGI_PLAY, 'Executar Aplicação (Spring Boot / Gradle)', () => {
        if (window.appRunner) window.appRunner.run(item.path, { kind: 'app' });
      }));
      menu.appendChild(mkItem(SVGI_TEST, 'Executar Todos os Testes', () => {
        if (window.appRunner) window.appRunner.run(item.path, { kind: 'test-all' });
      }));
      addSeparator();

      menu.appendChild(mkItem(SVGI_SYNC, 'Sincronizar Dependências (Baixar e Re-indexar)', () => {
        triggerSyncDependencies(item.path, true);
      }));
      menu.appendChild(mkItem(SVGI_REFRESH, 'Re-indexar Classpath (Sem download)', () => {
        triggerSyncDependencies(item.path, false);
      }));
      addSeparator();
    } else if (isSyntheticDeps) {
      menu.appendChild(mkItem(SVGI_SYNC, 'Sincronizar / Baixar Dependências (Maven/Gradle)', () => {
        triggerSyncDependencies(projectRootPath || item.path, true);
      }));
      menu.appendChild(mkItem(SVGI_REFRESH, 'Re-indexar Classpath do Projeto', () => {
        triggerSyncDependencies(projectRootPath || item.path, false);
      }));
    } else if (isPom) {
      menu.appendChild(mkItem(SVGI_MAVEN, 'Recarregar Projeto Maven (Baixar dependências)', () => {
        triggerSyncDependencies(projectRootPath || item.path, true);
      }));
      menu.appendChild(mkItem(SVGI_REFRESH, 'Re-indexar Classpath Maven', () => {
        triggerSyncDependencies(projectRootPath || item.path, false);
      }));
      addSeparator();
    } else if (isGradle) {
      menu.appendChild(mkItem(SVGI_GRADLE, 'Recarregar Projeto Gradle (--refresh-dependencies)', () => {
        triggerSyncDependencies(projectRootPath || item.path, true);
      }));
      menu.appendChild(mkItem(SVGI_REFRESH, 'Re-indexar Classpath Gradle', () => {
        triggerSyncDependencies(projectRootPath || item.path, false);
      }));
      addSeparator();
    } else if (item.isDir && (item.path.includes('test') || item.path.includes('tests'))) {
      menu.appendChild(mkItem(SVGI_TEST, 'Executar Testes nesta Pasta', () => {
        if (window.appRunner) window.appRunner.run(projectRootPath || item.path, { kind: 'test-all' });
      }));
      addSeparator();
    } else if (!item.isDir && item.path && item.path.endsWith('.java')) {
      const simpleName = (item.name || item.path.split(/[/\\]/).pop()).replace(/\.java$/i, '');
      if (simpleName.endsWith('Test') || simpleName.endsWith('Tests')) {
        menu.appendChild(mkItem(SVGI_TEST, `Executar Testes em '${simpleName}'`, () => {
          if (window.appRunner) window.appRunner.run(projectRootPath, { kind: 'test-class', testClass: simpleName });
        }));
      } else {
        menu.appendChild(mkItem(SVGI_PLAY, `Executar '${simpleName}.main()'`, () => {
          if (window.appRunner) window.appRunner.run(projectRootPath, { kind: 'app', mainClass: simpleName });
        }));
      }
      addSeparator();
    }

    if (!isSyntheticDeps && (item.isRoot || item.isDir)) {
      menu.appendChild(mkItem(SVGI_JAVA, 'Nova Classe Java...', () => {
        if (typeof window.openNewJavaClassDialog === 'function') {
          window.openNewJavaClassDialog(item.path);
        }
      }));

      menu.appendChild(mkItem(SVGI_NEW_FILE, 'Novo Arquivo', () => {
        creatingFileParent = item.path;
        if (item.isDir) item.collapsed = false;
        window.renderTree();
      }));

      menu.appendChild(mkItem(SVGI_NEW_FOLDER, 'Nova Pasta', () => {
        creatingFolderParent = item.path;
        if (item.isDir) item.collapsed = false;
        window.renderTree();
      }));
      addSeparator();
    } else if (!isSyntheticDeps && !item.isDir && item.path && item.path.endsWith('.java')) {
      const parentDir = item.path.replace(/[/\\][^/\\]+$/, '');
      menu.appendChild(mkItem(SVGI_JAVA, 'Nova Classe Java neste Pacote...', () => {
        if (typeof window.openNewJavaClassDialog === 'function') {
          window.openNewJavaClassDialog(parentDir);
        }
      }));
    }

    if (!item.isRoot && !isSyntheticDeps) {
      if (!item.isDir) {
        menu.appendChild(mkItem(SVGI_LINK, 'Anexar ao contexto', async () => {
          if (window.electronAPI && window.electronAPI.workspaceAddPath) {
            const res = await window.electronAPI.workspaceAddPath(item.path, 'file');
            if (res && res.attachments && typeof renderWorkspacePanel === 'function') {
              renderWorkspacePanel(res.attachments);
              if (typeof showToast === 'function') showToast('Arquivo anexado ao contexto!');
            }
          }
        }));
      }

      menu.appendChild(mkItem(SVGI_CLIPBOARD, 'Copiar Caminho Absoluto', () => {
        window.electronAPI.copyToClipboard(item.path);
        if (typeof showToast === 'function') showToast('Caminho absoluto copiado!');
      }));

      menu.appendChild(mkItem(SVGI_LINK, 'Copiar Caminho Relativo', () => {
        const projectPath = wsProjectMain ? wsProjectMain.dataset.path : '';
        let relPath = item.path;
        if (projectPath && item.path.startsWith(projectPath)) {
          relPath = item.path.substring(projectPath.length).replace(/^[/\\]+/, '');
        }
        window.electronAPI.copyToClipboard(relPath);
        if (typeof showToast === 'function') showToast('Caminho relativo copiado!');
      }));
      addSeparator();

      menu.appendChild(mkItem(SVGI_EDIT, 'Renomear', () => {
        renamingPath = item.path;
        window.renderTree();
      }));

      menu.appendChild(mkItem(SVGI_TRASH, 'Excluir', () => {
        if (typeof window.deleteSingleItem === 'function') window.deleteSingleItem(item);
      }));
    }

    document.body.appendChild(menu);
    const menuWidth = menu.offsetWidth || 180;
    const menuHeight = menu.offsetHeight || 140;
    let x = event.clientX;
    let y = event.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closer, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closer, true), 0);
  }

  window.showTreeContextMenu = showTreeContextMenu;
})();

