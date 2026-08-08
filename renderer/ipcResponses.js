// IPC: respostas da IA, transcrição, debug e Vision Guide
// Restaurado do index.html original (bloco perdido na divisão automática).
(function() {
    const transcriptionElement = document.getElementById('transcription');
    const animationContainer = document.getElementById('animation-container');
    const robot = document.getElementById('robot');

            window.electronAPI.onDebugStatusChanged((status) => {
                const debugIndicator = document.getElementById('debug-indicator');
                if (status) {
                    debugIndicator.style.display = 'block';
                } else {
                    debugIndicator.style.display = 'none';
                }
            });
            
            // Listener para CTRL+I
            window.electronAPI.onManualInput(() => {
                if (typeof window.handleCtrlI === 'function') {
                    window.handleCtrlI();
                } else {
                    if (typeof window.setChatCollapsed === 'function' && window.isChatCollapsed()) {
                        window.setChatCollapsed(false);
                    }
                    openManualInput();
                }
            });

             // Transcrição
            window.electronAPI.onTranscriptionStart((audioFilePath) => {
                animationContainer.style.display = "none";
                robot.style.display = 'block';
                console.log('Transcrição iniciada para:', audioFilePath);
            });

            window.electronAPI.onTranscriptionResult(async (text) => {
                console.log('Texto transcrito:', text);
                const transcriptionElement = document.getElementById('transcription');

                const isDebug = await window.electronAPI.getDebugModeStatus();
                let displayText = text;

                if (isDebug) {
                    const promptInstruction = await window.electronAPI.getPromptInstruction();
                    const backendUrl = (await window.electronAPI.getBackendUrl()) || "URL_INDEFINIDA";
                    //console.log("DEBUG backend URL:", backendUrl);
                    const lang = await window.electronAPI.getLanguage();
                    const map = {
                        'pt-br': 'PORTUGUESE',
                        'en-us': 'ENGLISH'
                    };
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
                    transcriptionElement.appendChild(pre);
                    scrollTranscriptionToBottom();
                    
                    return; // Finaliza a execução aqui para o modo debug
                }

                appendQuestionEntry(text);
            });

            window.electronAPI.onTranscriptionError((message) => {
                robot.style.display = 'none';
                // Erro também encerra o turno: sem isto o spinner do bloco
                // "Pensando" continuava girando embaixo da mensagem de erro.
                if (typeof window.stopProcessing === 'function') window.stopProcessing();

                // Ignora erros de cancelamento (não exibe na tela)
                if (message === 'Request cancelled') {
                    console.log('Request cancelled by user - this is expected');
                    return;
                }
                
                console.error('Erro na transcrição:', message);
                
                // Só mostra erro na tela se não for um cancelamento
                if (currentQuestionElement) {
                    // Se já tem pergunta, adiciona erro após ela
                    const errorMsg = document.createElement('p');
                    errorMsg.style.color = '#ff6b6b';
                    errorMsg.textContent = `Erro: ${message}`;
                    document.getElementById('transcription').appendChild(errorMsg);
                } else {
                    // Se não tem pergunta, substitui o conteúdo
                    document.getElementById('transcription').innerText = `Erro: ${message}`;
                }
            });

            window.electronAPI.onIaResponse((response, usedKnowledge) => {
                console.log('IA respondeu:', response, '| base de conhecimento:', !!usedKnowledge);
                if (!response) {
                    document.getElementById('robot').style.display = 'none';
                    console.error('Resposta é undefined ou vazia');
                    return;
                }

                if (window.historySession) {
                    window.historySession.addMessageToCurrentSession('assistant', response);
                }

                const transcriptionElement = document.getElementById('transcription');
                const newResponse = document.createElement('div');
                newResponse.classList.add('ia-response');
                
                // Check if response is already HTML (has <pre> or <code> tags) or plain markdown text
                const isAlreadyHTML = /<pre|<code/.test(response);
                
                if (isAlreadyHTML) {
                    newResponse.innerHTML = response;
                } else {
                    const formattedResponse = formatOpenAIResponse(response);
                    newResponse.innerHTML = formattedResponse;
                }

                // Span pequeno indicando que a base de conhecimento foi consultada.
                if (usedKnowledge) {
                    const kbBadge = document.createElement('div');
                    kbBadge.className = 'kb-used-badge';
                    kbBadge.textContent = '• base de conhecimento usada';
                    newResponse.insertBefore(kbBadge, newResponse.firstChild);
                }

                // Adiciona dentro do interaction-block da pergunta atual (se existir)
                const lastBlock = transcriptionElement.querySelector('.interaction-block:last-child');
                if (lastBlock) {
                    lastBlock.appendChild(newResponse);
                } else {
                    transcriptionElement.appendChild(newResponse);
                }

                document.getElementById('robot').style.display = 'none';


                // Scroll suave para o fim
                setTimeout(() => scrollTranscriptionToBottom('smooth'), 100);

            });

            // Reprodução de áudio TTS quando o modo de voz está ativo
            if (window.electronAPI && window.electronAPI.onPlayTtsAudio) {
                window.electronAPI.onPlayTtsAudio(async ({ audioBase64, text }) => {
                    try {
                        if (window.electronAPI.getNexaConfig) {
                            const nexaCfg = await window.electronAPI.getNexaConfig();
                            if (nexaCfg && nexaCfg.enabled) {
                                // A janela da Nexa reproduz e anima o áudio da fala exclusivamente
                                return;
                            }
                        }
                    } catch (_) {}

                    try {
                        if (window.currentTtsAudio) {
                            window.currentTtsAudio.pause();
                            window.currentTtsAudio = null;
                        }
                        const audio = new Audio('data:audio/mp3;base64,' + audioBase64);
                        window.currentTtsAudio = audio;
                        audio.play().catch(e => console.warn('Erro ao reproduzir áudio TTS:', e.message));
                    } catch (err) {
                        console.error('Erro na execução do player TTS:', err);
                    }
                });
            }

            window.electronAPI.onOpenAIResponse((response, usedKnowledge, usage) => {
                console.log('OpenAI respondeu:', response, '| base de conhecimento:', !!usedKnowledge, '| usage:', usage);
                if (!response) {
                    document.getElementById('robot').style.display = 'none';
                    console.error('Resposta da OpenAI é undefined ou vazia');
                    return;
                }

                if (window.historySession) {
                    window.historySession.addMessageToCurrentSession('assistant', response);
                }

                const transcriptionElement = document.getElementById('transcription');
                const newResponse = document.createElement('div');
                newResponse.classList.add('ia-response');

                const formattedResponse = formatOpenAIResponse(response);
                newResponse.innerHTML = formattedResponse;

                if (usedKnowledge) {
                    const kbBadge = document.createElement('div');
                    kbBadge.className = 'kb-used-badge';
                    kbBadge.textContent = '• base de conhecimento usada';
                    newResponse.insertBefore(kbBadge, newResponse.firstChild);
                }

                if (usage && usage.total_tokens) {
                    const tokensBadge = document.createElement('div');
                    tokensBadge.className = 'kb-used-badge';
                    tokensBadge.style.color = 'var(--text-3)';
                    tokensBadge.style.marginTop = '4px';
                    tokensBadge.style.fontSize = '10px';
                    
                    const details = usage.completion_tokens_details || {};
                    const reasoning = details.reasoning_tokens || 0;
                    let txt = `• gasto de tokens: ~${usage.total_tokens} (prompt: ${usage.prompt_tokens}, completion: ${usage.completion_tokens}`;
                    if (reasoning > 0) {
                        txt += `, raciocínio: ${reasoning}`;
                    }
                    txt += ')';
                    tokensBadge.textContent = txt;
                    newResponse.appendChild(tokensBadge);
                }

                const lastBlockOAI = transcriptionElement.querySelector('.interaction-block:last-child');
                if (lastBlockOAI) {
                    lastBlockOAI.appendChild(newResponse);
                } else {
                    transcriptionElement.appendChild(newResponse);
                }

                document.getElementById('robot').style.display = 'none';

                // Scroll suave para o fim
                setTimeout(() => scrollTranscriptionToBottom('smooth'), 100);

            });

            if (window.electronAPI.onVisionGuideMessage) {
                window.electronAPI.onVisionGuideMessage((data) => {
                    if (!data || !data.text) return;
                    
                    const fileViewer = document.getElementById('file-viewer');
                    const isEditorVisible = fileViewer && fileViewer.classList.contains('open');
                    
                    if (isEditorVisible) {
                        const notif = document.getElementById('ide-tutor-notif');
                        const msgEl = document.getElementById('ide-tutor-msg');
                        if (notif && msgEl) {
                            msgEl.innerHTML = data.text;
                            notif.classList.add('visible');
                            notif.style.pointerEvents = 'auto';
                            notif.style.cursor = 'pointer';
                            notif.onclick = () => notif.classList.remove('visible');
                            
                            if (window.ideTutorTimeout) clearTimeout(window.ideTutorTimeout);
                            window.ideTutorTimeout = setTimeout(() => {
                                notif.classList.remove('visible');
                            }, 10000);
                        }
                    } else {
                        const transcriptionElement = document.getElementById('transcription');
                        
                        const hero = document.getElementById('welcome-hero');
                        if (hero) hero.classList.add('hidden');
                        
                        const newResponse = document.createElement('div');
                        newResponse.className = 'ia-response';
                        newResponse.style.borderLeft = '3px solid var(--accent-2)';
                        newResponse.style.paddingLeft = '10px';
                        newResponse.style.marginTop = '10px';
                        newResponse.innerHTML = `<strong>Tutor:</strong> ${formatOpenAIResponse(data.text)}`;
                        
                        transcriptionElement.appendChild(newResponse);
                        scrollTranscriptionToBottom();
                    }
                });
            }
})();
