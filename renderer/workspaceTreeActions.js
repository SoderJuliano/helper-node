// Workspace Tree Interactions, Menus and Buttons Module
(function() {
    const wsProjectMain = document.getElementById('ws-project-main');
    const wsTreeToggle = document.getElementById('ws-tree-toggle');
    const wsTree = document.getElementById('ws-tree');
    // Perdidos na divisão automática (usados nos handlers abaixo).
    const wsProject = document.getElementById('ws-project');
    const wsAddBtn = document.getElementById('workspace-add');
    const wsPanel = document.getElementById('workspace-panel');
    const transcriptionElement = document.getElementById('transcription');

    // TreeNode events wiring (drag & drop, contextmenu, check selection, open file)
    window.wireTreeNodeEvents = function(node, e, projectPath) {
        if (selectedPaths.size > 0) {
            const checkbox = document.createElement('span');
            checkbox.className = 'ws-tree-checkbox' + (selectedPaths.has(e.path) ? ' checked' : '');
            checkbox.addEventListener('click', (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                if (selectedPaths.has(e.path)) {
                    selectedPaths.delete(e.path);
                } else {
                    selectedPaths.add(e.path);
                }
                updateSelectionUi();
                renderTree();
            });
            node.insertBefore(checkbox, node.firstChild);
        }
        
        // Nós sintéticos (Dependencies/jar/classe/status do classpath Java) não
        // existem no disco: sem arrastar, sem soltar em cima, sem menu de
        // contexto (renomear/excluir/anexar não fazem sentido pra eles).
        node.draggable = (renamingPath !== e.path) && !e.synthetic;
        node.addEventListener('dragstart', (ev) => {
            if (e.synthetic) return;
            ev.dataTransfer.setData('text/plain', e.path);
            ev.dataTransfer.effectAllowed = 'move';
            node.style.opacity = '0.5';
        });
        node.addEventListener('dragend', () => {
            node.style.opacity = '';
            document.querySelectorAll('.ws-tree-node').forEach(n => n.classList.remove('drag-over'));
        });
        node.addEventListener('dragover', (ev) => {
            if (e.synthetic) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'move';
            if (e.isDir) {
                node.classList.add('drag-over');
            }
        });
        node.addEventListener('dragleave', () => {
            node.classList.remove('drag-over');
        });
        node.addEventListener('drop', async (ev) => {
            if (e.synthetic) return;
            ev.preventDefault();
            node.classList.remove('drag-over');
            const srcPath = ev.dataTransfer.getData('text/plain');
            if (!srcPath || srcPath === e.path) return;

            let destDir = e.path;
            if (!e.isDir) {
                const lastSlash = Math.max(e.path.lastIndexOf('/'), e.path.lastIndexOf('\\'));
                destDir = e.path.substring(0, lastSlash);
            }

            const srcParent = srcPath.substring(0, Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\')));
            if (srcParent === destDir) return;

            if (destDir.startsWith(srcPath + '/') || destDir.startsWith(srcPath + '\\') || destDir === srcPath) {
                if (typeof showToast === 'function') showToast('Não é possível mover uma pasta para dentro dela mesma.');
                return;
            }

            const res = await window.electronAPI.moveItem(srcPath, destDir);
            if (res.ok) {
                await refreshProjectTree();
            } else {
                if (typeof showToast === 'function') showToast('Erro ao mover: ' + res.error);
            }
        });

        node.addEventListener('contextmenu', (ev) => {
            if (e.synthetic) { ev.preventDefault(); ev.stopPropagation(); return; }
            showTreeContextMenu(ev, e);
        });

        // Double click/Click listener to open file
        node.addEventListener('click', (ev) => {
            if (ev.target.closest('.ws-tree-chevron') || ev.target.closest('.ws-tree-checkbox') || renamingPath) return;
            if (e.synthetic === 'java-deps-status') return; // linha informativa, não navegável
            if (e.isDir) {
                toggleDir(e);
            } else {
                if (typeof window.openFileViewer === 'function') window.openFileViewer(e.path);
            }
        });
    };

            async function deleteSelectedItems() {
                if (!selectedPaths || selectedPaths.size === 0) return;
                const list = Array.from(selectedPaths);
                const count = list.length;
                let confirmMsg = '';
                if (count === 1) {
                    const filename = list[0].split(/[/\\]/).pop();
                    confirmMsg = `Tem certeza que deseja excluir o item "${filename}" permanentemente?`;
                } else {
                    confirmMsg = `Tem certeza que deseja excluir permanentemente os ${count} itens selecionados?`;
                }
                
                if (window.confirm(confirmMsg)) {
                    const res = await window.electronAPI.deleteItems(list);
                    if (res && res.ok) {
                        selectedPaths.clear();
                        updateSelectionUi();
                        await refreshProjectTree();
                        if (typeof showToast === 'function') showToast(`${count} item(ns) excluído(s) com sucesso.`);
                    } else {
                        if (typeof showToast === 'function') showToast('Erro ao excluir: ' + (res ? res.error : 'erro desconhecido'));
                    }
                }
            }

            async function deleteSingleItem(item) {
                const filename = item.name || item.path.split(/[/\\]/).pop();
                if (window.confirm(`Tem certeza que deseja excluir o item "${filename}" permanentemente?`)) {
                    const res = await window.electronAPI.deleteItems([item.path]);
                    if (res && res.ok) {
                        if (selectedPaths) {
                            selectedPaths.delete(item.path);
                            updateSelectionUi();
                        }
                        await refreshProjectTree();
                        if (typeof showToast === 'function') showToast(`"${filename}" excluído com sucesso.`);
                    } else {
                        if (typeof showToast === 'function') showToast('Erro ao excluir: ' + (res ? res.error : 'erro desconhecido'));
                    }
                }
            }

            document.addEventListener('keydown', (ev) => {
                if (ev.key === 'Delete' || ev.key === 'Del') {
                    const active = document.activeElement;
                    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
                        return;
                    }
                    if (selectedPaths && selectedPaths.size > 0) {
                        ev.preventDefault();
                        deleteSelectedItems();
                    }
                }
            });

 // deleteSelectedItems & deleteSingleItem

            async function refreshProjectTree() {
                if (!wsTree || !wsTreeToggle) return;
                const open = wsTreeToggle.getAttribute('aria-expanded') === 'true';
                if (!open) return;
                let res = null;
                try { res = window.electronAPI.getProjectTree ? await window.electronAPI.getProjectTree() : null; } catch (_) {}
                if (!res || !res.entries || !res.entries.length) {
                    wsTree.innerHTML = '<span class="ws-tree-empty">Não foi possível ler a estrutura.</span>';
                    treeEntries = [];
                    return;
                }
                const collapsedMap = new Map();
                treeEntries.forEach(e => {
                    if (e.isDir) collapsedMap.set(e.path, e.collapsed);
                });
                treeEntries = res.entries.map((entry) => ({
                    ...entry,
                    collapsed: entry.isDir
                        ? (entry.lazy ? true : (collapsedMap.has(entry.path) ? collapsedMap.get(entry.path) : true))
                        : false
                }));
                await fetchAndUpdateGitStatus();
                renderTree();
            }

            // ⚠️ NÃO chamar renderTree() aqui.
            //
            // Isto rodava `fetchAndUpdateGitStatus().then(renderTree)` a cada 8s,
            // e renderTree faz `wsTree.innerHTML = ''` e reconstrói TODOS os nós
            // (cada um com 9 listeners). Se o rebuild caía entre o mousedown e o
            // mouseup, o elemento sob o cursor era destruído e o navegador NUNCA
            // emitia o `click` — o clique simplesmente sumia. Era a causa de
            // "clico e nada acontece, clico 7-10 vezes até abrir".
            //
            // Git status só muda cor: dá pra aplicar nas classes dos nós que já
            // estão na tela, sem tocar na estrutura nem nos listeners.
            setInterval(() => {
                if (wsProjectMain && wsProjectMain.dataset && wsProjectMain.dataset.path) {
                    fetchAndUpdateGitStatus().then(() => applyGitStatusClasses());
                }
            }, 8000);

            // Atualiza só as classes de cor do git, in-place.
            function applyGitStatusClasses() {
                if (!wsTree) return;
                const projectPath = wsProjectMain ? wsProjectMain.dataset.path : '';
                const mods = currentGitStatus.modifiedFiles || {};
                const dirs = currentGitStatus.modifiedDirs || {};
                for (const node of wsTree.querySelectorAll('.ws-tree-node[data-path]')) {
                    const abs = node.dataset.path;
                    let rel = abs;
                    if (projectPath && rel.startsWith(projectPath)) {
                        rel = rel.substring(projectPath.length).replace(/^[/\\]+/, '').replace(/\\/g, '/');
                    } else {
                        rel = rel.replace(/\\/g, '/');
                    }
                    const isDir = node.classList.contains('dir');
                    node.classList.remove('git-modified', 'git-staged', 'git-untracked', 'git-dir-modified');
                    if (isDir) {
                        if (dirs[rel]) node.classList.add('git-dir-modified');
                    } else if (mods[rel]) {
                        node.classList.add(mods[rel] === 'A' ? 'git-staged' : 'git-modified');
                    }
                }
            }

            let refreshTreeTimeout = null;
            function triggerTreeRefresh() {
                if (refreshTreeTimeout) clearTimeout(refreshTreeTimeout);
                refreshTreeTimeout = setTimeout(() => {
                    refreshProjectTree();
                }, 300);
            }

            function showTreeContextMenu(event, item) {
                event.preventDefault();
                event.stopPropagation();
                document.querySelectorAll('.ws-tree-context-menu').forEach(m => m.remove());
                const menu = document.createElement('div');
                menu.className = 'ws-tree-context-menu';
                menu.style.cssText = 'position:fixed; z-index:10000; background:var(--bg-elevated, #1b1e24); border:1px solid var(--border, #2d2d38); border-radius:var(--radius-sm, 4px); padding:4px; box-shadow:0 4px 12px rgba(0,0,0,0.5); min-width:170px; font-family:var(--font-ui); font-size:12px; color:var(--text, #e3e3e6); -webkit-app-region: no-drag;';
                
                const SVGI_NEW_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
                const SVGI_NEW_FOLDER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
                const SVGI_CLIPBOARD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
                const SVGI_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
                const SVGI_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                const SVGI_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#ff5252;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
                const SVGI_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#4ade80;"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
                const SVGI_TEST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; color:#38bdf8;"><path d="M10 2v7.31L4.62 17.5A2 2 0 0 0 6.35 20.5h11.3a2 2 0 0 0 1.73-3L14 9.31V2"/><line x1="8.5" y1="2" x2="15.5" y2="2"/></svg>';

                const mkItem = (iconHtml, label, fn) => {
                    const b = document.createElement('button');
                    b.innerHTML = `<span style="margin-right:8px; opacity:0.8; display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px;">${iconHtml}</span>${label}`;
                    b.style.cssText = 'display:flex; align-items:center; width:100%; text-align:left; background:transparent; border:none; color:inherit; font-size:inherit; font-family:inherit; padding:6px 10px; cursor:pointer; border-radius:4px; transition:background .15s;';
                    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
                    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
                    b.addEventListener('click', () => { menu.remove(); fn(); });
                    return b;
                };

                // Opções de execução App Runner (Spring Boot / Testes)
                const projectRootPath = (wsProjectMain && wsProjectMain.dataset.path) || (item.isRoot ? item.path : '');

                if (item.isRoot) {
                    menu.appendChild(mkItem(SVGI_PLAY, 'Executar Aplicação (Spring Boot / Gradle)', () => {
                        if (window.appRunner) window.appRunner.run(item.path, { kind: 'app' });
                    }));
                    menu.appendChild(mkItem(SVGI_TEST, 'Executar Todos os Testes', () => {
                        if (window.appRunner) window.appRunner.run(item.path, { kind: 'test-all' });
                    }));
                    const hrApp = document.createElement('div');
                    hrApp.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                    menu.appendChild(hrApp);
                } else if (item.isDir && (item.path.includes('test') || item.path.includes('tests'))) {
                    menu.appendChild(mkItem(SVGI_TEST, 'Executar Testes nesta Pasta', () => {
                        if (window.appRunner) window.appRunner.run(projectRootPath || item.path, { kind: 'test-all' });
                    }));
                    const hrApp = document.createElement('div');
                    hrApp.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                    menu.appendChild(hrApp);
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
                    const hrApp = document.createElement('div');
                    hrApp.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                    menu.appendChild(hrApp);
                }
                
                if (item.isRoot || item.isDir) {
                    menu.appendChild(mkItem(SVGI_NEW_FILE, 'Novo Arquivo', () => {
                        creatingFileParent = item.path;
                        if (item.isDir) {
                            item.collapsed = false;
                        }
                        renderTree();
                    }));

                    menu.appendChild(mkItem(SVGI_NEW_FOLDER, 'Nova Pasta', () => {
                        creatingFolderParent = item.path;
                        if (item.isDir) {
                            item.collapsed = false;
                        }
                        renderTree();
                    }));
                    
                    const hr0 = document.createElement('div');
                    hr0.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                    menu.appendChild(hr0);
                }

                if (!item.isRoot) {
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
                    
                    const hr = document.createElement('div');
                    hr.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                    menu.appendChild(hr);
                    
                    menu.appendChild(mkItem(SVGI_EDIT, 'Renomear', () => {
                        renamingPath = item.path;
                        renderTree();
                    }));
                    
                    menu.appendChild(mkItem(SVGI_TRASH, 'Excluir', () => {
                        deleteSingleItem(item);
                    }));
                }
                
                document.body.appendChild(menu);
                const menuWidth = menu.offsetWidth || 170;
                const menuHeight = menu.offsetHeight || 120;
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

            function expandAncestorsMatching(predicate) {
                const dirStack = [];
                for (const e of treeEntries) {
                    while (dirStack.length && dirStack[dirStack.length - 1].depth >= e.depth) dirStack.pop();
                    if (predicate(e)) dirStack.forEach(d => { d.collapsed = false; });
                    if (e.isDir) dirStack.push(e);
                }
            }

            // Filtrar (Ctrl+F / Ctrl+Shift+F) precisa que os matches fiquem visíveis mesmo dentro
            // de pastas colapsadas — expande na hora, sem mexer no estado depois.
            function expandAncestorsForFilter() {
                const nameFilter = currentTreeNameFilter();
                const contentFilter = currentTreeContentFilter();
                if (activeTreeFilterMode === 'name' && nameFilter) {
                    expandAncestorsMatching((e) => e.name.toLowerCase().includes(nameFilter));
                } else if (activeTreeFilterMode === 'content' && contentFilter.length >= 4) {
                    expandAncestorsMatching((e) => !e.isDir && contentSearchMatchSet.has(e.path));
                }
            }

            async function ensureProjectTreeOpen() {
                if (!wsProjectMain || !wsProjectMain.dataset.path) return false;
                if (!wsTreeToggle || wsTreeToggle.getAttribute('aria-expanded') !== 'true') {
                    await toggleProjectTree();
                }
                return true;
            }

 // refreshProjectTree, triggerTreeRefresh, ContextMenu, filters

            async function toggleProjectTree() {
                if (!wsTree || !wsTreeToggle) return;
                const open = wsTreeToggle.getAttribute('aria-expanded') === 'true';
                if (open) { collapseProjectTree(); return; }
                wsTreeToggle.setAttribute('aria-expanded', 'true');
                wsTree.style.display = '';
                wsTree.textContent = 'carregando…';
                let res = null;
                try { res = window.electronAPI.getProjectTree ? await window.electronAPI.getProjectTree() : null; } catch (_) {}
                if (!res || !res.entries || !res.entries.length) {
                    wsTree.innerHTML = '<span class="ws-tree-empty">Não foi possível ler a estrutura.</span>';
                    treeEntries = [];
                    return;
                }
                treeEntries = res.entries.map((entry) => ({
                    ...entry,
                    collapsed: entry.isDir
                }));
                renderTree();
            }
            if (wsTreeToggle) {
                wsTreeToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleProjectTree(); });
            }
            if (wsProject) {
                wsProject.addEventListener('contextmenu', (ev) => {
                    const nodeEl = ev.target.closest('.ws-tree-node');
                    if (nodeEl) return;
                    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA') return;

                    ev.preventDefault();
                    ev.stopPropagation();
                    const projectPath = wsProjectMain ? wsProjectMain.dataset.path : '';
                    if (projectPath) {
                        showTreeContextMenu(ev, { path: projectPath, isRoot: true });
                    }
                });
            }

 // toggleProjectTree & listeners

            function showAttachMenu(anchor) {
                document.querySelectorAll('.ws-attach-menu').forEach(m => m.remove());
                const menu = document.createElement('div');
                menu.className = 'ws-attach-menu';
                menu.style.cssText = 'position:absolute; z-index:9999; background:#1c1c1c; border:1px solid rgba(255,255,255,0.18); border-radius:4px; padding:3px; box-shadow:0 4px 12px rgba(0,0,0,0.5); min-width:120px; -webkit-app-region: no-drag;';
                const mkItem = (label, fn) => {
                    const b = document.createElement('button');
                    b.textContent = label;
                    b.style.cssText = 'display:block; width:100%; text-align:left; background:transparent; border:none; color:#fff; font-size:10px; padding:5px 8px; cursor:pointer; border-radius:2px; font-family:inherit;';
                    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.08)');
                    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
                    b.addEventListener('click', () => { menu.remove(); fn(); });
                    return b;
                };
                menu.appendChild(mkItem('📄  Arquivo', async () => {
                    const r = await window.electronAPI.workspacePickFile();
                    if (r && r.attachments) renderWorkspacePanel(r.attachments);
                }));
                menu.appendChild(mkItem('📁  Pasta', async () => {
                    const r = await window.electronAPI.workspacePickDir();
                    if (r && r.attachments) renderWorkspacePanel(r.attachments);
                }));
                document.body.appendChild(menu);
                const r = anchor.getBoundingClientRect();
                const menuWidth = menu.offsetWidth || 120;
                const menuHeight = menu.offsetHeight || 80;

                const spaceBelow = window.innerHeight - r.bottom - 8;
                const spaceAbove = r.top - 8;

                let top;
                if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
                    top = r.bottom + 4;
                } else {
                    top = r.top - menuHeight - 4;
                }

                if (top + menuHeight > window.innerHeight - 8) {
                    top = window.innerHeight - menuHeight - 8;
                }
                if (top < 8) {
                    top = 8;
                    if (menuHeight > window.innerHeight - 16) {
                        menu.style.maxHeight = (window.innerHeight - 16) + 'px';
                        menu.style.overflowY = 'auto';
                    }
                }

                let left = r.left;
                if (left + menuWidth > window.innerWidth - 8) {
                    left = window.innerWidth - menuWidth - 8;
                }
                if (left < 8) {
                    left = 8;
                }

                menu.style.left = Math.round(left) + 'px';
                menu.style.top = Math.round(top) + 'px';
                const closer = (ev) => {
                    if (!menu.contains(ev.target) && ev.target !== anchor) {
                        menu.remove();
                        document.removeEventListener('click', closer, true);
                    }
                };
                setTimeout(() => document.addEventListener('click', closer, true), 0);
            }

            // "Abrir projeto" (pasta) e "Anexar arquivo" agora são ações
            // explícitas e rotuladas na sidebar — nada de menu escondido.
            const wsOpenProjectBtn = document.getElementById('workspace-open-project');
            if (wsOpenProjectBtn) wsOpenProjectBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await pickProjectFolder();
            });
            if (wsAddBtn) wsAddBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!(window.electronAPI && window.electronAPI.workspacePickFile)) return;
                const r = await window.electronAPI.workspacePickFile();
                if (r && r.attachments) renderWorkspacePanel(r.attachments);
                refreshProjectContext();
            });
            if (window.electronAPI && window.electronAPI.onWorkspaceChanged) {
                window.electronAPI.onWorkspaceChanged((data) => {
                    if (typeof data.enabled === 'boolean' && wsPanel) {
                        wsPanel.style.display = data.enabled ? '' : 'none';
                    }
                    if (data.attachments) renderWorkspacePanel(data.attachments);
                    refreshProjectContext();
                    if (typeof isTerminalInitialized !== 'undefined' && !isTerminalInitialized && (document.body.classList.contains('terminal-active') || document.body.classList.contains('split-active'))) {
                        initTerminalProcess();
                    }
                });
            }
            // Listener pra IA ter editado um arquivo → chips horizontais no último interaction-block
            if (window.electronAPI && window.electronAPI.onWorkspaceFileWritten) {
                window.electronAPI.onWorkspaceFileWritten((data) => {
                    try {
                        const SVGI_MINI_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                        const SVGI_MINI_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                        const SVGI_MINI_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; display:inline-block; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
                        const SVGI_MINI_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; color:#ff5252; display:inline-block; vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

                        const verbSvg = data.action === 'create' ? SVGI_MINI_FILE :
                                        data.action === 'delete' ? SVGI_MINI_TRASH :
                                        data.action === 'append' ? SVGI_MINI_PLUS :
                                        SVGI_MINI_EDIT;
                        const parts = (data.path || '').split('/');
                        const shortName = parts.slice(-2).join('/');

                        // Procura ou cria a lista de chips no último interaction-block
                        const lastBlock = transcriptionElement
                            ? transcriptionElement.querySelector('.interaction-block:last-child')
                            : null;
                        const container = lastBlock || transcriptionElement;
                        if (!container) return;

                        let filesList = container.querySelector('.tool-files-list');
                        if (!filesList) {
                            filesList = document.createElement('div');
                            filesList.className = 'tool-files-list';
                            container.appendChild(filesList);
                        }

                        const chip = document.createElement('span');
                        chip.className = 'tool-file-chip';
                        chip.title = `${data.path}\n(clique para ver o diff)`;
                        chip.innerHTML = verbSvg + `<span style="vertical-align:middle;">${shortName}</span>`;
                        // Clicar mostra o DIFF (antes/depois, vermelho/verde — o que a IA
                        // mudou), estilo code review do GitHub. Editar manualmente continua
                        // acessível pela árvore do projeto ou pela busca (Ctrl+F).
                        chip.addEventListener('click', () => {
                            openFileDiff(data.path, data.backupAt);
                        });
                        filesList.appendChild(chip);

                        if (transcriptionElement) {
                            transcriptionElement.scrollTo({ top: transcriptionElement.scrollHeight, behavior: 'smooth' });
                        }
                        
                        if (typeof triggerTreeRefresh === 'function') {
                            triggerTreeRefresh();
                        }
                    } catch (e) { console.warn('file-written render failed:', e); }
                });
            }

            if (window.electronAPI && window.electronAPI.onFileMutated) {
                window.electronAPI.onFileMutated(() => {
                    if (typeof triggerTreeRefresh === 'function') {
                        triggerTreeRefresh();
                    }
                    if (typeof fetchAndUpdateGitStatus === 'function') {
                        fetchAndUpdateGitStatus();
                    }
                });
            }
 // showAttachMenu, wsOpenProjectBtn, wsAddBtn clicks, delete selection, rename selection

    // Toast de Zoom (indica o nível de zoom do editor ou da árvore)
    if (!window.showZoomToast) {
        window.showZoomToast = function(text) {
            let toast = document.getElementById('zoom-level-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'zoom-level-toast';
                toast.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:20000; background:rgba(20,20,28,0.92); color:#50fa7b; border:1px solid rgba(80,250,123,0.4); border-radius:18px; padding:6px 14px; font-family:var(--font-ui, system-ui, sans-serif); font-size:12px; font-weight:600; box-shadow:0 6px 20px rgba(0,0,0,0.6); pointer-events:none; transition:opacity 0.2s ease, transform 0.2s ease; backdrop-filter:blur(8px);';
                document.body.appendChild(toast);
            }
            toast.textContent = text;
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
            clearTimeout(toast._hideTimer);
            toast._hideTimer = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(6px)';
            }, 1200);
        };
    }

    // Zoom da Árvore Lateral (Workspace Tree) com Ctrl + Mouse Wheel
    const setupTreeWheelZoom = () => {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar || sidebar._hasTreeWheelZoom) return;
        sidebar._hasTreeWheelZoom = true;

        // Restaurar tamanho salvo da fonte da árvore
        const savedTreeFontSize = localStorage.getItem('ws_tree_font_size');
        if (savedTreeFontSize) {
            document.documentElement.style.setProperty('--ws-tree-font-size', `${savedTreeFontSize}px`);
            const wsTreeEl = document.getElementById('ws-tree');
            if (wsTreeEl) wsTreeEl.style.fontSize = `${savedTreeFontSize}px`;
        }

        sidebar.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                const wsTreeEl = document.getElementById('ws-tree');
                if (!wsTreeEl) return;

                e.preventDefault();
                e.stopPropagation();

                const delta = e.deltaY < 0 ? 0.8 : -0.8;
                let currentSize = parseFloat(getComputedStyle(wsTreeEl).fontSize) || parseFloat(wsTreeEl.style.fontSize) || 12.5;
                let newSize = Math.min(28, Math.max(8, Math.round((currentSize + delta) * 10) / 10));

                document.documentElement.style.setProperty('--ws-tree-font-size', `${newSize}px`);
                wsTreeEl.style.fontSize = `${newSize}px`;
                localStorage.setItem('ws_tree_font_size', newSize);

                if (typeof window.showZoomToast === 'function') {
                    window.showZoomToast(`🔍 Fonte da Árvore: ${newSize}px`);
                }
            }
        }, { passive: false });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupTreeWheelZoom);
    } else {
        setupTreeWheelZoom();
    }

    // Expose functions
    window.refreshProjectTree = refreshProjectTree;
    window.triggerTreeRefresh = triggerTreeRefresh;
    window.showTreeContextMenu = showTreeContextMenu;
    window.showAttachMenu = showAttachMenu;
    window.deleteSelectedItems = deleteSelectedItems;
    window.deleteSingleItem = deleteSingleItem;
    window.expandAncestorsForFilter = expandAncestorsForFilter;
    window.ensureProjectTreeOpen = ensureProjectTreeOpen;
})();
