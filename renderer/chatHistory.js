// Chat History Management Module
var historyState = { loadedSessions: [], currentSession: null };

(function() {
    const historyContent = document.getElementById('history-content');
    const newChatBtn = document.getElementById('new-chat-btn');
    const conversationViewer = document.getElementById('conversation-viewer');
    const conversationContent = document.getElementById('conversation-content');
    const conversationCloseBtn = document.getElementById('conversation-close-btn');
    const conversationDownloadBtn = document.getElementById('conversation-download-btn');
    const transcriptionElement = document.getElementById('transcription');

            function safeTitle(text) {
                if (!text || typeof text !== 'string') return 'Sem título';
                return text.replace(/\s+/g, ' ').trim().slice(0, 80);
            }

            function renderHistoryList(sessions) {
                historyContent.innerHTML = '';

                if (!sessions || sessions.length === 0) {
                    historyContent.innerHTML = '<p style="color: #888; font-size: 9px;">Nenhuma conversa ainda</p>';
                    return;
                }

                sessions.forEach(session => {
                    const item = document.createElement('div');
                    item.className = 'panel-item';
                    if (session.id === historyState.currentSessionId) item.classList.add('active');

                    const titleSpan = document.createElement('span');
                    titleSpan.className = 'panel-item-title';
                    titleSpan.textContent = session.title;
                    // Clicar restaura a conversa DENTRO do chat (não em modal) e
                    // continua a sessão, com o contexto recarregado na IA.
                    titleSpan.addEventListener('click', () => loadSessionIntoChat(session.id));

                    // Ações: baixar (.txt) + deletar, lado a lado.
                    const actions = document.createElement('div');
                    actions.className = 'panel-item-actions';

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

                    actions.appendChild(downloadBtn);
                    actions.appendChild(deleteBtn);
                    item.appendChild(titleSpan);
                    item.appendChild(actions);
                    historyContent.appendChild(item);
                });
            }

            function prependSessionInUI(session) {
                if (!session) return;

                const withoutCurrent = historyState.loadedSessions.filter(s => s.id !== session.id);
                // Sem limite de 3: a sidebar mostra todas as conversas (com rolagem).
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
                    // Se a sessão foi deletada e recriada automaticamente, atualiza o ID local
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

            // Carregar histórico do backend (TODAS as conversas)
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

            // Restaura uma conversa DENTRO do chat (recupera a sessão) e recarrega
            // o contexto na IA, pra continuar de onde parou.
            async function loadSessionIntoChat(sessionId) {
                try {
                    const session = await window.electronAPI.getSessionById(sessionId);
                    if (!session || !Array.isArray(session.conversations)) return;

                    const transcriptionElement = document.getElementById('transcription');
                    manualInputActive = false;
                    removeManualInputContainer();
                    transcriptionElement.innerHTML = '';
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
                            setQuestionText(q, msg.content);
                            wireQuestionEdit(q);
                            currentBlock.appendChild(q);
                            currentBlock.appendChild(createBlockActions(transcriptionElement));
                            transcriptionElement.appendChild(currentBlock);
                        } else {
                            if (!currentBlock) {
                                currentBlock = document.createElement('div');
                                currentBlock.className = 'interaction-block';
                                currentBlock.appendChild(createBlockActions(transcriptionElement));
                                transcriptionElement.appendChild(currentBlock);
                            }
                            let resp = currentBlock.querySelector('.ia-response');
                            if (!resp) {
                                resp = document.createElement('div');
                                resp.className = 'ia-response';
                                currentBlock.appendChild(resp);
                            }
                            resp.innerText = (resp.innerText ? resp.innerText + '\n' : '') + msg.content;
                        }
                    });

                    historyState.currentSessionId = sessionId;
                    renderHistoryList(historyState.loadedSessions); // re-marca o item ativo
                    const cab = document.getElementById('copy-all-btn');
                    if (cab) cab.style.display = '';

                    // Recarrega o contexto na IA pra continuar a conversa
                    if (window.electronAPI.seedAiSession) {
                        try { await window.electronAPI.seedAiSession(session.conversations); } catch (_) {}
                    }
                    scrollTranscriptionToBottom('auto');
                    showToast('Conversa restaurada — pode continuar daqui.');
                } catch (error) {
                    console.error('Erro ao restaurar conversa:', error);
                }
            }

            // Visualizar conversação completa
            async function viewConversation(sessionId) {
                try {
                    const session = await window.electronAPI.getSessionById(sessionId);
                    if (!session) return;

                    conversationContent.innerHTML = '';
                    session.conversations.forEach(msg => {
                        const msgDiv = document.createElement('div');
                        msgDiv.className = `conversation-message ${msg.role}`;
                        msgDiv.innerHTML = `
                            <div class="conversation-message-label">${msg.role === 'user' ? 'P:' : 'R:'}</div>
                            <div class="conversation-message-content">${msg.content}</div>
                        `;
                        conversationContent.appendChild(msgDiv);
                    });

                    conversationViewer.dataset.sessionId = sessionId;
                    conversationViewer.style.display = 'block';
                } catch (error) {
                    console.error('Erro ao visualizar conversa:', error);
                }
            }

            // Fechar visualizador
            conversationCloseBtn.addEventListener('click', () => {
                conversationViewer.style.display = 'none';
            });
 // History management (safeTitle, renderHistoryList, loadHistory, etc.)

            // ========== Toast in-app + Download da conversa ==========
            const appToast = document.getElementById('app-toast');
            let toastTimer = null;
            function showToast(text, kind) {
                appToast.textContent = text;
                appToast.classList.toggle('error', kind === 'error');
                appToast.classList.add('show');
                if (toastTimer) clearTimeout(toastTimer);
                toastTimer = setTimeout(() => {
                    appToast.classList.remove('show');
                }, 5000);
            }
            window.showToast = showToast;

            conversationDownloadBtn.addEventListener('click', async () => {
                const sid = conversationViewer.dataset.sessionId;
                if (!sid) {
                    showToast('Nenhuma conversa aberta pra baixar.', 'error');
                    return;
                }
                conversationDownloadBtn.disabled = true;
                try {
                    const res = await window.electronAPI.downloadConversationTxt(sid);
                    if (res && res.ok) {
                        showToast(`Conversa salva em:\n${res.path}`);
                    } else {
                        showToast(`Falha ao baixar: ${(res && res.error) || 'erro desconhecido'}`, 'error');
                    }
                } catch (e) {
                    showToast(`Falha ao baixar: ${e.message}`, 'error');
                } finally {
                    conversationDownloadBtn.disabled = false;
                }
            });

            // Novo chat
            newChatBtn.addEventListener('click', async () => {
                try {
                    // Limpa a UI
                    transcriptionElement.innerHTML = '';
                    const cabReset = document.getElementById('copy-all-btn');
                    if (cabReset) cabReset.style.display = 'none';
                    const hero = document.getElementById('welcome-hero');
                    if (hero) hero.classList.remove('hidden');
                    greeting.style.display = 'block';
                    
                    // Reseta estado local
                    historyState.currentSessionId = null;
                    window.historySession.reset();
                    
                    // Reseta variáveis de streaming
                    streamingElement = null;
                    streamingText = '';
                    typingCursor = null;

                    // CRÍTICO: reseta flags de estado que travam a UI
                    manualInputActive = false;
                    isEditingQuestion = false;
                    currentQuestionElement = null;

                    // Fecha visualizador se estiver aberto
                    conversationViewer.style.display = 'none';
                    removeManualInputContainer();

                    // Para o robô/loading se estiver rodando
                    stopProcessing();

                    // Notifica o backend para limpar sessões de IA imediatamente
                    window.electronAPI.clearAiSessions();
                    
                    console.log('✓ Novo chat iniciado: UI limpa e sessões resetadas');
                    showToast('Nova conversa iniciada');
                } catch (error) {
                    console.error('Erro ao criar novo chat:', error);
                }
            });

            // Carregar histórico na inicialização é disparado pelo app.js (window.loadHistory)

            function getOrCreateRealtimeFeed() {
                let feed = document.getElementById('rt-assistant-feed');
                if (!feed) {
                    feed = document.createElement('div');
                    feed.id = 'rt-assistant-feed';
                    feed.className = 'rt-assistant-feed';
                    transcriptionElement.appendChild(feed);
                    // Garante que #transcription fique visível: remove is-empty escondendo o hero.
                    const hero = document.getElementById('welcome-hero');
                    if (hero) hero.classList.add('hidden');
                }
                return feed;
            }

            function appendRealtimeBubble(type, text) {
                if (!text) return;
                const feed = getOrCreateRealtimeFeed();
                const bubble = document.createElement('div');
                bubble.className = `rt-bubble ${type}`;

                if (type === 'user') {
                    // Collapsible: header always visible, body hidden by default
                    const lines = text.split('\n');
                    const title = lines[0] || '';
                    const body = lines.slice(1).join('\n').trim();

                    const header = document.createElement('div');
                    header.className = 'rt-bubble-header';
                    header.innerHTML = `<span>${title}</span><span class="rt-bubble-toggle">▼</span>`;

                    const bodyEl = document.createElement('div');
                    bodyEl.className = 'rt-bubble-body';
                    bodyEl.textContent = body;

                    header.addEventListener('click', () => {
                        const isOpen = bodyEl.classList.toggle('open');
                        header.querySelector('.rt-bubble-toggle').classList.toggle('open', isOpen);
                    });

                    bubble.appendChild(header);
                    if (body) bubble.appendChild(bodyEl);
                } else {
                    bubble.textContent = text;
                }

                feed.appendChild(bubble);
                transcriptionElement.scrollTo({
                    top: transcriptionElement.scrollHeight,
                    behavior: 'smooth'
                });
            }
 // Toast, download, new chat click

            // ========== End History Management ==========

            // Centralized event listener for all copy actions
            transcriptionElement.addEventListener('click', (event) => {
                const button = event.target.closest('.copy-button');
                if (button) {
                    const preElement = button.closest('pre');
                    if (!preElement) return;

                    const clonePre = preElement.cloneNode(true);
                    const btnClone = clonePre.querySelector('.copy-button');
                    if (btnClone) clonePre.removeChild(btnClone);

                    const textToCopy = clonePre.innerText.trim();
                    copyTextReliable(textToCopy);
                    showCopyToast();
                    button.classList.remove('copy-error');
                    button.classList.add('copied');
                    setTimeout(() => { button.classList.remove('copied'); }, 1200);
                    return; // Stop further processing
                }

                const inlineCode = event.target.closest('.inline-code');
                if (inlineCode) {
                    const textToCopy = inlineCode.textContent.trim();
                    copyTextReliable(textToCopy);
                    showCopyToast();

                    // Efeito visual temporário (piscar verde)
                    const originalBg = inlineCode.style.backgroundColor;
                    const originalColor = inlineCode.style.color;
                    inlineCode.style.backgroundColor = 'rgba(74, 222, 128, 0.35)'; // Fundo verde transparente
                    inlineCode.style.color = '#4ade80';
                    setTimeout(() => {
                        inlineCode.style.backgroundColor = originalBg;
                        inlineCode.style.color = originalColor;
                    }, 1000);
                    return; // Stop further processing
                }
            });

            // Renderiza tooltip de atalhos dinamicamente.
            // Main decide o que mostrar baseado em SO, DE e configs ativas.
            // Renderer s\u00f3 desenha. Reage a mudan\u00e7as via 'shortcuts-changed'.
            const renderShortcuts = async () => {
                try {
                    const sc = document.getElementById('shortcut-content');
                    if (!sc || typeof window.electronAPI.getAvailableShortcuts !== 'function') return;
                    const data = await window.electronAPI.getAvailableShortcuts();
                    const items = (data && data.items) || [];

                    // Preserva debug-indicator no fim
                    const dbg = document.getElementById('debug-indicator');
                    sc.innerHTML = '';
                    items.forEach(s => {
                        const div = document.createElement('div');
                        div.className = 'command-item';
                        div.id = 'sc-' + s.id;
                        const keysText = s.altKeys ? `${s.keys} / ${s.altKeys}` : s.keys;
                        div.innerHTML = `\u26a1\ufe0e <strong>${keysText}</strong> - ${s.action} ${s.icon || ''}`;
                        sc.appendChild(div);
                    });
                    if (dbg) sc.appendChild(dbg);
                } catch (err) {
                    console.warn('[shortcuts] Falha ao renderizar atalhos:', err);
                }
            };

            renderShortcuts();
            if (typeof window.electronAPI.onShortcutsChanged === 'function') {
                window.electronAPI.onShortcutsChanged(renderShortcuts);
            }

        setTimeout(() => {
            greeting.classList.add('hidden');
        }, 3000);

        // Esconder o "Olá amigo" ao clicar e, em áreas livres da tela,
        // abrir input manual (atalho equivalente ao Ctrl+I).
        const greeting = document.getElementById('greeting');
        document.body.addEventListener('click', (event) => {
            greeting.classList.add('hidden');

            // NÃO escondemos mais o hero a cada clique: isso fazia o composer
            // centralizado "pular" pro rodapé só de clicar na tela. O hero (e o
            // dock do composer) só saem quando uma pergunta é realmente enviada
            // (appendQuestionEntry cuida disso).

            const interactive = event.target.closest(
                'button, a, input, textarea, .edit-container, .copy-button, .block-action-btn, .block-actions-toggle, .block-actions-close, .panel, #conversation-viewer, #composer, #sidebar, .hero-chip'
            );
            if (interactive) return;
            if (manualInputActive || isEditingQuestion) return;
            if (document.getElementById('conversation-viewer').style.display !== 'none') return;
            openManualInput();
        });

    // Expose
    window.loadHistory = loadHistory;
    window.loadSessionIntoChat = loadSessionIntoChat;
    window.prependSessionInUI = prependSessionInUI;
    window.addMessageToCurrentSession = addMessageToCurrentSession;
    window.ensureSessionForFirstQuestion = ensureSessionForFirstQuestion;
    // Usados por outros módulos (IIFEs separadas).
    window.renderShortcuts = renderShortcuts;
    window.getOrCreateRealtimeFeed = getOrCreateRealtimeFeed;
    window.appendRealtimeBubble = appendRealtimeBubble;
})();
