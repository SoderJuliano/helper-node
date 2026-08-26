// renderer/chatInput.js
// Chat Input / Composer Interactive Handling Module
var manualInputActive = false;
var pastedImageForManualInput = null;
var promptHistory = [];
var promptHistoryIndex = -1;
var promptHistoryDraft = '';

(function() {
    const transcriptionElement = document.getElementById('transcription');

    function dockComposer(container) {
        const shell = document.getElementById('composer-shell');
        const ghost = document.getElementById('composer-ghost');
        const sendBtn = document.getElementById('composer-send');
        if (!shell) { if (transcriptionElement) transcriptionElement.appendChild(container); return; }
        if (ghost) ghost.style.display = 'none';
        if (sendBtn) shell.insertBefore(container, sendBtn);
        else shell.appendChild(container);
    }

    function undockComposer() {
        const shell = document.getElementById('composer-shell');
        const ghost = document.getElementById('composer-ghost');
        const sendBtn = document.getElementById('composer-send');
        if (shell) {
            const docked = shell.querySelector('.manual-input-container');
            if (docked) {
                const transcription = document.getElementById('transcription');
                if (transcription) transcription.appendChild(docked);
            }
        }
        if (ghost) ghost.style.display = '';
        if (sendBtn) sendBtn.style.display = '';
    }

    function openManualInput(initialText = '') {
        if (manualInputActive || window.isEditingQuestion) {
            const existingInput = document.querySelector('.manual-input-container .terminal-input');
            if (existingInput) {
                existingInput.focus();
                if (initialText) {
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
        pastedImageForManualInput = null;
        const sp = document.getElementById('screenshot-preview');
        if (sp) sp.style.display = 'none';
        
        if (typeof removeManualInputContainer === 'function') removeManualInputContainer();
        
        const container = document.createElement('div');
        container.className = 'edit-container manual-input-container';

        const wrap = document.createElement('div');
        wrap.className = 'terminal-input-wrap';

        const hint = document.createElement('span');
        hint.className = 'terminal-hint';
        hint.textContent = 'digite sua pergunta — Shift+Enter envia · Esc fecha';

        const inputField = document.createElement('div');
        inputField.className = 'terminal-input';
        inputField.setAttribute('contenteditable', 'plaintext-only');
        inputField.setAttribute('spellcheck', 'false');
        inputField.setAttribute('data-placeholder', '');

        const gCursor = document.createElement('span');
        gCursor.className = 'gcursor';
        gCursor.contentEditable = 'false';
        gCursor.textContent = '_';

        Object.defineProperty(inputField, 'value', {
            get() {
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

        const updateHasText = () => {
            const txt = inputField.value;
            if (txt.length > 0) wrap.classList.add('has-text');
            else wrap.classList.remove('has-text');
        };
        const syncCursor = updateHasText;
        const syncCursorWithCaretPosition = updateHasText;

        inputField.addEventListener('input', updateHasText);

        if (initialText) {
            inputField.textContent = initialText;
        }
        updateHasText();

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
        container.appendChild(controls);

        dockComposer(container);

        inputField.focus();
        syncCursorWithCaretPosition();
        setTimeout(() => {
            inputField.focus();
            syncCursorWithCaretPosition();
        }, 20);
        
        const isCaretAtEdgeLine = (edge) => {
            const sel = window.getSelection();
            if (!sel || !sel.rangeCount) return true;
            const range = sel.getRangeAt(0).cloneRange();
            range.collapse(true);
            let rect = range.getClientRects()[0];
            if (!rect) rect = range.getBoundingClientRect();
            const elRect = inputField.getBoundingClientRect();
            if (!rect || (rect.top === 0 && rect.bottom === 0)) return true;
            return edge === 'top'
                ? (rect.top - elRect.top) < 4
                : (elRect.bottom - rect.bottom) < 4;
        };

        inputField.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                manualInputActive = false;
                container.remove();
                undockComposer();
                pastedImageForManualInput = null;
                const prev = document.getElementById('screenshot-preview');
                if (prev) prev.style.display = 'none';
            } else if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
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
        });
    }
    
    async function submitManualQuestion(text, container) {
        manualInputActive = false;
        if (container) {
            try { container.remove(); } catch (_) {}
        }
        undockComposer();

        if (text && promptHistory[promptHistory.length - 1] !== text) {
            promptHistory.push(text);
        }
        promptHistoryIndex = -1;
        promptHistoryDraft = '';

        const _heroSubmit = document.getElementById('welcome-hero');
        if (_heroSubmit) _heroSubmit.classList.add('hidden');

        const transcriptionElement = document.getElementById('transcription');
        if (!transcriptionElement) return;

        const isDebug = window.electronAPI && window.electronAPI.getDebugModeStatus
            ? await window.electronAPI.getDebugModeStatus()
            : false;

        const questionSpan = document.createElement('span');
        questionSpan.className = 'question-text';
        if (typeof window.setQuestionText === 'function') {
            window.setQuestionText(questionSpan, pastedImageForManualInput ? `${text} (Image in context)` : text);
        } else {
            questionSpan.textContent = text;
        }

        if (typeof window.wireQuestionEdit === 'function') {
            window.wireQuestionEdit(questionSpan);
        }

        const ib = document.createElement('div');
        ib.className = 'interaction-block';
        ib.appendChild(questionSpan);
        if (typeof window.createBlockActions === 'function') {
            ib.appendChild(window.createBlockActions(transcriptionElement));
        }

        if (isDebug && window.electronAPI) {
            const promptInstruction = (await window.electronAPI.getPromptInstruction()) || '';
            const backendUrl = (await window.electronAPI.getBackendUrl()) || "URL_INDEFINIDA";
            const lang = (await window.electronAPI.getLanguage()) || 'pt-br';
            const map = { 'pt-br': 'PORTUGUESE', 'en-us': 'ENGLISH' };
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
            ib.appendChild(pre);
        }

        transcriptionElement.appendChild(ib);
        window.currentQuestionElement = questionSpan;
        if (typeof window.scrollTranscriptionToBottom === 'function') {
            window.scrollTranscriptionToBottom('force');
        }

        if (typeof window.startProcessing === 'function') window.startProcessing();

        if (pastedImageForManualInput) {
            if (window.pendingChatImage && window.backendSupportsVision && await window.backendSupportsVision()) {
                if (typeof window.sentImageToAI === 'function') window.sentImageToAI(text, window.pendingChatImage);
            } else {
                if (typeof window.lastOcrText === 'string' && window.lastOcrText.length > 0) {
                    if (typeof window.sentToAI === 'function') window.sentToAI(`${text}\n${window.lastOcrText}`);
                } else {
                    if (typeof window.sentToAI === 'function') window.sentToAI(text);
                }
            }
            pastedImageForManualInput = null;
            window.pendingChatImage = null;
            const sp = document.getElementById('screenshot-preview');
            if (sp) sp.style.display = 'none';
        } else {
            if (typeof window.sentToAI === 'function') window.sentToAI(text);
        }
    }

    if (window.electronAPI && window.electronAPI.onOcrResult) {
        window.electronAPI.onOcrResult(({ text }) => { window.lastOcrText = text || ''; });
    }

    window.openManualInput = openManualInput;
    window.submitManualQuestion = submitManualQuestion;
    window.dockComposer = dockComposer;
    window.undockComposer = undockComposer;
})();
