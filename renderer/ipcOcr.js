// IPC: resultado de OCR (captura de tela / imagem colada)
// Restaurado do index.html original (bloco perdido na divisão automática).
(function() {

            window.electronAPI.onOcrResult(async ({ text, screenshotPath, base64Image, error, directSend }) => {
                const preview = document.getElementById('screenshot-preview');
                const robot = document.getElementById('robot');
                const animationContainer = document.getElementById('animation-container');
                const transcriptionElement = document.getElementById('transcription');
                const welcomeHero = document.getElementById('welcome-hero');

                // Esconde outros elementos de carregamento e garante que o hero suma imediatamente
                if (animationContainer) animationContainer.style.display = 'none';
                if (welcomeHero) welcomeHero.classList.add('hidden');
                
                // Se houve erro no OCR, exibir mensagem de erro
                if (error) {
                    console.warn('OCR Error:', error);
                    if (robot) robot.style.display = 'none';
                    
                    if (manualInputActive) {
                        // Se estamos em input manual, apenas logar o erro
                        console.log('OCR error in manual input mode, continuing...');
                        return;
                    }
                    
                    // Mostrar mensagem de erro apenas se não estivermos em input manual
                    const errorMsg = document.createElement('p');
                    errorMsg.style.color = '#ff6b6b';
                    errorMsg.textContent = `Erro no OCR: ${error}`;
                    if (transcriptionElement) {
                        transcriptionElement.appendChild(errorMsg);
                        if (typeof window.scrollTranscriptionToBottom === 'function') {
                            window.scrollTranscriptionToBottom();
                        }
                    }
                    return;
                }

                // Mostra a miniatura no card de preview acima do composer
                const imgSrc = base64Image || (screenshotPath ? `file://${screenshotPath}` : '');
                if (base64Image) {
                    window.pendingChatImage = base64Image;
                }
                if (imgSrc) {
                    if (typeof window.showComposerImagePreview === 'function') {
                        window.showComposerImagePreview(imgSrc);
                    } else if (preview) {
                        preview.src = imgSrc;
                        preview.style.display = 'block';
                    }
                }

                // Se o input manual está ativo, verificar se o usuário já digitou uma pergunta.
                // Se o input estiver vazio (o usuário acionou captura via atalho global), não prender
                // no preview: envia diretamente para a IA como no fluxo padrão do Windows.
                const tInput = document.querySelector('.manual-input-container .terminal-input');
                const userTypedText = tInput ? (tInput.value || '').trim() : '';

                if (!directSend && manualInputActive && userTypedText.length > 0) {
                    pastedImageForManualInput = base64Image || (`file://${screenshotPath}`);
                    if (robot) robot.style.display = 'none';
                    if (text && !userTypedText.includes(text)) {
                        tInput.value = userTypedText + '\n' + text;
                        tInput.focus();
                    }
                    return;
                }

                if (manualInputActive) {
                    manualInputActive = false;
                    const container = document.querySelector('.manual-input-container');
                    if (container) {
                        try { container.remove(); } catch (_) {}
                    }
                    if (typeof window.undockComposer === 'function') {
                        window.undockComposer();
                    }
                }

                if (robot) robot.style.display = 'block';
                // Alinhar à esquerda para transcrições de imagem
                if (transcriptionElement) transcriptionElement.classList.add('ocr-left');

                // Verifica se há um bloco de colagem pendente (apenas de um Ctrl+V recente ainda sem resposta)
                const lastBlock = transcriptionElement ? transcriptionElement.querySelector('.interaction-block:last-child') : null;
                const isPendingPasteBlock = lastBlock &&
                    !lastBlock.querySelector('.ia-response') &&
                    !lastBlock.querySelector('.ai-phase.done') &&
                    currentQuestionElement &&
                    currentQuestionElement.closest('.interaction-block') === lastBlock &&
                    (currentQuestionElement.textContent || '').trim() === 'Image in context';

                if (isPendingPasteBlock) {
                    const resolvedTitle = (text && text.trim()) ? text.trim() : '📸 Imagem colada';
                    if (typeof window.setQuestionText === 'function') {
                        window.setQuestionText(currentQuestionElement, resolvedTitle);
                    } else {
                        currentQuestionElement.textContent = resolvedTitle;
                    }

                    const targetBlock = lastBlock;
                    window.activeInteractionBlock = targetBlock;

                    if (typeof window.startProcessing === 'function') {
                        window.startProcessing(targetBlock);
                    }

                    if (window.pendingChatImage && typeof window.backendSupportsVision === 'function' && await window.backendSupportsVision()) {
                        if (typeof window.sentImageToAI === 'function') {
                            window.sentImageToAI(text || '', window.pendingChatImage, { block: targetBlock });
                        }
                        window.pendingChatImage = null;
                    } else {
                        if (typeof window.sentToAI === 'function') {
                            window.sentToAI(text || 'Processo texto da imagem', { block: targetBlock });
                        }
                    }

                    setTimeout(() => {
                        if (typeof window.hideComposerImagePreview === 'function') window.hideComposerImagePreview();
                        else if (preview) preview.style.display = 'none';
                    }, 8000);

                    return;
                }

                // Captura via Ctrl+Shift+S / Ctrl+Shift+X ou imagem enviada:
                // SEMPRE cria um novo bloco no final da conversa
                if (window.pendingChatImage) {
                    const questionTitle = (text && text.trim()) ? text.trim() : '📸 Captura de tela';
                    let qSpan = null;
                    if (typeof window.appendQuestionEntry === 'function') {
                        qSpan = window.appendQuestionEntry(questionTitle);
                    }
                    const targetBlock = qSpan ? qSpan.closest('.interaction-block') : (transcriptionElement ? transcriptionElement.querySelector('.interaction-block:last-child') : null);
                    if (targetBlock) {
                        window.activeInteractionBlock = targetBlock;
                    }

                    if (typeof window.startProcessing === 'function') {
                        window.startProcessing(targetBlock);
                    }
                    if (typeof window.sentImageToAI === 'function') {
                        window.sentImageToAI(text || '', window.pendingChatImage, { block: targetBlock });
                    }
                    window.pendingChatImage = null;
                    setTimeout(() => {
                        if (typeof window.hideComposerImagePreview === 'function') window.hideComposerImagePreview();
                        else if (preview) preview.style.display = 'none';
                    }, 8000);
                    return;
                }

                // Se houver apenas texto OCR sem imagem pendente:
                if (text && text.trim().length > 0) {
                    let qSpan = null;
                    if (typeof window.appendQuestionEntry === 'function') {
                        qSpan = window.appendQuestionEntry(text.trim());
                    }
                    const targetBlock = qSpan ? qSpan.closest('.interaction-block') : (transcriptionElement ? transcriptionElement.querySelector('.interaction-block:last-child') : null);
                    if (targetBlock) {
                        window.activeInteractionBlock = targetBlock;
                    }
                    if (typeof window.startProcessing === 'function') {
                        window.startProcessing(targetBlock);
                    }
                    if (typeof window.sentToAI === 'function') {
                        window.sentToAI(text, { block: targetBlock });
                    }
                } else {
                    if (robot) robot.style.display = 'none';
                    console.log('Nenhum texto encontrado, não enviando para IA');
                }

                setTimeout(() => {
                    if (typeof window.hideComposerImagePreview === 'function') window.hideComposerImagePreview();
                    else if (preview) preview.style.display = 'none';
                }, 8000);
            });
})();
