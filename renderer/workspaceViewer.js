// Workspace Code & Diff Viewer Wrapper Module
(function() {
        // === Diff view: mostra o que a IA mudou num arquivo (estilo PR) ===
        async function openFileDiff(filePath, backupAt) {
            const viewer = document.getElementById('diff-viewer');
            const body = document.getElementById('diff-body');
            const fileEl = document.getElementById('diff-file');
            const statsEl = document.getElementById('diff-stats');
            if (!viewer || !body) return;
            fileEl.textContent = String(filePath || '').split('/').slice(-2).join('/');
            fileEl.title = filePath || '';
            fileEl.dataset.path = filePath || '';
            statsEl.innerHTML = '';
            body.innerHTML = '<div class="diff-empty">Carregando diff…</div>';
            viewer.classList.add('open');

            let res = null;
            try {
                res = window.electronAPI.getFileDiff
                    ? await window.electronAPI.getFileDiff({ path: filePath, backupAt })
                    : null;
            } catch (_) {}
            if (!res) { body.innerHTML = '<div class="diff-empty">Não foi possível gerar o diff.</div>'; return; }
            if (res.tooBig) { body.innerHTML = '<div class="diff-empty">Arquivo grande demais para exibir o diff.</div>'; return; }

            statsEl.innerHTML = `<span class="d-add">+${res.adds}</span><span class="d-del">−${res.dels}</span>`;
            const lines = res.lines || [];
            if (!lines.length || (res.adds === 0 && res.dels === 0)) {
                body.innerHTML = '<div class="diff-empty">Sem alterações detectadas neste arquivo.</div>';
                return;
            }
            body.innerHTML = '';
            const addLine = (l) => {
                const div = document.createElement('div');
                div.className = 'diff-line ' + (l.t === 'add' ? 'add' : l.t === 'del' ? 'del' : 'ctx');
                const g = document.createElement('span'); g.className = 'dl-gutter'; g.textContent = (l.ln != null ? l.ln : '');
                const s = document.createElement('span'); s.className = 'dl-sign'; s.textContent = (l.t === 'add' ? '+' : l.t === 'del' ? '−' : '');
                const t = document.createElement('span'); t.className = 'dl-text'; t.textContent = l.text;
                div.appendChild(g); div.appendChild(s); div.appendChild(t);
                body.appendChild(div);
            };
            // Colapsa trechos longos sem alteração (estilo PR).
            const COLLAPSE = 4;
            let run = [];
            const flushCtx = () => {
                if (!run.length) return;
                if (run.length > COLLAPSE * 2) {
                    run.slice(0, COLLAPSE).forEach(addLine);
                    const sep = document.createElement('div');
                    sep.className = 'diff-line ctx';
                    sep.innerHTML = '<span class="dl-gutter"></span><span class="dl-sign"></span><span class="dl-text" style="color:var(--text-4)">⋯ ' + (run.length - COLLAPSE * 2) + ' linhas inalteradas ⋯</span>';
                    body.appendChild(sep);
                    run.slice(-COLLAPSE).forEach(addLine);
                } else {
                    run.forEach(addLine);
                }
                run = [];
            };
            let count = 0;
            for (const l of lines) {
                if (count++ > 2000) break;
                if (l.t === 'ctx') run.push(l);
                else { flushCtx(); addLine(l); }
            }
            flushCtx();
            body.scrollTop = 0;
        }
        function closeFileDiff() {
            const v = document.getElementById('diff-viewer');
            if (v) v.classList.remove('open');
        }
        (function wireDiffViewer() {
            const closeBtn = document.getElementById('diff-close');
            if (closeBtn) closeBtn.addEventListener('click', closeFileDiff);
            
            const fileEl = document.getElementById('diff-file');
            if (fileEl) {
                fileEl.addEventListener('click', () => {
                    const path = fileEl.dataset.path;
                    if (path) {
                        closeFileDiff();
                        openFileViewer(path);
                    }
                });
            }

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    const v = document.getElementById('diff-viewer');
                    if (v && v.classList.contains('open')) { e.stopPropagation(); closeFileDiff(); }
                }
            }, true);
        })();

 // Diff Viewer

        // ===== Editor de arquivo (IDE): abre no lugar do chat =====
        // Implementação real (CodeMirror, save, estado) vive em editorController.js
        // (window.EditorController) — este wrapper só existe pra manter o nome/assinatura
        // que os call sites já usam (tree, chip da IA, link do RAG).
        async function openFileViewer(filePath, lineNum) {
            if (window.EditorController) await window.EditorController.openFile(filePath, lineNum);
        }
        // Ctrl+Shift+F → Enter: abre todos os arquivos que bateram a busca por
        // conteúdo, cada um como uma aba. Abre em ordem reversa para o PRIMEIRO
        // match terminar como aba ativa. (Sem isto, o Enter só dava ReferenceError
        // — openMatchingFiles não existia — e nada abria.)
        async function openMatchingFiles(paths) {
            if (!Array.isArray(paths) || !paths.length) return;
            for (let i = paths.length - 1; i >= 0; i--) {
                await openFileViewer(paths[i]);
            }
        }
        function closeFileViewer() {
            const v = document.getElementById('file-viewer');
            if (v) v.classList.remove('open');
            if (window.EditorController) window.EditorController.closeEditor();
        }
        (function wireFileViewer() {
            const closeBtn = document.getElementById('fv-close');
            if (closeBtn) closeBtn.addEventListener('click', closeFileViewer);
            document.addEventListener('keydown', (e) => {
                const v = document.getElementById('file-viewer');
                const isOpen = !!(v && v.classList.contains('open'));
                if (!isOpen) return;
                if (e.key === 'Escape') {
                    // Se o diálogo de busca do CodeMirror (Ctrl+F) estiver aberto,
                    // deixa ELE tratar o Esc (fecha só a busca) — não fecha o editor
                    // inteiro por baixo do usuário.
                    if (document.querySelector('.CodeMirror-dialog')) return;
                    e.stopPropagation(); closeFileViewer();
                } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                    // Ctrl+S salva o arquivo aberto no editor em vez do "Salvar" do SO.
                    e.preventDefault(); e.stopPropagation();
                    if (window.EditorController) window.EditorController.saveActive();
                }
            }, true);
            // Configurações (janela separada) pede pra abrir um arquivo aqui —
            // ex.: link "Ver base completa" da base de conhecimento (RAG).
            if (window.electronAPI && window.electronAPI.onOpenFileInViewer) {
                window.electronAPI.onOpenFileInViewer((filePath) => openFileViewer(filePath));
            }
        })();
 // File Viewer

    // Expose functions
    window.openFileDiff = openFileDiff;
    window.closeFileDiff = closeFileDiff;
    window.openFileViewer = openFileViewer;
    window.openMatchingFiles = openMatchingFiles;
    window.closeFileViewer = closeFileViewer;
})();
