// IPC: resultado de OCR (captura de tela / imagem colada)
// Restaurado do index.html original (bloco perdido na divisão automática).
(function() {

            window.electronAPI.onOcrResult(async ({ text, screenshotPath, base64Image, error }) => {
                const preview = document.getElementById('screenshot-preview');
                const robot = document.getElementById('robot');
                const animationContainer = document.getElementById('animation-container');
                const transcriptionElement = document.getElementById('transcription');

                // Esconde outros elementos de carregamento
                animationContainer.style.display = 'none';
                
                // Se houve erro no OCR, exibir mensagem de erro
                if (error) {
                    console.warn('OCR Error:', error);
                    robot.style.display = 'none';
                    
                    if (manualInputActive) {
                        // Se estamos em input manual, apenas logar o erro
                        console.log('OCR error in manual input mode, continuing...');
                        return;
                    }
                    
                    // Mostrar mensagem de erro apenas se não estivermos em input manual
                    const errorMsg = document.createElement('p');
                    errorMsg.style.color = '#ff6b6b';
                    errorMsg.textContent = `Erro no OCR: ${error}`;
                    transcriptionElement.appendChild(errorMsg);
                    scrollTranscriptionToBottom();
                    return;
                }

                // Mostra a miniatura (use base64 if provided)
                if (base64Image) {
                    // Captura (Ctrl+Shift+S) traz o base64 aqui; paste já setou antes.
                    // Só sobrescreve quando vier base64 real (não apaga o do paste).
                    window.pendingChatImage = base64Image;
                    preview.src = base64Image;
                } else if (screenshotPath) {
                    preview.src = `file://${screenshotPath}`;
                }
                preview.style.display = 'block';

                // Se input manual está ativo, não envia nada ainda; apenas guarda e mostra
                if (manualInputActive) {
                    pastedImageForManualInput = base64Image || (`file://${screenshotPath}`);
                    robot.style.display = 'none';
                    // Insere o texto OCR no início do input (terminal contenteditable)
                    const tInput = document.querySelector('.manual-input-container .terminal-input');
                    if (tInput && text) {
                        const existingText = tInput.value;
                        tInput.value = text + '\n' + existingText;
                        tInput.focus();
                    }
                    return;
                }

                robot.style.display = 'block';
                // Alinhar à esquerda para transcrições de imagem
                transcriptionElement.classList.add('ocr-left');

                // --- START MODIFICATION ---
                // If there's an existing question (from paste event "Image in context"), append to it
                if (currentQuestionElement && currentQuestionElement.textContent.includes("Image in context")) {
                    let combinedText = getQuestionText(currentQuestionElement);
                    // Add the OCR text, potentially on a new line for clarity
                    combinedText += `\n${text}`; 
                    
                    currentQuestionElement.textContent = combinedText; // Update the question span
                    const editIcon = document.createElement('span'); // Re-add edit icon
                    editIcon.className = 'edit-icon';
                    editIcon.innerHTML = EDIT_ICON_SVG;

                    // Se há imagem colada e o backend tem visão, manda a IMAGEM
                    // (não o OCR). É o que faz a captura realmente chegar no modelo.
                    if (window.pendingChatImage && await backendSupportsVision()) {
                        sentImageToAI('', window.pendingChatImage);
                        window.pendingChatImage = null;
                    } else {
                        sentToAI(text || 'Processo texto da imagem');
                    }

                    setTimeout(() => {
                        preview.style.display = 'none';
                    }, 8000);

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

                // Captura via Ctrl+Shift+S em modo normal: se há imagem e o backend
                // tem visão, manda a IMAGEM pro modelo (independe do OCR ter texto).
                if (window.pendingChatImage && await backendSupportsVision()) {
                    sentImageToAI('', window.pendingChatImage);
                    window.pendingChatImage = null;
                    setTimeout(() => { preview.style.display = 'none'; }, 8000);
                    return;
                }

                transcriptionElement.appendChild(ocrContainer);
                scrollTranscriptionToBottom();

                // Só envia para IA se encontrou texto
                if (text && text.trim().length > 0) {
                    sentToAI(text);
                } else {
                    robot.style.display = 'none';
                    console.log('Nenhum texto encontrado, não enviando para IA');
                }

                setTimeout(() => {
                    preview.style.display = 'none';
                }, 8000);
            });
})();
