// Embedded Terminal Module
var isTerminalInitialized = false;
var terminalHistory = [];
var terminalHistoryIdx = 0;

(function() {
        function ansiToHtml(text) {
            let html = text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
            
            const colors = {
                // Foreground standard
                30: 'color: #21222c',
                31: 'color: #ff5555', // Red (untracked / unstaged)
                32: 'color: #50fa7b', // Green (staged)
                33: 'color: #f1fa8c', // Yellow
                34: 'color: #bd93f9', // Blue
                35: 'color: #ff79c6', // Magenta
                36: 'color: #8be9fd', // Cyan
                37: 'color: #f8f8f2', // White
                39: 'color: inherit',
                // Foreground bright
                90: 'color: #6272a4', // Gray/Bright Black
                91: 'color: #ff6e6e',
                92: 'color: #69ff94',
                93: 'color: #ffffa5',
                94: 'color: #d6acff',
                95: 'color: #ff92df',
                96: 'color: #a4ffff',
                97: 'color: #ffffff',
                // Background standard
                40: 'background-color: #21222c',
                41: 'background-color: #ff5555',
                42: 'background-color: #50fa7b',
                43: 'background-color: #f1fa8c',
                44: 'background-color: #bd93f9',
                45: 'background-color: #ff79c6',
                46: 'background-color: #8be9fd',
                47: 'background-color: #f8f8f2',
                49: 'background-color: transparent',
                // Background bright
                100: 'background-color: #6272a4',
                101: 'background-color: #ff6e6e',
                102: 'background-color: #69ff94',
                103: 'background-color: #ffffa5',
                104: 'background-color: #d6acff',
                105: 'background-color: #ff92df',
                106: 'background-color: #a4ffff',
                107: 'background-color: #ffffff'
            };

            function get256Color(n) {
                if (n < 8) {
                    const base = ['#000000','#cd0000','#00cd00','#cdcd00','#0000ee','#cd00cd','#00cdcd','#e5e5e5'];
                    return base[n];
                }
                if (n < 16) {
                    const bright = ['#7f7f7f','#ff0000','#00ff00','#ffff00','#5c5cff','#ff00ff','#00ffff','#ffffff'];
                    return bright[n - 8];
                }
                if (n >= 16 && n <= 231) {
                    n -= 16;
                    const r = Math.floor(n / 36);
                    const g = Math.floor((n % 36) / 6);
                    const b = n % 6;
                    const map = [0, 95, 135, 175, 215, 255];
                    return `rgb(${map[r]}, ${map[g]}, ${map[b]})`;
                }
                if (n >= 232 && n <= 255) {
                    const val = (n - 232) * 10 + 8;
                    return `rgb(${val}, ${val}, ${val})`;
                }
                return '#f8f8f2';
            }

            let openSpan = false;

            html = html.replace(/\x1b\[([0-9;]*)m/g, (match, p1) => {
                let style = '';
                const codes = p1.split(';');
                let reset = false;
                
                for (let i = 0; i < codes.length; i++) {
                    const code = codes[i];
                    if (code === '0' || code === '') {
                        reset = true;
                    } else if (code === '1') {
                        style += 'font-weight: bold;';
                    } else if (code === '2') {
                        style += 'opacity: 0.75;';
                    } else if (code === '4') {
                        style += 'text-decoration: underline;';
                    } else if (code === '38' && codes[i+1] === '5' && codes[i+2] !== undefined) {
                        const colorIdx = parseInt(codes[i+2], 10);
                        style += `color: ${get256Color(colorIdx)};`;
                        i += 2;
                    } else if (code === '48' && codes[i+1] === '5' && codes[i+2] !== undefined) {
                        const colorIdx = parseInt(codes[i+2], 10);
                        style += `background-color: ${get256Color(colorIdx)};`;
                        i += 2;
                    } else if (code === '38' && codes[i+1] === '2' && codes[i+4] !== undefined) {
                        style += `color: rgb(${codes[i+2]}, ${codes[i+3]}, ${codes[i+4]});`;
                        i += 4;
                    } else if (code === '48' && codes[i+1] === '2' && codes[i+4] !== undefined) {
                        style += `background-color: rgb(${codes[i+2]}, ${codes[i+3]}, ${codes[i+4]});`;
                        i += 4;
                    } else if (colors[code]) {
                        style += colors[code] + ';';
                    }
                }

                let result = '';
                if (reset && openSpan) {
                    result += '</span>';
                    openSpan = false;
                }
                if (style) {
                    if (openSpan) {
                        result += '</span>';
                    }
                    result += `<span style="${style}">`;
                    openSpan = true;
                }
                return result;
            });

            // Clean up any remaining non-color ANSI escape sequences that pollute the terminal output
            // 1. Remove DCS, OSC, PM, APC sequences (typically terminate with ESC \ or BEL)
            html = html.replace(/\x1b[P\]^_][\s\S]*?(?:\x1b\\|\x07)/g, '');
            // 2. Remove remaining CSI sequences (e.g. bracketed paste [?2004h, alt screen [?1049h)
            html = html.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
            // 3. Remove any other leftover ESC sequences (2-byte)
            html = html.replace(/\x1b./g, '');

            if (openSpan) {
                html += '</span>';
            }
            return html;
        }

 // ansiToHtml & get256Color

        async function initTerminalProcess() {
            if (isTerminalInitialized) return;
            isTerminalInitialized = true;
            
            const termScreen = document.getElementById('terminal-screen');
            if (termScreen) {
                termScreen.innerHTML = '<span style="color: #6272a4;">Iniciando conexão com terminal do sistema...\n</span>';
            }

            try {
                const res = await window.electronAPI.terminalInit();
                if (res && res.ok) {
                    if (termScreen) {
                        termScreen.innerHTML += `<span style="color: #50fa7b;">Terminal conectado (${res.shell}) em ${res.projectPath}\n\n</span>`;
                    }
                } else {
                    if (termScreen) {
                        termScreen.innerHTML += '<span style="color: #ff5555;">Erro ao iniciar terminal.\n</span>';
                    }
                }
            } catch (e) {
                if (termScreen) {
                    termScreen.innerHTML += `<span style="color: #ff5555;">Erro: ${e.message}\n</span>`;
                }
            }
        }

        function setupTerminalUI() {
            const btnChat = document.getElementById('tab-btn-chat');
            const btnTerminal = document.getElementById('tab-btn-terminal');
            const btnSplit = document.getElementById('tab-btn-split');
            const content = document.getElementById('composer-view-content');
            const termScreen = document.getElementById('terminal-screen');
            const termInput = document.getElementById('terminal-input-field');
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
                    }

                    window.addEventListener('mousemove', onMouseMove);
                    window.addEventListener('mouseup', onMouseUp);
                });

                const savedH = localStorage.getItem('helper_terminal_height');
                if (savedH) {
                    termContainer.style.height = savedH;
                }
            }

            function setActiveTab(activeBtn, layoutClass) {
                [btnChat, btnTerminal, btnSplit].forEach(btn => {
                    if (btn) btn.classList.remove('active');
                });
                if (activeBtn) activeBtn.classList.add('active');
                
                if (content) {
                    content.className = 'composer-view-content ' + layoutClass;
                }

                // Manage body classes for full-width layout
                document.body.classList.remove('terminal-active', 'split-active');
                if (layoutClass === 'flex-layout-terminal') {
                    document.body.classList.add('terminal-active');
                    initTerminalProcess();
                    setTimeout(() => termInput && termInput.focus(), 50);
                } else if (layoutClass === 'flex-layout-split') {
                    document.body.classList.add('split-active');
                    initTerminalProcess();
                    setTimeout(() => termInput && termInput.focus(), 50);
                }
            }

            if (btnChat) btnChat.addEventListener('click', () => setActiveTab(btnChat, 'flex-layout-chat'));
            if (btnTerminal) btnTerminal.addEventListener('click', () => setActiveTab(btnTerminal, 'flex-layout-terminal'));
            if (btnSplit) btnSplit.addEventListener('click', () => setActiveTab(btnSplit, 'flex-layout-split'));

            if (termContainer && termInput) {
                termContainer.addEventListener('click', () => {
                    const sel = window.getSelection ? window.getSelection().toString() : '';
                    if (sel && sel.trim()) {
                        return; // Se houver texto selecionado, não altera o foco para não cancelar a seleção
                    }
                    termInput.focus();
                });
            }

            if (termInput) {
                termInput.addEventListener('keydown', (e) => {
                    // === Caracteres de controle (terminal nativo) ===
                    // Encaminha sinais reais ao PTY: Ctrl+C interrompe (SIGINT),
                    // Ctrl+D EOF, Ctrl+Z suspende, Ctrl+\ SIGQUIT. Sem isso, npm/git
                    // e qualquer processo em foreground ficavam travados sem forma de parar.
                    if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
                        const k = e.key.toLowerCase();
                        // Ctrl+C: se há texto selecionado, deixa copiar; senão manda SIGINT.
                        if (k === 'c') {
                            const sel = window.getSelection && window.getSelection().toString();
                            if (sel && sel.trim()) return; // permite copiar seleção
                            e.preventDefault();
                            window.electronAPI.terminalInput('\x03');
                            termInput.value = '';
                            return;
                        }
                        if (k === 'd') { e.preventDefault(); window.electronAPI.terminalInput('\x04'); return; }
                        if (k === 'z') { e.preventDefault(); window.electronAPI.terminalInput('\x1a'); return; }
                        if (k === '\\') { e.preventDefault(); window.electronAPI.terminalInput('\x1c'); return; }
                        if (k === 'u') { e.preventDefault(); termInput.value = ''; window.electronAPI.terminalInput('\x15'); return; }
                    }
                    if (e.key === 'Enter') {
                        const val = termInput.value;
                        if (val.trim() === 'clear') {
                            if (termScreen) {
                                termScreen.innerHTML = '';
                            }
                            window.electronAPI.terminalInput('\n');
                            terminalHistory.push(val);
                            terminalHistoryIdx = terminalHistory.length;
                            termInput.value = '';
                            return;
                        }
                        window.electronAPI.terminalInput(val + '\n');
                        if (val.trim()) {
                            terminalHistory.push(val);
                            terminalHistoryIdx = terminalHistory.length;
                            if (val.trim().startsWith('git ')) {
                                setTimeout(() => {
                                    if (typeof fetchAndUpdateGitStatus === 'function') fetchAndUpdateGitStatus();
                                    if (typeof refreshProjectTree === 'function') refreshProjectTree();
                                }, 350);
                            }
                        }
                        termInput.value = '';
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        if (terminalHistory.length > 0 && terminalHistoryIdx > 0) {
                            terminalHistoryIdx--;
                            termInput.value = terminalHistory[terminalHistoryIdx];
                        }
                    } else if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        if (terminalHistoryIdx < terminalHistory.length - 1) {
                            terminalHistoryIdx++;
                            termInput.value = terminalHistory[terminalHistoryIdx];
                        } else {
                            terminalHistoryIdx = terminalHistory.length;
                            termInput.value = '';
                        }
                    } else if (e.key === 'l' && e.ctrlKey) {
                        e.preventDefault();
                        if (termScreen) {
                            termScreen.innerHTML = '';
                        }
                    }
                });
            }

            if (window.electronAPI.onTerminalOutput) {
                window.electronAPI.onTerminalOutput((payload) => {
                    if (termScreen) {
                        const isAtBottom = termScreen.scrollHeight - termScreen.clientHeight <= termScreen.scrollTop + 20;
                        let chunk = payload.data;
                        
                        if (chunk.includes('\x1b[2J') || chunk.includes('\x1b[H') || chunk.includes('\x0c')) {
                            termScreen.innerHTML = '';
                            chunk = chunk.replace(/\x1b\[2J/g, '')
                                         .replace(/\x1b\[H/g, '')
                                         .replace(/\x0c/g, '')
                                         .replace(/\x1b\[3J/g, '');
                        }
                        
                        if (chunk) {
                            // Normalize newlines (carriage returns \r or \r\n to standard \n) so HTML's white-space: pre-wrap renders them correctly
                            chunk = chunk.replace(/\r+\n/g, '\n').replace(/\r/g, '\n');
                            const span = document.createElement('span');
                            span.innerHTML = ansiToHtml(chunk);
                            termScreen.appendChild(span);
                        }
                        
                        if (isAtBottom) {
                            termScreen.scrollTop = termScreen.scrollHeight;
                        }
                    }
                });
            }

            if (window.electronAPI.onTerminalClosed) {
                window.electronAPI.onTerminalClosed((payload) => {
                    if (termScreen) {
                        const span = document.createElement('span');
                        span.style.color = '#ff5555';
                        span.textContent = `\n[Terminal desconectado com código ${payload.code}]\n`;
                        termScreen.appendChild(span);
                        termScreen.scrollTop = termScreen.scrollHeight;
                    }
                    isTerminalInitialized = false;
                });
            }
        } // initTerminalProcess, setupTerminalUI, control characters, fit resize

    // Expose functions
    window.initTerminalProcess = initTerminalProcess;
    window.setupTerminalUI = setupTerminalUI;
})();
