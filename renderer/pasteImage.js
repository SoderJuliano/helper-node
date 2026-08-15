// Colagem de imagem (Ctrl+V) no chat.
//
// Dois comportamentos, decididos pelo MAIN (não aqui):
//   modo IDE (projeto aberto) → imagem vira arquivo anexado ao contexto; volta
//     pelo evento `image-attached` e vira um chip no painel de workspace.
//   fora do modo IDE          → OCR pro input, como sempre foi.
//
// Este arquivo só repassa bytes. Duas regras que vieram de bugs reais:
//   1. O evento `paste` do Chromium SÓ dispara com campo editável em foco. Na
//      tela hero nada está focado, então existe o fallback por Ctrl+V lendo o
//      clipboard do SO via IPC. Não "simplificar" removendo um dos dois.
//   2. NUNCA inserir <img> com data-URL no caminho de envio: a decodificação
//      síncrona travava o event loop do renderer e a pergunta nunca era
//      enviada (o app inteiro congelava). Miniatura só via file://, e depois.
(function() {
    // Evita processar a mesma imagem duas vezes quando o paste nativo e o
    // fallback de Ctrl+V disparam juntos.
    let lastHandledAt = 0;
    function recentlyHandled() {
        const now = Date.now();
        if (now - lastHandledAt < 700) return true;
        lastHandledAt = now;
        return false;
    }

    async function handlePastedImage(base64Image) {
        if (!base64Image) return;

        let ideMode = false;
        try {
            ideMode = window.electronAPI && window.electronAPI.isIdeProjectMode
                ? await window.electronAPI.isIdeProjectMode()
                : false;
        } catch (_) {}

        if (ideMode) {
            // O main grava, faz OCR e anexa; a UI reage ao `image-attached`.
            // Nada de "Image in context" no transcript nem preview data-URL.
            if (typeof showToast === 'function') showToast('Anexando imagem ao contexto…');
            window.electronAPI.processPastedImage(base64Image);
            return;
        }

        // ── Fluxo antigo, intocado ───────────────────────────────────────────
        window.pendingChatImage = base64Image;

        if (manualInputActive) {
            pastedImageForManualInput = base64Image;
            const preview = document.getElementById('screenshot-preview');
            preview.src = base64Image;
            preview.style.display = 'block';
            window.electronAPI.processPastedImage(base64Image);
        } else {
            const robot = document.getElementById('robot');
            if (robot) robot.style.display = 'block';
            appendQuestionEntry("Image in context");
            window.electronAPI.processPastedImage(base64Image);
        }
    }

    // Caminho 1: paste nativo (só funciona com campo editável em foco).
    document.addEventListener('paste', (event) => {
        const items = (event.clipboardData || window.clipboardData).items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const imageFile = items[i].getAsFile();
                console.log('Imagem colada detectada!');
                if (recentlyHandled()) { event.preventDefault(); return; }

                const reader = new FileReader();
                reader.onload = (e) => { handlePastedImage(e.target.result); };
                reader.readAsDataURL(imageFile);

                event.preventDefault();
                break;
            }
        }
    });

    // Caminho 2: Ctrl+V sem campo focado — lê o clipboard do SO pelo main.
    document.addEventListener('keydown', async (e) => {
        const isPaste = (e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V');
        if (!isPaste) return;

        // Com campo editável em foco o evento `paste` acima já resolve.
        const el = document.activeElement;
        const editable = el && (el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName));
        if (editable) return;

        if (!(window.electronAPI && window.electronAPI.readClipboardImage)) return;
        try {
            const dataUrl = await window.electronAPI.readClipboardImage();
            if (!dataUrl) return;
            if (recentlyHandled()) return;
            console.log('Imagem colada detectada (clipboard do SO)!');
            handlePastedImage(dataUrl);
        } catch (_) {}
    });

    // Confirmação visual do anexo: atualiza o painel de workspace e avisa
    // quando o provider atual não enxerga imagem (agy só recebe o OCR).
    if (window.electronAPI && window.electronAPI.onImageAttached) {
        window.electronAPI.onImageAttached((data) => {
            if (!data) return;
            if (data.attachments && typeof renderWorkspacePanel === 'function') {
                renderWorkspacePanel(data.attachments);
            }
            if (typeof showToast === 'function') {
                showToast(data.providerSeesImage
                    ? 'Imagem anexada ao contexto.'
                    : 'Imagem anexada — este provedor não lê imagens, será usado o texto extraído (OCR).');
            }
        });
    }
})();
