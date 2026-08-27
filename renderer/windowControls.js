// Window Controls & Sidebar Layout Module
(async function() {
    // Custom Window Controls (Windows/macOS)
    const minBtn = document.getElementById('main-win-min-btn');
    const maxBtn = document.getElementById('main-win-max-btn');
    const closeBtn = document.getElementById('main-win-close-btn');
    const controlsOverlay = document.getElementById('win-controls-overlay');

    if (window.electronAPI) {
        if (window.electronAPI.platform === 'linux') {
            if (controlsOverlay) controlsOverlay.style.display = 'none';
        } else {
            const attach = (btn, fn) => {
                if (!btn) return;
                const handler = (e) => {
                    if (e) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                    try {
                        if (typeof fn === 'function') fn();
                    } catch (err) {
                        console.warn('[windowControls] Erro ao executar acao de janela:', err);
                    }
                };
                btn.addEventListener('click', handler);
                btn.addEventListener('mousedown', (e) => {
                    if (e) e.stopPropagation();
                });
            };
            attach(minBtn, () => window.electronAPI.minimizeWindow && window.electronAPI.minimizeWindow());
            attach(maxBtn, () => window.electronAPI.maximizeWindow && window.electronAPI.maximizeWindow());
            attach(closeBtn, () => window.electronAPI.closeWindow && window.electronAPI.closeWindow());
        }
    }

    // Sidebar Collapsing
    window.isSidebarCollapsed = function() {
        return document.body.classList.contains('sidebar-collapsed');
    };

    window.setSidebarCollapsed = function(collapsed) {
        document.body.classList.toggle('sidebar-collapsed', collapsed);
        const shell = document.getElementById('app-shell');
        if (shell) shell.classList.toggle('sidebar-collapsed', collapsed);
        try { localStorage.setItem('sidebar-collapsed', collapsed ? 'true' : 'false'); } catch(_) {}
    };

        function isSidebarCollapsed() { return document.body.classList.contains('sidebar-collapsed'); }
        function setSidebarCollapsed(collapsed) {
            document.body.classList.toggle('sidebar-collapsed', collapsed);
            try { localStorage.setItem('hn-sidebar-collapsed', collapsed ? '1' : '0'); } catch (_) {}
        }
        (function initSidebarCollapse() {
            const shell = document.getElementById('app-shell');
            // Restaura o estado salvo SEM animar (evita "piscar" ao carregar a janela).
            if (shell) shell.classList.add('no-anim');
            let saved = false;
            try { saved = localStorage.getItem('hn-sidebar-collapsed') === '1'; } catch (_) {}
            if (saved) setSidebarCollapsed(true);
            requestAnimationFrame(() => { if (shell) shell.classList.remove('no-anim'); });

            const collapseBtn = document.getElementById('sidebar-collapse-btn');
            if (collapseBtn) collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); setSidebarCollapsed(true); });
            const expandBtn = document.getElementById('sidebar-expand-btn');
            if (expandBtn) expandBtn.addEventListener('click', (e) => { e.stopPropagation(); setSidebarCollapsed(false); });
        })();

        // === AI Chat Collapsing (espelhado da Sidebar) ===
        window.isChatCollapsed = function() {
            const mainEl = document.getElementById('main');
            return mainEl ? mainEl.classList.contains('chat-hidden') : false;
        };

        window.setChatCollapsed = function(collapsed) {
            document.body.classList.toggle('chat-hidden', collapsed);
            if (window.EditorController && typeof window.EditorController.toggleChatVisibility === 'function') {
                window.EditorController.toggleChatVisibility(!collapsed);
            } else {
                const mainEl = document.getElementById('main');
                if (mainEl) mainEl.classList.toggle('chat-hidden', collapsed);
            }
        };

        (function initChatCollapse() {
            const collapseBtn = document.getElementById('chat-collapse-btn');
            if (collapseBtn) collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); window.setChatCollapsed(true); });
            const expandBtn = document.getElementById('chat-expand-btn');
            if (expandBtn) expandBtn.addEventListener('click', (e) => { e.stopPropagation(); window.setChatCollapsed(false); });
        })();

        // === Sidebar redimensionável (arraste a borda direita) — largura
        // persiste entre sessões via localStorage, independente do estado de
        // recolhido/expandido (que continua controlado por setSidebarCollapsed). ===
        (function initSidebarResize() {
            const shell = document.getElementById('app-shell');
            const resizer = document.getElementById('sidebar-resizer');
            if (!shell || !resizer) return;
            const MIN_W = 200, MAX_W = 480;

            let saved = null;
            try { saved = parseInt(localStorage.getItem('hn-sidebar-w'), 10); } catch (_) {}
            if (saved && saved >= MIN_W && saved <= MAX_W) {
                shell.style.setProperty('--sidebar-w', saved + 'px');
            }

            let dragging = false, startX = 0, startW = 0;

            function onMove(e) {
                if (!dragging) return;
                const w = Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - startX)));
                shell.style.setProperty('--sidebar-w', w + 'px');
            }
            function onUp() {
                if (!dragging) return;
                dragging = false;
                shell.classList.remove('resizing');
                resizer.classList.remove('dragging');
                document.body.classList.remove('resizing-sidebar');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                const w = parseInt(getComputedStyle(shell).gridTemplateColumns, 10);
                if (w) { try { localStorage.setItem('hn-sidebar-w', String(w)); } catch (_) {} }
            }
            resizer.addEventListener('mousedown', (e) => {
                if (isSidebarCollapsed()) return;
                e.preventDefault(); e.stopPropagation();
                dragging = true;
                startX = e.clientX;
                startW = parseInt(getComputedStyle(shell).gridTemplateColumns, 10) || 268;
                shell.classList.add('resizing');
                resizer.classList.add('dragging');
                document.body.classList.add('resizing-sidebar');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        })();

        // === Redimensionamento do painel de arquivos abertos (editor vs chat/terminal) ===
        (function initEditorResize() {
            const main = document.getElementById('main');
            const fv = document.getElementById('file-viewer');
            const resizer = document.getElementById('editor-resizer');
            if (!main || !fv || !resizer) return;

            let saved = null;
            try { saved = localStorage.getItem('hn-editor-w'); } catch (_) {}
            if (saved && /^\d+(\.\d+)?%$/.test(saved)) {
                const num = parseFloat(saved);
                if (num >= 15 && num <= 85) {
                    main.style.setProperty('--editor-w', saved);
                }
            }

            let dragging = false, startX = 0, startW = 0, mainW = 0;

            function onMove(e) {
                if (!dragging) return;
                const newW = startW + (e.clientX - startX);
                const minW = Math.max(160, mainW * 0.15);
                const maxW = Math.min(mainW - 160, mainW * 0.85);
                const clampedW = Math.min(maxW, Math.max(minW, newW));
                const pct = (clampedW / mainW) * 100;
                main.style.setProperty('--editor-w', pct.toFixed(2) + '%');

                const cm = window.EditorController && window.EditorController.getCm ? window.EditorController.getCm() : null;
                if (cm) cm.refresh();
                if (window._termFit) window._termFit();
            }

            function onUp() {
                if (!dragging) return;
                dragging = false;
                main.classList.remove('resizing-editor');
                resizer.classList.remove('dragging');
                document.body.classList.remove('resizing-editor');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                const currentPct = main.style.getPropertyValue('--editor-w');
                if (currentPct) {
                    try { localStorage.setItem('hn-editor-w', currentPct); } catch (_) {}
                }
                const cm = window.EditorController && window.EditorController.getCm ? window.EditorController.getCm() : null;
                if (cm) cm.refresh();
                if (window._termFit) window._termFit();
            }

            resizer.addEventListener('mousedown', (e) => {
                if (!fv.classList.contains('open') || main.classList.contains('chat-hidden')) return;
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                startX = e.clientX;
                startW = fv.getBoundingClientRect().width;
                mainW = main.getBoundingClientRect().width || (window.innerWidth - 268);
                main.classList.add('resizing-editor');
                resizer.classList.add('dragging');
                document.body.classList.add('resizing-editor');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });

            resizer.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                main.style.setProperty('--editor-w', '55%');
                try { localStorage.setItem('hn-editor-w', '55%'); } catch (_) {}
                const cm = window.EditorController && window.EditorController.getCm ? window.EditorController.getCm() : null;
                if (cm) cm.refresh();
                if (window._termFit) window._termFit();
            });
        })();

        // Ctrl+F / Ctrl+Shift+F / Ctrl+B global — capture-phase no document
        document.addEventListener('keydown', (e) => {
            // Ctrl+B: alterna a sidebar — funciona igual no chat e no editor.
            if (e.key.toLowerCase() === 'b' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                e.preventDefault(); e.stopPropagation();
                setSidebarCollapsed(!isSidebarCollapsed());
                return;
            }
            if (e.key.toLowerCase() !== 'f' || !(e.ctrlKey || e.metaKey) || e.altKey) return;

            // Shift+F = Ctrl+Shift+F: Busca por conteúdo em todos os arquivos do projeto.
            if (e.shiftKey) {
                e.preventDefault(); e.stopPropagation();
                if (isSidebarCollapsed()) setSidebarCollapsed(false);
                if (window.openTreeContentFilter) window.openTreeContentFilter();
                return;
            }

            // Ctrl+F (sem Shift):
            // Se o editor estiver aberto com um arquivo: busca dentro do arquivo (CodeMirror).
            // Se nenhum arquivo estiver aberto: busca na árvore de arquivos por nome.
            const fv = document.getElementById('file-viewer');
            const isEditorOpen = !!(fv && fv.classList.contains('open') && window.EditorController && window.EditorController.hasOpenFile());

            if (isEditorOpen) {
                if (window.EditorController && window.EditorController.hasFocus()) {
                    return; // Deixa o CodeMirror tratar o evento se o foco já estiver dentro dele
                }
                e.preventDefault(); e.stopPropagation();
                if (window.EditorController) window.EditorController.focusSearch();
                return;
            }

            e.preventDefault(); e.stopPropagation();
            if (isSidebarCollapsed()) setSidebarCollapsed(false);
            if (window.openTreeFilter) window.openTreeFilter();
        }, true);

        function removeManualInputContainer() {
            const existing = document.querySelector('.manual-input-container');
            if (existing) existing.remove();
            undockComposer();
        }

    // Panels Toggle Button
            // === Botão ⌬ — esconde/mostra painéis ===
            const commandsDiv = document.querySelector('.commands');
            const panelsToggleBtn = document.getElementById('panels-toggle-btn');
            const SVG_OPEN  = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.636 12.5a.5.5 0 0 1-.5.5H1.5A1.5 1.5 0 0 1 0 11.5v-10A1.5 1.5 0 0 1 1.5 0h10A1.5 1.5 0 0 1 13 1.5v6.636a.5.5 0 0 1-1 0V1.5a.5.5 0 0 0-.5-.5h-10a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h6.636a.5.5 0 0 1 .5.5"/><path fill-rule="evenodd" d="M16 15.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1 0-1h3.793L6.146 6.854a.5.5 0 1 1 .708-.708L15 14.293V10.5a.5.5 0 0 1 1 0z"/></svg>`;
            const SVG_CLOSE = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M7.364 3.5a.5.5 0 0 1 .5-.5H14.5A1.5 1.5 0 0 1 16 4.5v10a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 3 14.5V7.864a.5.5 0 1 1 1 0V14.5a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-10a.5.5 0 0 0-.5-.5H7.864a.5.5 0 0 1-.5-.5"/><path fill-rule="evenodd" d="M0 .5A.5.5 0 0 1 .5 0h5a.5.5 0 0 1 0 1H1.707l8.147 8.146a.5.5 0 0 1-.708.708L1 1.707V5.5a.5.5 0 0 1-1 0z"/></svg>`;
            if (panelsToggleBtn && commandsDiv) {
                panelsToggleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isOpen = commandsDiv.classList.contains('open');
                    commandsDiv.classList.toggle('open', !isOpen);
                    panelsToggleBtn.innerHTML = isOpen ? SVG_OPEN : SVG_CLOSE;
                    panelsToggleBtn.style.color = isOpen ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.75)';
                });
            }

    // Config Open Button & Edition Tag
            // Botão ⚙ Configurações (sidebar)
            const configOpenBtn = document.getElementById('config-open-btn');
            if (configOpenBtn && window.electronAPI && window.electronAPI.openConfig) {
                configOpenBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    window.electronAPI.openConfig();
                });
            }

            // Tag de edição na sidebar (full/lite)
            const editionTag = document.getElementById('app-edition-tag');
            if (editionTag && window.electronAPI && window.electronAPI.getEdition) {
                try { editionTag.textContent = await window.electronAPI.getEdition(); } catch(_) {}
            }

    // Usada por chatInput/chatMessages/chatHistory (IIFEs separadas).
    window.removeManualInputContainer = removeManualInputContainer;
})();
