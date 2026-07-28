// Workspace Searching and Tree Filtering Module
var activeTreeFilterMode = null;
var contentSearchMatches = [];
var contentSearchMatchSet = new Set();
var contentSearchDebounce = null;
var contentSearchSeq = 0;

(function() {
    const wsTreeFilterInput = document.getElementById('ws-tree-filter');
    const wsTreeContentFilterInput = document.getElementById('ws-tree-content-filter');
    const wsTreeFilterHint = document.getElementById('ws-tree-filter-hint');
    const wsTreeContentFilterHint = document.getElementById('ws-tree-content-filter-hint');
    const wsProjectMain = document.getElementById('ws-project-main');

    function currentTreeNameFilter() {
        return (wsTreeFilterInput && wsTreeFilterInput.value.trim().toLowerCase()) || '';
    }
    window.currentTreeNameFilter = currentTreeNameFilter;

    function currentTreeContentFilter() {
        return (wsTreeContentFilterInput && wsTreeContentFilterInput.value.trim().toLowerCase()) || '';
    }
    window.currentTreeContentFilter = currentTreeContentFilter;

    function clearContentSearchState() {
        contentSearchMatches = [];
        contentSearchMatchSet = new Set();
        if (contentSearchDebounce) {
            clearTimeout(contentSearchDebounce);
            contentSearchDebounce = null;
        }
    }
    window.clearContentSearchState = clearContentSearchState;

            function closeTreeContentFilter() {
                if (!wsTreeContentFilterInput) return;
                wsTreeContentFilterInput.style.display = 'none';
                if (wsTreeContentFilterHint) wsTreeContentFilterHint.style.display = 'none';
                wsTreeContentFilterInput.value = '';
                clearContentSearchState();
                if (activeTreeFilterMode === 'content') activeTreeFilterMode = null;
                renderTree();
            }
            function closeTreeFilter() {
                if (!wsTreeFilterInput) return;
                wsTreeFilterInput.style.display = 'none';
                if (wsTreeFilterHint) wsTreeFilterHint.style.display = 'none';
                wsTreeFilterInput.value = '';
                if (activeTreeFilterMode === 'name') activeTreeFilterMode = null;
                renderTree();
            }
            function updateTreeFilterHint() {
                if (!wsTreeFilterHint) return;
                const filter = currentTreeNameFilter();
                if (!filter) { wsTreeFilterHint.textContent = ''; return; }
                const n = treeEntries.filter(e => !e.isDir && e.name.toLowerCase().includes(filter)).length;
                wsTreeFilterHint.textContent = n ? `${n} arquivo(s) — Enter abre o primeiro` : 'nenhum arquivo encontrado';
            }
            function updateTreeContentFilterHint(message) {
                if (!wsTreeContentFilterHint) return;
                if (typeof message === 'string') {
                    wsTreeContentFilterHint.textContent = message;
                    return;
                }
                const filter = currentTreeContentFilter();
                if (!filter) {
                    wsTreeContentFilterHint.textContent = '';
                } else if (filter.length < 4) {
                    wsTreeContentFilterHint.textContent = 'digite pelo menos 4 letras';
                } else {
                    wsTreeContentFilterHint.textContent = contentSearchMatches.length
                        ? `${contentSearchMatches.length} arquivo(s) — Enter abre todos`
                        : 'nenhum arquivo encontrado';
                }
            }
            // Primeiro arquivo (não pasta) que bate o filtro, na ordem da árvore.
            function firstMatchingFile(filter) {
                return treeEntries.find(e => !e.isDir && e.name.toLowerCase().includes(filter));
            }
            async function runContentSearchNow() {
                const filter = currentTreeContentFilter();
                const searchSeq = ++contentSearchSeq;
                if (!filter) {
                    clearContentSearchState();
                    updateTreeContentFilterHint('');
                    renderTree();
                    return;
                }
                if (filter.length < 4) {
                    clearContentSearchState();
                    updateTreeContentFilterHint();
                    renderTree();
                    return;
                }
                updateTreeContentFilterHint('procurando…');
                let res = null;
                try {
                    res = window.electronAPI && window.electronAPI.searchProjectContent
                        ? await window.electronAPI.searchProjectContent(filter)
                        : null;
                } catch (_) {}
                if (searchSeq !== contentSearchSeq) return;
                contentSearchMatches = Array.isArray(res && res.matches) ? res.matches : [];
                contentSearchMatchSet = new Set(contentSearchMatches);
                expandAncestorsForFilter();
                renderTree();
                if (res && res.ok === false) updateTreeContentFilterHint('erro ao buscar conteúdo');
                else if (res && res.limited) updateTreeContentFilterHint(`${contentSearchMatches.length} arquivo(s) — limite atingido, Enter abre os listados`);
                else updateTreeContentFilterHint();
            }
            function scheduleContentSearch() {
                if (contentSearchDebounce) clearTimeout(contentSearchDebounce);
                contentSearchDebounce = setTimeout(() => {
                    contentSearchDebounce = null;
                    runContentSearchNow();
                }, 180);
            }

            // Busca flutuante (Ctrl+F, editor fechado, de qualquer lugar do app).
            // Abre a árvore do projeto sozinha (se ainda fechada) pra mostrar os
            // matches sublinhados; não depende da árvore já estar aberta.
            async function openTreeFilter() {
                if (!wsTreeFilterInput) return;
                const ok = await ensureProjectTreeOpen();
                if (!ok) return;
                closeTreeContentFilter();
                activeTreeFilterMode = 'name';
                wsTreeFilterInput.style.display = 'block';
                if (wsTreeFilterHint) wsTreeFilterHint.style.display = 'block';
                wsTreeFilterInput.value = '';
                updateTreeFilterHint();
                renderTree();
                wsTreeFilterInput.focus();
                setTimeout(() => wsTreeFilterInput.focus(), 50);
            }
            async function openTreeContentFilter() {
                if (!wsTreeContentFilterInput) return;
                const ok = await ensureProjectTreeOpen();
                if (!ok) return;
                closeTreeFilter();
                activeTreeFilterMode = 'content';
                clearContentSearchState();
                wsTreeContentFilterInput.style.display = 'block';
                if (wsTreeContentFilterHint) wsTreeContentFilterHint.style.display = 'block';
                wsTreeContentFilterInput.value = '';
                updateTreeContentFilterHint();
                renderTree();
                wsTreeContentFilterInput.focus();
                setTimeout(() => wsTreeContentFilterInput.focus(), 50);
            }
            // Exposto em window: os listeners globais vivem em outro escopo.
            window.openTreeFilter = openTreeFilter;
            window.openTreeContentFilter = openTreeContentFilter;
            if (wsTreeFilterInput) {
                wsTreeFilterInput.addEventListener('input', () => {
                    expandAncestorsForFilter();
                    renderTree();
                    updateTreeFilterHint();
                });
                wsTreeFilterInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.stopPropagation(); e.preventDefault(); closeTreeFilter();
                    } else if (e.key === 'Enter') {
                        e.stopPropagation(); e.preventDefault();
                        const filter = currentTreeNameFilter();
                        const match = filter && firstMatchingFile(filter);
                        if (match) {
                            closeTreeFilter();
                            openFileViewer(match.path);
                        }
                    }
                });
            }
            if (wsTreeContentFilterInput) {
                wsTreeContentFilterInput.addEventListener('input', () => {
                    scheduleContentSearch();
                    if (currentTreeContentFilter().length < 4) renderTree();
                    updateTreeContentFilterHint();
                });
                wsTreeContentFilterInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        e.stopPropagation(); e.preventDefault(); closeTreeContentFilter();
                    } else if (e.key === 'Enter') {
                        e.stopPropagation(); e.preventDefault();
                        if (currentTreeContentFilter().length >= 4 && contentSearchMatches.length) {
                            const paths = [...contentSearchMatches];
                            closeTreeContentFilter();
                            openMatchingFiles(paths);
                        }
                    }
                });
            }

 // filter close/hint/schedule search/run search

    // Expose functions
    window.closeTreeContentFilter = closeTreeContentFilter;
    window.closeTreeFilter = closeTreeFilter;
    window.updateTreeFilterHint = updateTreeFilterHint;
    window.updateTreeContentFilterHint = updateTreeContentFilterHint;
    window.firstMatchingFile = firstMatchingFile;
    window.runContentSearchNow = runContentSearchNow;
    window.scheduleContentSearch = scheduleContentSearch;
    window.openTreeFilter = openTreeFilter;
    window.openTreeContentFilter = openTreeContentFilter;
})();
