// Colagem de imagem (Ctrl+V) no chat — dispara OCR via IPC.
// Separado de chatInput.js para respeitar o limite de 500 linhas.
(function() {
    // Paste event handler
            document.addEventListener('paste', (event) => {
                const items = (event.clipboardData || window.clipboardData).items;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        const imageFile = items[i].getAsFile();
                        console.log('Imagem colada detectada!');
                        
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            const base64Image = e.target.result;

                            // Guarda o data URL real da imagem pra mandar pro modelo
                            // de visão (o OCR/ocr-result não carrega o base64 de volta).
                            window.pendingChatImage = base64Image;

                            if (manualInputActive) {
                                // NOVO FLUXO: Input manual está aberto
                                console.log('Input manual ativo, mostrando preview e iniciando OCR da imagem.');
                                pastedImageForManualInput = base64Image;
                                const preview = document.getElementById('screenshot-preview');
                                preview.src = base64Image;
                                preview.style.display = 'block';
                                // Processa OCR agora para ter o texto pronto no envio
                                window.electronAPI.processPastedImage(base64Image);
                            } else {
                                // FLUXO ANTIGO: Input manual fechado, processa imediatamente
                                const robot = document.getElementById('robot');
                                if (robot) robot.style.display = 'block';

                                const message = "Image in context";
                                appendQuestionEntry(message);

                                window.electronAPI.processPastedImage(base64Image);
                            }
                        };
                        reader.readAsDataURL(imageFile);

                        event.preventDefault();
                        break;
                    }
                }
            });
})();
