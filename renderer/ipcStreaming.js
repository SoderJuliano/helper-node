// IPC: captura em andamento e streaming de resposta
// Restaurado do index.html original (bloco perdido na divisão automática).

// Estado do streaming. Fora da IIFE porque chatHistory (novo chat) e
// chatMessages (editar pergunta) precisam RESETAR essas variáveis.
var streamingElement = null;
var streamingText = '';
var typingCursor = null;

// Texto CRU do raciocínio da resposta atual. Guardado à parte porque o
// raciocínio precisa ser re-renderizado inteiro a cada atualização: o modelo
// despeja trechos de código dentro do pensamento, e mostrar isso como texto
// corrido fica ilegível. Com o markdown do projeto, ``` vira <pre><code>.
var thinkingRaw = '';
var thinkingRenderTimer = null;
var thinkingNoDom = 0;        // quanto do raw já foi pro DOM no modo texto
var thinkingModoTexto = false; // caiu pro modo barato (append incremental)?

// Acima disto, formatar ao vivo custa caro demais: reconstruir o innerHTML de
// um texto de dezenas de KB (com blocos <pre> e botões de copiar) a cada tick
// trava o renderer — foi o que fez a caixa de raciocínio "congelar" enquanto o
// modelo continuava mandando tokens. Passando do limite, o texto só é
// ACRESCENTADO (barato) e a formatação completa acontece uma vez, no fim.
var LIMITE_MARKDOWN_AO_VIVO = 20000;

function renderThinking(contentDiv, final) {
    if (!contentDiv) return;
    if (thinkingRaw.length <= LIMITE_MARKDOWN_AO_VIVO || final) {
        try {
            if (typeof window.renderMarkdown === 'function') {
                contentDiv.innerHTML = window.renderMarkdown(thinkingRaw, 'stream');
            } else {
                contentDiv.textContent = thinkingRaw;
            }
            thinkingModoTexto = false;
        } catch (e) {
            // Markdown quebrado no meio do stream (bloco de código aberto, por
            // exemplo) não pode derrubar a exibição do raciocínio.
            console.warn('renderThinking: markdown falhou, caindo pra texto:', e && e.message);
            contentDiv.textContent = thinkingRaw;
            thinkingModoTexto = true;
        }
        thinkingNoDom = thinkingRaw.length;
    } else if (!thinkingModoTexto) {
        contentDiv.textContent = thinkingRaw; // troca de modo: uma vez só
        thinkingModoTexto = true;
        thinkingNoDom = thinkingRaw.length;
    } else if (thinkingRaw.length > thinkingNoDom) {
        // Append puro: não reconstrói nada do que já está na tela.
        contentDiv.appendChild(document.createTextNode(thinkingRaw.slice(thinkingNoDom)));
        thinkingNoDom = thinkingRaw.length;
    }
    // A caixa tem altura fixa e rola por dentro: acompanha o texto novo sozinha.
    contentDiv.scrollTop = contentDiv.scrollHeight;
}

// Re-renderizar a cada token seria custoso e faria o texto piscar. Agrupa em
// janelas de ~250ms.
function agendarRenderThinking(contentDiv) {
    if (thinkingRenderTimer) return;
    thinkingRenderTimer = setTimeout(() => {
        thinkingRenderTimer = null;
        renderThinking(contentDiv, false);
    }, 250);
}

// Só arrasta a tela pro fim se o usuário JÁ estiver no fim. Antes, cada token
// de raciocínio forçava scrollTo(scrollHeight) — com centenas de tokens era
// impossível rolar pra cima: a tela puxava de volta pra baixo sem parar, e o
// botão de interromper ficava inalcançável enquanto a IA não parava sozinha.
function autoScrollSeNoFim(el) {
    if (!el) return;
    const distanciaDoFim = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanciaDoFim > 120) return; // usuário rolou pra cima: respeita
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}

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
                // Turno interrompido pelo usuário: descarta. Sem esta guarda,
                // qualquer chunk que chegasse depois do "Parar IA" continuava
                // sendo escrito no chat — e, se um erro já tivesse limpado a
                // tela, o texto reaparecia colado na mensagem de erro. A trava
                // do lado do provider (CopilotCliProvider._aborted) resolve a
                // origem; esta é a rede de proteção pros outros provedores.
                if (window.iaCancelled) return;

                const transcriptionElement = document.getElementById('transcription');

                console.log('Chunk recebido:', JSON.stringify(chunk), 'Length:', chunk.length);

                // Cria o elemento de streaming na primeira chunk
                if (!streamingElement) {
                    console.log('Criando novo elemento de streaming');
                    // Raciocínio é por resposta: zera o buffer da anterior.
                    thinkingRaw = '';
                    thinkingNoDom = 0;
                    thinkingModoTexto = false;
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
                        thinkingRaw += chunk.text;
                        agendarRenderThinking(contentDiv);
                    }

                    // Scroll automático para thinking (só se já estiver no fim)
                    autoScrollSeNoFim(transcriptionElement);
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

                // Scroll automático (só se já estiver no fim)
                autoScrollSeNoFim(transcriptionElement);
            });

            window.electronAPI.onStreamComplete(() => {
                console.log('Stream complete triggered');
                const robot = document.getElementById('robot');
                robot.style.display = 'none';

                // O bloco "Pensando" (com o spinner girando) é criado ao enviar
                // a pergunta, mas stopProcessing() só era chamado pelo botão de
                // interromper — no fim normal do stream ninguém desligava, e o
                // spinner ficava rodando para sempre embaixo da resposta já
                // pronta. É stopProcessing quem tira o spinner, o botão × e a
                // classe is-processing do bloco.
                if (typeof window.stopProcessing === 'function') window.stopProcessing();

                const finalStreamText = streamingText;
                if (window.historySession && finalStreamText) {
                    window.historySession.addMessageToCurrentSession('assistant', finalStreamText);
                }
                if (window.electronAPI && window.electronAPI.triggerTtsPlayback && finalStreamText) {
                    window.electronAPI.triggerTtsPlayback(finalStreamText);
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
                        // Render final: pode haver um lote de tokens ainda
                        // pendente no throttle de 120ms, e o outerHTML abaixo
                        // congela o que estiver na tela — sem isso o fim do
                        // raciocínio se perdia.
                        if (thinkingRenderTimer) {
                            clearTimeout(thinkingRenderTimer);
                            thinkingRenderTimer = null;
                        }
                        // final=true: força a formatação completa mesmo se o
                        // raciocínio passou do limite do render ao vivo.
                        renderThinking(existingThinkBlock.querySelector('div'), true);
                        // Fecha o raciocínio ao terminar. O colapso dependia de um
                        // evento 'thinking-end', que o backendStreamRouter NUNCA
                        // emite (todo thinking sai como event:'thinking'), então a
                        // caixa ficava aberta pra sempre. Como o outerHTML é
                        // capturado logo abaixo, tem que fechar ANTES.
                        existingThinkBlock.open = false;
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
                // Turno novo (voz): destrava o stream — este caminho não passa
                // pelo startProcessing nem pelo sentToAI.
                window.iaCancelled = false;
                let activeSessionId = null;
                if (window.historySession) {
                    activeSessionId = await window.historySession.ensureSessionForFirstQuestion(text);
                    await window.historySession.addMessageToCurrentSession('user', text);
                }
                window.electronAPI.sendTextToGeminiStream(text, activeSessionId);
            });
})();
