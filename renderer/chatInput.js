// Chat Input / Composer Module
var manualInputActive = false;
var pastedImageForManualInput = null;
// Histórico de prompts enviados (navegação com ArrowUp/ArrowDown, estilo CLI).
// Fora da IIFE de propósito: escopo de script = global, como o resto do renderer.
var promptHistory = [];
var promptHistoryIndex = -1;
var promptHistoryDraft = '';

(function() {
    const welcomeHero = document.getElementById('welcome-hero');
    const composerGhost = document.getElementById('composer-ghost');
    const composerShell = document.getElementById('composer-shell');
    const composerSendBtn = document.getElementById('composer-send');

    // Suggestions chips & composer handlers
            // Hero de boas-vindas: sugestões clicáveis preenchem o composer
            document.querySelectorAll('.hero-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const prompt = chip.dataset.prompt || '';
                    openManualInput(prompt);
                    if (welcomeHero) welcomeHero.classList.add('hidden');
                });
            });

            // Composer ghost: clicar no placeholder abre o input real
            if (composerGhost && composerShell) {
                composerShell.addEventListener('click', (e) => {
                    if (e.target.closest('.composer-send')) return;
                    if (manualInputActive || isEditingQuestion) return;
                    openManualInput();
                });
            }

            // Composer send button: atalho visual — aciona submit se houver input ativo
            if (composerSendBtn) {
                composerSendBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (!manualInputActive) { openManualInput(); return; }
                    const input = document.querySelector('.manual-input-container .terminal-input');
                    if (input) {
                        const question = (input.value || '').trim();
                        const container = input.closest('.manual-input-container');
                        if ((question || pastedImageForManualInput) && container) {
                            submitManualQuestion(question, container);
                        }
                    }
                });
            }

            // Foco inicial suave na área de escrita visível
            if (composerGhost) {
                composerGhost.setAttribute('tabindex', '0');
                setTimeout(() => {
                    try {
                        composerGhost.focus({ preventScroll: true });
                    } catch (_) {
                        composerGhost.focus();
                    }
                }, 120);
            }

    // Keydown for Ctrl+I to show/hide composer or focus it
    window.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
            e.preventDefault();
            const toggle = document.getElementById('composer-collapse-toggle');
            if (toggle) toggle.click();
        }
    });


    // Token counter
            // ── Token counter ─────────────────────────────────────────────────────
            // Estima tokens do input atual (~4 chars por token) e exibe na toolbar.
            (function initTokenCounter() {
                const tokenLabel = document.getElementById('composer-token-count');
                const ghost = document.getElementById('composer-ghost');
                if (!tokenLabel || !ghost) return;

                function estimateTokens(text) {
                    if (!text) return 0;
                    // ~4 chars per token (rough GPT/Claude estimate)
                    return Math.ceil(text.length / 4);
                }

                function formatCount(n) {
                    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
                    return String(n);
                }

                function updateTokenLabel(text) {
                    const t = estimateTokens(text);
                    if (t === 0) {
                        tokenLabel.textContent = '';
                        tokenLabel.className = 'composer-token-count';
                        return;
                    }
                    tokenLabel.textContent = formatCount(t) + ' tok';
                    tokenLabel.className = 'composer-token-count' +
                        (t > 4000 ? ' danger' : t > 2000 ? ' warn' : '');
                }

                // MutationObserver watches for text changes in the contenteditable ghost
                const obs = new MutationObserver(() => {
                    updateTokenLabel(ghost.innerText || '');
                });
                obs.observe(ghost, { childList: true, subtree: true, characterData: true });

                // Also listen to direct input events
                ghost.addEventListener('input', () => updateTokenLabel(ghost.innerText || ''));

                // Clear on send
                const sendBtn = document.getElementById('composer-send');
                if (sendBtn) {
                    sendBtn.addEventListener('click', () => {
                        tokenLabel.textContent = '';
                        tokenLabel.className = 'composer-token-count';
                    });
                }
            })();

            // Workspace empty note: mostra quando workspace desativado
            const wsEmptyNote = document.getElementById('ws-empty-note');
            const wsPanelTop = document.getElementById('workspace-panel');
            if (wsEmptyNote && wsPanelTop) {
                // O painel é escondido APENAS com display:'none'. Quando ativo, o
                // refreshWorkspacePanel usa display:'' (volta ao padrão = visível).
                // O bug antigo tratava '' como "escondido" e mostrava o aviso
                // "Anexos desativados" mesmo com projetos anexados.
                const syncWsNote = () => {
                    const hidden = wsPanelTop.style.display === 'none';
                    wsEmptyNote.style.display = hidden ? '' : 'none';
                };
                new MutationObserver(syncWsNote)
                    .observe(wsPanelTop, { attributes: true, attributeFilter: ['style'] });
                syncWsNote();
            }

    // Composer Presentation / submission
        // === Composer fixo (apresentação) ===
        // Ancora o container de input real no composer shell visual, mantendo
        // toda a lógica intacta. "Dock" é puramente reposicionamento DOM —
        // nenhum fluxo de dados, validação ou submissão é alterado.
        function dockComposer(container) {
            const shell = document.getElementById('composer-shell');
            const ghost = document.getElementById('composer-ghost');
            const sendBtn = document.getElementById('composer-send');
            if (!shell) { transcriptionElement.appendChild(container); return; } // fallback
            // Insere o input ANTES do botão enviar (ghost escondido)
            if (ghost) ghost.style.display = 'none';
            if (sendBtn) shell.insertBefore(container, sendBtn);
            else shell.appendChild(container);
        }
        function undockComposer() {
            const shell = document.getElementById('composer-shell');
            const ghost = document.getElementById('composer-ghost');
            const sendBtn = document.getElementById('composer-send');
            // Reverte o dock: se o input manual ainda está dentro do composer,
            // devolve-o para #transcription (onde o CSS o mantém oculto). Assim,
            // qualquer container.replaceWith(bloco) seguinte insere a pergunta no
            // fluxo do chat — e não dentro do text area. (Corrige o bug em que a
            // pergunta ficava presa num balão dentro do composer.)
            if (shell) {
                const docked = shell.querySelector('.manual-input-container');
                if (docked) {
                    const transcription = document.getElementById('transcription');
                    if (transcription) transcription.appendChild(docked);
                }
            }
            if (ghost) ghost.style.display = '';
            // O send-button do .edit-controls (legado) fica escondido via CSS
            // quando está dentro de #composer, mas mostra o composer-send.
            if (sendBtn) sendBtn.style.display = '';
        }

        function openManualInput(initialText = '') {
            if (manualInputActive || isEditingQuestion) {
                // Se ja esta ativo, apenas garante o foco no input
                const existingInput = document.querySelector('.manual-input-container .terminal-input');
                if (existingInput) {
                    existingInput.focus();
                    if (initialText) {
                        // contenteditable: append no fim antes do cursor
                        const cur = existingInput.querySelector('.gcursor');
                        const tn = document.createTextNode(initialText);
                        if (cur) existingInput.insertBefore(tn, cur);
                        else existingInput.appendChild(tn);
                        existingInput.dispatchEvent(new Event('input'));
                    }
                }
                return;
            }

            manualInputActive = true;
            pastedImageForManualInput = null; // Reseta a imagem colada
            document.getElementById('screenshot-preview').style.display = 'none'; // Esconde o preview
            
            const transcriptionElement = document.getElementById('transcription');
            removeManualInputContainer();
            
            const container = document.createElement('div');
            container.className = 'edit-container manual-input-container';

            // Wrap estilo terminal: '>' antes + contenteditable + '_' DOM no fim.
            const wrap = document.createElement('div');
            wrap.className = 'terminal-input-wrap';

            // Dica curta ao lado do cursor (some quando user digita).
            const hint = document.createElement('span');
            hint.className = 'terminal-hint';
            hint.textContent = 'digite sua pergunta — Shift+Enter envia · Esc fecha';

            // Usamos contenteditable em vez de textarea: assim o '_' piscando
            // e' um <span> REAL dentro do conteudo, sempre apos a posicao do
            // cursor (re-anexado no end no input event). Zero replicacao,
            // zero desalinhamento.
            const inputField = document.createElement('div');
            inputField.className = 'terminal-input';
            inputField.setAttribute('contenteditable', 'plaintext-only');
            inputField.setAttribute('spellcheck', 'false');
            inputField.setAttribute('data-placeholder', '');

            const gCursor = document.createElement('span');
            gCursor.className = 'gcursor';
            gCursor.contentEditable = 'false';
            gCursor.textContent = '_';

            // API pseudo-textarea pra resto do codigo (submitManualQuestion etc).
            Object.defineProperty(inputField, 'value', {
                get() {
                    // Texto sem o cursor (que tem contentEditable=false).
                    const clone = inputField.cloneNode(true);
                    clone.querySelectorAll('.gcursor').forEach(n => n.remove());
                    return clone.innerText.replace(/\u00A0/g, ' ');
                },
                set(v) {
                    inputField.textContent = v || '';
                    syncCursor();
                },
                configurable: true,
            });

            // Usamos o caret NATIVO (caret-color no CSS). Estas funções agora só
            // atualizam o toggle .has-text (esconde a dica). Nada de inserir/mover
            // o cursor no DOM — era isso que embaralhava as letras e travava o
            // backspace. O gCursor permanece definido mas nunca é inserido.
            const updateHasText = () => {
                const txt = inputField.value;
                if (txt.length > 0) wrap.classList.add('has-text');
                else wrap.classList.remove('has-text');
            };
            const syncCursor = updateHasText;
            const syncCursorWithCaretPosition = updateHasText;

            inputField.addEventListener('input', updateHasText);

            // Init: caret nativo. Se houver texto inicial, posiciona o caret no fim.
            if (initialText) {
                inputField.textContent = initialText;
            }
            updateHasText();
            // Coloca o caret no fim do conteúdo quando o input ganha foco a 1ª vez.
            const placeCaretEnd = () => {
                try {
                    const range = document.createRange();
                    range.selectNodeContents(inputField);
                    range.collapse(false);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                } catch (_) {}
            };
            inputField.addEventListener('focus', () => { if (inputField.value) placeCaretEnd(); }, { once: true });

            wrap.appendChild(hint);
            wrap.appendChild(inputField);
            container.appendChild(wrap);
            
            const controls = document.createElement('div');
            controls.className = 'edit-controls';
            
            const sendButton = document.createElement('button');
            sendButton.className = 'send-button';
            sendButton.textContent = 'Enviar';
            sendButton.onclick = () => {
                const question = inputField.value.trim();
                if (question || pastedImageForManualInput) {
                    submitManualQuestion(question, container);
                }
            };
            
            controls.appendChild(sendButton);
            container.appendChild(controls); // Append controls to container

            // === Composer fixo (UX): ancora o input no rodapé, sempre visível.
            // O input real é criado aqui (preserva toda a lógica), mas "ancorado"
            // visualmente dentro do composer fixo da UI. Limpeza apenas de camada
            // de apresentação — nenhum fluxo de dados é alterado.
            dockComposer(container);

            // Foca no input com um pequeno delay para garantir que o DOM foi atualizado
            setTimeout(() => {
                inputField.focus();
                syncCursorWithCaretPosition();
            }, 100);
            
            // Detecta se o caret está na primeira/última linha visual do contenteditable,
            // pra so' navegar o historico quando a seta nao serve pra mover entre linhas.
            const isCaretAtEdgeLine = (edge) => {
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return true;
                const range = sel.getRangeAt(0).cloneRange();
                range.collapse(true);
                let rect = range.getClientRects()[0];
                if (!rect) rect = range.getBoundingClientRect();
                const elRect = inputField.getBoundingClientRect();
                if (!rect || (rect.top === 0 && rect.bottom === 0)) return true; // vazio
                return edge === 'top'
                    ? (rect.top - elRect.top) < 4
                    : (elRect.bottom - rect.bottom) < 4;
            };

            // Enter quebra linha, Shift+Enter envia
            inputField.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault(); // Previne comportamento padrão
                    e.stopPropagation(); // Evita que o evento se propague
                    manualInputActive = false;
                    container.remove();
                    undockComposer();
                    pastedImageForManualInput = null; // Limpa a imagem
                    document.getElementById('screenshot-preview').style.display = 'none'; // Esconde o preview
                } else if (e.key === 'Enter' && e.shiftKey) {
                    e.preventDefault(); // Previne nova linha no textarea
                    const question = inputField.value.trim();
                    if (question || pastedImageForManualInput) {
                        submitManualQuestion(question, container);
                    }
                } else if (e.key === 'ArrowUp' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                    if (promptHistory.length && isCaretAtEdgeLine('top')) {
                        e.preventDefault();
                        if (promptHistoryIndex === -1) {
                            promptHistoryDraft = inputField.value;
                            promptHistoryIndex = promptHistory.length - 1;
                        } else if (promptHistoryIndex > 0) {
                            promptHistoryIndex--;
                        }
                        inputField.value = promptHistory[promptHistoryIndex];
                        placeCaretEnd();
                    }
                } else if (e.key === 'ArrowDown' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
                    if (promptHistoryIndex !== -1 && isCaretAtEdgeLine('bottom')) {
                        e.preventDefault();
                        if (promptHistoryIndex < promptHistory.length - 1) {
                            promptHistoryIndex++;
                            inputField.value = promptHistory[promptHistoryIndex];
                        } else {
                            promptHistoryIndex = -1;
                            inputField.value = promptHistoryDraft;
                        }
                        placeCaretEnd();
                    }
                }
                // Enter sozinho não precisa de handler, deixa o comportamento padrão (quebra linha)
            });
        }
        
        async function submitManualQuestion(text, container) {
            manualInputActive = false;
            undockComposer(); // restaura o ghost do composer após envio

            // Registra no histórico de prompts (navegação ArrowUp/ArrowDown, estilo CLI).
            if (text && promptHistory[promptHistory.length - 1] !== text) {
                promptHistory.push(text);
            }
            promptHistoryIndex = -1;
            promptHistoryDraft = '';

            // Enviar = conversa começou: esconde o hero (→ #main perde .is-empty,
            // o composer doca embaixo e o #transcription fica visível). Antes isso
            // dependia do clique no body, que removi pra parar o "pulo" — sem este
            // hide a pergunta/resposta caíam num #transcription display:none.
            const _heroSubmit = document.getElementById('welcome-hero');
            if (_heroSubmit) _heroSubmit.classList.add('hidden');

            const isDebug = await window.electronAPI.getDebugModeStatus();

            if (pastedImageForManualInput) {
                // We already processed image OCR in main and will send combined prompt here
                // Show the question in UI
                const questionSpan = document.createElement('span');
                questionSpan.className = 'question-text';
                setQuestionText(questionSpan, `${text} (Image in context)`);
                const ib1 = document.createElement('div');
                ib1.className = 'interaction-block';
                ib1.appendChild(questionSpan);
                container.replaceWith(ib1);
                currentQuestionElement = questionSpan;

                startProcessing();

                // Se o backend tem visão (OpenAI/Lite), manda a IMAGEM real + o
                // enunciado digitado. O OCR local não basta: quiz/código/canvas
                // viram OCR vazio e o modelo respondia "envie as opções".
                if (window.pendingChatImage && await backendSupportsVision()) {
                    sentImageToAI(text, window.pendingChatImage);
                } else {
                    // Backends sem visão: mantém o fluxo antigo de OCR + texto.
                    const promptInstruction = await window.electronAPI.getPromptInstruction();
                    if (typeof window.lastOcrText === 'string' && window.lastOcrText.length > 0) {
                        sentToAI(`${promptInstruction}${text}\n${window.lastOcrText}`);
                    } else {
                        sentToAI(`${promptInstruction}${text}`);
                    }
                }
                pastedImageForManualInput = null;
                window.pendingChatImage = null;
                document.getElementById('screenshot-preview').style.display = 'none';
                return;
            }

            // Existing debug/plain flows remain unchanged
            if (isDebug) {
                const promptInstruction = await window.electronAPI.getPromptInstruction();
                const backendUrl = (await window.electronAPI.getBackendUrl()) || "URL_INDEFINIDA";
                //console.log("DEBUG backend URL:", backendUrl);
                const lang = await window.electronAPI.getLanguage();
                const map = {
                    'pt-br': 'PORTUGUESE',
                    'en-us': 'ENGLISH'
                };
                const debugInfo = {
                    'HTTP Verb': 'POST',
                    'Backend URL': backendUrl,
                    'Request Body': {
                        newPrompt: `${promptInstruction}${text}`,
                        ip: sessionStorage.getItem("user_ip"),
                        email: 'julianosoder.js@gmail.com',
                        agent: false,
                        language: map[lang] || 'ENGLISH'
                    }
                };
                
                const pre = document.createElement('pre');
                pre.textContent = JSON.stringify(debugInfo, null, 2);
                container.replaceWith(pre);

            } else {
                const questionSpan = document.createElement('span');
                questionSpan.className = 'question-text';
                setQuestionText(questionSpan, text);
                wireQuestionEdit(questionSpan);

                const ib2 = document.createElement('div');
                ib2.className = 'interaction-block';
                ib2.appendChild(questionSpan);
                ib2.appendChild(createBlockActions(document.getElementById('transcription')));
                container.replaceWith(ib2);
                currentQuestionElement = questionSpan;
            }
            
            // Inicia processamento
            startProcessing();
            
            // Envia para a IA
            sentToAI(text);
        }

        window.electronAPI.onOcrResult(({ text }) => { window.lastOcrText = text || ''; });

    // Register on window
    window.openManualInput = openManualInput;
    window.submitManualQuestion = submitManualQuestion;
    window.dockComposer = dockComposer;
    window.undockComposer = undockComposer;
})();
