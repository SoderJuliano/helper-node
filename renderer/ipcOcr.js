// IPC: resultado de OCR (captura de tela / imagem colada)
// Restaurado do index.html original (bloco perdido na divisão automática).
(function() {

            window.electronAPI.onOcrResult(async ({ text, screenshotPath, base64Image, error }) => {
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

                // Mostra a miniatura (use base64 if provided)
                if (base64Image) {
                    // Captura (Ctrl+Shift+S) traz o base64 aqui; paste já setou antes.
                    // Só sobrescreve quando vier base64 real (não apaga o do paste).
                    window.pendingChatImage = base64Image;
                    if (preview) preview.src = base64Image;
                } else if (screenshotPath) {
                    if (preview) preview.src = `file://${screenshotPath}`;
                }
                if (preview) preview.style.display = 'block';

                // Se input manual está ativo, não envia nada ainda; apenas guarda e mostra
                if (manualInputActive) {
                    pastedImageForManualInput = base64Image || (`file://${screenshotPath}`);
                    if (robot) robot.style.display = 'none';
                    // Insere o texto OCR no início do input (terminal contenteditable)
                    const tInput = document.querySelector('.manual-input-container .terminal-input');
                    if (tInput && text) {
                        const existingText = tInput.value;
                        tInput.value = text + '\n' + existingText;
                        tInput.focus();
                    }
                    return;
                }

                if (robot) robot.style.display = 'block';
                // Alinhar à esquerda para transcrições de imagem
                if (transcriptionElement) transcriptionElement.classList.add('ocr-left');

                // --- START MODIFICATION ---
                // If there's an existing question (from paste event "Image in context"), append to it
                if (currentQuestionElement && currentQuestionElement.textContent.includes("Image in context")) {
                    let combinedText = typeof window.getQuestionText === 'function'
                        ? window.getQuestionText(currentQuestionElement)
                        : (currentQuestionElement.textContent || '');
                    // Add the OCR text, potentially on a new line for clarity
                    if (text && text.trim()) combinedText += `\n${text.trim()}`; 
                    
                    if (typeof window.setQuestionText === 'function') {
                        window.setQuestionText(currentQuestionElement, combinedText);
                    } else {
                        currentQuestionElement.textContent = combinedText;
                    }

                    if (typeof window.startProcessing === 'function') {
                        window.startProcessing();
                    }

                    // Se há imagem colada e o backend tem visão, manda a IMAGEM
                    // (não o OCR). É o que faz a captura realmente chegar no modelo.
                    if (window.pendingChatImage && typeof window.backendSupportsVision === 'function' && await window.backendSupportsVision()) {
                        if (typeof window.sentImageToAI === 'function') {
                            window.sentImageToAI(text || '', window.pendingChatImage);
                        }
                        window.pendingChatImage = null;
                    } else {
                        if (typeof window.sentToAI === 'function') {
                            window.sentToAI(text || 'Processo texto da imagem');
                        }
                    }

                    setTimeout(() => {
                        if (preview) preview.style.display = 'none';
                    }, 8000);

                    return;
                }

                // Captura via Ctrl+Shift+S ou paste em modo normal: envia a imagem para o backend
                if (window.pendingChatImage) {
                    const questionTitle = (text && text.trim()) ? text.trim() : '📸 Captura de tela';
                    if (typeof window.appendQuestionEntry === 'function') {
                        window.appendQuestionEntry(questionTitle);
                    }
                    if (typeof window.startProcessing === 'function') {
                        window.startProcessing();
                    }
                    if (typeof window.sentImageToAI === 'function') {
                        window.sentImageToAI(text || '', window.pendingChatImage);
                    }
                    window.pendingChatImage = null;
                    setTimeout(() => { if (preview) preview.style.display = 'none'; }, 8000);
                    return;
                }

                // Detectar conteúdo HTML/CSS e renderizar como bloco de código
                const hasHtmlTags = /<\/?[a-zA-Z][^>]*>/m.test(text || '');
                const hasCssBraces = /\{[\s\S]*\}/m.test(text || '');
                const ocrContainer = document.createElement('div');
                ocrContainer.className = 'ia-response';
                
                if (text && (hasHtmlTags || hasCssBraces)) {
                    const pre = document.createElement('pre');
                    const code = document.createElement('code');
                    const copyBtn = document.createElement('button');
                    copyBtn.className = 'copy-button';
                    copyBtn.title = 'Copiar';
                    copyBtn.setAttribute('aria-label', 'Copiar código');
                    copyBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
                    code.textContent = text;
                    pre.appendChild(copyBtn);
                    pre.appendChild(code);
                    ocrContainer.appendChild(pre);
                } else {
                    // Texto simples ou vazio
                    ocrContainer.textContent = text || 'Nenhum texto encontrado na imagem';
                }

                if (transcriptionElement) {
                    transcriptionElement.appendChild(ocrContainer);
                    if (typeof window.scrollTranscriptionToBottom === 'function') {
                        window.scrollTranscriptionToBottom();
                    }
                }

                // Só envia para IA se encontrou texto
                if (text && text.trim().length > 0) {
                    if (typeof window.appendQuestionEntry === 'function') {
                        window.appendQuestionEntry(text.trim());
                    }
                    if (typeof window.startProcessing === 'function') {
                        window.startProcessing();
                    }
                    if (typeof window.sentToAI === 'function') {
                        window.sentToAI(text);
                    }
                } else {
                    if (robot) robot.style.display = 'none';
                    console.log('Nenhum texto encontrado, não enviando para IA');
                }

                setTimeout(() => {
                    if (preview) preview.style.display = 'none';
                }, 8000);
            });
})();
