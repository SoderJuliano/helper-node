// renderer/liveAssistant.js
// Live Assistant, Audio Feedback & Panel Controls Module
(function() {
    const animationContainer = document.getElementById('animation-container');
    const shortcutPanel = document.getElementById('shortcut-panel');
    const shortcutToggle = document.getElementById('shortcut-toggle');
    const shortcutHeader = document.getElementById('shortcut-header');
    const historyPanel = document.getElementById('history-panel');
    const historyToggle = document.getElementById('history-toggle');
    const historyHeader = document.getElementById('history-header');

    function setPanelCollapsed(panel, collapsed) {
        if (!panel) return;
        panel.classList.toggle('collapsed', collapsed);
        try {
            if (panel.id) {
                localStorage.setItem(`hn-${panel.id}-collapsed`, collapsed ? '1' : '0');
            }
        } catch (_) {}
    }

    function togglePanel(panel) {
        if (!panel) return;
        const willCollapse = !panel.classList.contains('collapsed');
        setPanelCollapsed(panel, willCollapse);
    }

    if (shortcutHeader) {
        shortcutHeader.addEventListener('click', (event) => {
            event.stopPropagation();
            togglePanel(shortcutPanel);
        });
    }

    if (historyHeader) {
        historyHeader.addEventListener('click', (event) => {
            event.stopPropagation();
            const wasCollapsed = historyPanel.classList.contains('collapsed');
            togglePanel(historyPanel);
            if (wasCollapsed && typeof window.loadHistory === 'function') {
                try { window.loadHistory(); } catch (_) {}
            }
        });
    }

    // Restaura o estado salvo dos painéis
    if (shortcutPanel) {
        let saved = true;
        try {
            const val = localStorage.getItem('hn-shortcut-panel-collapsed');
            if (val !== null) saved = val === '1';
        } catch (_) {}
        setPanelCollapsed(shortcutPanel, saved);
    }

    if (historyPanel) {
        let saved = false;
        try {
            const val = localStorage.getItem('hn-history-panel-collapsed');
            if (val !== null) saved = val === '1';
        } catch (_) {}
        setPanelCollapsed(historyPanel, saved);
    }

    window.togglePanel = togglePanel;
    window.setPanelCollapsed = setPanelCollapsed;

    function loadAnimation() {
        if (!animationContainer) return;
        fetch('assets/loading.json')
            .then(response => response.json())
            .then(animationData => {
                window.animation = lottie.loadAnimation({
                    container: animationContainer,
                    renderer: 'svg',
                    loop: true,
                    autoplay: false,
                    animationData: animationData
                });
                animationContainer.style.display = 'none';
            })
            .catch(error => console.error('Erro ao carregar animação:', error));
    }

    function updateListeningIndicator(isRecording, isTranscribing) {
        const listeningEl = document.getElementById('composer-listening');
        const textEl = document.getElementById('composer-listening-text');
        const robot = document.getElementById('robot');

        if (listeningEl) {
            if (isRecording) {
                listeningEl.style.display = 'flex';
                listeningEl.classList.remove('transcribing');
                if (textEl) textEl.textContent = 'Ouvindo áudio… Ctrl+D para transcrever';
                if (robot) robot.style.display = 'none';
            } else if (isTranscribing) {
                listeningEl.style.display = 'flex';
                listeningEl.classList.add('transcribing');
                if (textEl) textEl.textContent = 'Transcrevendo áudio… aguarde um instante';
                if (robot) robot.style.display = 'block';
            } else {
                listeningEl.style.display = 'none';
                listeningEl.classList.remove('transcribing');
                if (robot && !window._iaStreamingActive) robot.style.display = 'none';
            }
        }
    }

    if (window.electronAPI && window.electronAPI.onToggleRecording) {
        window.electronAPI.onToggleRecording((event, data) => {
            if (!data) return;
            if (!data.isRealtimeAssistant) {
                toggleAnimation(data.isRecording);
            } else if (!data.isRecording) {
                toggleAnimation(false);
            }

            if (data.isRecording) {
                const hero = document.getElementById('welcome-hero');
                if (hero) hero.classList.add('hidden');
            }

            if (data.isIdeMode) {
                updateListeningIndicator(!!data.isRecording, !!data.isTranscribing);
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onIdeAudioTranscribing) {
        window.electronAPI.onIdeAudioTranscribing((data) => {
            const isTranscribing = !!(data && data.isTranscribing);
            updateListeningIndicator(false, isTranscribing);
        });
    }

    if (window.electronAPI && window.electronAPI.onIdeAudioTranscribed) {
        window.electronAPI.onIdeAudioTranscribed((text) => {
            updateListeningIndicator(false, false);
            if (!text || !text.trim() || text === '[BLANK_AUDIO]') {
                if (typeof showToast === 'function') showToast('Nenhum áudio detectado.');
                return;
            }
            if (typeof openManualInput === 'function') {
                openManualInput(text);
            }
        });
    }

    if (window.electronAPI && window.electronAPI.onTranscriptionError) {
        window.electronAPI.onTranscriptionError((err) => {
            updateListeningIndicator(false, false);
            if (err && typeof showToast === 'function') showToast(err);
        });
    }

    function toggleAnimation(shouldPlay) {
        const animation = window.animation;
        if (!animation) {
            console.error('Animation not loaded');
            return;
        }

        if (animationContainer) animationContainer.style.display = shouldPlay ? 'block' : 'none';
        shouldPlay ? animation.play() : animation.stop();
    }

    window.addEventListener('DOMContentLoaded', () => {
        loadAnimation();
    });

    window.loadAnimation = loadAnimation;
    window.toggleAnimation = toggleAnimation;
    window.updateListeningIndicator = updateListeningIndicator;
})();
