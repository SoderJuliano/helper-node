// renderer/workspaceTree.js
// Workspace Code Tree Module
var treeEntries = [];
var selectedPaths = new Set();
var expandedDirPaths = new Set();
window.expandedDirPaths = expandedDirPaths;
var renamingPath = null;
var creatingFileParent = null;
var creatingFolderParent = null;

(function() {
    const wsPanel = document.getElementById('workspace-panel');
    const wsProjectMain = document.getElementById('ws-project-main');
    const wsTreeToggle = document.getElementById('ws-tree-toggle');
    const wsTree = document.getElementById('ws-tree');

    const TREE_DIR_IC = '<svg class="ws-tree-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
    const TREE_CHEVRON_IC = '<svg class="ws-tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    const TREE_CHEVRON_SPACER = '<span class="ws-tree-chevron-spacer"></span>';
    const TREE_SPINNER_IC = '<svg class="ws-tree-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>';
    const TREE_DEPS_IC = '<svg class="ws-tree-ic ws-tree-ic-deps" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
    const TREE_JAR_IC = '<svg class="ws-tree-ic ws-tree-ic-jar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 3v18M16 3v18M4 8h4M16 8h4M4 13h4M16 13h4"/></svg>';
    const TREE_PKG_IC = '<svg class="ws-tree-ic ws-tree-ic-pkg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24a1.78 1.78 0 0 0-2.5 1.55v12.42a1.78 1.78 0 0 0 2.5 1.55L16.5 14.6a1.78 1.78 0 0 0 0-3.2z"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>';
    const TREE_CLASS_IC = '<svg class="ws-tree-ic ws-tree-ic-class" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 8.5c-1.5 0-3 1-3 3.5s1.5 3.5 3 3.5c1 0 1.8-.4 2.3-1"/></svg>';

    const wsEmptyNote = document.getElementById('ws-empty-note');
    const wsPanelTop = document.getElementById('workspace-panel');
    if (wsEmptyNote && wsPanelTop) {
        const syncWsNote = () => {
            const hidden = wsPanelTop.style.display === 'none';
            wsEmptyNote.style.display = hidden ? '' : 'none';
        };
        new MutationObserver(syncWsNote).observe(wsPanelTop, { attributes: true, attributeFilter: ['style'] });
        syncWsNote();
    }

    function collapseProjectTree() {
        if (wsTree) { wsTree.style.display = 'none'; wsTree.innerHTML = ''; }
        if (wsTreeToggle) wsTreeToggle.setAttribute('aria-expanded', 'false');
        const filterEl = document.getElementById('ws-tree-filter');
        if (filterEl) { filterEl.style.display = 'none'; filterEl.value = ''; }
        const contentFilterEl = document.getElementById('ws-tree-content-filter');
        if (contentFilterEl) { contentFilterEl.style.display = 'none'; contentFilterEl.value = ''; }
        const filterHintEl = document.getElementById('ws-tree-filter-hint');
        if (filterHintEl) filterHintEl.style.display = 'none';
        const contentFilterHintEl = document.getElementById('ws-tree-content-filter-hint');
        if (contentFilterHintEl) contentFilterHintEl.style.display = 'none';
        if (typeof window.clearContentSearchState === 'function') window.clearContentSearchState();
        treeEntries = [];
        expandedDirPaths.clear();
    }

    async function toggleDir(e) {
        if (!e || !e.isDir) return;
        if (!expandedDirPaths) expandedDirPaths = new Set();

        if (!e.collapsed) {
            e.collapsed = true;
            expandedDirPaths.delete(e.path);
            const pPrefix = e.path.replace(/\\/g, '/').replace(/\/+$/, '') + '/';
            for (const p of expandedDirPaths) {
                if ((p.replace(/\\/g, '/') + '/').startsWith(pPrefix)) {
                    expandedDirPaths.delete(p);
                }
            }
            for (const item of treeEntries) {
                if (item.isDir && item.path !== e.path && (item.path.replace(/\\/g, '/') + '/').startsWith(pPrefix)) {
                    item.collapsed = true;
                }
            }
            renderTree();
            return;
        }

        if (e.loading) return;

        e.collapsed = false;
        expandedDirPaths.add(e.path);

        const idx = treeEntries.indexOf(e);
        const hasChildrenInArray = (idx !== -1 && idx + 1 < treeEntries.length && treeEntries[idx + 1].depth > e.depth);

        if (!hasChildrenInArray) {
            let directEntries = [];
            let retry = false;

            if (e.synthetic === 'java-deps') {
                e.loading = true;
                renderTree();
                if (typeof window.fetchJavaDepsChildren === 'function') {
                    const r = await window.fetchJavaDepsChildren(e);
                    directEntries = r.entries || [];
                    retry = r.retry;
                }
            } else if (e.synthetic === 'java-jar') {
                e.loading = true;
                renderTree();
                if (typeof window.fetchJavaJarChildren === 'function') {
                    const r = await window.fetchJavaJarChildren(e);
                    directEntries = r.entries || [];
                }
            } else if (e.lazy && window.electronAPI && window.electronAPI.getDirChildren) {
                e.loading = true;
                renderTree();
                try {
                    const res = await window.electronAPI.getDirChildren(e.path);
                    if (res && res.ok && res.entries) directEntries = res.entries;
                } catch (_) {}
            }

            e.loading = false;
            e.loaded = !retry;

            const curIdx = treeEntries.indexOf(e);
            if (curIdx !== -1) {
                let removeCount = 0;
                while (curIdx + 1 + removeCount < treeEntries.length && treeEntries[curIdx + 1 + removeCount].depth > e.depth) {
                    removeCount++;
                }
                if (removeCount > 0) {
                    treeEntries.splice(curIdx + 1, removeCount);
                }
                if (directEntries && directEntries.length) {
                    const children = directEntries.map(c => ({
                        ...c,
                        depth: e.depth + 1 + (c.depth || 0),
                        collapsed: c.isDir ? !expandedDirPaths.has(c.path) : false,
                        loaded: true
                    }));
                    treeEntries.splice(curIdx + 1, 0, ...children);
                }
            }
        }

        let curIdx = treeEntries.indexOf(e);
        if (curIdx !== -1 && !e.synthetic) {
            while (curIdx < treeEntries.length) {
                const item = treeEntries[curIdx];
                if (item.isDir) {
                    item.collapsed = false;
                    expandedDirPaths.add(item.path);
                }
                const directSubs = [];
                for (let k = curIdx + 1; k < treeEntries.length; k++) {
                    if (treeEntries[k].depth === item.depth + 1) {
                        directSubs.push(treeEntries[k]);
                    } else if (treeEntries[k].depth <= item.depth) {
                        break;
                    }
                }
                const subDirs = directSubs.filter(c => c.isDir && !c.synthetic);
                const subFiles = directSubs.filter(c => !c.isDir);
                if (subDirs.length === 1 && subFiles.length === 0) {
                    curIdx = treeEntries.indexOf(subDirs[0]);
                    if (curIdx === -1) break;
                } else {
                    break;
                }
            }
        }

        renderTree();
    }

    function renderTree() {
        if (!wsTree) return;
        wsTree.innerHTML = '';
        const nameFilter = typeof window.currentTreeNameFilter === 'function' ? window.currentTreeNameFilter() : '';
        const contentFilter = typeof window.currentTreeContentFilter === 'function' ? window.currentTreeContentFilter() : '';
        const hasNameFilter = window.activeTreeFilterMode === 'name' && !!nameFilter;
        const hasContentFilter = window.activeTreeFilterMode === 'content' && !!contentFilter;
        const projectPath = wsProjectMain ? wsProjectMain.dataset.path : '';
        const contentSearchMatchSet = window.contentSearchMatchSet || new Set();

        if (creatingFileParent === projectPath && typeof window.renderCreationInput === 'function') {
            window.renderCreationInput(wsTree, projectPath, 0);
        }
        if (creatingFolderParent === projectPath && typeof window.renderCreationFolderInput === 'function') {
            window.renderCreationFolderInput(wsTree, projectPath, 0);
        }

        let skipDepth = null;
        for (const e of treeEntries) {
            if (skipDepth !== null) {
                if (e.depth > skipDepth) continue;
                skipDepth = null;
            }
            const isNameMatch = hasNameFilter && e.name.toLowerCase().includes(nameFilter);
            const isContentMatch = hasContentFilter && !e.isDir && contentSearchMatchSet.has(e.path);
            const shouldDim = hasNameFilter || (hasContentFilter && contentFilter.length >= 4);
            const isMatch = isNameMatch || isContentMatch;

            let relPath = e.path;
            const normPath = (e.path || '').replace(/\\/g, '/');
            const normProject = (projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
            if (normProject && normPath.toLowerCase().startsWith(normProject.toLowerCase())) {
                relPath = normPath.substring(normProject.length).replace(/^\/+/, '');
            } else {
                relPath = normPath;
            }

            let gitClass = '';
            let gitStatus = null;
            let featuredClass = '';
            let dirIconHtml = TREE_DIR_IC;

            const gitStatusObj = window.currentGitStatus || {};

            if (!e.synthetic) {
                if (!e.isDir) {
                    const mods = gitStatusObj.modifiedFiles || {};
                    gitStatus = mods[relPath] || mods[relPath.toLowerCase()] || null;
                    if (gitStatus) {
                        gitClass = (gitStatus === 'A') ? ' git-staged' : ' git-modified';
                    }
                } else {
                    const dirs = gitStatusObj.modifiedDirs || {};
                    if (dirs[relPath] || dirs[relPath.toLowerCase()]) {
                        gitClass = ' git-dir-modified';
                    }

                    const dirName = e.name.toLowerCase();
                    if (dirName === 'src' || dirName === 'main') {
                        featuredClass = ' ws-tree-node-featured';
                        dirIconHtml = '<svg class="ws-tree-ic ws-tree-ic-featured" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
                    } else if (['app', 'services', 'components', 'renderer', 'pages', 'lib', 'core', 'api', 'backend', 'frontend', 'controllers', 'models', 'views', 'routes'].includes(dirName)) {
                        featuredClass = ' ws-tree-node-primary';
                        dirIconHtml = '<svg class="ws-tree-ic ws-tree-ic-primary" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
                    }
                }
            }

            const node = document.createElement('div');
            node.className = 'ws-tree-node ' + (e.isDir ? 'dir' : 'file') +
                (e.collapsed ? ' collapsed' : '') +
                (shouldDim ? (isMatch ? ' match' : ' dim') : '') +
                (e.synthetic ? ' ws-tree-node-synthetic' : '') +
                gitClass + featuredClass;
            node.style.paddingLeft = (4 + e.depth * 12) + 'px';
            node.dataset.path = e.path;
            const chevron = e.loading ? TREE_SPINNER_IC : TREE_CHEVRON_IC;
            if (e.synthetic === 'java-deps') {
                node.innerHTML = chevron + TREE_DEPS_IC;
            } else if (e.synthetic === 'java-jar') {
                node.innerHTML = chevron + TREE_JAR_IC;
            } else if (e.synthetic === 'java-pkg') {
                node.innerHTML = chevron + TREE_PKG_IC;
            } else if (e.synthetic === 'java-class') {
                node.innerHTML = TREE_CHEVRON_SPACER + TREE_CLASS_IC;
            } else if (e.synthetic === 'java-deps-status') {
                node.innerHTML = TREE_CHEVRON_SPACER;
            } else {
                node.innerHTML = e.isDir ? (chevron + dirIconHtml) : (TREE_CHEVRON_SPACER + (window.fileIconHtml ? window.fileIconHtml(e.name) : ''));
            }

            if (typeof window.wireTreeNodeEvents === 'function') {
                window.wireTreeNodeEvents(node, e, projectPath);
            }

            if (renamingPath === e.path) {
                const input = document.createElement('input');
                input.type = 'text';
                input.value = e.name;
                input.className = 'ws-tree-rename-input';
                input.style.cssText = `
                    background: #0d0d12;
                    border: 1px solid var(--accent-2);
                    color: var(--text);
                    font-family: inherit;
                    font-size: inherit;
                    padding: 1px 4px;
                    margin-left: 4px;
                    border-radius: 3px;
                    width: 100%;
                    box-sizing: border-box;
                    outline: none;
                `;
                node.appendChild(input);
                input.addEventListener('click', (ev) => ev.stopPropagation());
                setTimeout(() => { input.focus(); input.select(); }, 50);
                input.addEventListener('blur', async () => {
                    const val = input.value.trim();
                    if (val && val !== e.name) {
                        const lastSlash = Math.max(e.path.lastIndexOf('/'), e.path.lastIndexOf('\\'));
                        const newPath = e.path.substring(0, lastSlash + 1) + val;
                        const res = await window.electronAPI.renameItem(e.path, newPath);
                        if (res.ok) {
                            if (window.EditorController && typeof window.EditorController.renamePath === 'function') {
                                window.EditorController.renamePath(e.path, newPath);
                            }
                            if (typeof window.refreshProjectTree === 'function') await window.refreshProjectTree();
                        } else {
                            if (typeof showToast === 'function') showToast('Erro ao renomear: ' + res.error);
                        }
                    }
                    renamingPath = null;
                    renderTree();
                });
                input.addEventListener('keydown', async (ev) => {
                    if (ev.key === 'Enter') {
                        input.blur();
                    } else if (ev.key === 'Escape') {
                        renamingPath = null;
                        renderTree();
                    }
                });
            } else {
                const label = document.createElement('span');
                label.className = 'ws-tree-label';
                if (e.synthetic === 'java-class') {
                    label.textContent = e.name.split('.').pop();
                    node.title = e.name;
                } else if (e.synthetic === 'java-deps-status') {
                    label.textContent = e.name;
                    label.style.opacity = '0.6';
                    label.style.fontStyle = 'italic';
                } else {
                    label.textContent = e.name;
                }
                node.appendChild(label);

                if (gitStatus && !e.isDir) {
                    const tag = document.createElement('span');
                    tag.className = 'ws-tree-git-tag ' + (gitStatus === 'A' ? 'tag-a' : 'tag-m');
                    tag.textContent = (gitStatus === 'A' ? 'A' : 'M');
                    node.appendChild(tag);
                }
            }

            if (e.isDir && !e.collapsed) {
                if (creatingFileParent === e.path && typeof window.renderCreationInput === 'function') {
                    window.renderCreationInput(node, e.path, e.depth + 1);
                }
                if (creatingFolderParent === e.path && typeof window.renderCreationFolderInput === 'function') {
                    window.renderCreationFolderInput(node, e.path, e.depth + 1);
                }
            }

            wsTree.appendChild(node);
            if (e.isDir && e.collapsed) {
                skipDepth = e.depth;
            }
        }
    }

    const wsTreeTrashBtn = document.getElementById('ws-tree-trash-btn');
    if (wsTreeTrashBtn) {
        wsTreeTrashBtn.addEventListener('click', () => {
            if (typeof window.deleteSelectedItems === 'function') window.deleteSelectedItems();
        });
    }

    function updateSelectionUi() {
        if (wsTreeTrashBtn) {
            wsTreeTrashBtn.style.display = selectedPaths.size > 0 ? 'flex' : 'none';
        }
    }

    if (window.electronAPI && window.electronAPI.onJavaDepsChanged) {
        window.electronAPI.onJavaDepsChanged(() => {
            const depsNode = treeEntries.find(e => e.synthetic === 'java-deps');
            if (depsNode && !depsNode.collapsed) {
                depsNode.loaded = false;
                const idx = treeEntries.indexOf(depsNode);
                if (idx !== -1) {
                    let removeCount = 0;
                    while (idx + 1 + removeCount < treeEntries.length && treeEntries[idx + 1 + removeCount].depth > depsNode.depth) {
                        removeCount++;
                    }
                    if (removeCount > 0) {
                        treeEntries.splice(idx + 1, removeCount);
                    }
                }
                depsNode.collapsed = true;
                toggleDir(depsNode);
            }
        });
    }

    async function revealPathInTree(targetPath) {
        if (!targetPath || !wsTree) return;
        const normTarget = String(targetPath).replace(/\\/g, '/');

        if (normTarget.includes('.jar!')) {
            const foundJarEl = highlightAndScrollToNode(normTarget);
            if (foundJarEl) return;
            return;
        }

        let foundEl = highlightAndScrollToNode(normTarget);
        if (foundEl) return;

        const projectPath = (wsProjectMain ? wsProjectMain.dataset.path : '') || '';
        const normProj = projectPath.replace(/\\/g, '/');
        if (normProj && normTarget.toLowerCase().startsWith(normProj.toLowerCase())) {
            let rel = normTarget.substring(normProj.length).replace(/^[/\\]+/, '');
            const parts = rel.split('/');
            parts.pop();
            let cur = normProj;
            for (const p of parts) {
                cur += '/' + p;
                const dirEntry = treeEntries.find(e => e.isDir && e.path.replace(/\\/g, '/').toLowerCase() === cur.toLowerCase());
                if (dirEntry && dirEntry.collapsed) {
                    await toggleDir(dirEntry);
                }
            }
            highlightAndScrollToNode(normTarget);
        }
    }

    function highlightAndScrollToNode(normTarget) {
        if (!wsTree) return null;
        const normLower = normTarget.toLowerCase();
        const nodes = wsTree.querySelectorAll('.ws-tree-node');
        let targetEl = null;

        nodes.forEach(n => {
            n.classList.remove('ws-tree-active-file');
            const p = (n.dataset.path || '').replace(/\\/g, '/').toLowerCase();
            if (p === normLower || p.endsWith('/' + normLower) || normLower.endsWith('/' + p)) {
                targetEl = n;
            }
        });

        if (targetEl) {
            targetEl.classList.add('ws-tree-active-file');
            targetEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return targetEl;
        }
        return null;
    }

    window.collapseProjectTree = collapseProjectTree;
    window.toggleDir = toggleDir;
    window.renderTree = renderTree;
    window.updateSelectionUi = updateSelectionUi;
    window.revealPathInTree = revealPathInTree;
})();
