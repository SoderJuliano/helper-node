// Chat Messages & Question Editing Module
var currentQuestionElement = null;
var isEditingQuestion = false;

(function() {
    const welcomeHero = document.getElementById('welcome-hero');
    const mainEl = document.getElementById('main');
    const transcriptionElement = document.getElementById('transcription');

    function syncEmptyState() {
        const empty = welcomeHero && !welcomeHero.classList.contains('hidden');
        if (mainEl) mainEl.classList.toggle('is-empty', !!empty);
    }
    syncEmptyState();
    if (welcomeHero) {
        new MutationObserver(syncEmptyState).observe(welcomeHero, { attributes: true, attributeFilter: ['class'] });
    }

            // === Botão Copy All fixo no topo ===
            const copyAllFixedBtn = document.getElementById('copy-all-btn');
            if (copyAllFixedBtn) {
                copyAllFixedBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const blocks = transcriptionElement.querySelectorAll('.interaction-block');
                    let allText = '';
                    blocks.forEach(block => {
                        const q = block.querySelector('.question-text');
                        // .streaming-response = respostas dos providers CLI
                        const a = block.querySelector('.ia-response, .streaming-response');
                        if (q) allText += `Pergunta: ${getQuestionText(q)}\n\n`;
                        if (a) allText += `Resposta: ${a.innerText || a.textContent}\n\n---\n\n`;
                    });
                    if (!allText.trim()) return;
                    copyTextReliable(allText.trim());
                    copyAllFixedBtn.textContent = 'Copiado ✓';
                    copyAllFixedBtn.classList.add('copied');
                    setTimeout(() => { copyAllFixedBtn.textContent = 'Copiar tudo'; copyAllFixedBtn.classList.remove('copied'); }, 1500);
                });
            }

            // === Botão Cancelar Requisição Fixo ===
            const cancelFixedBtn = document.getElementById('cancel-request-btn');
            if (cancelFixedBtn) {
                cancelFixedBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    console.log('🛑 Botão Cancelar Fixo Clicado');
                    if (window.electronAPI && window.electronAPI.cancelIaRequest) {
                        window.electronAPI.cancelIaRequest();
                    }
                    stopProcessing();
                });
            }

        function scrollTranscriptionToBottom(behavior = 'smooth') {
            const el = document.getElementById('transcription');
            if (!el) return;
            // Se o usuário rolou pra cima manualmente para ler ou clicar em algo (como cancelar), não forçar scroll pra baixo
            const isNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 150;
            if (isNearBottom || behavior === 'force') {
                el.scrollTo({ top: el.scrollHeight, behavior: behavior === 'force' ? 'smooth' : behavior });
            }
        }

 // scrollTranscriptionToBottom

        function appendQuestionEntry(text) {
            const transcriptionElement = document.getElementById('transcription');

            // Oculta o hero de boas-vindas na primeira mensagem real
            const hero = document.getElementById('welcome-hero');
            if (hero) hero.classList.add('hidden');

            // Cria o bloco que agrupa pergunta + resposta
            const interactionBlock = document.createElement('div');
            interactionBlock.className = 'interaction-block';

            const questionSpan = document.createElement('span');
            questionSpan.className = 'question-text';
            setQuestionText(questionSpan, text);

            wireQuestionEdit(questionSpan);

            // === Bloco de ações ⌬ ===
            const blockActions = createBlockActions(transcriptionElement);

            interactionBlock.appendChild(questionSpan);
            interactionBlock.appendChild(blockActions);
            transcriptionElement.appendChild(interactionBlock);
            currentQuestionElement = questionSpan;
            // Mostrar Copy All assim que houver pelo menos 1 bloco
            const cab = document.getElementById('copy-all-btn');
            if (cab) cab.style.display = 'block';
            scrollTranscriptionToBottom();
            return questionSpan;
        }

        document.addEventListener('click', async (e) => {
            // Verifica se clicou em um bloco de código (pre > code)
            const codeElement = e.target.closest('pre code');
            if (codeElement && e.target.tagName !== 'BUTTON') {
                // Pega apenas o texto do código, sem o botão
                const codeText = codeElement.textContent.replace(/^(Copy|Copied!|✓|✗)/, '').trim();

                copyTextReliable(codeText);
                showCopyToast();
                
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            
            // Verifica se clicou em código inline (apenas <code>, sem <pre>)
            // Primeiro verifica se é um elemento <code>
            const clickedCode = e.target.closest('code');
            if (clickedCode) {
                // Verifica se NÃO está dentro de um <pre>
                const isInsidePre = clickedCode.closest('pre') !== null;
                if (!isInsidePre) {
                    const codeText = clickedCode.textContent.trim();

                    copyTextReliable(codeText);
                    showCopyToast();
                    
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
        });

        // Carregar a animação
 // Click listener for code copy/edit

            window.addEventListener('keydown', (e) => {
                // Ctrl+F é tratado em capture-phase no document (ver logo após
                // wireFileViewer) — não duplica aqui.
                // Ctrl+D: fallback pra Wayland onde global shortcuts falham.
                if (e.key === 'd' && e.ctrlKey && !e.shiftKey && !e.altKey) {
                    const active = document.activeElement;
                    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
                    if (!isInput) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (window.electronAPI && window.electronAPI.triggerToggleRecording) {
                            window.electronAPI.triggerToggleRecording();
                        }
                        return;
                    }
                }
                // Ctrl+I: mostra/esconde o composer no modo assistente em tempo real.
                if (e.key === 'i' && e.ctrlKey && !e.shiftKey && !e.altKey) {
                    const active = document.activeElement;
                    const isInput = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable);
                    if (!isInput && typeof window.setComposerVisibility === 'function') {
                        e.preventDefault();
                        e.stopPropagation();
                        const el = window.composerEl;
                        window.setComposerVisibility(el && el.classList.contains('collapsed'));
                        return;
                    }
                }
                if (e.key === 'Escape' && manualInputActive) {
                    manualInputActive = false;
                    removeManualInputContainer();
                    undockComposer();
                    pastedImageForManualInput = null;
                    document.getElementById('screenshot-preview').style.display = 'none';
                    e.stopPropagation();
                    e.preventDefault();
                } else if (isDirectTypingKey(e) && !manualInputActive && !isEditingQuestion) {
                    openManualInput(e.key === 'Backspace' ? '' : e.key);
                    e.preventDefault();
                } else if (e.key === 'Escape' && document.getElementById('conversation-viewer').style.display !== 'none') {
                    // Close conversation viewer with Escape key
                    document.getElementById('conversation-viewer').style.display = 'none';
                    e.stopPropagation();
                    e.preventDefault();
                }
            });
        // Window keydowns for audio trigger controls

        async function sentToAI(text) {
            let activeSessionId = null;
            if (window.historySession) {
                activeSessionId = await window.historySession.ensureSessionForFirstQuestion(text);
                await window.historySession.addMessageToCurrentSession('user', text);
            }

            const aiModel = await window.electronAPI.getAiModel();
            
            if (aiModel === 'llama-stream' || aiModel === 'qwen-stream') {
                // Usa streaming
                window.electronAPI.sendTextToGeminiStream(text, activeSessionId);
            } else {
                // Usa o método normal
                window.electronAPI.sendTextToGemini(text, activeSessionId);
            }
        }

        // Manda a IMAGEM (data URL) pro modelo de visão, com o enunciado digitado
        // (se houver). Usado no chat quando o backend é OpenAI — antes a imagem
        // era jogada fora e só o OCR ia pro modelo.
        async function sentImageToAI(text, image) {
            const q = (text && text.trim()) ? text.trim() : 'Image in context';
            if (window.historySession) {
                await window.historySession.ensureSessionForFirstQuestion(q);
                await window.historySession.addMessageToCurrentSession('user', q);
            }
            window.electronAPI.sendVisionToGemini(text || '', image);
        }

        // True quando o backend ativo suporta visão (OpenAI). Na Lite é sempre true.
        async function backendSupportsVision() {
            try { return (await window.electronAPI.getAiModel()) === 'openIa'; }
            catch (_) { return false; }
        }

        // Renderizador de markdown único usado em toda a UI.
        // Suporta: blocos de código (```), código inline (`x`), headings (#/##/###),
        // listas (- / * / 1.), negrito (**), itálico (*), parágrafos e quebras de linha.
 // sendToAI / sendImageToAI / supportsVision

        const EDIT_ICON_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 21H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path fill-rule="evenodd" clip-rule="evenodd" d="M18.0235 10.4646L7.58554 20.9026H2.76801L2.76489 16.0819L13.2029 5.64392L18.0235 10.4646Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13.2029 5.64388L15.0004 3.84641C15.7814 3.06536 17.0477 3.06536 17.8288 3.84641L19.821 5.83863C20.6021 6.61968 20.6021 7.88601 19.821 8.66706L18.0235 10.4645V10.4645" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

        // Renderiza o texto da pergunta com markdown e guarda o original em data-raw
        // para que edição e reenvio sempre usem o texto puro.
        function setQuestionText(el, text) {
            el.dataset.raw = text;
            el.innerHTML = renderMarkdown(text, 'q');
            // Re-injeta o edit-icon (renderMarkdown sobrescreve innerHTML)
            const ic = document.createElement('span');
            ic.className = 'edit-icon';
            ic.title = 'Editar e reenviar';
            ic.innerHTML = EDIT_ICON_SVG;
            el.appendChild(ic);
        }

        function getQuestionText(questionSpan) {
            // Usa o texto original guardado em data-raw; fallback para textContent
            return (questionSpan.dataset.raw || questionSpan.textContent).trim();
        }

        // Liga a edição SOMENTE ao clique no lápis — clicar no texto da
        // pergunta não abre mais o editor (abria sem querer o tempo todo).
        function wireQuestionEdit(span) {
            span.addEventListener('click', (e) => {
                if (!e.target.closest('.edit-icon')) return;
                e.stopPropagation();
                handleQuestionEdit(span);
            });
        }

        // Handler global de Esc enquanto edita (capture: funciona mesmo se o
        // foco saiu do textarea). Registrado em handleQuestionEdit, removido
        // ao cancelar/enviar.
        let _editEscHandler = null;
        function _removeEditEscHandler() {
            if (_editEscHandler) {
                document.removeEventListener('keydown', _editEscHandler, true);
                _editEscHandler = null;
            }
        }

        function handleQuestionEdit(questionSpan) {
            if (isEditingQuestion) return;

            isEditingQuestion = true;
            console.log('Iniciando edição da pergunta');

            const currentText = getQuestionText(questionSpan);

            const container = document.createElement('div');
            container.className = 'edit-container';

            // Sempre usa textarea para edição
            const editField = document.createElement('textarea');
            editField.className = 'edit-textarea';
            editField.rows = 5;
            editField.value = currentText;
            editField.style.width = '100%';
            editField.style.marginBottom = '10px';

            const sendButton = document.createElement('button');
            sendButton.className = 'send-button';
            sendButton.textContent = 'Enviar';
            sendButton.style.marginRight = '10px';

            const cancelButton = document.createElement('button');
            cancelButton.className = 'send-button edit-cancel-btn';
            cancelButton.textContent = 'Cancelar (Esc)';

            const controls = document.createElement('div');
            controls.className = 'edit-controls';
            controls.appendChild(sendButton);
            controls.appendChild(cancelButton);

            container.appendChild(editField);
            container.appendChild(controls);

            const doCancel = () => cancelEditSimple(questionSpan, container, currentText);
            const doSend = () => {
                const newText = editField.value.trim();
                if (newText) finishEdit(newText, container);
                else doCancel(); // vazio = cancelar, nunca reenviar em branco
            };

            sendButton.addEventListener('click', doSend);
            cancelButton.addEventListener('click', doCancel);

            // Enter envia, Shift+Enter quebra linha, Esc cancela.
            editField.addEventListener('keydown', function(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    doCancel();
                } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doSend();
                }
            });

            // Esc cancela mesmo com o foco fora do textarea.
            _editEscHandler = (e) => {
                if (e.key === 'Escape' && isEditingQuestion) {
                    e.preventDefault();
                    e.stopPropagation();
                    doCancel();
                }
            };
            document.addEventListener('keydown', _editEscHandler, true);

            // Substitui o span pelo campo de edição
            questionSpan.replaceWith(container);
            editField.focus();
        }

        function cancelEditSimple(originalSpan, container, originalText) {
            console.log('Cancelando edição — nada é reenviado');
            isEditingQuestion = false;
            _removeEditEscHandler();

            // Recria o span original com markdown e lápis (setQuestionText faz os dois)
            setQuestionText(originalSpan, originalText);

            // Substitui de volta (listener de clique original do span continua vivo)
            container.replaceWith(originalSpan);
        }

        function finishEdit(newText, container) {
            console.log('Finalizando edição com texto:', newText);

            isEditingQuestion = false;
            _removeEditEscHandler();

            // Só aqui (envio confirmado) cancela a requisição em andamento —
            // abrir o editor por engano não pode matar uma resposta em curso.
            window.electronAPI.cancelIaRequest();
            stopProcessing();

            // Limpa qualquer elemento de streaming anterior
            const transcriptionElement = document.getElementById('transcription');
            const existingStreamingElements = transcriptionElement.querySelectorAll('.streaming-response, .response-text');
            existingStreamingElements.forEach(el => el.remove());
            
            // Força reset COMPLETO das variáveis de streaming
            streamingElement = null;
            streamingText = '';
            typingCursor = null;
            console.log('Variáveis de streaming resetadas globalmente');
            
            // Recria o span com o novo texto dentro de um interaction-block
            const questionSpan = document.createElement('span');
            questionSpan.className = 'question-text';
            setQuestionText(questionSpan, newText);
            wireQuestionEdit(questionSpan);

            // Se o container está dentro de um interaction-block, substitui o bloco inteiro
            const parentBlock = container.closest('.interaction-block');
            const newBlock = document.createElement('div');
            newBlock.className = 'interaction-block';
            newBlock.appendChild(questionSpan);
            newBlock.appendChild(createBlockActions(document.getElementById('transcription')));

            if (parentBlock) {
                parentBlock.replaceWith(newBlock);
            } else {
                container.replaceWith(newBlock);
            }
            currentQuestionElement = questionSpan;
            
            console.log('Enviando pergunta editada:', newText);
            
            // IMPORTANTE: Inicia o processamento ANTES de enviar
            startProcessing();
            console.log('Loading iniciado - robô deve estar visível');
            
            // Envia para a IA
            sentToAI(newText);
        }

        
        function stopProcessing() {
            // Esconde botão cancelar fixo do topo
            const cancelFixedBtn = document.getElementById('cancel-request-btn');
            if (cancelFixedBtn) cancelFixedBtn.style.display = 'none';

            // Para animações (instância lottie compartilhada via window.animation)
            const animation = window.animation;
            const animationContainer = document.getElementById('animation-container');
            if (animation) {
                if (animationContainer) animationContainer.style.display = 'none';
                animation.stop();
            }
            const robot = document.getElementById('robot');
            if (robot) robot.style.display = 'none';

            const transcriptionElement = document.getElementById('transcription');
            if (transcriptionElement) {
                const blocks = transcriptionElement.querySelectorAll('.interaction-block');
                blocks.forEach(block => {
                    block.classList.remove('is-processing');
                    const ph = block.querySelector('.ai-phase');
                    if (ph && !ph.classList.contains('expanded')) {
                        ph.classList.add('done');
                        const spin = ph.querySelector('.ai-phase-spin'); if (spin) spin.remove();
                        const stop = ph.querySelector('.ai-phase-stop'); if (stop) stop.remove();
                    }
                });
            }
            
            // Notifica o backend para parar notificações
            window.electronAPI.stopNotifications();
        }
        
        function startProcessing() {
            console.log('startProcessing chamado');
            // Mostra botão cancelar fixo do topo
            const cancelFixedBtn = document.getElementById('cancel-request-btn');
            if (cancelFixedBtn) cancelFixedBtn.style.display = 'inline-flex';

            const robot = document.getElementById('robot');
            if (robot) robot.style.display = 'block';
            console.log('Robô definido como visível');

            const transcriptionElement = document.getElementById('transcription');
            if (transcriptionElement) {
                const lastBlock = transcriptionElement.querySelector('.interaction-block:last-child');
                if (lastBlock) {
                    lastBlock.classList.add('is-processing');
                    let ph = lastBlock.querySelector('.ai-phase');
                    if (!ph) {
                        ph = document.createElement('div');
                        ph.className = 'ai-phase';
                        ph.innerHTML = `
                            <div class="ai-phase-header">
                                <span class="ai-phase-spin"></span>
                                <span class="ai-phase-tag">Pensando</span>
                                <span class="ai-phase-text">Aguardando resposta...</span>
                                <button class="ai-phase-stop" title="Interromper">×</button>
                            </div>
                        `;
                        const stop = ph.querySelector('.ai-phase-stop');
                        if (stop) stop.addEventListener('click', (e) => {
                            e.stopPropagation();
                            console.log('Botão interromper clicado');
                            if (window.electronAPI && window.electronAPI.cancelIaRequest) {
                                window.electronAPI.cancelIaRequest();
                            }
                            stopProcessing();
                            const txt = ph.querySelector('.ai-phase-text');
                            if (txt) txt.textContent = 'Interrompido pelo usuário';
                            ph.classList.add('done');
                            const spin = ph.querySelector('.ai-phase-spin'); if (spin) spin.remove();
                            if (stop) stop.remove();
                        });
                        lastBlock.appendChild(ph);
                    }
                }
            }
            
            // Reinicia notificações
            window.electronAPI.startNotifications();
            console.log('Notificações iniciadas');
        }
 // Question Editing (wireQuestionEdit, handleQuestionEdit, etc.)

    // Expose
    window.scrollTranscriptionToBottom = scrollTranscriptionToBottom;
    window.appendQuestionEntry = appendQuestionEntry;
    window.sentToAI = sentToAI;
    window.sentImageToAI = sentImageToAI;
    window.wireQuestionEdit = wireQuestionEdit;
    window.handleQuestionEdit = handleQuestionEdit;
    // Usados pelos módulos ipcOcr.js / ipcResponses.js (IIFEs separadas).
    window.backendSupportsVision = backendSupportsVision;
    window.getQuestionText = getQuestionText;
    window.EDIT_ICON_SVG = EDIT_ICON_SVG;
    window.setQuestionText = setQuestionText;
    window.startProcessing = startProcessing;
    window.stopProcessing = stopProcessing;
})();
