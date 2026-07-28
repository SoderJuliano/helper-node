// IPC: captura em andamento e streaming de resposta
// Restaurado do index.html original (bloco perdido na divisão automática).

// Estado do streaming. Fora da IIFE porque chatHistory (novo chat) e
// chatMessages (editar pergunta) precisam RESETAR essas variáveis.
var streamingElement = null;
var streamingText = '';
var typingCursor = null;

(function() {
    const transcriptionElement = document.getElementById('transcription');
    const robot = document.getElementById('robot');

            window.electronAPI.onCapturingScreen((val) => {
                // Usa o robot loading padrao (mesmo "pensando" das respostas).
                // val=true: imagem entrou no contexto, OCR/IA processando.
                // val=false: handler de captura terminou (ja existem outros pontos
                // que escondem o robot após a resposta da IA).
                const robot = document.getElementById('robot');
                if (!robot) return;
                robot.style.display = val ? 'block' : 'none';
            })

            // ===== STREAMING LISTENERS =====
            window.electronAPI.onStreamChunk((chunk) => {
                const transcriptionElement = document.getElementById('transcription');
                
                console.log('Chunk recebido:', JSON.stringify(chunk), 'Length:', chunk.length);
                
                // Cria o elemento de streaming na primeira chunk
                if (!streamingElement) {
                    console.log('Criando novo elemento de streaming');
                    streamingElement = document.createElement('div');
                    streamingElement.className = 'streaming-response';
                    
                    typingCursor = document.createElement('span');
                    typingCursor.className = 'typing-cursor';
                    
                    const lastBlockStream = transcriptionElement.querySelector('.interaction-block:last-child');
                    if (lastBlockStream) {
                        lastBlockStream.appendChild(streamingElement);
                    } else {
                        transcriptionElement.appendChild(streamingElement);
                    }
                    streamingElement.appendChild(typingCursor);
                    streamingText = '';
                    console.log('Elemento de streaming criado');
                }
                
                let currentThinkBlock = streamingElement.querySelector('details.think-block');

                if (typeof chunk === 'object' && chunk.type === 'thinking') {
                    if (chunk.event === 'thinking-start') {
                        if (!currentThinkBlock) {
                            const details = document.createElement('details');
                            details.className = 'think-block';
                            details.open = true;
                            const summary = document.createElement('summary');
                            summary.textContent = 'Raciocínio';
                            details.appendChild(summary);
                            const content = document.createElement('div');
                            details.appendChild(content);
                            streamingElement.insertBefore(details, typingCursor);
                        }
                    } else if (chunk.event === 'thinking-end') {
                        if (currentThinkBlock) {
                            currentThinkBlock.open = false; // Collapse when done
                        }
                    } else {
                        if (!currentThinkBlock) {
                            const details = document.createElement('details');
                            details.className = 'think-block';
                            details.open = true;
                            const summary = document.createElement('summary');
                            summary.textContent = 'Raciocínio';
                            details.appendChild(summary);
                            const content = document.createElement('div');
                            details.appendChild(content);
                            streamingElement.insertBefore(details, typingCursor);
                            currentThinkBlock = details;
                        }
                        const contentDiv = currentThinkBlock.querySelector('div');
                        contentDiv.textContent += chunk.text;
                    }
                    
                    // Scroll automático para thinking
                    transcriptionElement.scrollTo({
                        top: transcriptionElement.scrollHeight,
                        behavior: 'smooth'
                    });
                    return; // Retorna cedo para não jogar thinking no texto final
                }

                // SIMPLE RULE: Just concatenate tokens as-is, backend should send spaces
                // If backend doesn't send spaces between words, they will be joined
                streamingText += chunk;
                console.log('Total text length:', streamingText.length);
                
                // Remove o cursor, atualiza o texto, adiciona o cursor de volta
                if (typingCursor && typingCursor.parentNode) {
                    typingCursor.remove();
                }
                
                streamingElement.textContent = streamingText;
                streamingElement.appendChild(typingCursor);
                
                // Scroll automático
                transcriptionElement.scrollTo({
                    top: transcriptionElement.scrollHeight,
                    behavior: 'smooth'
                });
            });

            window.electronAPI.onStreamComplete(() => {
                console.log('Stream complete triggered');
                const robot = document.getElementById('robot');
                robot.style.display = 'none';

                const finalStreamText = streamingText;
                if (window.historySession && finalStreamText) {
                    window.historySession.addMessageToCurrentSession('assistant', finalStreamText);
                }
                
                // Remove o cursor piscando
                if (typingCursor && typingCursor.parentNode) {
                    typingCursor.remove();
                }
                
                // Verificações de integridade
                const transcriptionElement = document.getElementById('transcription');
                const isElementInDOM = streamingElement && transcriptionElement.contains(streamingElement);
                

                console.log('Stream complete state check:', {
                    hasStreamingElement: !!streamingElement,
                    hasStreamingText: !!streamingText,
                    textLength: streamingText ? streamingText.length : 0,
                    isElementInDOM: isElementInDOM,
                    elementClassName: streamingElement ? streamingElement.className : 'none'
                });
                
                // Formata o texto final
                if (streamingElement && streamingText && isElementInDOM) {
                    console.log('Formatando texto final do stream:', streamingText.substring(0, 100) + '...');
                    
                    // Salva o think-block se existir
                    const existingThinkBlock = streamingElement.querySelector('details.think-block');
                    let thinkHTML = '';
                    if (existingThinkBlock) {
                        thinkHTML = existingThinkBlock.outerHTML;
                    }
                    
                    // Aplica formatação HTML básica
                    const formatted = formatStreamedText(streamingText);
                    console.log('Texto formatado:', formatted.substring(0, 200) + '...');
                    
                    streamingElement.innerHTML = thinkHTML + formatted;
                    
                    // Adiciona contagem estimada de tokens
                    const estimatedTokens = Math.ceil(streamingText.length / 4);
                    const tokenBadge = document.createElement('div');
                    tokenBadge.className = 'response-token-badge';
                    tokenBadge.style.fontSize = '0.75rem';
                    tokenBadge.style.color = '#888';
                    tokenBadge.style.marginTop = '8px';
                    tokenBadge.style.textAlign = 'right';
                    tokenBadge.textContent = `~${estimatedTokens} tokens`;
                    streamingElement.appendChild(tokenBadge);
                    
                    console.log('Stream formatting completed successfully');
                } else {
                    console.warn('Stream complete mas sem condições adequadas:', {
                        hasElement: !!streamingElement,
                        hasText: !!streamingText,
                        textLength: streamingText ? streamingText.length : 0,
                        isElementInDOM: isElementInDOM,
                        transcriptionChildren: transcriptionElement.children.length
                    });
                    
                    // Tenta recuperar elementos perdidos
                    if (streamingText && !streamingElement) {
                        console.log('Tentando recuperar elemento perdido...');
                        const existingResponse = transcriptionElement.querySelector('.streaming-response');
                        if (existingResponse) {
                            console.log('Encontrado elemento existente, aplicando formatação');
                            streamingElement = existingResponse;
                            const formatted = formatStreamedText(streamingText);
                            streamingElement.innerHTML = formatted;
                        }
                    }
                }
                
                // Reseta as variáveis
                streamingElement = null;
                streamingText = '';
                typingCursor = null;
                
                console.log('Stream completo! Variáveis resetadas.');
            });

            // Listener para auto-stream após transcrição de áudio
            window.electronAPI.onAutoStream(async (text) => {
                console.log('Auto-streaming after transcription:', text);
                let activeSessionId = null;
                if (window.historySession) {
                    activeSessionId = await window.historySession.ensureSessionForFirstQuestion(text);
                    await window.historySession.addMessageToCurrentSession('user', text);
                }
                window.electronAPI.sendTextToGeminiStream(text, activeSessionId);
            });
})();
