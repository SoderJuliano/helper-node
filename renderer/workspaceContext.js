// Workspace Context & Project Management Module
var ctxProject = null;
var currentGitStatus = { modifiedFiles: {}, modifiedDirs: {} };

const TREE_FILE_TYPE_STYLES = {
    js: '#f5d76e', jsx: '#f5d76e', mjs: '#f5d76e', cjs: '#f5d76e',
    ts: '#5a9fd4', tsx: '#5a9fd4',
    json: '#e8a33d', jsonc: '#e8a33d',
    html: '#e6714a', htm: '#e6714a',
    css: '#5b9dd9', scss: '#c876d0', sass: '#c876d0', less: '#5b9dd9',
    md: '#8fa8bf', markdown: '#8fa8bf',
    py: '#6aa9d8',
    sh: '#7fbf7f', bash: '#7fbf7f', zsh: '#7fbf7f',
    yml: '#a9b665', yaml: '#a9b665',
    xml: '#e6714a',
    png: '#c876d0', jpg: '#c876d0', jpeg: '#c876d0', gif: '#c876d0', svg: '#c876d0', ico: '#c876d0', webp: '#c876d0',
    php: '#8a94c4',
    java: '#e6714a',
    go: '#5ac6c6',
    rs: '#e6714a',
    lock: '#8a8a95', gitignore: '#8a8a95', env: '#a9b665',
    txt: '#8a8a95', log: '#8a8a95',
};

function fileTypeColor(name) {
    const lower = name.toLowerCase();
    if (lower === '.gitignore' || lower === '.env' || lower.startsWith('.env.')) return TREE_FILE_TYPE_STYLES.gitignore;
    const dot = lower.lastIndexOf('.');
    if (dot <= 0) return null;
    const ext = lower.slice(dot + 1);
    return TREE_FILE_TYPE_STYLES[ext] || null;
}

const TREE_FILE_IC = '<svg class="ws-tree-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';

function fileIconHtml(name) {
    const color = fileTypeColor(name);
    return color ? `<svg class="ws-tree-ic" style="color:${color}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>` : TREE_FILE_IC;
}

