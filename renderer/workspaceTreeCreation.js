// renderer/workspaceTreeCreation.js
// Inline file and folder creation input in workspace tree
(function() {
  'use strict';

  const TREE_CHEVRON_IC = '<svg class="ws-tree-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  const TREE_DIR_IC = '<svg class="ws-tree-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const TREE_FILE_IC = '<svg class="ws-tree-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  const TREE_CHEVRON_SPACER = '<span class="ws-tree-chevron-spacer"></span>';

  function renderCreationInput(parentEl, parentDirPath, depth) {
    const node = document.createElement('div');
    node.className = 'ws-tree-node file temp-create';
    node.style.paddingLeft = (4 + depth * 12) + 'px';
    node.innerHTML = TREE_CHEVRON_SPACER + TREE_FILE_IC;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'nome-do-arquivo.ext';
    input.style.cssText = `
        background: #0d0d12;
        border: 1px solid var(--accent-2);
        color: var(--text);
        font-family: inherit;
        font-size: inherit;
        padding: 1px 4px;
        margin-left: 4px;
        border-radius: 3px;
        width: 100%;
        box-sizing: border-box;
        outline: none;
    `;
    node.appendChild(input);
    parentEl.appendChild(node);

    setTimeout(() => {
        input.focus();
        node.scrollIntoView({ block: 'nearest' });
    }, 50);

    let saved = false;
    const saveCreate = async () => {
        if (saved) return;
        saved = true;
        const name = input.value.trim();
        if (name) {
            const wsProjectMain = document.getElementById('ws-project-main');
            const projectRoot = (wsProjectMain && wsProjectMain.dataset.path) || '';
            let targetFilePath = '';
            let initialContent = '';

            if (name.endsWith('.java') || (name.includes('.') && !name.endsWith('/'))) {
                if (typeof window.resolveJavaClassTarget === 'function') {
                    const resolved = window.resolveJavaClassTarget(parentDirPath, name, projectRoot);
                    if (resolved && resolved.typeName) {
                        targetFilePath = resolved.filePath;
                        initialContent = typeof window.generateJavaTemplate === 'function'
                            ? window.generateJavaTemplate(resolved.packageName, resolved.typeName, 'class')
                            : '';
                    }
                }
            }

            if (!targetFilePath) {
                const separator = parentDirPath.includes('\\') ? '\\' : '/';
                targetFilePath = parentDirPath + (parentDirPath.endsWith(separator) ? '' : separator) + name;
            }

            const res = await window.electronAPI.createFile(targetFilePath, initialContent);
            if (res.ok) {
                creatingFileParent = null;
                if (window.expandedDirPaths) {
                    window.expandedDirPaths.add(parentDirPath);
                }
                await window.refreshProjectTree();
                if (typeof window.openFileViewer === 'function') window.openFileViewer(targetFilePath);
            } else {
                if (typeof showToast === 'function') showToast('Erro ao criar: ' + res.error);
                creatingFileParent = null;
                window.renderTree();
            }
        } else {
            creatingFileParent = null;
            window.renderTree();
        }
    };

    input.addEventListener('click', (ev) => ev.stopPropagation());

    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault(); ev.stopPropagation();
            saveCreate();
        } else if (ev.key === 'Escape') {
            ev.preventDefault(); ev.stopPropagation();
            creatingFileParent = null;
            window.renderTree();
        }
    });

    input.addEventListener('blur', () => {
        saveCreate();
    });
  }

  function renderCreationFolderInput(parentEl, parentDirPath, depth) {
    const node = document.createElement('div');
    node.className = 'ws-tree-node dir temp-create';
    node.style.paddingLeft = (4 + depth * 12) + 'px';
    node.innerHTML = TREE_CHEVRON_IC + TREE_DIR_IC;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'nome-da-pasta';
    input.style.cssText = `
        background: #0d0d12;
        border: 1px solid var(--accent-2);
        color: var(--text);
        font-family: inherit;
        font-size: inherit;
        padding: 1px 4px;
        margin-left: 4px;
        border-radius: 3px;
        width: 100%;
        box-sizing: border-box;
        outline: none;
    `;
    node.appendChild(input);
    parentEl.appendChild(node);

    setTimeout(() => {
        input.focus();
        node.scrollIntoView({ block: 'nearest' });
    }, 50);

    let saved = false;
    const saveCreate = async () => {
        if (saved) return;
        saved = true;
        const name = input.value.trim();
        if (name) {
            const separator = parentDirPath.includes('\\') ? '\\' : '/';
            const dirPath = parentDirPath + (parentDirPath.endsWith(separator) ? '' : separator) + name;
            const res = await window.electronAPI.createDir(dirPath);
            if (res.ok) {
                creatingFolderParent = null;
                await window.refreshProjectTree();
            } else {
                if (typeof showToast === 'function') showToast('Erro ao criar pasta: ' + res.error);
                creatingFolderParent = null;
                window.renderTree();
            }
        } else {
            creatingFolderParent = null;
            window.renderTree();
        }
    };

    input.addEventListener('click', (ev) => ev.stopPropagation());

    input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
            ev.preventDefault(); ev.stopPropagation();
            saveCreate();
        } else if (ev.key === 'Escape') {
            ev.preventDefault(); ev.stopPropagation();
            creatingFolderParent = null;
            window.renderTree();
        }
    });

    input.addEventListener('blur', () => {
        saveCreate();
    });
  }

  window.renderCreationInput = renderCreationInput;
  window.renderCreationFolderInput = renderCreationFolderInput;
})();
