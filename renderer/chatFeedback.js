// renderer/chatFeedback.js
// Human-in-the-Loop (HITL) Feedback & Active Memory UI Module.
// Provê ações de cópia, avaliação positiva (Golden Example) e correção manual (JSONL)
// diretamente nas bolhas de resposta do chat.

(function() {
    const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const THUMBS_UP_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>';
    const EDIT_CORRECTION_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';

    function createBlockActions(transcriptionElement) {
        const bar = document.createElement('div');
        bar.className = 'interaction-actions-bar';

        // 1. Botão de Copiar resposta
        const copyBtn = document.createElement('button');
        copyBtn.className = 'interaction-action-btn copy-interaction-btn';
        copyBtn.title = 'Copiar resposta';
        copyBtn.setAttribute('aria-label', 'Copiar resposta');
        copyBtn.innerHTML = COPY_ICON_SVG;
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const block = bar.closest('.interaction-block');
            let aEl = block ? block.querySelector('.ia-response, .streaming-response') : null;
            if (!aEl && block && block.nextElementSibling &&
                block.nextElementSibling.matches('.ia-response, .streaming-response')) {
                aEl = block.nextElementSibling;
            }
            const aText = aEl ? (aEl.innerText || aEl.textContent || '').trim() : '';
            if (!aText) {
                if (typeof showToast === 'function') showToast('Nada para copiar ainda');
                return;
            }
            if (typeof copyTextReliable === 'function') copyTextReliable(aText);
            copyBtn.innerHTML = CHECK_ICON_SVG;
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.innerHTML = COPY_ICON_SVG;
                copyBtn.classList.remove('copied');
            }, 1500);
        });

        // 2. Botão de Feedback Positivo (Golden Example)
        const thumbsUpBtn = document.createElement('button');
        thumbsUpBtn.className = 'interaction-action-btn feedback-thumbs-up-btn';
        thumbsUpBtn.title = 'Marcar como resposta de referência (Golden Example no JSONL)';
        thumbsUpBtn.setAttribute('aria-label', 'Boa resposta');
        thumbsUpBtn.innerHTML = THUMBS_UP_ICON_SVG;
        thumbsUpBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const block = bar.closest('.interaction-block');
            if (!block) return;
            const qEl = block.querySelector('.question-text');
            const qText = (typeof window.getQuestionText === 'function' ? window.getQuestionText(qEl) : (qEl ? qEl.innerText || qEl.textContent : '')) || '';
            const aEl = block.querySelector('.ia-response, .streaming-response');
            const aText = aEl ? (aEl.innerText || aEl.textContent || '').trim() : '';
            if (!qText || !aText) return;

            thumbsUpBtn.classList.add('active-positive');
            try {
                if (window.electronAPI && window.electronAPI.savePreferenceMemory) {
                    const model = (await window.electronAPI.getAiModel()) || 'ollama';
                    await window.electronAPI.savePreferenceMemory({
                        prompt: qText,
                        chosen: aText,
                        feedback: 'positive',
                        model: model,
                    });
                    const notify = (typeof showToast === 'function') ? showToast : (typeof window.showToast === 'function' ? window.showToast : null);
                    if (notify) {
                        notify('Gravado como exemplo de referência no JSONL!');
                    }
                }
            } catch (err) {
                console.warn('[feedback] Falha ao salvar feedback positivo:', err);
            }
        });

        // 3. Botão de Correção / Feedback Negativo (Human-in-the-Loop)
        const correctBtn = document.createElement('button');
        correctBtn.className = 'interaction-action-btn feedback-thumbs-down-btn';
        correctBtn.title = 'Corrigir resposta para o Ollama (Memória Ativa JSONL)';
        correctBtn.setAttribute('aria-label', 'Corrigir resposta');
        correctBtn.innerHTML = EDIT_CORRECTION_ICON_SVG;
        correctBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const block = bar.closest('.interaction-block');
            if (!block) return;

            let panel = block.querySelector('.feedback-correction-panel');
            if (panel) {
                panel.remove();
                correctBtn.classList.remove('active-negative');
                return;
            }
            correctBtn.classList.add('active-negative');

            const qEl = block.querySelector('.question-text');
            const qText = (typeof window.getQuestionText === 'function' ? window.getQuestionText(qEl) : (qEl ? qEl.innerText || qEl.textContent : '')) || '';
            const aEl = block.querySelector('.ia-response, .streaming-response');
            const aText = aEl ? (aEl.innerText || aEl.textContent || '').trim() : '';

            panel = document.createElement('div');
            panel.className = 'feedback-correction-panel';
            panel.innerHTML = `
                <div class="feedback-correction-title">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    <span>Corrigir para o Ollama (Memória Ativa JSONL)</span>
                </div>
                <textarea class="feedback-correction-textarea" placeholder="Digite a resposta ou fato correto que o modelo deve aprender..."></textarea>
                <div class="feedback-correction-actions">
                    <button type="button" class="feedback-btn feedback-btn-cancel">Cancelar</button>
                    <button type="button" class="feedback-btn feedback-btn-save">Salvar Correção</button>
                </div>
            `;

            const textarea = panel.querySelector('.feedback-correction-textarea');
            const saveBtn = panel.querySelector('.feedback-btn-save');
            const cancelBtn = panel.querySelector('.feedback-btn-cancel');

            cancelBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                panel.remove();
                correctBtn.classList.remove('active-negative');
            });

            saveBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const correction = textarea.value.trim();
                if (!correction) {
                    textarea.focus();
                    return;
                }
                saveBtn.disabled = true;
                saveBtn.textContent = 'Salvando...';
                try {
                    if (window.electronAPI && window.electronAPI.savePreferenceMemory) {
                        const model = (await window.electronAPI.getAiModel()) || 'ollama';
                        await window.electronAPI.savePreferenceMemory({
                            prompt: qText,
                            rejected: aText,
                            chosen: correction,
                            feedback: 'correction',
                            model: model,
                        });

                        panel.remove();
                        correctBtn.classList.remove('active-negative');

                        const notify = (typeof showToast === 'function') ? showToast : (typeof window.showToast === 'function' ? window.showToast : null);
                        if (notify) {
                            notify('Correção salva em active_memory.jsonl!');
                        }
                    }
                } catch (err) {
                    console.warn('[feedback] Erro ao salvar correção:', err);
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Salvar Correção';
                }
            });

            block.appendChild(panel);
            setTimeout(() => textarea.focus(), 50);
        });

        bar.appendChild(copyBtn);
        bar.appendChild(thumbsUpBtn);
        bar.appendChild(correctBtn);
        return bar;
    }

    window.createBlockActions = createBlockActions;
})();
