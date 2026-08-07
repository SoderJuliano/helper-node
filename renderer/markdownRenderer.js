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

            // 0. Trata tag <voice_summary>...</voice_summary>
            let out = text.replace(/<voice_summary>([\s\S]*?)<\/voice_summary>/gi, (_, summary) => {
                const clean = summary.replace(/<[^>]*>/g, '').trim();
                return hold(`<div class="voice-summary-card"><span class="voice-icon">🔊</span><div class="voice-content"><strong>Resumo em Áudio:</strong> ${clean}</div></div>`);
            });

            // 1. Protege blocos ``` ... ```
            //
            // Varredura por LINHA, não regex sobre o texto todo. O regex antigo
            // (/```([\w-]*)\n?([\s\S]*?)```/) fechava o bloco na primeira crase
            // tripla que encontrasse EM QUALQUER LUGAR — inclusive no meio de
            // uma linha de código, como console.log("```"). Dois estragos,
            // ambos reproduzidos com bloco de 300 linhas:
            //
            //   crase tripla no meio  -> <pre> ficava com 5 linhas e as outras
            //                            295 viravam texto solto (o usuário
            //                            continuava VENDO tudo, mas copiar o
            //                            bloco trazia só as 5);
            //   bloco sem fechamento  -> nenhum <pre> era criado e o código
            //                            inteiro virava parágrafo — "copiei a
            //                            resposta e veio sem o bloco".
            //
            // Regra do CommonMark: a cerca de fechamento tem que estar sozinha
            // na linha e ser pelo menos tão longa quanto a de abertura; bloco
            // sem fechamento vai até o fim do texto.
            out = (() => {
                const linhas = out.split('\n');
                const saida = [];
                let i = 0;
                while (i < linhas.length) {
                    const abre = linhas[i].match(/^\s*(`{3,})\s*([\w+#.-]*)\s*$/);
                    if (!abre) { saida.push(linhas[i]); i++; continue; }

                    const cerca = abre[1];
                    const lang = abre[2];
                    const corpo = [];
                    let j = i + 1;
                    let fechou = false;
                    for (; j < linhas.length; j++) {
                        const fim = linhas[j].match(/^\s*(`{3,})\s*$/);
                        if (fim && fim[1].length >= cerca.length) { fechou = true; break; }
                        corpo.push(linhas[j]);
                    }

                    const id = `${pfx}-cb-${Date.now()}-${blocks.length}`;
                    saida.push(hold(
                        `<pre>${copyBtn()}<code id="${id}" class="language-${lang || 'text'}">`
                        + `${escapeHTML(corpo.join('\n').trim())}</code></pre>`
                    ));
                    i = fechou ? j + 1 : j; // sem fechamento, consome até o fim
                }
                return saida.join('\n');
            })();

            // 2. Código inline `x` → <code> inline (NÃO bloco)
            out = out.replace(/`([^`\n]+)`/g, (_, code) =>
                `<code class="inline-code" title="Clique para copiar">${escapeHTML(code)}</code>`
            );

            // 3. Negrito e itálico
            out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
            out = out.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

            // 4. Processa tabelas markdown (| col1 | col2 | \n |---|---| \n | val1 | val2 |)
            function renderTableBlock(tableLines) {
                if (tableLines.length < 2) return tableLines.join('\n');
                const parseRow = (rowStr) => {
                    let r = rowStr.trim();
                    if (r.startsWith('|')) r = r.slice(1);
                    if (r.endsWith('|')) r = r.slice(0, -1);
                    return r.replace(/\\\|/g, '\x00PIPE\x00')
                            .split('|')
                            .map(c => c.replace(/\x00PIPE\x00/g, '|').trim());
                };

                const headerRow = parseRow(tableLines[0]);
                const alignRow = parseRow(tableLines[1]);

                // Valida se a linha separadora é válida (| --- | :---: | ---: |)
                const isValidAlign = alignRow.length > 0 && alignRow.every(col => /^:?-+:?$/.test(col));
                if (!isValidAlign) return tableLines.join('\n');

                const alignments = alignRow.map(col => {
                    if (col.startsWith(':') && col.endsWith(':')) return 'center';
                    if (col.endsWith(':')) return 'right';
                    if (col.startsWith(':')) return 'left';
                    return 'left';
                });

                const bodyRows = tableLines.slice(2).map(parseRow);
                const formatCell = (cellStr) => cellStr.replace(/&lt;br\s*\/??&gt;/gi, '<br>')
                                                      .replace(/<br\s*\/?>/gi, '<br>')
                                                      .replace(/\\n/g, '<br>');

                let html = '<div class="markdown-table-wrapper"><table class="markdown-table"><thead><tr>';
                headerRow.forEach((cell, idx) => {
                    const align = alignments[idx] || 'left';
                    html += `<th style="text-align:${align}">${formatCell(cell)}</th>`;
                });
                html += '</tr></thead><tbody>';

                bodyRows.forEach(row => {
                    html += '<tr>';
                    row.forEach((cell, idx) => {
                        const align = alignments[idx] || 'left';
                        html += `<td style="text-align:${align}">${formatCell(cell)}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody></table></div>';
                return html;
            }

            // Detecta blocos de tabela markdown
            const linesForTable = out.split('\n');
            const processedTableLines = [];
            let currentTableBlock = [];

            for (let i = 0; i < linesForTable.length; i++) {
                const line = linesForTable[i];
                const isTableLine = /^\s*\|.*\|\s*$/.test(line);

                if (isTableLine) {
                    currentTableBlock.push(line);
                } else {
                    if (currentTableBlock.length >= 2) {
                        const tableHtml = renderTableBlock(currentTableBlock);
                        if (tableHtml.startsWith('<div class="markdown-table-wrapper">')) {
                            processedTableLines.push(hold(tableHtml));
                        } else {
                            processedTableLines.push(...currentTableBlock);
                        }
                    } else if (currentTableBlock.length > 0) {
                        processedTableLines.push(...currentTableBlock);
                    }
                    currentTableBlock = [];
                    processedTableLines.push(line);
                }
            }

            if (currentTableBlock.length >= 2) {
                const tableHtml = renderTableBlock(currentTableBlock);
                if (tableHtml.startsWith('<div class="markdown-table-wrapper">')) {
                    processedTableLines.push(hold(tableHtml));
                } else {
                    processedTableLines.push(...currentTableBlock);
                }
            } else if (currentTableBlock.length > 0) {
                processedTableLines.push(...currentTableBlock);
            }

            out = processedTableLines.join('\n');

            // 5. Processa linha a linha para headings e listas
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

            // 6. Agrupa linhas em parágrafos (linha vazia = nova <p>)
            out = result.join('\n');
            out = out.replace(/\n\n+/g, '\x01').replace(/\n/g, '<br>').replace(/\x01/g, '</p><p>');
            if (!out.match(/^<(h[123]|ul|ol|pre|\x00)/)) out = '<p>' + out + '</p>';

            // Limpa marcas de parágrafo e quebras de linha supérfluas em torno de blocos retidos (tabelas e código)
            out = out.replace(/<p>\s*(<br>\s*)*(\x00B\d+\x00)/g, '$2<p>')
                     .replace(/(\x00B\d+\x00)\s*(<br>\s*)*<\/p>/g, '</p>$1')
                     .replace(/<p>\s*<\/p>/g, '');

            // 7. Restaura blocos protegidos
            //
            // ⚠️ O replacement PRECISA ser função. Com string, o replace
            // interpreta `$&`, `$'`, "$`" e `$n` como padrões de substituição:
            // um bloco de código contendo `$'` fazia o replace inserir todo o
            // texto DEPOIS do bloco, e "$`" todo o texto ANTES — o conteúdo
            // saía corrompido/duplicado (medido: 300 linhas com `$'` viravam
            // 13.689 chars de 10.691). Código com regex e shell script cai
            // nisso o tempo todo.
            blocks.forEach((b, i) => { out = out.replace(`\x00B${i}\x00`, () => b); });

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
