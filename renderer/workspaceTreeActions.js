// renderer/workspaceTreeActions.js
// Workspace Tree Interactions, Menus and Buttons Module
(function() {
    const wsProjectMain = document.getElementById('ws-project-main');
    const wsTreeToggle = document.getElementById('ws-tree-toggle');
    const wsTree = document.getElementById('ws-tree');
    const wsProject = document.getElementById('ws-project');
    const wsAddBtn = document.getElementById('workspace-add');
    const wsPanel = document.getElementById('workspace-panel');
    const transcriptionElement = document.getElementById('transcription');

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
                if (typeof window.updateSelectionUi === 'function') window.updateSelectionUi();
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
                    if (typeof window.updateSelectionUi === 'function') window.updateSelectionUi();
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

        const expPaths = window.expandedDirPaths || new Set();

        let newEntries = res.entries.map((entry) => ({
            ...entry,
            collapsed: entry.isDir ? !expPaths.has(entry.path) : false,
            loaded: true
        }));

        for (let i = 0; i < newEntries.length; i++) {
            const e = newEntries[i];
            if (e.isDir && expPaths.has(e.path) && e.synthetic) {
                e.collapsed = false;
                try {
                    let directEntries = [];
                    if (e.synthetic === 'java-deps') {
                        if (typeof window.fetchJavaDepsChildren === 'function') {
                            const r = await window.fetchJavaDepsChildren(e);
                            if (r && r.entries) directEntries = r.entries;
                        }
                    } else if (e.synthetic === 'java-jar') {
                        if (typeof window.fetchJavaJarChildren === 'function') {
                            const r = await window.fetchJavaJarChildren(e);
                            if (r && r.entries) directEntries = r.entries;
                        }
                    }
                    if (directEntries && directEntries.length) {
                        const children = directEntries.map(c => ({
                            ...c,
                            depth: e.depth + 1 + (c.depth || 0),
                            collapsed: c.isDir ? !expPaths.has(c.path) : false,
                            loaded: true
                        }));
                        newEntries.splice(i + 1, 0, ...children);
                    }
                } catch (_) {}
            }
        }

        treeEntries = newEntries;
        if (typeof window.fetchAndUpdateGitStatus === 'function') await window.fetchAndUpdateGitStatus();
        window.renderTree();
    }

    window.addEventListener('focus', () => {
        if (wsProjectMain && wsProjectMain.dataset && wsProjectMain.dataset.path) {
            if (typeof window.fetchAndUpdateGitStatus === 'function') {
                window.fetchAndUpdateGitStatus();
            }
        }
    });

    function applyGitStatusClasses() {
        if (!wsTree) return;
        const projectPath = wsProjectMain ? wsProjectMain.dataset.path : '';
        const gitStatusObj = window.currentGitStatus || {};
        const mods = gitStatusObj.modifiedFiles || {};
        const dirs = gitStatusObj.modifiedDirs || {};
        const normProject = (projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');

        for (const node of wsTree.querySelectorAll('.ws-tree-node[data-path]')) {
            const abs = node.dataset.path || '';
            const normAbs = abs.replace(/\\/g, '/');
            let rel = normAbs;
            if (normProject && normAbs.toLowerCase().startsWith(normProject.toLowerCase())) {
                rel = normAbs.substring(normProject.length).replace(/^\/+/, '');
            }
            const isDir = node.classList.contains('dir');
            node.classList.remove('git-modified', 'git-staged', 'git-untracked', 'git-dir-modified');
            const existingTag = node.querySelector('.ws-tree-git-tag');
            if (existingTag) existingTag.remove();

            if (isDir) {
                if (dirs[rel] || dirs[rel.toLowerCase()]) {
                    node.classList.add('git-dir-modified');
                }
            } else {
                const status = mods[rel] || mods[rel.toLowerCase()];
                if (status) {
                    node.classList.add(status === 'A' ? 'git-staged' : 'git-modified');
                    const tag = document.createElement('span');
                    tag.className = 'ws-tree-git-tag ' + (status === 'A' ? 'tag-a' : 'tag-m');
                    tag.textContent = (status === 'A' ? 'A' : 'M');
                    node.appendChild(tag);
                }
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

    function expandAncestorsMatching(predicate) {
        const dirStack = [];
        for (const e of treeEntries) {
            while (dirStack.length && dirStack[dirStack.length - 1].depth >= e.depth) dirStack.pop();
            if (predicate(e)) dirStack.forEach(d => { d.collapsed = false; });
            if (e.isDir) dirStack.push(e);
        }
    }

    function expandAncestorsForFilter() {
        const nameFilter = typeof window.currentTreeNameFilter === 'function' ? window.currentTreeNameFilter() : '';
        const contentFilter = typeof window.currentTreeContentFilter === 'function' ? window.currentTreeContentFilter() : '';
        const contentSearchMatchSet = window.contentSearchMatchSet || new Set();

        if (window.activeTreeFilterMode === 'name' && nameFilter) {
            expandAncestorsMatching((e) => e.name.toLowerCase().includes(nameFilter));
        } else if (window.activeTreeFilterMode === 'content' && contentFilter.length >= 4) {
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

    async function toggleProjectTree() {
        if (!wsTree || !wsTreeToggle) return;
        const open = wsTreeToggle.getAttribute('aria-expanded') === 'true';
        if (open) {
            if (typeof window.collapseProjectTree === 'function') window.collapseProjectTree();
            return;
        }
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
        const expPaths = window.expandedDirPaths || new Set();
        treeEntries = res.entries.map((entry) => ({
            ...entry,
            collapsed: entry.isDir ? !expPaths.has(entry.path) : false,
            loaded: true
        }));
        window.renderTree();
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
            if (projectPath && typeof window.showTreeContextMenu === 'function') {
                window.showTreeContextMenu(ev, { path: projectPath, isRoot: true });
            }
        });
    }

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
        menu.appendChild(mkItem('Arquivo', async () => {
            const r = await window.electronAPI.workspacePickFile();
            if (r && r.attachments && typeof renderWorkspacePanel === 'function') renderWorkspacePanel(r.attachments);
        }));
        menu.appendChild(mkItem('Pasta', async () => {
            const r = await window.electronAPI.workspacePickDir();
            if (r && r.attachments && typeof renderWorkspacePanel === 'function') renderWorkspacePanel(r.attachments);
        }));
        document.body.appendChild(menu);
        const r = anchor.getBoundingClientRect();
        const menuWidth = menu.offsetWidth || 120;
        const menuHeight = menu.offsetHeight || 80;

        let top = r.bottom + 4;
        if (top + menuHeight > window.innerHeight - 8) {
            top = r.top - menuHeight - 4;
        }

        let left = r.left;
        if (left + menuWidth > window.innerWidth - 8) {
            left = window.innerWidth - menuWidth - 8;
        }

        menu.style.left = Math.round(Math.max(8, left)) + 'px';
        menu.style.top = Math.round(Math.max(8, top)) + 'px';
        const closer = (ev) => {
            if (!menu.contains(ev.target) && ev.target !== anchor) {
                menu.remove();
                document.removeEventListener('click', closer, true);
            }
        };
        setTimeout(() => document.addEventListener('click', closer, true), 0);
    }

    const wsOpenProjectBtn = document.getElementById('workspace-open-project');
    if (wsOpenProjectBtn) wsOpenProjectBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (typeof window.pickProjectFolder === 'function') await window.pickProjectFolder();
    });

    if (wsAddBtn) wsAddBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!(window.electronAPI && window.electronAPI.workspacePickFile)) return;
        const r = await window.electronAPI.workspacePickFile();
        if (r && r.attachments && typeof renderWorkspacePanel === 'function') renderWorkspacePanel(r.attachments);
        if (typeof refreshProjectContext === 'function') refreshProjectContext();
    });

    if (window.electronAPI && window.electronAPI.onWorkspaceChanged) {
        window.electronAPI.onWorkspaceChanged((data) => {
            if (typeof data.enabled === 'boolean' && wsPanel) {
                wsPanel.style.display = data.enabled ? '' : 'none';
            }
            if (data.attachments && typeof renderWorkspacePanel === 'function') renderWorkspacePanel(data.attachments);
            if (typeof refreshProjectContext === 'function') refreshProjectContext();
            if (typeof isTerminalInitialized !== 'undefined' && !isTerminalInitialized && (document.body.classList.contains('terminal-active') || document.body.classList.contains('split-active'))) {
                if (typeof initTerminalProcess === 'function') initTerminalProcess();
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onWorkspaceFileWritten) {
        window.electronAPI.onWorkspaceFileWritten((data) => {
            try {
                const SVGI_MINI_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
                const SVGI_MINI_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                const SVGI_MINI_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; display:inline-block; vertical-align:middle;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
                const SVGI_MINI_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:11px; height:11px; margin-right:4px; opacity:0.8; color:#ff5252; display:inline-block; vertical-align:middle;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

                const verbSvg = data.action === 'create' ? SVGI_MINI_FILE :
                                data.action === 'delete' ? SVGI_MINI_TRASH :
                                data.action === 'append' ? SVGI_MINI_PLUS :
                                SVGI_MINI_EDIT;
                const parts = (data.path || '').split('/');
                const shortName = parts.slice(-2).join('/');

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
                chip.addEventListener('click', () => {
                    if (typeof openFileDiff === 'function') openFileDiff(data.path, data.backupAt);
                });
                filesList.appendChild(chip);

                if (transcriptionElement) {
                    transcriptionElement.scrollTo({ top: transcriptionElement.scrollHeight, behavior: 'smooth' });
                }

                triggerTreeRefresh();
            } catch (e) { console.warn('file-written render failed:', e); }
        });
    }

    if (window.electronAPI && window.electronAPI.onFileMutated) {
        window.electronAPI.onFileMutated(() => {
            triggerTreeRefresh();
            if (typeof window.fetchAndUpdateGitStatus === 'function') {
                window.fetchAndUpdateGitStatus();
            }
        });
    }

    window.refreshProjectTree = refreshProjectTree;
    window.applyGitStatusClasses = applyGitStatusClasses;
    window.triggerTreeRefresh = triggerTreeRefresh;
    window.showAttachMenu = showAttachMenu;
    window.deleteSelectedItems = deleteSelectedItems;
    window.deleteSingleItem = deleteSingleItem;
    window.expandAncestorsForFilter = expandAncestorsForFilter;
    window.ensureProjectTreeOpen = ensureProjectTreeOpen;
})();
