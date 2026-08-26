// renderer/codeNavContextMenu.js
// Menu de contexto de navegação de código (Find Usages, Rename, Copy).
(function () {
  'use strict';

  let activeEditorContextMenu = null;

  function removeActiveEditorContextMenu() {
    if (activeEditorContextMenu) {
      activeEditorContextMenu.remove();
      activeEditorContextMenu = null;
    }
  }

  function showEditorContextMenu(cm, filePath, event, getSymbolOrPathAtPos) {
    event.preventDefault();
    event.stopPropagation();

    removeActiveEditorContextMenu();
    if (window.CodeNavUsagesPopup) {
      window.CodeNavUsagesPopup.removeActiveUsagesPopup();
      window.CodeNavUsagesPopup.removeActiveDefinitionPopup();
    }

    const selection = cm.getSelection();
    const hasSelection = selection && selection.length > 0;

    const pos = cm.coordsChar({ left: event.clientX, top: event.clientY });

    let targetSymbol = null;
    if (hasSelection) {
      const trimmedSel = selection.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(trimmedSel)) {
        targetSymbol = trimmedSel;
      }
    }

    if (!targetSymbol && getSymbolOrPathAtPos) {
      const item = getSymbolOrPathAtPos(cm, pos);
      targetSymbol = (item && item.symbol && !item.isPath) ? item.symbol : null;
    }

    if (!targetSymbol) {
      const wordRange = cm.findWordAt(pos);
      const word = cm.getRange(wordRange.anchor, wordRange.head).trim();
      if (word && /^[A-Za-z_$][\w$]*$/.test(word)) {
        targetSymbol = word;
      }
    }

    if (!hasSelection && !targetSymbol) return;

    const menu = document.createElement('div');
    menu.className = 'code-editor-context-menu';
    activeEditorContextMenu = menu;

    if (targetSymbol) {
      const btnFindUsages = document.createElement('button');
      btnFindUsages.className = 'menu-item-find-usages';
      btnFindUsages.innerHTML = `<span>Achar Usos de '${targetSymbol}'</span>`;
      btnFindUsages.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeActiveEditorContextMenu();
        if (window.electronAPI && window.electronAPI.codeNavFindUsages && window.CodeNavUsagesPopup) {
          const usages = await window.electronAPI.codeNavFindUsages({ filePath, symbol: targetSymbol });
          window.CodeNavUsagesPopup.showUsagesPopup(usages, targetSymbol, event.clientX, event.clientY);
        }
      });
      menu.appendChild(btnFindUsages);

      const btnRename = document.createElement('button');
      btnRename.className = 'menu-item-rename menu-danger';
      btnRename.innerHTML = `<span>Renomear '${targetSymbol}'</span>`;
      btnRename.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeActiveEditorContextMenu();
        if (window.CodeNavRename) {
          window.CodeNavRename.startRenameMethod(cm, filePath, targetSymbol, pos);
        }
      });
      menu.appendChild(btnRename);
    }

    if (hasSelection) {
      const btnCopy = document.createElement('button');
      btnCopy.className = 'menu-item-copy';
      const linesCount = selection.split('\n').length;
      const label = linesCount > 1 ? `Copiar (${linesCount} linhas)` : 'Copiar';
      btnCopy.innerHTML = `<span>${label}</span>`;
      btnCopy.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeActiveEditorContextMenu();
        try {
          if (window.electronAPI && window.electronAPI.copyToClipboard) {
            window.electronAPI.copyToClipboard(selection);
          } else {
            await navigator.clipboard.writeText(selection);
          }
        } catch (_) {
          const ta = document.createElement('textarea');
          ta.value = selection;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
      });
      menu.appendChild(btnCopy);
    }

    document.body.appendChild(menu);

    const width = menu.offsetWidth || 180;
    const height = menu.offsetHeight || 80;
    let x = event.clientX;
    let y = event.clientY;
    if (x + width > window.innerWidth) x = window.innerWidth - width - 10;
    if (y + height > window.innerHeight) y = window.innerHeight - height - 10;

    menu.style.left = Math.max(10, x) + 'px';
    menu.style.top = Math.max(10, y) + 'px';

    const dismissHandler = (ev) => {
      if (menu && !menu.contains(ev.target)) {
        removeActiveEditorContextMenu();
        document.removeEventListener('mousedown', dismissHandler, true);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', dismissHandler, true);
    }, 0);
  }

  window.CodeNavContextMenu = {
    showEditorContextMenu,
    removeActiveEditorContextMenu,
  };
})();
