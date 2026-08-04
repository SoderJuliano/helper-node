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

            // Cada tecla vai crua pro PTY. É o que faltava pro vim do `git pull`:
            // antes o <input> só mandava a linha inteira no Enter, então dentro do
            // editor era chute.
            term.onData((data) => {
                window.electronAPI.terminalInput(data);
                // Depois de um Enter, o painel de git/árvore pode ter mudado.
                if (data.includes('\r')) agendarRefreshGit();
            });

            // Ctrl+C: com seleção, copia; sem seleção, deixa o PTY receber o \x03.
            term.attachCustomKeyEventHandler((e) => {
                if (e.type !== 'keydown') return true;
                if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') {
                    const sel = term.getSelection();
                    if (sel && sel.trim()) {
                        navigator.clipboard.writeText(sel).catch(() => {});
                        term.clearSelection();
                        return false;
                    }
                }
                if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
                    navigator.clipboard.readText()
                        .then((t) => t && window.electronAPI.terminalInput(t))
                        .catch(() => {});
                    return false;
                }
                return true;
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

            function setActiveTab(activeBtn, layoutClass) {
                [btnChat, btnTerminal, btnSplit].forEach((btn) => {
                    if (btn) btn.classList.remove('active');
                });
                if (activeBtn) activeBtn.classList.add('active');

                if (content) content.className = 'composer-view-content ' + layoutClass;

                document.body.classList.remove('terminal-active', 'split-active');
                if (layoutClass === 'flex-layout-terminal' || layoutClass === 'flex-layout-split') {
                    document.body.classList.add(
                        layoutClass === 'flex-layout-terminal' ? 'terminal-active' : 'split-active'
                    );
                    initTerminalProcess();
                    // O painel acabou de ficar visível: só agora dá pra medir.
                    setTimeout(() => { sincronizarTamanho(); if (term) term.focus(); }, 50);
                }
            }

            if (btnChat) btnChat.addEventListener('click', () => setActiveTab(btnChat, 'flex-layout-chat'));
            if (btnTerminal) btnTerminal.addEventListener('click', () => setActiveTab(btnTerminal, 'flex-layout-terminal'));
            if (btnSplit) btnSplit.addEventListener('click', () => setActiveTab(btnSplit, 'flex-layout-split'));

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
