// renderer/chatMessages.js
// Chat Messages & Display Handling Module
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

    const copyAllFixedBtn = document.getElementById('copy-all-btn');
    if (copyAllFixedBtn) {
        copyAllFixedBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const blocks = transcriptionElement.querySelectorAll('.interaction-block');
            let allText = '';
            blocks.forEach(block => {
                const q = block.querySelector('.question-text');
                const a = block.querySelector('.ia-response, .streaming-response');
                if (q) allText += `Pergunta: ${window.getQuestionText(q)}\n\n`;
                if (a) allText += `Resposta: ${a.innerText || a.textContent}\n\n---\n\n`;
            });
            if (!allText.trim()) return;
            if (typeof copyTextReliable === 'function') copyTextReliable(allText.trim());
            copyAllFixedBtn.textContent = 'Copiado ✓';
            copyAllFixedBtn.classList.add('copied');
            setTimeout(() => { copyAllFixedBtn.textContent = 'Copiar tudo'; copyAllFixedBtn.classList.remove('copied'); }, 1500);
        });
    }

    function scrollTranscriptionToBottom(behavior = 'smooth') {
        const el = document.getElementById('transcription');
        if (!el) return;
        const isNearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 150;
        if (isNearBottom || behavior === 'force') {
            el.scrollTo({ top: el.scrollHeight, behavior: behavior === 'force' ? 'smooth' : behavior });
        }
    }

    function appendQuestionEntry(text) {
        const transcriptionElement = document.getElementById('transcription');

        const hero = document.getElementById('welcome-hero');
        if (hero) hero.classList.add('hidden');

        const interactionBlock = document.createElement('div');
        interactionBlock.className = 'interaction-block';

        const questionSpan = document.createElement('span');
        questionSpan.className = 'question-text';
        if (typeof window.setQuestionText === 'function') {
            window.setQuestionText(questionSpan, text);
        } else {
            questionSpan.textContent = text;
        }

        if (typeof window.wireQuestionEdit === 'function') {
            window.wireQuestionEdit(questionSpan);
        }

        const blockActions = typeof window.createBlockActions === 'function' ? window.createBlockActions(transcriptionElement) : document.createElement('div');

        interactionBlock.appendChild(questionSpan);
        interactionBlock.appendChild(blockActions);
        transcriptionElement.appendChild(interactionBlock);
        currentQuestionElement = questionSpan;

        const cab = document.getElementById('copy-all-btn');
        if (cab) cab.style.display = 'block';
        scrollTranscriptionToBottom();
        return questionSpan;
    }

    document.addEventListener('click', async (e) => {
        const fileLink = e.target.closest('.chat-file-link, [data-file-path]');
        if (fileLink) {
            e.preventDefault();
            e.stopPropagation();
            const rawPath = fileLink.getAttribute('data-file-path') || fileLink.dataset.filePath;
            const rawLine = fileLink.getAttribute('data-line') || fileLink.dataset.line;
            if (rawPath && rawPath !== '#') {
                const parseFn = window.parseFilePathAndLine || ((r) => ({ path: r, line: undefined }));
                let { path: filePath, line } = parseFn(rawPath);
                if (!line && rawLine) line = parseInt(rawLine, 10);
                if (filePath && typeof window.openFileViewer === 'function') {
                    window.openFileViewer(filePath, line);
                }
            }
            return;
        }

        const webLink = e.target.closest('a.chat-web-link, a[href^="http://"], a[href^="https://"]');
        if (webLink) {
            e.preventDefault();
            e.stopPropagation();
            const url = webLink.getAttribute('href');
            if (url && window.electronAPI && window.electronAPI.workspaceOpenExternal) {
                window.electronAPI.workspaceOpenExternal(url);
            }
            return;
        }

        const codeElement = e.target.closest('pre code');
        if (codeElement && e.target.tagName !== 'BUTTON') {
            const codeText = codeElement.textContent.replace(/^(Copy|Copied!|✓|✗)/, '').trim();
            if (typeof copyTextReliable === 'function') copyTextReliable(codeText);
            if (typeof showCopyToast === 'function') showCopyToast();
            e.stopPropagation();
            e.preventDefault();
            return;
        }

        const clickedCode = e.target.closest('code');
        if (clickedCode) {
            const isInsidePre = clickedCode.closest('pre') !== null;
            if (!isInsidePre) {
                const codeText = clickedCode.textContent.trim();
                const isFileFn = window.isLikelyFilePath;
                if (isFileFn && isFileFn(codeText) && typeof window.openFileViewer === 'function') {
                    const parseFn = window.parseFilePathAndLine || ((r) => ({ path: r, line: undefined }));
                    const { path: p, line } = parseFn(codeText);
                    window.openFileViewer(p, line);
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }

                if (typeof copyTextReliable === 'function') copyTextReliable(codeText);
                if (typeof showCopyToast === 'function') showCopyToast();
                e.stopPropagation();
                e.preventDefault();
            }
        }
    });

    window.addEventListener('keydown', (e) => {
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
        if (e.key === 'Escape' && typeof manualInputActive !== 'undefined' && manualInputActive) {
            manualInputActive = false;
            if (typeof removeManualInputContainer === 'function') removeManualInputContainer();
            if (typeof undockComposer === 'function') undockComposer();
            if (typeof pastedImageForManualInput !== 'undefined') pastedImageForManualInput = null;
            const sp = document.getElementById('screenshot-preview');
            if (sp) sp.style.display = 'none';
            e.stopPropagation();
            e.preventDefault();
        } else if (typeof isDirectTypingKey === 'function' && isDirectTypingKey(e) && (typeof manualInputActive === 'undefined' || !manualInputActive) && !isEditingQuestion) {
            if (typeof openManualInput === 'function') openManualInput(e.key === 'Backspace' ? '' : e.key);
            e.preventDefault();
        } else if (e.key === 'Escape') {
            const cv = document.getElementById('conversation-viewer');
            if (cv && cv.style.display !== 'none') {
                cv.style.display = 'none';
                e.stopPropagation();
                e.preventDefault();
            }
        }
    });

    async function sentToAI(text) {
        window.iaCancelled = false;
        let activeSessionId = null;
        if (window.historySession) {
            activeSessionId = await window.historySession.ensureSessionForFirstQuestion(text);
            await window.historySession.addMessageToCurrentSession('user', text);
        }

        const aiModel = await window.electronAPI.getAiModel();

        if (aiModel === 'llama-stream' || aiModel === 'qwen-stream' || aiModel === 'ollamaLocal') {
            window.electronAPI.sendTextToGeminiStream(text, activeSessionId);
        } else {
            window.electronAPI.sendTextToGemini(text, activeSessionId);
        }
    }

    async function sentImageToAI(text, image) {
        window.iaCancelled = false;
        const q = (text && text.trim()) ? text.trim() : 'Image in context';
        if (window.historySession) {
            await window.historySession.ensureSessionForFirstQuestion(q);
            await window.historySession.addMessageToCurrentSession('user', q);
        }
        window.electronAPI.sendVisionToGemini(text || '', image);
    }

    async function backendSupportsVision() {
        try { return (await window.electronAPI.getAiModel()) === 'openIa'; }
        catch (_) { return false; }
    }

    function stopProcessing() {
        showFloatingStop(false);
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
                const runningItems = block.querySelectorAll('.ai-activity-item.running');
                runningItems.forEach(it => {
                    it.classList.remove('running');
                    it.classList.add('done');
                    const ic = it.querySelector('.ai-activity-ic');
                    if (ic) ic.innerHTML = '<svg class="ai-activity-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                });
            });
        }

        window.electronAPI.stopNotifications();
    }

    function cancelIaAndFreezeStream() {
        window.iaCancelled = true;
        if (window.electronAPI && window.electronAPI.cancelIaRequest) {
            window.electronAPI.cancelIaRequest();
        }
        try {
            if (typeof typingCursor !== 'undefined' && typingCursor && typingCursor.parentNode) {
                typingCursor.remove();
            }
        } catch (_) {}
        if (typeof streamingElement !== 'undefined') streamingElement = null;
        if (typeof streamingText !== 'undefined') streamingText = '';
        if (typeof typingCursor !== 'undefined') typingCursor = null;
        stopProcessing();
    }

    function getFloatingStop() {
        let btn = document.getElementById('ai-stop-floating');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'ai-stop-floating';
            btn.className = 'ai-stop-floating';
            btn.textContent = '■ Parar IA';
            btn.title = 'Interromper a IA';
            btn.addEventListener('click', () => {
                cancelIaAndFreezeStream();
            });
            document.body.appendChild(btn);
        }
        return btn;
    }

    function showFloatingStop(mostrar) {
        const btn = getFloatingStop();
        btn.classList.toggle('visible', !!mostrar);
    }

    function startProcessing() {
        window.iaCancelled = false;
        const robot = document.getElementById('robot');
        if (robot) robot.style.display = 'block';
        showFloatingStop(true);

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
                            <button class="ai-phase-stop" title="Interromper">×</button>
                            <span class="ai-phase-text">Aguardando resposta...</span>
                        </div>
                    `;
                    const stop = ph.querySelector('.ai-phase-stop');
                    if (stop) stop.addEventListener('click', (e) => {
                        e.stopPropagation();
                        cancelIaAndFreezeStream();
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

        window.electronAPI.startNotifications();
    }

    window.scrollTranscriptionToBottom = scrollTranscriptionToBottom;
    window.appendQuestionEntry = appendQuestionEntry;
    window.sentToAI = sentToAI;
    window.sentImageToAI = sentImageToAI;
    window.backendSupportsVision = backendSupportsVision;
    window.startProcessing = startProcessing;
    window.stopProcessing = stopProcessing;
    window.cancelIaAndFreezeStream = cancelIaAndFreezeStream;
})();
