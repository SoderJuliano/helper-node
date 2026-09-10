// Realtime segment-based Assistant Bubble Manager
var rtSegments = {};

(function() {
    const transcriptionElement = document.getElementById('transcription');
    let isListeningState = true;

    function updateRealtimeStatus(status, customMsg) {
        const existing = document.getElementById('rt-status-banner');
        if (existing && existing.parentNode) {
            existing.parentNode.removeChild(existing);
        }
    }

    // ===== Realtime segment-based bubble manager =====
    // Cada segmento tem 1 bolha de usuário + 1 bolha de assistente.
    // A transcrição chega pronta (Whisper local ou OpenAI) e preenche a bolha.
    const rtSegments = new Map(); // id -> { userBubble, userText, userBadge, assistantBubble, assistantText, assistantBadge }

    function scrollFeed() {
        transcriptionElement.scrollTo({ top: transcriptionElement.scrollHeight, behavior: 'smooth' });
    }

    function ensureSegmentBubbles(segmentId, iteration) {
        if (rtSegments.has(segmentId)) return rtSegments.get(segmentId);

        const feed = getOrCreateRealtimeFeed();

        // Bolha do usuário (transcrição)
        const userBubble = document.createElement('div');
        userBubble.className = 'rt-bubble user';
        userBubble.dataset.segmentId = segmentId;
        userBubble.style.padding = '8px 12px';
        userBubble.style.overflow = 'visible';

        const userHeader = document.createElement('div');
        userHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:11px;color:rgba(144,202,249,0.85);margin-bottom:4px;font-weight:500;';
        const userLabel = document.createElement('span');
        userLabel.textContent = `Trecho #${iteration || '?'}`;
        const userBadge = document.createElement('span');
        userBadge.className = 'rt-badge';
        userBadge.style.cssText = 'font-size:10px;opacity:0.75;font-style:italic;';
        userBadge.textContent = 'ouvindo…';
        userHeader.appendChild(userLabel);
        userHeader.appendChild(userBadge);

        const userText = document.createElement('div');
        userText.style.cssText = 'font-size:12.5px;color:rgba(220,235,255,0.92);white-space:pre-wrap;line-height:1.5;';
        userText.textContent = '';

        userBubble.appendChild(userHeader);
        userBubble.appendChild(userText);
        feed.appendChild(userBubble);

        // Bolha do assistente (resposta)
        const assistantBubble = document.createElement('div');
        assistantBubble.className = 'rt-bubble assistant';
        assistantBubble.dataset.segmentId = segmentId;

        const assistantBadge = document.createElement('div');
        assistantBadge.className = 'rt-badge';
        assistantBadge.style.cssText = 'font-size:10px;opacity:0.7;font-style:italic;margin-bottom:4px;color:rgba(180,255,180,0.85);';
        assistantBadge.textContent = 'processando IA…';

        const assistantText = document.createElement('div');
        assistantText.className = 'rt-assistant-text';
        assistantText.style.cssText = 'font-size:13px;white-space:pre-wrap;line-height:1.55;';
        assistantText.textContent = '';

        assistantBubble.appendChild(assistantBadge);
        assistantBubble.appendChild(assistantText);
        feed.appendChild(assistantBubble);

        const entry = { userBubble, userText, userBadge, assistantBubble, assistantText, assistantBadge };
        rtSegments.set(segmentId, entry);
        scrollFeed();
        return entry;
    }

    const composerEl = document.getElementById('composer');
    const composerToggleBtn = document.getElementById('composer-collapse-toggle');
    let _realtimeComposerHidden = false;

    function setComposerCollapsed(collapsed) {
        if (!composerEl) return;
        if (collapsed) {
            composerEl.classList.add('collapsed');
            if (composerToggleBtn) {
                composerToggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polyline points="18 15 12 9 6 15"/></svg> <span style="font-size: 11px; margin-left: 6px; font-family: var(--font-ui);">Mostrar Input (Ctrl+I)</span>`;
            }
        } else {
            composerEl.classList.remove('collapsed');
            if (composerToggleBtn) {
                composerToggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px;"><polyline points="6 9 12 15 18 9"/></svg>`;
            }
        }
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 50);
    }

    function setComposerVisibility(show) {
        if (!composerEl) return;
        setComposerCollapsed(!show);
        _realtimeComposerHidden = !show;
    }

    if (composerToggleBtn) {
        composerToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isCollapsed = composerEl.classList.contains('collapsed');
            setComposerVisibility(isCollapsed);
        });
    }

    if (window.electronAPI && window.electronAPI.onToggleRecording) {
        window.electronAPI.onToggleRecording((event, data) => {
            if (!data) return;
            if (data.isRealtimeAssistant) {
                isListeningState = !!data.isRecording;
                updateRealtimeStatus(isListeningState ? 'listening' : 'paused');
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onRealtimeAssistantUpdate) {
        window.electronAPI.onRealtimeAssistantUpdate((payload) => {
            if (!payload || !payload.type) return;

            switch (payload.type) {
                case 'state':
                    if (payload.state === 'started') {
                        isListeningState = true;
                        setComposerVisibility(false);
                        const hero = document.getElementById('welcome-hero');
                        if (hero) hero.classList.add('hidden');
                        updateRealtimeStatus('listening');
                    }
                    else if (payload.state === 'stopped') {
                        isListeningState = false;
                        setComposerVisibility(true);
                        updateRealtimeStatus('paused');
                    }
                    appendRealtimeBubble('system', payload.message || 'Atualização do modo em tempo real');
                    return;

                case 'error':
                    updateRealtimeStatus('error', payload.message);
                    appendRealtimeBubble('system', payload.message || 'Erro no assistente em tempo real.');
                    return;

                case 'fatal_error':
                    updateRealtimeStatus('error', payload.message);
                    appendRealtimeBubble('fatal-error', payload.message || 'Erro fatal: assistente desligado.');
                    return;

                case 'segment_start': {
                    if (isListeningState) updateRealtimeStatus('speaking', 'Detectando fala...');
                    ensureSegmentBubbles(payload.id, payload.iteration);
                    return;
                }

                case 'segment_discard': {
                    if (isListeningState) updateRealtimeStatus('listening');
                    const seg = rtSegments.get(payload.id);
                    if (seg) {
                        if (seg.userBubble && seg.userBubble.parentNode) seg.userBubble.parentNode.removeChild(seg.userBubble);
                        if (seg.assistantBubble && seg.assistantBubble.parentNode) seg.assistantBubble.parentNode.removeChild(seg.assistantBubble);
                        rtSegments.delete(payload.id);
                    }
                    return;
                }

                case 'segment_partial': {
                    const isMic = (payload.audioSource === 'mic');
                    if (isListeningState) updateRealtimeStatus('speaking', isMic ? 'Você falando...' : 'Interlocutor falando...');
                    const seg = ensureSegmentBubbles(payload.id, payload.iteration);
                    seg.userText.textContent = payload.text || '';
                    seg.userBadge.textContent = 'ouvindo (preview)…';
                    scrollFeed();
                    return;
                }

                case 'segment_whisper_correction': {
                    // Texto definitivo da transcrição (Whisper local ou OpenAI)
                    if (isListeningState) updateRealtimeStatus('thinking', 'Processando com IA...');
                    const seg = rtSegments.get(payload.id) || ensureSegmentBubbles(payload.id, payload.iteration);
                    seg.userText.textContent = payload.text || '';
                    seg.userBadge.textContent = 'transcrito';
                    seg.userBadge.style.color = 'rgba(180,255,180,0.9)';
                    if (payload.noSuggestion) {
                        seg.userBadge.textContent = 'você falou';
                        seg.assistantBubble.style.display = 'none';
                        if (isListeningState) updateRealtimeStatus('listening');
                    } else {
                        seg.assistantBadge.textContent = 'processando IA…';
                    }
                    scrollFeed();
                    return;
                }

                case 'segment_response': {
                    if (isListeningState) updateRealtimeStatus('listening');
                    const seg = rtSegments.get(payload.id) || ensureSegmentBubbles(payload.id, payload.iteration);
                    if (typeof formatOpenAIResponse === 'function') {
                        seg.assistantText.innerHTML = formatOpenAIResponse(payload.response || '');
                    } else {
                        seg.assistantText.textContent = payload.response || '';
                    }
                    seg.assistantBadge.textContent = 'resposta IA';
                    seg.assistantBadge.style.color = 'rgba(180,255,180,0.9)';
                    scrollFeed();
                    return;
                }

                case 'segment_response_corrected': {
                    const seg = rtSegments.get(payload.id);
                    if (!seg) return;
                    if (typeof formatOpenAIResponse === 'function') {
                        seg.assistantText.innerHTML = formatOpenAIResponse(payload.response || '');
                    } else {
                        seg.assistantText.textContent = payload.response || '';
                    }
                    seg.assistantBadge.textContent = 'resposta IA';
                    seg.assistantBadge.style.color = 'rgba(180,255,180,0.9)';
                    return;
                }

                case 'segment_error': {
                    updateRealtimeStatus('error', payload.message || 'erro processando segmento');
                    const seg = rtSegments.get(payload.id);
                    if (seg) {
                        seg.assistantText.textContent = (payload.message || 'erro processando segmento');
                        seg.assistantBadge.textContent = 'erro';
                        seg.assistantBadge.style.color = '#ff8a80';
                    } else {
                        appendRealtimeBubble('system', (payload.message || 'erro de segmento'));
                    }
                    return;
                }
            }
        });
    }

    // Expose
    window.ensureSegmentBubbles = ensureSegmentBubbles;
    window.setComposerVisibility = setComposerVisibility;
    window.updateRealtimeStatus = updateRealtimeStatus;
    window.composerEl = composerEl;
})();
