// renderer/chatHistory.js
// Chat History Management Module
var historyState = { loadedSessions: [], currentSession: null };

(function() {
    const historyPanel = document.getElementById('history-panel');
    const historyContent = document.getElementById('history-content');
    const historyFilterContainer = document.getElementById('history-filter-container');
    const historyFilterInput = document.getElementById('history-filter-input');
    const historySearchBtn = document.getElementById('history-search-btn');
    const newChatBtn = document.getElementById('new-chat-btn');
    const conversationViewer = document.getElementById('conversation-viewer');
    const transcriptionElement = document.getElementById('transcription');

    let historySearchQuery = '';
    let isMouseOverHistory = false;
    let lastMouseX = -1;
    let lastMouseY = -1;

    window.addEventListener('mousemove', (e) => {
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    }, { passive: true, capture: true });

    if (historyPanel) {
        historyPanel.addEventListener('mouseenter', () => { isMouseOverHistory = true; }, true);
        historyPanel.addEventListener('mouseleave', () => { isMouseOverHistory = false; }, true);
        historyPanel.addEventListener('mouseover', () => { isMouseOverHistory = true; }, true);
        historyPanel.addEventListener('mouseout', (e) => {
            if (!historyPanel.contains(e.relatedTarget)) {
                isMouseOverHistory = false;
            }
        }, true);
    }
    if (historyContent) {
        historyContent.addEventListener('mouseenter', () => { isMouseOverHistory = true; }, true);
        historyContent.addEventListener('mouseleave', () => { isMouseOverHistory = false; }, true);
        historyContent.addEventListener('mouseover', () => { isMouseOverHistory = true; }, true);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function highlightMatch(title, query) {
        if (!query) return escapeHtml(title);
        const escapedTitle = escapeHtml(title);
        const lowerTitle = escapedTitle.toLowerCase();
        const lowerQuery = escapeHtml(query).toLowerCase();
        let result = '';
        let start = 0;
        let idx = lowerTitle.indexOf(lowerQuery, start);
        if (idx === -1) return escapedTitle;

        while (idx !== -1) {
            result += escapedTitle.substring(start, idx);
            result += `<mark class="history-search-highlight">${escapedTitle.substring(idx, idx + lowerQuery.length)}</mark>`;
            start = idx + lowerQuery.length;
            idx = lowerTitle.indexOf(lowerQuery, start);
        }
        result += escapedTitle.substring(start);
        return result;
    }

    function safeTitle(text) {
        if (!text || typeof text !== 'string') return 'Sem título';
        return text.replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    function renderHistoryList(sessions) {
        if (!historyContent) return;
        historyContent.innerHTML = '';

        const allSessions = sessions || historyState.loadedSessions || [];
        const query = historySearchQuery.trim().toLowerCase();
        const displaySessions = query
            ? allSessions.filter(s => s && s.title && s.title.toLowerCase().includes(query))
            : allSessions;

        if (!displaySessions || displaySessions.length === 0) {
            if (query) {
                historyContent.innerHTML = `<p style="color: #888; font-size: 11px; padding: 6px 8px; font-style: italic;">Nenhuma conversa encontrada</p>`;
            } else {
                historyContent.innerHTML = '<p style="color: #888; font-size: 9px;">Nenhuma conversa ainda</p>';
            }
            return;
        }

        displaySessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'panel-item';
            if (session.id === historyState.currentSessionId) item.classList.add('active');

            const titleSpan = document.createElement('span');
            titleSpan.className = 'panel-item-title';
            if (query) {
                titleSpan.innerHTML = highlightMatch(session.title, historySearchQuery.trim());
            } else {
                titleSpan.textContent = session.title;
            }
            titleSpan.addEventListener('click', () => loadSessionIntoChat(session.id));

            const actions = document.createElement('div');
            actions.className = 'panel-item-actions';

            const renameBtn = document.createElement('button');
            renameBtn.className = 'panel-item-action panel-item-rename';
            renameBtn.title = 'Renomear conversa';
            renameBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (item.querySelector('.panel-item-rename-input')) return;

                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'panel-item-rename-input';
                input.value = session.title;

                let saved = false;

                const finishRename = async () => {
                    if (saved) return;
                    saved = true;

                    const newTitle = input.value.trim();
                    if (newTitle && newTitle !== session.title) {
                        session.title = newTitle;
                        const sessionInList = historyState.loadedSessions.find(s => s.id === session.id);
                        if (sessionInList) sessionInList.title = newTitle;
                        try {
                            await window.electronAPI.renameSession(session.id, newTitle);
                        } catch (err) {
                            console.error('Erro ao renomear sessão:', err);
                        }
                    }
                    renderHistoryList(historyState.loadedSessions);
                };

                input.addEventListener('click', (ev) => ev.stopPropagation());
                input.addEventListener('keydown', async (ev) => {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        await finishRename();
                    } else if (ev.key === 'Escape') {
                        ev.preventDefault();
                        ev.stopPropagation();
                        saved = true;
                        renderHistoryList(historyState.loadedSessions);
                    }
                });

                input.addEventListener('blur', async () => {
                    await finishRename();
                });

                item.replaceChild(input, titleSpan);
                actions.style.display = 'none';
                input.focus();
                input.select();
            });

            const downloadBtn = document.createElement('button');
            downloadBtn.className = 'panel-item-action';
            downloadBtn.title = 'Baixar conversa (.txt)';
            downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            downloadBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const res = await window.electronAPI.downloadConversationTxt(session.id);
                    if (res && res.ok) showToast(`Conversa salva em:\n${res.path}`);
                    else showToast(`Falha ao baixar: ${(res && res.error) || 'erro'}`, 'error');
                } catch (err) { showToast(`Falha ao baixar: ${err.message}`, 'error'); }
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'panel-item-action panel-item-delete';
            deleteBtn.title = 'Deletar conversa';
            deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const result = await window.electronAPI.deleteSession(session.id);
                    if (result.success) {
                        historyState.loadedSessions = historyState.loadedSessions.filter(s => s.id !== session.id);
                        renderHistoryList(historyState.loadedSessions);
                    }
                } catch (error) {
                    console.error('Erro ao deletar conversa:', error);
                }
            });

            actions.appendChild(renameBtn);
            actions.appendChild(downloadBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(titleSpan);
            item.appendChild(actions);
            historyContent.appendChild(item);
        });
    }

    function openHistoryFilter() {
        const hp = document.getElementById('history-panel');
        const hfc = document.getElementById('history-filter-container');
        const hfi = document.getElementById('history-filter-input');

        if (hp && hp.classList.contains('collapsed')) {
            hp.classList.remove('collapsed');
            try { localStorage.setItem('hn-history-panel-collapsed', '0'); } catch (_) {}
        }
        if (hfc) {
            hfc.style.display = 'block';
        }
        if (hfi) {
            hfi.value = historySearchQuery || '';
            hfi.focus();
            hfi.select();
            setTimeout(() => {
                hfi.focus();
                hfi.select();
            }, 50);
        }
    }

    function closeHistoryFilter() {
        const hfc = document.getElementById('history-filter-container');
        const hfi = document.getElementById('history-filter-input');

        if (hfc) {
            hfc.style.display = 'none';
        }
        if (hfi) {
            hfi.value = '';
            hfi.blur();
        }
        historySearchQuery = '';
        renderHistoryList(historyState.loadedSessions);
    }

    function isPointInside(el, x, y) {
        if (!el || x < 0 || y < 0) return false;
        try {
            const r = el.getBoundingClientRect();
            return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        } catch (_) {
            return false;
        }
    }

    function isHistoryTargetedForSearch(e) {
        const hp = document.getElementById('history-panel');
        const hc = document.getElementById('history-content');
        const hfi = document.getElementById('history-filter-input');
        const hfc = document.getElementById('history-filter-container');

        // 1. Campo de busca já aberto ou focado
        if (hfi && (document.activeElement === hfi || (hfc && hfc.style.display !== 'none' && hfc.style.display !== ''))) {
            return true;
        }

        // 2. Foco atual ou alvo do evento dentro do painel
        if (e && e.target && hp && hp.contains(e.target)) {
            return true;
        }
        if (document.activeElement && hp && hp.contains(document.activeElement)) {
            return true;
        }

        // 3. Flag de hover ativa
        if (isMouseOverHistory) {
            return true;
        }

        // 4. Coordenadas do mouse
        if (lastMouseX >= 0 && lastMouseY >= 0) {
            if (hp && isPointInside(hp, lastMouseX, lastMouseY)) return true;
            if (hc && isPointInside(hc, lastMouseX, lastMouseY)) return true;
            try {
                const elUnder = document.elementFromPoint(lastMouseX, lastMouseY);
                if (elUnder && hp && hp.contains(elUnder)) return true;
            } catch (_) {}
        }

        // 5. Fallback seletores :hover
        try {
            if (hp && (hp.matches(':hover') || hp.querySelector(':hover'))) return true;
            if (hc && (hc.matches(':hover') || hc.querySelector(':hover'))) return true;
        } catch (_) {}

        return false;
    }

    if (historyFilterInput) {
        historyFilterInput.addEventListener('input', () => {
            historySearchQuery = historyFilterInput.value;
            renderHistoryList(historyState.loadedSessions);
        });

        historyFilterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();
                closeHistoryFilter();
            } else if (e.key === 'Enter') {
                e.stopPropagation();
                e.preventDefault();
                const query = historySearchQuery.trim().toLowerCase();
                const allSessions = historyState.loadedSessions || [];
                const displaySessions = query
                    ? allSessions.filter(s => s && s.title && s.title.toLowerCase().includes(query))
                    : allSessions;
                if (displaySessions.length > 0) {
                    loadSessionIntoChat(displaySessions[0].id);
                }
            }
        });
    }

    if (historySearchBtn) {
        historySearchBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (historyFilterContainer && historyFilterContainer.style.display !== 'none') {
                closeHistoryFilter();
            } else {
                openHistoryFilter();
            }
        });
    }

    function prependSessionInUI(session) {
        if (!session) return;

        const withoutCurrent = historyState.loadedSessions.filter(s => s.id !== session.id);
        historyState.loadedSessions = [
            { id: session.id, title: session.title, created: session.created },
            ...withoutCurrent
        ];

        renderHistoryList(historyState.loadedSessions);
    }

    async function ensureSessionForFirstQuestion(questionText) {
        if (historyState.currentSessionId) return historyState.currentSessionId;

        const newSession = await window.electronAPI.createNewSession(safeTitle(questionText));
        if (!newSession || !newSession.id) return null;

        historyState.currentSessionId = newSession.id;
        prependSessionInUI(newSession);
        return historyState.currentSessionId;
    }

    async function addMessageToCurrentSession(role, content) {
        if (!historyState.currentSessionId || !content) return;
        try {
            const result = await window.electronAPI.addMessage(historyState.currentSessionId, role, content);
            if (result && result.sessionId && result.sessionId !== historyState.currentSessionId) {
                historyState.currentSessionId = result.sessionId;
            }
        } catch (error) {
            console.error('Erro ao salvar mensagem no histórico:', error);
        }
    }

    window.historySession = {
        ensureSessionForFirstQuestion,
        addMessageToCurrentSession,
        getCurrentSessionId: () => historyState.currentSessionId,
        reset: () => {
            historyState.currentSessionId = null;
        }
    };

    async function loadHistory() {
        try {
            const sessions = window.electronAPI.getAllSessions
                ? await window.electronAPI.getAllSessions()
                : await window.electronAPI.getLastThreeSessions();
            historyState.loadedSessions = Array.isArray(sessions) ? sessions : [];
            renderHistoryList(historyState.loadedSessions);
        } catch (error) {
            console.error('Erro ao carregar histórico:', error);
        }
    }

    async function loadSessionIntoChat(sessionId) {
        try {
            const session = await window.electronAPI.getSessionById(sessionId);
            if (!session || !Array.isArray(session.conversations)) return;

            const transcriptionElement = document.getElementById('transcription');
            if (typeof manualInputActive !== 'undefined') manualInputActive = false;
            if (typeof removeManualInputContainer === 'function') removeManualInputContainer();
            if (transcriptionElement) transcriptionElement.innerHTML = '';
            const hero = document.getElementById('welcome-hero');
            if (hero) hero.classList.add('hidden');

            let currentBlock = null;
            session.conversations.forEach(msg => {
                if (!msg || !msg.content) return;
                if (msg.role === 'user') {
                    currentBlock = document.createElement('div');
                    currentBlock.className = 'interaction-block';
                    const q = document.createElement('span');
                    q.className = 'question-text';
                    if (typeof window.setQuestionText === 'function') window.setQuestionText(q, msg.content);
                    if (typeof window.wireQuestionEdit === 'function') window.wireQuestionEdit(q);
                    currentBlock.appendChild(q);
                    if (typeof window.createBlockActions === 'function') {
                        currentBlock.appendChild(window.createBlockActions(transcriptionElement));
                    }
                    if (transcriptionElement) transcriptionElement.appendChild(currentBlock);
                } else {
                    if (!currentBlock) {
                        currentBlock = document.createElement('div');
                        currentBlock.className = 'interaction-block';
                        if (typeof window.createBlockActions === 'function') {
                            currentBlock.appendChild(window.createBlockActions(transcriptionElement));
                        }
                        if (transcriptionElement) transcriptionElement.appendChild(currentBlock);
                    }
                    let resp = currentBlock.querySelector('.ia-response');
                    if (!resp) {
                        resp = document.createElement('div');
                        resp.className = 'ia-response';
                        currentBlock.appendChild(resp);
                    }
                    const rawContent = (resp.dataset.rawContent ? resp.dataset.rawContent + '\n' : '') + msg.content;
                    resp.dataset.rawContent = rawContent;
                    const formatted = typeof window.renderMarkdown === 'function' ? window.renderMarkdown(rawContent) : rawContent;
                    resp.innerHTML = formatted;
                }
            });

            historyState.currentSessionId = sessionId;
            renderHistoryList(historyState.loadedSessions);
            const cab = document.getElementById('copy-all-btn');
            if (cab) cab.style.display = '';

            if (window.electronAPI.seedAiSession) {
                try { await window.electronAPI.seedAiSession(session.conversations); } catch (_) {}
            }
            if (typeof window.scrollTranscriptionToBottom === 'function') window.scrollTranscriptionToBottom('auto');
            showToast('Conversa restaurada — pode continuar daqui.');
        } catch (error) {
            console.error('Erro ao restaurar conversa:', error);
        }
    }

    if (newChatBtn) {
        newChatBtn.addEventListener('click', async () => {
            try {
                if (transcriptionElement) transcriptionElement.innerHTML = '';
                const cabReset = document.getElementById('copy-all-btn');
                if (cabReset) cabReset.style.display = 'none';
                const hero = document.getElementById('welcome-hero');
                if (hero) hero.classList.remove('hidden');
                const greeting = document.getElementById('greeting');
                if (greeting) greeting.style.display = 'block';

                historyState.currentSessionId = null;
                window.historySession.reset();

                if (typeof streamingElement !== 'undefined') streamingElement = null;
                if (typeof streamingText !== 'undefined') streamingText = '';
                if (typeof typingCursor !== 'undefined') typingCursor = null;

                if (typeof manualInputActive !== 'undefined') manualInputActive = false;
                window.isEditingQuestion = false;
                window.currentQuestionElement = null;

                if (conversationViewer) conversationViewer.style.display = 'none';
                if (typeof removeManualInputContainer === 'function') removeManualInputContainer();

                if (typeof window.stopProcessing === 'function') window.stopProcessing();

                window.electronAPI.clearAiSessions();

                console.log('✓ Novo chat iniciado: UI limpa e sessões resetadas');
                showToast('Nova conversa iniciada');
            } catch (error) {
                console.error('Erro ao criar novo chat:', error);
            }
        });
    }

    if (transcriptionElement) {
        transcriptionElement.addEventListener('click', (event) => {
            const button = event.target.closest('.copy-button');
            if (button) {
                const preElement = button.closest('pre');
                if (!preElement) return;

                const clonePre = preElement.cloneNode(true);
                const btnClone = clonePre.querySelector('.copy-button');
                if (btnClone) clonePre.removeChild(btnClone);

                const textToCopy = clonePre.innerText.trim();
                if (typeof copyTextReliable === 'function') copyTextReliable(textToCopy);
                if (typeof showCopyToast === 'function') showCopyToast();
                button.classList.remove('copy-error');
                button.classList.add('copied');
                setTimeout(() => { button.classList.remove('copied'); }, 1200);
                return;
            }

            const inlineCode = event.target.closest('.inline-code');
            if (inlineCode) {
                const textToCopy = inlineCode.textContent.trim();
                if (typeof copyTextReliable === 'function') copyTextReliable(textToCopy);
                if (typeof showCopyToast === 'function') showCopyToast();
            }
        });
    }

    window.loadHistory = loadHistory;
    window.renderHistoryList = renderHistoryList;
    window.loadSessionIntoChat = loadSessionIntoChat;
    window.openHistoryFilter = openHistoryFilter;
    window.closeHistoryFilter = closeHistoryFilter;
    window.isHistoryTargetedForSearch = isHistoryTargetedForSearch;
})();
