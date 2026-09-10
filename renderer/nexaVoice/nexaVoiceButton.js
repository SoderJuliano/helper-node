/**
 * renderer/nexaVoice/nexaVoiceButton.js
 * 
 * Controlador do botão de microfone monocromático no composer e eventos de feedback visual do Modo de Voz Nexa.
 */

(function() {
    function initNexaVoiceButton() {
        const shell = document.getElementById('composer-shell');
        const sendBtn = document.getElementById('composer-send');
        if (!shell || !sendBtn) return;

        let micBtn = document.getElementById('composer-mic-toggle');
        if (!micBtn) {
            micBtn = document.createElement('button');
            micBtn.id = 'composer-mic-toggle';
            micBtn.className = 'composer-mic-toggle';
            micBtn.type = 'button';
            micBtn.title = 'Modo Voz Ativo Nexa (clique para ligar/desligar)';
            micBtn.setAttribute('aria-pressed', 'false');
            micBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            `;
            if (sendBtn) {
                shell.insertBefore(micBtn, sendBtn);
            } else {
                shell.appendChild(micBtn);
            }
        }

        if (micBtn._nexaVoiceInitialized) return;
        micBtn._nexaVoiceInitialized = true;

        let isVoiceActive = false;

        async function toggleVoiceMode() {
            if (!(window.electronAPI && window.electronAPI.nexaVoiceToggle)) return;
            try {
                const res = await window.electronAPI.nexaVoiceToggle();
                isVoiceActive = res && res.active;
                updateButtonState(isVoiceActive, false);
                if (typeof window.showToast === 'function') {
                    window.showToast(isVoiceActive ? 'Modo de Voz Nexa ativado!' : 'Modo de Voz Nexa desativado.');
                }
            } catch (e) {
                console.warn('[nexaVoiceButton] Erro ao alternar modo de voz:', e);
            }
        }

        function updateButtonState(active, followUp = false) {
            if (!micBtn) return;
            micBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
            if (active) {
                micBtn.classList.add('active');
                if (followUp) {
                    micBtn.classList.add('follow-up');
                    micBtn.title = 'Nexa ouvindo... (Pode falar diretamente sem dizer Nexa)';
                } else {
                    micBtn.classList.remove('follow-up');
                    micBtn.title = 'Modo Voz Ativo (Diga "Nexa..." para perguntar)';
                }
            } else {
                micBtn.classList.remove('active', 'follow-up', 'speaking-detected');
                micBtn.title = 'Modo Voz Ativo Nexa (clique para ligar)';
            }
        }

        micBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleVoiceMode();
        });

        // Escuta atualizações de status vindas do backend
        if (window.electronAPI && window.electronAPI.onNexaVoiceStatusChanged) {
            window.electronAPI.onNexaVoiceStatusChanged((data) => {
                isVoiceActive = !!data.active;
                updateButtonState(isVoiceActive, !!data.followUpActive);
            });
        }

        if (window.electronAPI && window.electronAPI.onNexaVoiceStateChanged) {
            window.electronAPI.onNexaVoiceStateChanged((data) => {
                if (data.state === 'listening') {
                    updateButtonState(true, !!data.followUpActive);
                } else if (data.state === 'thinking' || data.state === 'speaking') {
                    if (micBtn) micBtn.classList.add('speaking-detected');
                }
            });
        }

        // Obtém estado inicial
        if (window.electronAPI && window.electronAPI.nexaVoiceGetStatus) {
            window.electronAPI.nexaVoiceGetStatus().then((st) => {
                if (st && st.active) {
                    isVoiceActive = true;
                    updateButtonState(true, !!st.followUpActive);
                }
            }).catch(() => {});
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNexaVoiceButton);
    } else {
        initNexaVoiceButton();
    }
})();
