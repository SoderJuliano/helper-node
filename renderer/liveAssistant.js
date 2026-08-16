// Live Assistant, Agentic Phases & Audio Feedback Module
var activeAgenticSession = null;

(function() {
    const transcriptionElement = document.getElementById('transcription');
    // Elementos de painel/animação perdidos na divisão automática.
    const animationContainer = document.getElementById('animation-container');
    const shortcutPanel = document.getElementById('shortcut-panel');
    const shortcutToggle = document.getElementById('shortcut-toggle');
    const shortcutHeader = document.getElementById('shortcut-header');
    const historyPanel = document.getElementById('history-panel');
    const historyToggle = document.getElementById('history-toggle');
    const historyHeader = document.getElementById('history-header');

            // === Agentic Workflow Listeners ===
            let activeAgenticSession = null;
            const PHASE_LABELS = {
                thinking: 'Pensando', discovery: 'Explorando', planning: 'Planejando',
                implementation: 'Implementando', review: 'Revisando',
                completed: 'Concluído', error: 'Erro',
            };

            // Fase do agentic renderizada INLINE no bloco da pergunta atual,
            // com botão de interromper — sem balão flutuante.
            window.electronAPI.onAgenticPhaseUpdate(({ phase, status, sessionId, thinking }) => {
                const done = (phase === 'completed' || phase === 'error');
                if (!done) activeAgenticSession = sessionId;
                const block = transcriptionElement
                    ? transcriptionElement.querySelector('.interaction-block:last-child')
                    : null;
                if (!block) { if (done) activeAgenticSession = null; return; }
                let ph = block.querySelector('.ai-phase');
                if (!ph) {
                    ph = document.createElement('div');
                    ph.className = 'ai-phase';
                    ph.innerHTML = `
                        <div class="ai-phase-header">
                            <span class="ai-phase-spin"></span>
                            <span class="ai-phase-tag"></span>
                            <button class="ai-phase-stop" title="Interromper">×</button>
                            <span class="ai-phase-text"></span>
                            <span class="ai-phase-toggle-icon">▶</span>
                        </div>
                        <div class="ai-thinking-box"></div>
                    `;
                    const q = block.querySelector('.question-text');
                    if (q && q.nextSibling) block.insertBefore(ph, q.nextSibling);
                    else block.insertBefore(ph, block.firstChild);

                    const header = ph.querySelector('.ai-phase-header');
                    header.addEventListener('click', (e) => {
                        if (e.target.closest('.ai-phase-stop')) return;
                        ph.classList.toggle('expanded');
                    });

                    const stop = ph.querySelector('.ai-phase-stop');
                    if (stop) stop.addEventListener('click', () => {
                        // Congela o stream ANTES do abort: o kill leva alguns
                        // milissegundos e o texto desse intervalo ia pra tela.
                        if (typeof window.cancelIaAndFreezeStream === 'function') {
                            window.cancelIaAndFreezeStream();
                        }
                        if (activeAgenticSession) {
                            window.electronAPI.stopAgenticWorkflow(activeAgenticSession);
                        }
                        const txt = ph.querySelector('.ai-phase-text');
                        if (txt) txt.textContent = 'Interrompido pelo usuário';
                    });
                }
                const tag = ph.querySelector('.ai-phase-tag');
                const txt = ph.querySelector('.ai-phase-text');
                if (tag) tag.textContent = PHASE_LABELS[phase] || phase;
                if (txt) txt.textContent = status || '';

                const toggleIcon = ph.querySelector('.ai-phase-toggle-icon');
                if (toggleIcon) {
                    toggleIcon.style.display = thinking ? '' : 'none';
                }

                const box = ph.querySelector('.ai-thinking-box');
                if (box && thinking) {
                    box.textContent = thinking;
                }

                if (done) {
                    ph.classList.add(phase === 'error' ? 'error' : 'done');
                    const spin = ph.querySelector('.ai-phase-spin'); if (spin) spin.remove();
                    const stop = ph.querySelector('.ai-phase-stop'); if (stop) stop.remove();
                    activeAgenticSession = null;
                }
                scrollTranscriptionToBottom('auto');
            });

            window.electronAPI.onAgenticDebugInfo(({ type, data, sessionId }) => {
                const isDebug = document.getElementById('debug-indicator').style.display !== 'none';
                if (!isDebug) return;

                const transcriptionElement = document.getElementById('transcription');
                const debugBlock = document.createElement('div');
                debugBlock.className = 'agentic-debug-block';
                
                const header = document.createElement('div');
                header.className = 'agentic-debug-header';
                header.innerHTML = `<span>🔍 DEBUG: ${type.toUpperCase()}</span><span>${new Date().toLocaleTimeString()}</span>`;
                
                const content = document.createElement('pre');
                content.style.margin = '0';
                content.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
                
                debugBlock.appendChild(header);
                debugBlock.appendChild(content);
                transcriptionElement.appendChild(debugBlock);
                scrollTranscriptionToBottom();
            });

            // (O botão de interromper agora vive inline no .ai-phase.)
 // Agentic phase updates

            // === "Thinking"/ações da IA ao vivo (ler, buscar, rodar comando…) ===
            if (window.electronAPI && window.electronAPI.onAiToolActivity) {
                const ACT_CHECK = '<svg class="ai-activity-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
                const ACT_FAIL = '<svg class="ai-activity-fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
                window.electronAPI.onAiToolActivity((data) => {
                    try {
                        if (!data || !data.id || !transcriptionElement) return;
                        const block = transcriptionElement.querySelector('.interaction-block:last-child');
                        if (!block) return;
                        let feed = block.querySelector('.ai-activity');
                        if (!feed) {
                            feed = document.createElement('div');
                            feed.className = 'ai-activity';
                            // Abaixo da fase (se houver), senão logo após a pergunta.
                            const anchor = block.querySelector('.ai-phase') || block.querySelector('.question-text');
                            if (anchor && anchor.nextSibling) block.insertBefore(feed, anchor.nextSibling);
                            else block.appendChild(feed);
                        }
                        // Aceita tanto data.phase quanto data.state (compatibilidade CLI + agentic)
                        const evPhase = data.phase || data.state;
                        if (evPhase === 'start') {
                            if (feed.querySelector(`[data-id="${data.id}"]`)) return;
                            const item = document.createElement('div');
                            item.className = 'ai-activity-item running';
                            item.dataset.id = data.id;
                            const ic = document.createElement('span');
                            ic.className = 'ai-activity-ic';
                            ic.innerHTML = '<span class="ai-activity-spinner"></span>';
                            const lbl = document.createElement('span');
                            lbl.className = 'ai-activity-label';
                            lbl.textContent = data.label || data.name || 'trabalhando…';
                            item.appendChild(ic);
                            item.appendChild(lbl);
                            feed.appendChild(item);
                            transcriptionElement.scrollTo({ top: transcriptionElement.scrollHeight, behavior: 'smooth' });
                        } else if (evPhase === 'done' || evPhase === 'error') {
                            const item = feed.querySelector(`[data-id="${data.id}"]`);
                            if (!item) return;
                            const ok = evPhase !== 'error' && data.ok !== false;
                            item.classList.remove('running');
                            item.classList.add(ok ? 'done' : 'fail');
                            const ic = item.querySelector('.ai-activity-ic');
                            if (ic) ic.innerHTML = ok ? ACT_CHECK : ACT_FAIL;
                        }
                    } catch (e) { console.warn('ai-activity render failed:', e); }
                });
            }
            // A carga inicial do painel roda no app.js (DOMContentLoaded):
            // refreshWorkspacePanel vive no workspaceContext.js, que e carregado
            // DEPOIS deste arquivo — chamar aqui daria ReferenceError.

            // Rotacao do chevron e' controlada por CSS (.panel:not(.collapsed) .commands-toggle).
            // Aqui apenas alternamos a classe do painel.
            const setPanelCollapsed = (panel, _toggle, collapsed) => {
                panel.classList.toggle('collapsed', collapsed);
            };

            // Clique no header inteiro alterna o painel (mais area clicavel).
            const togglePanel = (panel) => {
                setPanelCollapsed(panel, null, !panel.classList.contains('collapsed'));
            };

            shortcutHeader.addEventListener('click', (event) => {
                event.stopPropagation();
                togglePanel(shortcutPanel);
            });

            historyHeader.addEventListener('click', (event) => {
                event.stopPropagation();
                const wasCollapsed = historyPanel.classList.contains('collapsed');
                togglePanel(historyPanel);
                // Recarrega a lista ao ABRIR o painel — sem isto, sessões criadas em
                // segundo plano (ex.: o Tutor) nunca apareciam até reiniciar o app,
                // porque loadHistory() só rodava uma vez na inicialização.
                if (wasCollapsed) { try { loadHistory(); } catch (_) {} }
            });

            // (workspace-bar nao e' colaps\u00e1vel; sem header click)

            setPanelCollapsed(shortcutPanel, shortcutToggle, true);
            setPanelCollapsed(historyPanel, historyToggle, true);
 // Live IA actions/thinking

        function loadAnimation() {
            fetch('assets/loading.json')
                .then(response => response.json())
                .then(animationData => {
                    // window.animation: instância compartilhada com chatMessages.js
                    window.animation = lottie.loadAnimation({
                        container: animationContainer,
                        renderer: 'svg',
                        loop: true,
                        autoplay: false, // Não inicia automaticamente
                        animationData: animationData
                    });
                    
                    // Esconde o container após carregar
                    animationContainer.style.display = 'none';
                })
                .catch(error => console.error('Erro ao carregar animação:', error));
        }

        window.electronAPI.onToggleRecording((event, data) => {
            if (!data) return;
            if (!data.isRealtimeAssistant) {
                toggleAnimation(data.isRecording);
            } else if (!data.isRecording) {
                toggleAnimation(false);
            }

            // CHOKE-POINT ÚNICO do hero: sempre que QUALQUER áudio é ligado
            // (Assistente em Tempo Real, Tradutor ou gravação) em modo janela,
            // o hero de boas-vindas TEM que sumir. Ele bloqueava a tela e, pior,
            // enquanto visível mantém #main.is-empty → #transcription {display:none},
            // então nada era transcrito. Não acople isso a eventos downstream
            // (realtime 'started', onTranslationStatus): eles falham/atrasam e o
            // bug volta. Este é o ponto que dispara pra TODOS os modos de áudio.
            // Ver memória: hero-window-mode-audio-blocker.
            if (data.isRecording) {
                const hero = document.getElementById('welcome-hero');
                if (hero) hero.classList.add('hidden');
            }

            // Modo IDE: em vez do robot/loading padrão, mostra a bolinha em
            // pulso acima do composer avisando que o áudio está sendo
            // capturado — a transcrição vai pro composer, não direto pra IA.
            const listeningEl = document.getElementById('composer-listening');
            if (listeningEl) {
                listeningEl.style.display = (data.isIdeMode && data.isRecording) ? 'flex' : 'none';
            }
        });

        // Modo IDE: chega o texto transcrito por Whisper (Ctrl+D) — preenche
        // o composer pro usuário revisar/editar e enviar com Shift+Enter ou
        // o botão Enviar. NÃO envia sozinho pra IA.
        if (window.electronAPI.onIdeAudioTranscribed) {
            window.electronAPI.onIdeAudioTranscribed((text) => {
                const listeningEl = document.getElementById('composer-listening');
                if (listeningEl) listeningEl.style.display = 'none';
                if (!text || !text.trim() || text === '[BLANK_AUDIO]') {
                    if (typeof showToast === 'function') showToast('Nenhum áudio detectado.');
                    return;
                }
                if (typeof openManualInput === 'function') {
                    openManualInput(text);
                }
            });
        }

        // Função unificada para controle
        function toggleAnimation(shouldPlay) {
            const animation = window.animation;
            if (!animation) {
                console.error('Animation not loaded');
                return;
            }

            animationContainer.style.display = shouldPlay ? 'block' : 'none';
            shouldPlay ? animation.play() : animation.stop();
        }

        window.addEventListener('DOMContentLoaded', () => {
            loadAnimation();
        });
        // Lottie animation loader & toggle

        // === Assistente de Tradução ===
        if (window.electronAPI && window.electronAPI.onTranslationResult) {
            // Funções stub — badge removido, mantidas para não quebrar chamadas no modo teste
            const _taShow = () => {};
            const _taHide = () => {};

            // Pulsating circle: aparece com mic aberto, some quando robot/lottie estão visíveis
            const _taLive = document.getElementById('ta-live-indicator');
            if (_taLive && window.electronAPI.onTranslationStatus) {
                window.electronAPI.onTranslationStatus((status) => {
                    if (status && status !== 'idle') {
                        const hero = document.getElementById('welcome-hero');
                        if (hero) hero.classList.add('hidden');
                        // Tradutor também não tem input de texto — mesma regra do
                        // Assistente em Tempo Real: composer some enquanto o modo está ativo.
                        if (typeof setComposerVisibility === 'function') setComposerVisibility(false);
                    } else if (status === 'idle') {
                        if (typeof setComposerVisibility === 'function') setComposerVisibility(true);
                    }
                    if (status === 'mic_open') {
                        _taLive.className = 'visible state-mic';
                    } else if (status === 'processing') {
                        // Esconde o pulse enquanto a IA processa
                        _taLive.classList.add('hidden-by-loader');
                    } else if (status === 'idle') {
                        _taLive.className = '';
                    }
                });

                // Esconde o pulse enquanto robot.gif ou lottie estiverem visíveis
                const _robot = document.getElementById('robot');
                const _animCont = document.getElementById('animation-container');
                const _syncPulse = () => {
                    const busy = (_robot && _robot.style.display === 'block') ||
                                 (_animCont && _animCont.style.display !== '' && _animCont.style.display !== 'none');
                    _taLive.classList.toggle('hidden-by-loader', busy);
                };
                const _obs = new MutationObserver(_syncPulse);
                if (_robot)   _obs.observe(_robot,   { attributes: true, attributeFilter: ['style'] });
                if (_animCont) _obs.observe(_animCont, { attributes: true, attributeFilter: ['style'] });
            }

            // === Barra de volume (mic/sys) — feedback visual de captação de áudio ===
            if (window.electronAPI.onTranslationLevel) {
                const _volBox = document.getElementById('ta-volume');
                const _volMic = document.getElementById('ta-vol-mic');
                const _volSys = document.getElementById('ta-vol-sys');
                const _SIL = 300;       // limiar de silêncio (mesmo do vadEngine)
                const _FULL = 2500;     // rms que enche a barra
                window.electronAPI.onTranslationLevel(({ source, rms }) => {
                    if (_volBox && _volBox.style.display !== 'block') _volBox.style.display = 'block';
                    const el = source === 'mic' ? _volMic : _volSys;
                    if (!el) return;
                    el.style.width = Math.max(0, Math.min(100, (rms / _FULL) * 100)) + '%';
                    el.classList.toggle('active', rms > _SIL);
                });
                if (window.electronAPI.onTranslationStatus) {
                    window.electronAPI.onTranslationStatus((status) => {
                        if (status === 'idle' && _volBox) _volBox.style.display = 'none';
                    });
                }
            }

            // === Loading "processando" — robôzinho pulando (robot.gif) ===
            if (window.electronAPI.onTranslationLoading) {
                const _taLoadBox = document.getElementById('ta-loading');
                window.electronAPI.onTranslationLoading((loading) => {
                    if (_taLoadBox) _taLoadBox.style.display = loading ? 'block' : 'none';
                });
            }

            const _taMeta = (text) => {
                const d = document.createElement('div');
                d.className = 'ta-meta';
                d.textContent = text;
                return d;
            };

            window.electronAPI.onTranslationResult((data) => {
                const el = document.getElementById('transcription');
                if (!el) return;
                const hero = document.getElementById('welcome-hero');
                if (hero) hero.classList.add('hidden');
                const { status } = data;

                // Pergunta sendo reproduzida
                if (status === 'question') {
                    _taShow(`🔊 Pergunta ${data.index}/${data.total}`, true);
                    el.appendChild(_taMeta(`— Pergunta ${data.index} de ${data.total} —`));

                // Tradução + sugestão
                } else if (status === 'done' || !status) {
                    _taShow(`🎤 Fale agora — até 40s`, false);
                    // Streaming: resultados do mesmo turno trazem o mesmo data.id e o texto
                    // acumulado. Atualiza o bloco existente NO LUGAR em vez de criar outro.
                    let block = data.id ? el.querySelector(`[data-ta-id="${data.id}"]`) : null;
                    if (!block) {
                        block = document.createElement('div');
                        block.className = 'interaction-block';
                        if (data.id) block.dataset.taId = data.id;
                        if (data.transcript && data.transcript.trim()) {
                            const orig = document.createElement('div');
                            orig.className = 'ta-original';
                            // mic (você) vs sys (entrevistador) — rótulo pra você saber quem falou
                            const who = data.mode === 'candidate' ? '👤 Você: ' : '🎧 Entrevistador: ';
                            orig.textContent = who + data.transcript;
                            block.appendChild(orig);
                        }
                        el.appendChild(block);
                    } else {
                        if (data.transcript && data.transcript.trim()) {
                            let orig = block.querySelector('.ta-original');
                            if (!orig) {
                                orig = document.createElement('div');
                                orig.className = 'ta-original';
                                block.insertBefore(orig, block.firstChild);
                            }
                            const who = data.mode === 'candidate' ? '👤 Você: ' : '🎧 Entrevistador: ';
                            orig.textContent = who + data.transcript;
                        }
                    }
                    if (data.response && data.response.trim()) {
                        let resp = block.querySelector('.ia-response');
                        if (!resp) {
                            resp = document.createElement('div');
                            resp.className = 'ia-response';
                            resp.style.cssText = 'white-space: pre-wrap;';
                            block.appendChild(resp);
                        }
                        resp.innerHTML = formatOpenAIResponse(data.response);
                    }

                // Ouvindo resposta — badge já foi atualizado no status 'done'
                } else if (status === 'listening') {
                    _taShow('🎤 Fale agora — até 40s', false);

                // Avaliando
                } else if (status === 'evaluating') {
                    _taShow('⏳ Avaliando...', true);

                // Resultado da avaliação
                } else if (status === 'evaluated') {
                    _taShow('🔊 Próxima pergunta...', true);
                    const block = document.createElement('div');
                    block.className = 'interaction-block';
                    if (data.userTranscript) {
                        const ut = document.createElement('div');
                        ut.className = 'ta-user-answer';
                        ut.textContent = `👤 Você disse: ${data.userTranscript}`;
                        block.appendChild(ut);
                    }
                    if (data.evaluation) {
                        const ev = document.createElement('div');
                        ev.className = 'ta-evaluation';
                        ev.textContent = data.evaluation;
                        block.appendChild(ev);
                    }
                    el.appendChild(block);

                // Sem resposta
                } else if (status === 'no_answer') {
                    _taShow('🔊 Próxima...', true);
                    el.appendChild(_taMeta('⏭  Sem resposta detectada.'));

                // Erro
                } else if (status === 'error') {
                    const d = document.createElement('div');
                    d.style.cssText = 'font-size:11px; color:#ff6b6b; margin:4px 0;';
                    d.textContent = `❌ ${data.error || 'Erro desconhecido'}`;
                    el.appendChild(d);

                // Teste concluído
                } else if (status === 'complete') {
                    _taHide();
                    const d = document.createElement('div');
                    d.style.cssText = 'font-size:13px; color:#a8e6a3; margin:14px 0; text-align:center;';
                    d.textContent = data.message || '✅ Teste concluído.';
                    el.appendChild(d);
                }

                scrollTranscriptionToBottom('smooth');
            });
        }
 // Audio Translation, Volume track, loading robot.gif

    // Expose
    window.toggleAnimation = toggleAnimation;
})();
