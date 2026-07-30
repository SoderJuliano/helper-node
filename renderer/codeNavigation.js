// renderer/codeNavigation.js
// Addon frontend do CodeMirror 5 para navegação de código (Go to Definition com Ctrl+Clique & Gutter Icons de Implementação)
(function () {
  'use strict';

  let currentHoverMarker = null;
  let activeCm = null;
  let currentFilePath = null;

  function clearHoverMarker() {
    if (currentHoverMarker) {
      currentHoverMarker.clear();
      currentHoverMarker = null;
    }
  }

  // Atualiza as marcas do gutter para a aba aberta atual
  async function updateGutterMarkers(cm, filePath) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavGetGutterInfo) return;

    // Limpa calha anterior
    cm.clearGutter('code-nav-gutter');

    try {
      const items = await window.electronAPI.codeNavGetGutterInfo({ filePath });
      if (!Array.isArray(items)) return;

      for (const item of items) {
        if (!item.line || !item.target) continue;
        const iconEl = document.createElement('div');
        iconEl.className = 'code-nav-gutter-icon';
        iconEl.textContent = 'I↓';
        iconEl.title = `Ir para implementação: ${item.symbol || 'Classe'}`;
        iconEl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (window.EditorController && item.target.filePath) {
            window.EditorController.openFile(item.target.filePath, item.target.line);
          }
        });

        // 0-indexed no CodeMirror
        const lineIdx = item.line - 1;
        cm.setGutterMarker(lineIdx, 'code-nav-gutter', iconEl);
      }
    } catch (err) {
      console.warn('[codeNavigation] erro ao buscar gutter info:', err);
    }
  }

  // Tenta resolver a definição de uma palavra ao clicar com Ctrl
  async function handleCtrlClick(cm, filePath, pos) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavFindDefinition) return;

    const wordRange = cm.findWordAt(pos);
    const symbol = cm.getRange(wordRange.anchor, wordRange.head).trim();

    if (!symbol || !/^[A-Za-z_$][\w$]*$/.test(symbol)) return;

    const lineText = cm.getLine(pos.line) || '';
    const res = await window.electronAPI.codeNavFindDefinition({ filePath, symbol, lineText });

    if (res && res.filePath) {
      if (window.EditorController) {
        await window.EditorController.openFile(res.filePath, res.line);
      }
    }
  }

  // Configura os ouvintes de evento no CodeMirror
  function attachCodeNavigation(cm, filePath) {
    if (!cm) return;
    activeCm = cm;
    currentFilePath = filePath;

    // Atualiza calha de implementações
    updateGutterMarkers(cm, filePath);

    const wrapper = cm.getWrapperElement();
    if (wrapper._hasCodeNav) return;
    wrapper._hasCodeNav = true;

    // Mousemove para efeito de link sob Ctrl
    wrapper.addEventListener('mousemove', (e) => {
      if (!(e.ctrlKey || e.metaKey)) {
        clearHoverMarker();
        return;
      }

      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
      if (!pos || pos.line < 0) {
        clearHoverMarker();
        return;
      }

      const wordRange = cm.findWordAt(pos);
      const symbol = cm.getRange(wordRange.anchor, wordRange.head).trim();

      if (symbol && /^[A-Za-z_$][\w$]*$/.test(symbol)) {
        clearHoverMarker();
        currentHoverMarker = cm.markText(wordRange.anchor, wordRange.head, {
          className: 'cm-nav-link'
        });
      } else {
        clearHoverMarker();
      }
    });

    wrapper.addEventListener('mouseleave', clearHoverMarker);

    // Ctrl + MouseDown para disparar Go to Definition
    wrapper.addEventListener('mousedown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.button === 0) {
        const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
        if (pos && pos.line >= 0) {
          e.preventDefault();
          e.stopPropagation();
          clearHoverMarker();
          handleCtrlClick(cm, currentFilePath, pos);
        }
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        clearHoverMarker();
      }
    });
  }

  window.CodeNavigation = {
    attach: attachCodeNavigation,
    updateGutterMarkers
  };
})();
