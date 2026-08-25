// Terminal embutido — xterm.js sobre o PTY do processo main.
//
// POR QUE ESTE ARQUIVO FOI REESCRITO
// ----------------------------------
// A versão anterior tinha um emulador VT100 escrito à mão (~370 linhas) que
// mantinha dois buffers por linha: `plainLines` (texto puro) e `ansiLines`
// (texto + escapes). O cursor (`curCol`) é uma coluna VISÍVEL, mas era usado
// pra fatiar os DOIS buffers — e `ansiLines` contém os bytes de escape, que não
// ocupam coluna nenhuma. Na prática:
//
//   ansi = "\x1b[32m"      (5 bytes, 0 colunas)  curCol = 0
//   escreve 'M'  ->  ansi.slice(0,0) + 'M' + ansi.slice(1)  =  "M[32m"
//
// O escape do git era PICADO e depois sobrescrito pelas letras seguintes. Daí
// os sintomas todos de uma vez: saída sem cor nenhuma (o SGR nunca chegava
// inteiro na tela), lixo de escape aparecendo quando o cursor estava em outra
// coluna, e a tela embaralhando progressivamente a cada comando colorido —
// `git status`, `git log`, `git diff`.
//
// Nada disso se conserta com mais casos especiais: um terminal precisa de um
// emulador de verdade. Este usa xterm.js, o mesmo do VS Code, que traz junto o
// que faltava e não dava pra remendar:
//   - alternate screen (\x1b[?1049h) → o vim do `git pull` fica VISÍVEL;
//   - teclas indo direto pro PTY → dá pra usar o vim, Tab, setas, Ctrl+C;
//   - resize real → sem mais corte na direita (ver terminal:resize).

var isTerminalInitialized = false;

