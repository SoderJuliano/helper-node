// renderer/codeNavigation.js
// Addon frontend do CodeMirror 5 para navegação de código (Go to Definition com Ctrl+Clique & Gutter Icons de Implementação)
(function () {
  'use strict';

  let currentHoverMarker = null;
  let activeCm = null;
  let currentFilePath = null;
  let activePopup = null;

  function clearHoverMarker() {
    if (currentHoverMarker) {
      currentHoverMarker.clear();
      currentHoverMarker = null;
    }
  }

  function removeActivePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  }

  // Abre todas as ocorrências encontradas em abas do editor
  async function openAllMatches(matches) {
    removeActivePopup();
    if (!Array.isArray(matches) || !matches.length) return;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (window.EditorController && matches[i].filePath) {
        await window.EditorController.openFile(matches[i].filePath, matches[i].line);
      }
    }
  }

  // Renderiza a janela pop-up de seleção quando o símbolo possui múltiplas definições
  function showDefinitionPopup(matches, symbol, clientX, clientY) {
    removeActivePopup();
    if (!Array.isArray(matches) || !matches.length) return;

    const popup = document.createElement('div');
    popup.className = 'code-nav-popup';
    activePopup = popup;

    // Cabeçalho
    const header = document.createElement('div');
    header.className = 'code-nav-popup-header';

    const title = document.createElement('span');
    title.className = 'code-nav-popup-title';
    title.textContent = `📌 ${symbol} (${matches.length})`;

    const sub = document.createElement('span');
    sub.className = 'code-nav-popup-sub';
    sub.textContent = 'Enter: abrir todas em abas';

    header.appendChild(title);
    header.appendChild(sub);
    popup.appendChild(header);

    let selectedIndex = 0;

    // Lista de ocorrências
    const itemEls = matches.map((m, idx) => {
      const item = document.createElement('div');
      item.className = 'code-nav-popup-item' + (idx === 0 ? ' selected' : '');

      const fileName = m.relativePath ? m.relativePath.split('/').pop() : m.filePath.split('/').pop();
      const folderPath = m.relativePath || m.filePath;

      const fileSpan = document.createElement('span');
      fileSpan.className = 'code-nav-popup-file';
      fileSpan.textContent = `${fileName}:${m.line}`;

      const pathSpan = document.createElement('span');
      pathSpan.className = 'code-nav-popup-path';
      pathSpan.textContent = folderPath;

      const badgeSpan = document.createElement('span');
      badgeSpan.className = 'code-nav-popup-badge';
      badgeSpan.textContent = m.className ? m.className : (m.kind || 'método');

      const leftDiv = document.createElement('div');
      leftDiv.style.display = 'flex';
      leftDiv.style.alignItems = 'center';
      leftDiv.style.overflow = 'hidden';
      leftDiv.appendChild(fileSpan);
      leftDiv.appendChild(pathSpan);

      item.appendChild(leftDiv);
      item.appendChild(badgeSpan);

      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeActivePopup();
        if (window.EditorController && m.filePath) {
          window.EditorController.openFile(m.filePath, m.line);
        }
      });

      popup.appendChild(item);
      return item;
    });

    document.body.appendChild(popup);

    // Posicionamento próximo ao ponteiro do mouse
    const width = popup.offsetWidth || 340;
    const height = popup.offsetHeight || 200;
    let x = clientX;
    let y = clientY + 10;
    if (x + width > window.innerWidth) x = window.innerWidth - width - 10;
    if (y + height > window.innerHeight) y = clientY - height - 10;
    popup.style.left = Math.max(10, x) + 'px';
    popup.style.top = Math.max(10, y) + 'px';

    // Teclas: Enter abre todas, Esc fecha, Setas navegam
    const keyHandler = (e) => {
      if (!activePopup) {
        document.removeEventListener('keydown', keyHandler, true);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('keydown', keyHandler, true);
        if (matches[selectedIndex]) {
          // Se navegou com as setas para um específico e deu enter, ou se quer abrir todos:
          // Se não usou as setas (selectedIndex === 0), abre todos em abas conforme solicitado.
          openAllMatches(matches);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        removeActivePopup();
        document.removeEventListener('keydown', keyHandler, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % matches.length;
        itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
        itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
      }
    };

    const clickOutsideHandler = (ev) => {
      if (popup && !popup.contains(ev.target)) {
        removeActivePopup();
        document.removeEventListener('mousedown', clickOutsideHandler, true);
        document.removeEventListener('keydown', keyHandler, true);
      }
    };

    setTimeout(() => {
      document.addEventListener('keydown', keyHandler, true);
      document.addEventListener('mousedown', clickOutsideHandler, true);
    }, 0);
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
  async function handleCtrlClick(cm, filePath, pos, mouseEvent) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavFindDefinition) return;

    const wordRange = cm.findWordAt(pos);
    const symbol = cm.getRange(wordRange.anchor, wordRange.head).trim();

    if (!symbol || !/^[A-Za-z_$][\w$]*$/.test(symbol)) return;

    const lineText = cm.getLine(pos.line) || '';
    const matches = await window.electronAPI.codeNavFindDefinition({ filePath, symbol, lineText });

    if (!Array.isArray(matches) || matches.length === 0) return;

    if (matches.length === 1) {
      if (window.EditorController && matches[0].filePath) {
        await window.EditorController.openFile(matches[0].filePath, matches[0].line);
      }
    } else {
      showDefinitionPopup(matches, symbol, mouseEvent.clientX, mouseEvent.clientY);
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
          handleCtrlClick(cm, currentFilePath, pos, e);
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
