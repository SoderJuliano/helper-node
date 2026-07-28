// Markdown Renderer & Clipboard Helpers Module
(function() {
        function copyTextReliable(text) {
            try {
                if (window.electronAPI && window.electronAPI.copyToClipboard) {
                    window.electronAPI.copyToClipboard(text);
                    return true;
                }
            } catch (_) {}
            try { navigator.clipboard.writeText(text).catch(() => {}); } catch (_) {}
            return true;
        }

 // copyTextReliable
        const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

        function createBlockActions(transcriptionElement) {
            // Ícone de copiar a RESPOSTA (vira ✓ ao copiar, estilo ChatGPT).
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-interaction-btn';
            copyBtn.title = 'Copiar resposta';
            copyBtn.setAttribute('aria-label', 'Copiar resposta');
            copyBtn.innerHTML = COPY_ICON_SVG;
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const block = copyBtn.closest('.interaction-block');
                let aEl = block.querySelector('.ia-response, .streaming-response');
                // Fallback: resposta pode ter caído fora do bloco (fluxos antigos)
                if (!aEl && block.nextElementSibling &&
                    block.nextElementSibling.matches('.ia-response, .streaming-response')) {
                    aEl = block.nextElementSibling;
                }
                const aText = aEl ? (aEl.innerText || aEl.textContent || '').trim() : '';
                if (!aText) { if (typeof showToast === 'function') showToast('Nada para copiar ainda'); return; }
                // Clipboard do Electron via IPC: navigator.clipboard falha
                // silenciosamente quando a janela não está focada (overlay).
                copyTextReliable(aText);
                copyBtn.innerHTML = CHECK_ICON_SVG;
                copyBtn.classList.add('copied');
                setTimeout(() => { copyBtn.innerHTML = COPY_ICON_SVG; copyBtn.classList.remove('copied'); }, 1500);
            });
            return copyBtn;
        }

 // createBlockActions / COPY_ICON_SVG / CHECK_ICON_SVG
        function isDirectTypingKey(e) {
            if (!e || e.ctrlKey || e.metaKey || e.altKey) return false;
            if (e.key !== 'Backspace' && e.key.length !== 1) return false;
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return false;
            return true;
        }

        // Função para mostrar toast de "copiado"
 // isDirectTypingKey
        async function showCopyToast() {
            const lang = await window.electronAPI.getLanguage();
            const messages = {
                'pt-br': 'Copiado para a área de transferência',
                'en-us': 'Copied to clipboard'
            };
            
            const toast = document.getElementById('copy-toast');
            toast.textContent = messages[lang] || messages['pt-br'];
            toast.classList.add('show');
            
            setTimeout(() => {
                toast.classList.remove('show');
            }, 2000);
        }

        // Delegação de evento para copiar código ao clicar
 // showCopyToast
        function renderMarkdown(text, idPrefix) {
            if (!text) return '';
            const pfx = idPrefix || 'md';
            const escapeHTML = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const copyBtn = () => '<button class="copy-button" title="Copiar"><svg fill="currentColor" viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg></button>';

            const blocks = [];
            const hold = (html) => { const ph = `\x00B${blocks.length}\x00`; blocks.push(html); return ph; };

            // 1. Protege blocos ``` ... ```
            let out = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
                const id = `${pfx}-cb-${Date.now()}-${blocks.length}`;
                return hold(`<pre>${copyBtn()}<code id="${id}" class="language-${lang || 'text'}">${escapeHTML(code.trim())}</code></pre>`);
            });

            // 2. Código inline `x` → <code> inline (NÃO bloco)
            out = out.replace(/`([^`\n]+)`/g, (_, code) =>
                `<code class="inline-code" title="Clique para copiar">${escapeHTML(code)}</code>`
            );

            // 3. Negrito e itálico
            out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

            // 4. Processa linha a linha para headings e listas
            const lines = out.split('\n');
            const result = [];
            let listType = null;
            let listItems = [];

            const flushList = () => {
                if (!listItems.length) return;
                const tag = listType === 'ol' ? 'ol' : 'ul';
                result.push(`<${tag}>${listItems.map(li => `<li>${li}</li>`).join('')}</${tag}>`);
                listItems = [];
                listType = null;
            };

            for (const line of lines) {
                // Headings
                const h3 = line.match(/^###\s+(.+)/);
                const h2 = line.match(/^##\s+(.+)/);
                const h1 = line.match(/^#\s+(.+)/);
                if (h1) { flushList(); result.push(`<h1>${h1[1]}</h1>`); continue; }
                if (h2) { flushList(); result.push(`<h2>${h2[1]}</h2>`); continue; }
                if (h3) { flushList(); result.push(`<h3>${h3[1]}</h3>`); continue; }

                // Ordered list
                const olM = line.match(/^\d+\.\s+(.+)/);
                if (olM) {
                    if (listType !== 'ol') { flushList(); listType = 'ol'; }
                    listItems.push(olM[1]);
                    continue;
                }

                // Unordered list
                const ulM = line.match(/^[-*]\s+(.+)/);
                if (ulM) {
                    if (listType !== 'ul') { flushList(); listType = 'ul'; }
                    listItems.push(ulM[1]);
                    continue;
                }

                flushList();
                result.push(line);
            }
            flushList();

            // 5. Agrupa linhas em parágrafos (linha vazia = nova <p>)
            out = result.join('\n');
            out = out.replace(/\n\n+/g, '\x01').replace(/\n/g, '<br>').replace(/\x01/g, '</p><p>');
            if (!out.match(/^<(h[123]|ul|ol|pre|\x00)/)) out = '<p>' + out + '</p>';

            // 6. Restaura blocos protegidos
            blocks.forEach((b, i) => { out = out.replace(`\x00B${i}\x00`, b); });

            return out;
        }

        // Aliases mantidos para compatibilidade com chamadas existentes
        const formatStreamedText  = (t) => renderMarkdown(t, 'stream');
        const formatOpenAIResponse = (t) => renderMarkdown(t, 'openai');
        
 // renderMarkdown & escapes & formats

    // Expose functions globally
    window.copyTextReliable = copyTextReliable;
    window.createBlockActions = createBlockActions;
    window.isDirectTypingKey = isDirectTypingKey;
    window.showCopyToast = showCopyToast;
    window.renderMarkdown = renderMarkdown;
    window.formatStreamedText = formatStreamedText;
    window.formatOpenAIResponse = formatOpenAIResponse;
})();