(function() {
        var term = null;
        var fitAddon = null;
        var resizeObserver = null;

        // Tema alinhado ao Dracula que o resto do app já usa.
        const TEMA = {
            background: '#090a0f', foreground: '#d8dee9', cursor: '#50fa7b',
            selectionBackground: 'rgba(98,114,164,0.45)',
            black: '#21222c',   red: '#ff5555',     green: '#50fa7b',  yellow: '#f1fa8c',
            blue: '#bd93f9',    magenta: '#ff79c6', cyan: '#8be9fd',   white: '#f8f8f2',
            brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94',
            brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df',
            brightCyan: '#a4ffff',   brightWhite: '#ffffff',
        };

        function fonteMono() {
            const v = getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
            return (v && v.trim()) || 'JetBrains Mono, Consolas, monospace';
        }

        /** Manda o tamanho REAL pro PTY. Sem isto o shell quebra as linhas na
         *  largura errada e o texto some na borda direita. */
        function sincronizarTamanho() {
            if (!term || !fitAddon) return;
            let dims;
            try { dims = fitAddon.proposeDimensions(); } catch (_) { return; }
            if (!dims || !dims.cols || !dims.rows) return;          // painel escondido
            if (!isFinite(dims.cols) || !isFinite(dims.rows)) return;
            try { fitAddon.fit(); } catch (_) { return; }
            if (window.electronAPI.terminalResize) {
                window.electronAPI.terminalResize({ cols: term.cols, rows: term.rows });
            }
        }
        window._termFit = sincronizarTamanho;

        function criarTerminal(host) {
            if (term) return term;
            if (typeof Terminal === 'undefined') {
                host.textContent = 'Falha ao carregar o xterm.js (node_modules/@xterm/xterm).';
                return null;
            }
            term = new Terminal({
                theme: TEMA,
                fontFamily: fonteMono(),
                fontSize: 13,
                lineHeight: 1.2,
                cursorBlink: true,
                // Histórico de rolagem. O emulador antigo guardava a tela inteira
                // em DOM, o que ficava pesado; aqui é buffer do xterm.
                scrollback: 5000,
                allowProposedApi: true,
                // Ctrl+C com texto selecionado copia (comportamento de terminal
                // de IDE); sem seleção, o handler abaixo manda SIGINT.
                macOptionIsMeta: true,
            });

            const FitCtor = (window.FitAddon && window.FitAddon.FitAddon) || window.FitAddon;
            if (FitCtor) { fitAddon = new FitCtor(); term.loadAddon(fitAddon); }

            term.open(host);
            // Exposto para scripts/test-terminal.js, que dirige o app por CDP e
            // lê o buffer real pra conferir cor e largura. Um terminal só dá pra
            // testar de verdade olhando o que foi pra tela.
            window._term = term;

            // Trava de deduplicação para colar texto (evita envio duplo se o evento
            // de teclado e o evento de paste do DOM dispararem em paralelo)
            let lastPasteText = '';
            let lastPasteTime = 0;

            function enviarTextoParaTerminal(texto) {
                if (!texto) return;
                const now = Date.now();
                if (texto === lastPasteText && (now - lastPasteTime) < 150) {
                    return;
                }
                lastPasteText = texto;
                lastPasteTime = now;

                if (term && typeof term.paste === 'function') {
                    term.paste(texto);
                } else if (window.electronAPI && typeof window.electronAPI.terminalInput === 'function') {
                    window.electronAPI.terminalInput(texto);
                }
            }

            // Função utilitária para ler o clipboard e colar no terminal (usada por clique direito e scripts)
            async function colarTextoNoTerminal() {
                let texto = '';
                if (window.electronAPI && typeof window.electronAPI.readClipboardText === 'function') {
                    try {
                        texto = await window.electronAPI.readClipboardText();
                    } catch (_) {}
                }

                if (!texto && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                    try {
                        texto = await navigator.clipboard.readText();
                    } catch (_) {}
                }

                if (texto) {
                    enviarTextoParaTerminal(texto);
                }
            }
            window._colarTextoNoTerminal = colarTextoNoTerminal;

            // Captura eventos nativos de paste do xterm (Ctrl+V, Shift+Insert, menu de contexto do SO)
            if (term.onPaste) {
                term.onPaste((data) => {
                    if (data) {
                        enviarTextoParaTerminal(data);
                    }
                });
            }

            // Cada tecla vai crua pro PTY. É o que faltava pro vim do `git pull`:
            // antes o <input> só mandava a linha inteira no Enter, então dentro do
            // editor era chute.
            term.onData((data) => {
                window.electronAPI.terminalInput(data);
                // Depois de um Enter, o painel de git/árvore pode ter mudado.
                if (data.includes('\r')) agendarRefreshGit();
            });

            // Interceptador de teclas customizado:
            // - Ctrl+V: cola do clipboard (evita envio de ^V cru no Windows)
            // - Ctrl+C: com seleção copia pro clipboard; sem seleção manda SIGINT (\x03) pro PTY
            term.attachCustomKeyEventHandler((e) => {
                if (e.type !== 'keydown') return true;
                const k = e.key ? e.key.toLowerCase() : '';

                // Ctrl+V / Cmd+V
                if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'v') {
                    e.preventDefault();
                    colarTextoNoTerminal();
                    return false;
                }

                // Ctrl+C / Cmd+C com texto selecionado
                if ((e.ctrlKey || e.metaKey) && !e.altKey && k === 'c') {
                    const sel = term.getSelection();
                    if (sel && sel.trim()) {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(sel).catch(() => {});
                        } else if (window.electronAPI && window.electronAPI.copyToClipboard) {
                            window.electronAPI.copyToClipboard(sel);
                        }
                        if (typeof window.showToast === 'function') window.showToast('Texto copiado do terminal!');
                        term.clearSelection();
                        return false;
                    }
                }

                return true;
            });

            // Menu de Contexto (botão direito no terminal)
            function showTerminalContextMenu(e) {
                e.preventDefault();
                e.stopPropagation();

                document.querySelectorAll('.term-context-menu').forEach(m => m.remove());

                const sel = (term && term.getSelection()) ? term.getSelection() : '';
                const hasSelection = Boolean(sel && sel.trim());

                const menu = document.createElement('div');
                menu.className = 'term-context-menu';
                menu.style.cssText = `
                    position: fixed;
                    left: ${Math.min(e.clientX, window.innerWidth - 200)}px;
                    top: ${Math.min(e.clientY, window.innerHeight - 170)}px;
                    z-index: 100000;
                    background: var(--bg-elevated, #1b1e24);
                    border: 1px solid var(--border, #2d2d38);
                    border-radius: var(--radius-sm, 6px);
                    padding: 4px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
                    min-width: 180px;
                    font-family: var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
                    font-size: 12px;
                    color: var(--text, #e3e3e6);
                    -webkit-app-region: no-drag;
                    user-select: none;
                `;

                const SVGI_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
                const SVGI_PASTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>';
                const SVGI_PATH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
                const SVGI_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

                const mkItem = (iconHtml, label, shortcut, enabled, fn) => {
                    const b = document.createElement('button');
                    b.innerHTML = `
                        <span style="display:flex; align-items:center; gap:8px;">
                            <span style="opacity:0.8; display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px;">${iconHtml}</span>
                            <span>${label}</span>
                        </span>
                        ${shortcut ? `<span style="font-size:10.5px; opacity:0.5; margin-left:14px;">${shortcut}</span>` : ''}
                    `;
                    b.style.cssText = `
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        width: 100%;
                        text-align: left;
                        background: transparent;
                        border: none;
                        color: ${enabled ? 'inherit' : 'rgba(255,255,255,0.3)'};
                        font-size: inherit;
                        font-family: inherit;
                        padding: 6px 10px;
                        cursor: ${enabled ? 'pointer' : 'default'};
                        border-radius: 4px;
                        transition: background .12s;
                    `;
                    if (enabled) {
                        b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.08)');
                        b.addEventListener('mouseleave', () => b.style.background = 'transparent');
                        b.addEventListener('click', (ev) => {
                            ev.stopPropagation();
                            menu.remove();
                            fn();
                        });
                    }
                    return b;
                };

                const mkSep = () => {
                    const sep = document.createElement('div');
                    sep.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                    return sep;
                };

                // 1. Copiar Seleção
                menu.appendChild(mkItem(SVGI_COPY, 'Copiar', 'Ctrl+C', hasSelection, () => {
                    if (hasSelection) {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(sel).catch(() => {});
                        } else if (window.electronAPI && window.electronAPI.copyToClipboard) {
                            window.electronAPI.copyToClipboard(sel);
                        }
                        if (typeof window.showToast === 'function') window.showToast('Copiado para a área de transferência!');
                        if (term) term.clearSelection();
                    }
                }));

                // 2. Colar no Terminal
                menu.appendChild(mkItem(SVGI_PASTE, 'Colar', 'Ctrl+V', true, () => {
                    colarTextoNoTerminal();
                    if (term) term.focus();
                }));

                menu.appendChild(mkSep());

                // 3. Copiar Caminho do Projeto
                const wsProjectMain = document.getElementById('ws-project-main');
                const projectPath = (wsProjectMain && wsProjectMain.dataset.path) || '';
                if (projectPath) {
                    menu.appendChild(mkItem(SVGI_PATH, 'Copiar Caminho do Projeto', '', true, () => {
                        if (navigator.clipboard && navigator.clipboard.writeText) {
                            navigator.clipboard.writeText(projectPath).catch(() => {});
                        } else if (window.electronAPI && window.electronAPI.copyToClipboard) {
                            window.electronAPI.copyToClipboard(projectPath);
                        }
                        if (typeof window.showToast === 'function') window.showToast('Caminho do projeto copiado!');
                    }));
                }

                // 4. Limpar Terminal
                menu.appendChild(mkItem(SVGI_CLEAR, 'Limpar Terminal', '', true, () => {
                    if (term) {
                        term.clear();
                        term.focus();
                    }
                }));

                document.body.appendChild(menu);

                const removeMenu = (ev) => {
                    if (!menu.contains(ev.target)) {
                        menu.remove();
                        document.removeEventListener('click', removeMenu);
                        document.removeEventListener('contextmenu', removeMenu);
                    }
                };
                setTimeout(() => {
                    document.addEventListener('click', removeMenu);
                    document.addEventListener('contextmenu', removeMenu);
                }, 10);
            }

            // Clique com botão direito no terminal abre o menu de contexto
            host.addEventListener('contextmenu', (e) => {
                showTerminalContextMenu(e);
            });

            return term;
        }

        // `git add`/`commit`/`checkout` mexem no que a árvore e o badge de branch
        // mostram. Antes isso era disparado ao ler o texto do <input>; agora o
        // gatilho é o Enter, e um debounce evita rodar a cada tecla de um vim.
        let refreshTimer = null;
        function agendarRefreshGit() {
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                if (typeof fetchAndUpdateGitStatus === 'function') fetchAndUpdateGitStatus();
                if (typeof refreshProjectTree === 'function') refreshProjectTree();
                if (typeof window.refreshProjectContext === 'function') window.refreshProjectContext();
            }, 400);
        }

        async function initTerminalProcess() {
            if (isTerminalInitialized) { sincronizarTamanho(); return; }
            isTerminalInitialized = true;

            const host = document.getElementById('terminal-screen');
            if (!host) { isTerminalInitialized = false; return; }
            if (!criarTerminal(host)) { isTerminalInitialized = false; return; }

            // Mede ANTES de subir o PTY pra ele já nascer com o tamanho certo —
            // senão o primeiro prompt já vem quebrado na largura errada.
            try { fitAddon && fitAddon.fit(); } catch (_) {}

            term.writeln('\x1b[38;5;61mIniciando conexão com terminal do sistema...\x1b[0m');
            try {
                const res = await window.electronAPI.terminalInit({ cols: term.cols, rows: term.rows });
                if (res && res.ok) {
                    term.writeln(`\x1b[32mTerminal conectado (${res.shell}) em ${res.projectPath}\x1b[0m`);
                    sincronizarTamanho();
                } else {
                    term.writeln(`\x1b[31mErro ao iniciar terminal: ${(res && res.error) || 'desconhecido'}\x1b[0m`);
                    isTerminalInitialized = false;
                }
            } catch (e) {
                term.writeln(`\x1b[31mErro: ${e.message}\x1b[0m`);
                isTerminalInitialized = false;
            }
        }

        function setupTerminalUI() {
            const btnChat = document.getElementById('tab-btn-chat');
            const btnTerminal = document.getElementById('tab-btn-terminal');
            const btnSplit = document.getElementById('tab-btn-split');
            const content = document.getElementById('composer-view-content');
            const termContainer = document.getElementById('terminal-container-element');
            const resizer = document.getElementById('terminal-resizer');

            if (resizer && termContainer) {
                let startY = 0;
                let startH = 0;
                resizer.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    startY = e.clientY;
                    startH = termContainer.offsetHeight;
                    resizer.classList.add('resizing');
                    document.body.style.cursor = 'ns-resize';
                    document.body.style.userSelect = 'none';

                    function onMouseMove(me) {
                        const dy = startY - me.clientY;
                        const newH = Math.max(120, Math.min(window.innerHeight - 150, startH + dy));
                        termContainer.style.height = `${newH}px`;
                    }

                    function onMouseUp() {
                        resizer.classList.remove('resizing');
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        window.removeEventListener('mousemove', onMouseMove);
                        window.removeEventListener('mouseup', onMouseUp);
                        localStorage.setItem('helper_terminal_height', termContainer.style.height);
                        sincronizarTamanho();
                    }

                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                });

                const savedH = localStorage.getItem('helper_terminal_height');
                if (savedH) termContainer.style.height = savedH;
            }

            // Qualquer coisa que mude a caixa (trocar de aba, split, redimensionar
            // a janela) muda cols/rows — e cols/rows errado é o corte na direita.
            if (termContainer && typeof ResizeObserver !== 'undefined') {
                resizeObserver = new ResizeObserver(() => sincronizarTamanho());
                resizeObserver.observe(termContainer);
            }
            window.addEventListener('resize', sincronizarTamanho);

            const btnAppRunner = document.getElementById('tab-btn-app-runner');

            function setActiveTab(activeBtn, layoutClass) {
                [btnChat, btnTerminal, btnSplit, btnAppRunner].forEach((btn) => {
                    if (btn) btn.classList.remove('active');
                });
                if (activeBtn) activeBtn.classList.add('active');

                if (content) content.className = 'composer-view-content ' + layoutClass;

                document.body.classList.remove('terminal-active', 'split-active', 'app-runner-active');
                if (layoutClass === 'flex-layout-terminal' || layoutClass === 'flex-layout-split') {
                    document.body.classList.add(
                        layoutClass === 'flex-layout-terminal' ? 'terminal-active' : 'split-active'
                    );
                    initTerminalProcess();
                    // O painel acabou de ficar visível: só agora dá pra medir.
                    setTimeout(() => { sincronizarTamanho(); if (term) term.focus(); }, 50);
                } else if (layoutClass === 'flex-layout-app-runner') {
                    document.body.classList.add('app-runner-active');
                }
            }

            if (btnChat) btnChat.addEventListener('click', () => setActiveTab(btnChat, 'flex-layout-chat'));
            if (btnTerminal) btnTerminal.addEventListener('click', () => setActiveTab(btnTerminal, 'flex-layout-terminal'));
            if (btnSplit) btnSplit.addEventListener('click', () => setActiveTab(btnSplit, 'flex-layout-split'));
            if (btnAppRunner) btnAppRunner.addEventListener('click', () => setActiveTab(btnAppRunner, 'flex-layout-app-runner'));

            window.activateComposerTab = function(tabName) {
                if (tabName === 'chat' && btnChat) setActiveTab(btnChat, 'flex-layout-chat');
                else if (tabName === 'terminal' && btnTerminal) setActiveTab(btnTerminal, 'flex-layout-terminal');
                else if (tabName === 'split' && btnSplit) setActiveTab(btnSplit, 'flex-layout-split');
                else if ((tabName === 'app-runner' || tabName === 'run') && btnAppRunner) setActiveTab(btnAppRunner, 'flex-layout-app-runner');
            };

            if (window.electronAPI.onTerminalOutput) {
                window.electronAPI.onTerminalOutput((payload) => {
                    if (term && payload && payload.data) term.write(payload.data);
                });
            }

            if (window.electronAPI.onTerminalClosed) {
                window.electronAPI.onTerminalClosed((payload) => {
                    if (term) term.writeln(`\r\n\x1b[31m[Terminal desconectado com código ${payload.code}]\x1b[0m`);
                    isTerminalInitialized = false;
                });
            }
        }

    window.initTerminalProcess = initTerminalProcess;
    window.setupTerminalUI = setupTerminalUI;
})();
