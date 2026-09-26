// renderer/chatQueue.js
// Turn queue manager for handling consecutive questions smoothly without race conditions or dropped loading indicators.
(function() {
    'use strict';

    window.isAiProcessing = false;
    window.activeInteractionBlock = null;
    window.chatQueue = [];

    function enqueueQuestion({ text, image, block, questionSpan }) {
        const queueId = 'queue-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
        const queueItem = {
            id: queueId,
            text,
            image,
            block,
            questionSpan
        };
        window.chatQueue.push(queueItem);

        if (block) {
            let ph = block.querySelector('.ai-phase');
            if (!ph) {
                ph = document.createElement('div');
                block.appendChild(ph);
            }
            ph.className = 'ai-phase ai-phase-queued';
            ph.innerHTML = `
                <div class="ai-phase-header">
                    <span class="ai-phase-clock">⏳</span>
                    <span class="ai-phase-tag queued">Na fila</span>
                    <span class="ai-phase-text">Aguardando conclusão da pergunta anterior...</span>
                    <div class="ai-phase-queued-actions">
                        <button class="ai-phase-queue-btn run-now" title="Interromper anterior e executar agora">⚡ Enviar agora</button>
                        <button class="ai-phase-queue-btn cancel-queue" title="Remover da fila">✕</button>
                    </div>
                </div>
            `;
            const runBtn = ph.querySelector('.run-now');
            if (runBtn) {
                runBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    forceExecuteQueuedItem(queueId);
                });
            }
            const cancelBtn = ph.querySelector('.cancel-queue');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeQueuedItem(queueId);
                });
            }
        }
        if (typeof window.scrollTranscriptionToBottom === 'function') {
            window.scrollTranscriptionToBottom('force');
        }
        return queueItem;
    }

    function removeQueuedItem(queueId) {
        if (!window.chatQueue) return;
        const idx = window.chatQueue.findIndex(q => q.id === queueId);
        if (idx !== -1) {
            const item = window.chatQueue.splice(idx, 1)[0];
            if (item && item.block) {
                const ph = item.block.querySelector('.ai-phase');
                if (ph) {
                    ph.className = 'ai-phase done error';
                    ph.innerHTML = `
                        <div class="ai-phase-header">
                            <span class="ai-phase-tag error">Cancelado</span>
                            <span class="ai-phase-text">Pergunta removida da fila</span>
                        </div>
                    `;
                }
            }
        }
    }

    function forceExecuteQueuedItem(queueId) {
        if (!window.chatQueue) return;
        const idx = window.chatQueue.findIndex(q => q.id === queueId);
        if (idx === -1) return;
        const item = window.chatQueue.splice(idx, 1)[0];

        // Interrompe o turno anterior em andamento
        if (typeof window.cancelIaAndFreezeStream === 'function') {
            window.cancelIaAndFreezeStream();
        }

        setTimeout(() => {
            executeQueuedTurn(item);
        }, 120);
    }

    function executeQueuedTurn(item) {
        if (!item) return;
        window.isAiProcessing = true;
        window.iaCancelled = false;
        window.activeInteractionBlock = item.block;
        window.currentQuestionElement = item.questionSpan;

        if (typeof window.startProcessing === 'function') {
            window.startProcessing(item.block);
        }

        if (typeof window.scrollTranscriptionToBottom === 'function') {
            window.scrollTranscriptionToBottom('force');
        }

        if (item.image) {
            if (typeof window.sentImageToAI === 'function') {
                window.sentImageToAI(item.text, item.image, { skipQueue: true, block: item.block });
            }
        } else {
            if (typeof window.sentToAI === 'function') {
                window.sentToAI(item.text, { skipQueue: true, block: item.block });
            }
        }
    }

    function onActiveTurnComplete(opts = {}) {
        // Finaliza o bloco ativo
        if (window.activeInteractionBlock) {
            window.activeInteractionBlock.classList.remove('is-processing');
            const ph = window.activeInteractionBlock.querySelector('.ai-phase:not(.ai-phase-queued)');
            if (ph) {
                ph.classList.add(opts.error ? 'error' : 'done');
                const spin = ph.querySelector('.ai-phase-spin'); if (spin) spin.remove();
                const stop = ph.querySelector('.ai-phase-stop'); if (stop) stop.remove();
                if (opts.error) {
                    const txt = ph.querySelector('.ai-phase-text');
                    if (txt) txt.textContent = opts.error;
                }
            }
            const runningItems = window.activeInteractionBlock.querySelectorAll('.ai-activity-item.running');
            runningItems.forEach(it => {
                it.classList.remove('running');
                it.classList.add('done');
                const ic = it.querySelector('.ai-activity-ic');
                if (ic) ic.innerHTML = '<svg class="ai-activity-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            });
        }

        // Se houver erro e houver itens na fila:
        if (opts.error && window.chatQueue && window.chatQueue.length > 0) {
            console.warn('[TurnComplete] Turno anterior terminou com erro. Pausando fila.');
            window.chatQueue.forEach(item => {
                if (item.block) {
                    const qPh = item.block.querySelector('.ai-phase');
                    if (qPh) {
                        qPh.innerHTML = `
                            <div class="ai-phase-header">
                                <span class="ai-phase-tag" style="background: rgba(234,179,8,0.18); color: #eab308;">Fila em pausa</span>
                                <span class="ai-phase-text">Houve erro na resposta anterior</span>
                                <div class="ai-phase-queued-actions">
                                    <button class="ai-phase-queue-btn run-now" title="Tentar executar esta pergunta agora">⚡ Enviar</button>
                                    <button class="ai-phase-queue-btn cancel-queue" title="Descartar">✕</button>
                                </div>
                            </div>
                        `;
                        const runBtn = qPh.querySelector('.run-now');
                        if (runBtn) runBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            forceExecuteQueuedItem(item.id);
                        });
                        const cancelBtn = qPh.querySelector('.cancel-queue');
                        if (cancelBtn) cancelBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            removeQueuedItem(item.id);
                        });
                    }
                }
            });
            window.chatQueue = [];
            if (typeof window.stopProcessing === 'function') window.stopProcessing();
            return;
        }

        // Se há perguntas na fila, desenfileira a próxima automaticamente!
        if (window.chatQueue && window.chatQueue.length > 0) {
            console.log('[TurnComplete] Desenfileirando próxima pergunta. Restantes na fila:', window.chatQueue.length);
            const nextItem = window.chatQueue.shift();
            if (nextItem) {
                setTimeout(() => {
                    executeQueuedTurn(nextItem);
                }, 80);
                return;
            }
        }

        if (typeof window.stopProcessing === 'function') window.stopProcessing();
    }

    function pauseChatQueueOnUserCancel() {
        if (!window.chatQueue || window.chatQueue.length === 0) return;
        window.chatQueue.forEach(item => {
            if (item.block) {
                const ph = item.block.querySelector('.ai-phase');
                if (ph) {
                    ph.innerHTML = `
                        <div class="ai-phase-header">
                            <span class="ai-phase-tag" style="background: rgba(234,179,8,0.18); color: #eab308;">Fila pausada</span>
                            <span class="ai-phase-text">Execução anterior foi interrompida</span>
                            <div class="ai-phase-queued-actions">
                                <button class="ai-phase-queue-btn run-now" title="Executar esta pergunta agora">⚡ Enviar</button>
                                <button class="ai-phase-queue-btn cancel-queue" title="Descartar">✕</button>
                            </div>
                        </div>
                    `;
                    const runBtn = ph.querySelector('.run-now');
                    if (runBtn) runBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        forceExecuteQueuedItem(item.id);
                    });
                    const cancelBtn = ph.querySelector('.cancel-queue');
                    if (cancelBtn) cancelBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        removeQueuedItem(item.id);
                    });
                }
            }
        });
        window.chatQueue = [];
    }

    window.enqueueQuestion = enqueueQuestion;
    window.removeQueuedItem = removeQueuedItem;
    window.forceExecuteQueuedItem = forceExecuteQueuedItem;
    window.executeQueuedTurn = executeQueuedTurn;
    window.onActiveTurnComplete = onActiveTurnComplete;
    window.pauseChatQueueOnUserCancel = pauseChatQueueOnUserCancel;
})();
