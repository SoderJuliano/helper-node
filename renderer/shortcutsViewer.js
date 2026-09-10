// renderer/shortcutsViewer.js
// Visualizador de Atalhos do Teclado no Painel Lateral (Modo Janela)
(function() {
    'use strict';

    async function renderShortcuts() {
        const container = document.getElementById('shortcut-content');
        if (!container) return;

        if (!window.electronAPI || !window.electronAPI.getAvailableShortcuts) {
            return;
        }

        try {
            const data = await window.electronAPI.getAvailableShortcuts();
            if (!data || !data.categories || data.categories.length === 0) {
                return;
            }

            // Preserva debug indicator se existir
            const debugIndicator = document.getElementById('debug-indicator');
            const isDebugVisible = debugIndicator && debugIndicator.style.display !== 'none';

            container.innerHTML = '';

            const debugEl = document.createElement('div');
            debugEl.id = 'debug-indicator';
            debugEl.className = 'command-item';
            debugEl.style.cssText = `display: ${isDebugVisible ? 'block' : 'none'}; color: #ffab40; font-weight: 600;`;
            debugEl.textContent = 'Modo Debug Ativo';
            container.appendChild(debugEl);

            data.categories.forEach((cat) => {
                if (!cat.items || cat.items.length === 0) return;

                const catDiv = document.createElement('div');
                catDiv.className = 'shortcut-category';

                const titleDiv = document.createElement('div');
                titleDiv.className = 'shortcut-cat-title';
                titleDiv.textContent = cat.name;
                catDiv.appendChild(titleDiv);

                cat.items.forEach((item) => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'command-item';

                    const leftDiv = document.createElement('div');
                    leftDiv.className = 'command-item-left';

                    const kbdSpan = document.createElement('span');
                    kbdSpan.className = 'sc-kbd';
                    kbdSpan.textContent = item.keys + (item.altKeys ? ` / ${item.altKeys}` : '');

                    const actionSpan = document.createElement('span');
                    actionSpan.className = 'sc-action';
                    actionSpan.textContent = item.action;

                    leftDiv.appendChild(kbdSpan);
                    leftDiv.appendChild(actionSpan);

                    const whereSpan = document.createElement('span');
                    whereSpan.className = 'sc-where';
                    whereSpan.textContent = item.where;

                    itemDiv.appendChild(leftDiv);
                    itemDiv.appendChild(whereSpan);

                    catDiv.appendChild(itemDiv);
                });

                container.appendChild(catDiv);
            });
        } catch (err) {
            console.error('Erro ao renderizar atalhos:', err);
        }
    }

    // Carrega os atalhos ao inicializar
    window.addEventListener('DOMContentLoaded', () => {
        renderShortcuts();
    });

    window.renderShortcuts = renderShortcuts;
})();