(function() {
    const composerCtx = document.getElementById('composer-context');
    const ctxOpenProjectBtn = document.getElementById('ctx-open-project');
    const ctxProjectBtn = document.getElementById('ctx-project');
    const ctxProjectName = document.getElementById('ctx-project-name');
    const ctxBranch = document.getElementById('ctx-branch');
    const ctxBranchName = document.getElementById('ctx-branch-name');
    let ctxProject = null; // { id, name, path, branch }

    // Elementos do painel de workspace usados por renderWorkspacePanel /
    // refreshWorkspacePanel (perdidos na divisão automática).
    const wsPanel = document.getElementById('workspace-panel');
    const wsContent = document.getElementById('workspace-content');
    const wsActions = document.getElementById('ws-actions');
    const wsProject = document.getElementById('ws-project');
    const wsProjectName = document.getElementById('ws-project-name');
    const wsProjectMain = document.getElementById('ws-project-main');
    const FILE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    const IMAGE_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';

    // Reexibe/oculta o painel conforme o acesso ao workspace e recarrega a lista.
    async function refreshWorkspacePanel() {
        if (!wsPanel) return;
        const enabled = window.electronAPI && window.electronAPI.getWorkspaceAccessEnabled
            ? await window.electronAPI.getWorkspaceAccessEnabled()
            : false;
        wsPanel.style.display = enabled ? '' : 'none';
        if (enabled && window.electronAPI && window.electronAPI.workspaceList) {
            const list = await window.electronAPI.workspaceList();
            renderWorkspacePanel(list);
        }
        refreshProjectContext();
    }

            function showProjectMenu(anchor) {
                document.querySelectorAll('.ctx-project-menu').forEach(m => m.remove());
                const menu = document.createElement('div');
                menu.className = 'ctx-project-menu';
                menu.style.cssText = 'position:absolute; z-index:9999; background:var(--bg-elevated); border:1px solid var(--border-strong); border-radius:8px; padding:4px; box-shadow:0 10px 30px rgba(0,0,0,0.55); min-width:188px; -webkit-app-region: no-drag;';
                
                const projectPath = anchor.dataset.path || (ctxProject && ctxProject.path);
                const projectId = anchor.dataset.id || (ctxProject && ctxProject.id);

                const SVGI_SWITCH_PROJECT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin-right:8px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
                const SVGI_NEW_PROJECT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin-right:8px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>';
                const SVGI_ADD_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin-right:8px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
                const SVGI_RUN_CONFIG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin-right:8px; opacity:0.8; color:#4ade80; display:inline-block; vertical-align:middle;"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
                const SVGI_OPEN_EXTERNAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin-right:8px; opacity:0.8; display:inline-block; vertical-align:middle;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
                const SVGI_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="width:13px; height:13px; margin-right:8px; opacity:0.8; color:#ff5252; display:inline-block; vertical-align:middle;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

                const mkItem = (iconHtml, label, fn, danger) => {
                    const b = document.createElement('button');
                    b.innerHTML = `${iconHtml}${label}`;
                    b.style.cssText = 'display:flex; align-items:center; width:100%; text-align:left; background:transparent; border:none; color:' + (danger ? 'var(--danger)' : 'var(--text-2)') + '; font-size:12px; padding:7px 10px; cursor:pointer; border-radius:5px; font-family:var(--font-ui);';
                    b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
                    b.addEventListener('mouseleave', () => b.style.background = 'transparent');
                    b.addEventListener('click', () => { menu.remove(); fn(); });
                    return b;
                };
                
                menu.appendChild(mkItem(SVGI_SWITCH_PROJECT, 'Trocar projeto…', () => pickProjectFolder()));
                menu.appendChild(mkItem(SVGI_NEW_PROJECT, 'Criar Novo Projeto…', () => createNewProject()));
                menu.appendChild(mkItem(SVGI_ADD_FILE, 'Anexar arquivo ao contexto…', async () => {
                    if (window.electronAPI && window.electronAPI.workspacePickFile) {
                        const r = await window.electronAPI.workspacePickFile();
                        if (r && r.attachments && typeof renderWorkspacePanel === 'function') {
                            renderWorkspacePanel(r.attachments);
                        }
                        if (typeof refreshProjectContext === 'function') refreshProjectContext();
                    }
                }));
                menu.appendChild(mkItem(SVGI_RUN_CONFIG, 'Configurações de Execução (Perfis/Envs)…', () => {
                    if (typeof window.openAppRunnerConfigModal === 'function') {
                        window.openAppRunnerConfigModal(projectPath);
                    }
                }));
                
                const hr = document.createElement('div');
                hr.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                menu.appendChild(hr);

                menu.appendChild(mkItem(SVGI_OPEN_EXTERNAL, 'Abrir no gerenciador de arquivos', () => {
                    if (projectPath && window.electronAPI.workspaceOpenExternal) {
                        const pathToSend = process.platform === 'win32' ? projectPath.replace(/\//g, '\\') : projectPath;
                        window.electronAPI.workspaceOpenExternal(pathToSend);
                    }
                }));
                
                const hr2 = document.createElement('div');
                hr2.style.cssText = 'height:1px; background:var(--border, #2d2d38); margin:4px 0;';
                menu.appendChild(hr2);

                menu.appendChild(mkItem(SVGI_CLOSE, 'Fechar projeto', async () => {
                    if (projectId != null && projectId !== '' && window.electronAPI.workspaceRemove) {
                        const updated = await window.electronAPI.workspaceRemove(projectId);
                        if (typeof renderWorkspacePanel === 'function') renderWorkspacePanel(updated);
                        await refreshProjectContext();
                    }
                }, true));
                
                document.body.appendChild(menu);
                const r = anchor.getBoundingClientRect();
                const menuWidth = menu.offsetWidth || 188;
                const menuHeight = menu.offsetHeight || 220;

                const spaceBelow = window.innerHeight - r.bottom - 8;
                const spaceAbove = r.top - 8;

                // Se houver espaço suficiente para baixo ou se tiver mais espaço abaixo do que acima, abre para baixo; caso contrário, abre para cima
                let top;
                if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
                    top = r.bottom + 6;
                } else {
                    top = r.top - menuHeight - 6;
                }

                // Proteção para não vazar os limites da tela (viewport clipping)
                if (top + menuHeight > window.innerHeight - 8) {
                    top = window.innerHeight - menuHeight - 8;
                }
                if (top < 8) {
                    top = 8;
                    if (menuHeight > window.innerHeight - 16) {
                        menu.style.maxHeight = (window.innerHeight - 16) + 'px';
                        menu.style.overflowY = 'auto';
                    }
                }

                let left = r.left;
                if (left + menuWidth > window.innerWidth - 8) {
                    left = window.innerWidth - menuWidth - 8;
                }
                if (left < 8) {
                    left = 8;
                }

                menu.style.left = Math.round(left) + 'px';
                menu.style.top = Math.round(top) + 'px';
                const closer = (ev) => {
                    if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
                        menu.remove();
                        document.removeEventListener('click', closer, true);
                    }
                };
                setTimeout(() => document.addEventListener('click', closer, true), 0);
            }

            // === Contexto ativo do projeto (modo IDE) ===
            // Modo arquivos OFF  → composer-context oculto (chat puro, limpo).
            // Modo arquivos ON, sem pasta → botão "Abrir projeto".
            // Modo arquivos ON, com pasta → pill do projeto (clique = menu de
            //   gerenciamento: trocar / abrir no sistema / fechar) + branch.
            async function pickProjectFolder() {
                if (!(window.electronAPI && window.electronAPI.workspacePickDir)) return;
                const r = await window.electronAPI.workspacePickDir();
                if (r && r.attachments && typeof renderWorkspacePanel === 'function') renderWorkspacePanel(r.attachments);
                await refreshProjectContext();
            }

            async function refreshProjectContext() {
                if (!composerCtx) return;
                let enabled = false;
                try {
                    enabled = window.electronAPI && window.electronAPI.getWorkspaceAccessEnabled
                        ? await window.electronAPI.getWorkspaceAccessEnabled() : false;
                } catch (_) {}
                if (!enabled) { composerCtx.style.display = 'none'; ctxProject = null; return; }

                let ctx = null;
                try { ctx = window.electronAPI.getProjectContext ? await window.electronAPI.getProjectContext() : null; } catch (_) {}
                ctxProject = (ctx && ctx.name) ? ctx : null;
                composerCtx.style.display = 'flex';

                if (!ctxProject) {
                    if (ctxOpenProjectBtn) ctxOpenProjectBtn.style.display = 'inline-flex';
                    if (ctxProjectBtn) ctxProjectBtn.style.display = 'none';
                    if (ctxBranch) ctxBranch.style.display = 'none';
                    return;
                }
                if (ctxOpenProjectBtn) ctxOpenProjectBtn.style.display = 'none';
                if (ctxProjectBtn) ctxProjectBtn.style.display = 'inline-flex';
                if (ctxProjectName) ctxProjectName.textContent = ctxProject.name;
                if (ctxBranch) {
                    if (ctxProject.branch) {
                        ctxBranch.style.display = 'inline-flex';
                        if (ctxBranchName) ctxBranchName.textContent = ctxProject.branch;
                    } else { ctxBranch.style.display = 'none'; }
                }
            }

            async function createNewProject() {
                if (!(window.electronAPI && window.electronAPI.pickParentDir && window.electronAPI.createAndOpenProject)) return;
                const parentPath = await window.electronAPI.pickParentDir();
                if (!parentPath) return; // cancelado
                const folderName = window.prompt("Digite o nome da pasta do novo projeto:");
                if (!folderName || !folderName.trim()) return;
                
                const res = await window.electronAPI.createAndOpenProject(parentPath, folderName.trim());
                if (res && res.ok) {
                    if (typeof renderWorkspacePanel === 'function') renderWorkspacePanel(res.attachments);
                    await refreshProjectContext();
                    if (typeof showToast === 'function') showToast('Novo projeto criado e aberto com sucesso!');
                } else {
                    if (typeof showToast === 'function') showToast('Erro ao criar projeto: ' + (res ? res.error : 'erro desconhecido'));
                }
            }

            // Windows usa "\" — split('/') devolvia o caminho inteiro como nome.
            function baseName(p) {
                return String(p || '').split(/[\\/]/).filter(Boolean).slice(-1)[0] || String(p || '');
            }

            function renderWorkspacePanel(attachments) {
                const list = attachments || [];
                const dir = list.find(a => a.type === 'dir');
                const files = list.filter(a => a.type === 'file');

                if (dir) {
                    const name = baseName(dir.path);
                    if (wsProjectMain && wsProjectMain.dataset.path !== dir.path) collapseProjectTree();
                    if (wsActions) wsActions.style.display = 'none';
                    if (wsProject) wsProject.style.display = '';
                    if (wsProjectName) wsProjectName.textContent = name;
                    if (wsProjectMain) { 
                        wsProjectMain.dataset.path = dir.path; 
                        wsProjectMain.dataset.id = dir.id; 
                        wsProjectMain.title = dir.path; 
                    }
                } else {
                    if (wsActions) wsActions.style.display = '';
                    if (wsProject) wsProject.style.display = 'none';
                    if (wsProjectMain) { 
                        wsProjectMain.dataset.path = ''; 
                        wsProjectMain.dataset.id = ''; 
                    }
                    collapseProjectTree();
                }

                if (!wsContent) return;
                wsContent.innerHTML = '';
                for (const a of files) {
                    const chip = document.createElement('div');
                    chip.className = 'ws-chip';
                    chip.title = a.path;

                    const ic = document.createElement('span');
                    ic.className = 'ws-chip-ic';
                    // Imagem colada tem ícone próprio pra se distinguir de um
                    // arquivo do projeto que o usuário anexou de propósito.
                    ic.innerHTML = a.origin === 'paste' ? IMAGE_ICON_SVG : FILE_ICON_SVG;

                    const label = document.createElement('span');
                    label.className = 'ws-chip-label';
                    label.textContent = a.origin === 'paste' ? 'imagem colada' : baseName(a.path);

                    chip.addEventListener('click', (e) => {
                        if (e.target.closest('.ws-chip-x')) return;
                        if (window.electronAPI && window.electronAPI.workspaceOpenExternal) {
                            window.electronAPI.workspaceOpenExternal(a.path);
                        }
                    });

                    const xBtn = document.createElement('button');
                    xBtn.className = 'ws-chip-x';
                    xBtn.title = 'Remover anexo';
                    xBtn.innerHTML = '<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 3 L9 9 M9 3 L3 9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
                    xBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        if (window.electronAPI && window.electronAPI.workspaceRemove) {
                            const updated = await window.electronAPI.workspaceRemove(a.id);
                            renderWorkspacePanel(updated);
                        }
                    });

                    chip.appendChild(ic);
                    chip.appendChild(label);
                    chip.appendChild(xBtn);
                    wsContent.appendChild(chip);
                }
            }

            // Clicar no projeto → menu Trocar/Fechar (reusa o do composer).
            if (wsProjectMain) {
                wsProjectMain.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showProjectMenu(wsProjectMain);
                });
            }
 // renderWorkspacePanel & projectMenu event click

            let currentGitStatus = { isGit: false, changesCount: 0, modifiedFiles: {}, modifiedDirs: {} };

            async function fetchAndUpdateGitStatus() {
                if (window.electronAPI && window.electronAPI.getProjectGitStatus) {
                    try {
                        const res = await window.electronAPI.getProjectGitStatus();
                        if (res) {
                            currentGitStatus = res;
                            updateGitStatusUi();
                        }
                    } catch (e) {
                        console.warn('Erro ao buscar git status:', e);
                    }
                }
            }

            function updateGitStatusUi() {
                const badge = document.getElementById('ws-git-changes-badge');
                if (badge) {
                    if (currentGitStatus.isGit && currentGitStatus.changesCount > 0) {
                        badge.textContent = `${currentGitStatus.changesCount}+`;
                        badge.style.display = 'inline-flex';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            }

 // currentGitStatus, fetchAndUpdateGitStatus, updateGitStatusUi

    // Expose
    window.pickProjectFolder = pickProjectFolder;
    window.refreshProjectContext = refreshProjectContext;
    window.createNewProject = createNewProject;
    window.showProjectMenu = showProjectMenu;
    window.renderWorkspacePanel = renderWorkspacePanel;
    window.refreshWorkspacePanel = refreshWorkspacePanel;
    window.fetchAndUpdateGitStatus = fetchAndUpdateGitStatus;
    window.updateGitStatusUi = updateGitStatusUi;
    window.fileIconHtml = fileIconHtml;

    // Listeners
    if (ctxOpenProjectBtn) {
        ctxOpenProjectBtn.addEventListener('click', (e) => { e.stopPropagation(); pickProjectFolder(); });
    }
    if (ctxProjectBtn) {
        ctxProjectBtn.addEventListener('click', (e) => { e.stopPropagation(); showProjectMenu(ctxProjectBtn); });
    }
    if (window.electronAPI && window.electronAPI.onSymbolIndexerStatus) {
        window.electronAPI.onSymbolIndexerStatus((data) => {
            if (!ctxProjectBtn) return;
            let statusBadge = document.getElementById('ctx-indexer-status');
            if (!statusBadge) {
                statusBadge = document.createElement('span');
                statusBadge.id = 'ctx-indexer-status';
                statusBadge.style.cssText = 'font-size:10px; opacity:0.8; margin-left:6px; font-family:var(--font-mono); color:#81d4fa; display:none; align-items:center; gap:3px;';
                ctxProjectBtn.appendChild(statusBadge);
            }
            if (data.status === 'indexing') {
                statusBadge.style.display = 'inline-flex';
                const pct = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
                statusBadge.textContent = `⚡ Indexando... ${pct}%`;
            } else if (data.status === 'completed') {
                statusBadge.style.display = 'inline-flex';
                statusBadge.textContent = `✓ Indexado`;
                setTimeout(() => { if (statusBadge) statusBadge.style.display = 'none'; }, 3500);
            } else {
                statusBadge.style.display = 'none';
            }
        });
    }
    refreshProjectContext();
})();
