// Workspace Searching and Tree Filtering Module
var activeTreeFilterMode = null;
var contentSearchMatches = [];
var contentSearchMatchSet = new Set();
var contentSearchOccurrences = [];
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
        contentSearchOccurrences = [];
        if (contentSearchDebounce) {
            clearTimeout(contentSearchDebounce);
            contentSearchDebounce = null;
        }
        const occContainer = document.getElementById('ws-tree-content-occurrences');
        if (occContainer) {
            occContainer.style.display = 'none';
            occContainer.innerHTML = '';
        }
    }
    window.clearContentSearchState = clearContentSearchState;

    function scrollToFirstTreeMatch() {
        const wsTree = document.getElementById('ws-tree');
        if (!wsTree) return;
        wsTree.querySelectorAll('.ws-tree-node.focused-match').forEach(el => el.classList.remove('focused-match'));
        const firstMatch = wsTree.querySelector('.ws-tree-node.match');
        if (firstMatch) {
            firstMatch.classList.add('focused-match');
            firstMatch.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }
    window.scrollToFirstTreeMatch = scrollToFirstTreeMatch;

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderContentOccurrencesPanel() {
        const occContainer = document.getElementById('ws-tree-content-occurrences');
        if (!occContainer) return;
        const filter = currentTreeContentFilter();
        if (!filter || filter.length < 4 || !contentSearchOccurrences.length) {
            occContainer.style.display = 'none';
            occContainer.innerHTML = '';
            return;
        }

        occContainer.innerHTML = '';

        const header = document.createElement('div');
        header.className = 'ws-occ-header';
        header.textContent = `${contentSearchOccurrences.length} ocorrência(s) em ${contentSearchMatches.length} arquivo(s):`;
        occContainer.appendChild(header);

        const list = document.createElement('div');
        list.className = 'ws-occ-list';

        contentSearchOccurrences.forEach(item => {
            const row = document.createElement('div');
            row.className = 'ws-occ-item';

            const escapedText = escapeHtml(item.text);
            const lowerEscaped = escapedText.toLowerCase();
            const lowerFilter = filter.toLowerCase();
            let highlighted = '';
            let start = 0;
            let idx = lowerEscaped.indexOf(lowerFilter, start);
            while (idx !== -1) {
                highlighted += escapedText.substring(start, idx);
                highlighted += `<mark class="ws-occ-highlight">${escapedText.substring(idx, idx + filter.length)}</mark>`;
                start = idx + filter.length;
                idx = lowerEscaped.indexOf(lowerFilter, start);
            }
            highlighted += escapedText.substring(start);

            const fileName = item.relPath.split('/').pop();
            const dirPath = item.relPath.includes('/') ? item.relPath.substring(0, item.relPath.lastIndexOf('/')) : '';

            row.innerHTML = `
                <div class="ws-occ-file-info">
                    <span class="ws-occ-filename">${escapeHtml(fileName)}</span>
                    <span class="ws-occ-line">:L${item.line}</span>
                    <span class="ws-occ-dir">${escapeHtml(dirPath)}</span>
                </div>
                <div class="ws-occ-snippet">${highlighted}</div>
            `;

            row.addEventListener('click', (ev) => {
                ev.stopPropagation();
                closeTreeContentFilter();
                if (typeof window.openFileViewer === 'function') {
                    window.openFileViewer(item.path, item.line);
                }
            });

            list.appendChild(row);
        });

        occContainer.appendChild(list);
        occContainer.style.display = 'block';
    }

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
                ? `${contentSearchMatches.length} arquivo(s) com ${contentSearchOccurrences.length} ocorrência(s) — Enter abre todos`
                : 'nenhuma ocorrência encontrada';
        }
    }

    function firstMatchingFile(filter) {
        return treeEntries.find(e => !e.isDir && e.name.toLowerCase().includes(filter));
    }
    async function runContentSearchNow() {
        const filter = currentTreeContentFilter();
        const searchSeq = ++contentSearchSeq;
        if (!filter || filter.length < 4) {
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
        contentSearchOccurrences = Array.isArray(res && res.occurrences) ? res.occurrences : [];
        expandAncestorsForFilter();
        renderTree();
        renderContentOccurrencesPanel();
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
        scrollToFirstTreeMatch();
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

    window.openTreeFilter = openTreeFilter;
    window.openTreeContentFilter = openTreeContentFilter;

    if (wsTreeFilterInput) {
        wsTreeFilterInput.addEventListener('input', () => {
            expandAncestorsForFilter();
            renderTree();
            scrollToFirstTreeMatch();
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
            if (currentTreeContentFilter().length < 4) {
                clearContentSearchState();
                renderTree();
            }
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
