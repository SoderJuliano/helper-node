// renderer/codeNavigation.js
// Addon frontend do CodeMirror 5 para navegação de código (Go to Definition com Ctrl+Clique, Usages Tooltip sob Hover & Gutter Icons de Implementação)
(function () {
  'use strict';

  let currentHoverMarker = null;
  let activeCm = null;
  let currentFilePath = null;
  let activePopup = null;

  // Usages Hover Badge & Popup state
  let activeUsagesBadge = null;
  let activeUsagesPopup = null;
  let usagesTimer = null;
  let lastHoveredSymbol = null;
  let isMouseOverBadge = false;

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

  function removeActiveUsagesBadge() {
    if (activeUsagesBadge && !isMouseOverBadge) {
      activeUsagesBadge.remove();
      activeUsagesBadge = null;
    }
  }

  function removeActiveUsagesPopup() {
    if (activeUsagesPopup) {
      activeUsagesPopup.remove();
      activeUsagesPopup = null;
    }
  }

  // Exibe o badge sutil [usado em N lugares] sobre o método quando o mouse fica parado
  function showUsagesBadge(symbol, usages, pos, clientX, clientY) {
    if (activeUsagesPopup) return; // Se a janela detalhada já está aberta, não mostra badge
    if (activeUsagesBadge) {
      activeUsagesBadge.remove();
      activeUsagesBadge = null;
    }

    const count = usages.length;
    const label = count === 1 ? '[1 uso]' : count === 0 ? '[0 usos]' : `[usado em ${count} lugares]`;

    const badge = document.createElement('div');
    badge.className = 'code-nav-usages-badge';
    badge.title = 'Clique para ver onde este método é chamado';
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'badge-icon';
    iconSpan.textContent = '⚡';

    const textSpan = document.createElement('span');
    textSpan.textContent = label;

    const hintSpan = document.createElement('span');
    hintSpan.className = 'badge-hint';
    hintSpan.textContent = '(clique para ver)';

    badge.appendChild(iconSpan);
    badge.appendChild(textSpan);
    badge.appendChild(hintSpan);

    badge.addEventListener('mouseenter', () => {
      isMouseOverBadge = true;
    });

    badge.addEventListener('mouseleave', () => {
      isMouseOverBadge = false;
      setTimeout(() => {
        removeActiveUsagesBadge();
      }, 150);
    });

    badge.addEventListener('click', (ev) => {
      ev.stopPropagation();
      isMouseOverBadge = false;
      removeActiveUsagesBadge();
      showUsagesPopup(usages, symbol, clientX, clientY);
    });

    document.body.appendChild(badge);
    activeUsagesBadge = badge;

    // Posicionar exatamente acima da palavra no CodeMirror
    let x = clientX;
    let y = clientY - 28;

    if (activeCm && pos) {
      try {
        const coords = activeCm.charCoords(pos, 'window');
        if (coords && coords.top > 0) {
          x = coords.left;
          y = coords.top - 26;
        }
      } catch (_) {}
    }

    const badgeWidth = badge.offsetWidth || 160;
    if (x + badgeWidth > window.innerWidth) x = window.innerWidth - badgeWidth - 10;
    if (y < 10) y = clientY + 18;

    badge.style.left = Math.max(10, x) + 'px';
    badge.style.top = Math.max(10, y) + 'px';
  }

  // Renderiza a janela detalhada de Chamadores (Usages Popup)
  function showUsagesPopup(usages, symbol, clientX, clientY) {
    removeActiveUsagesPopup();
    removeActivePopup();

    const popup = document.createElement('div');
    popup.className = 'code-nav-popup code-nav-usages-popup';
    activeUsagesPopup = popup;

    // Cabeçalho
    const header = document.createElement('div');
    header.className = 'code-nav-popup-header';

    const title = document.createElement('span');
    title.className = 'code-nav-popup-title';
    title.textContent = `🔗 Usos de "${symbol}" (${usages.length})`;

    const sub = document.createElement('span');
    sub.className = 'code-nav-popup-sub';
    sub.textContent = usages.length > 0 ? 'Enter: abrir selecionado / Esc: fechar' : 'Sem chamadores no projeto';

    header.appendChild(title);
    header.appendChild(sub);
    popup.appendChild(header);

    if (usages.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.padding = '12px';
      emptyDiv.style.color = '#888';
      emptyDiv.style.textAlign = 'center';
      emptyDiv.textContent = 'Nenhum chamador encontrado para este símbolo.';
      popup.appendChild(emptyDiv);
    }

    let selectedIndex = 0;

    const itemEls = usages.map((u, idx) => {
      const item = document.createElement('div');
      item.className = 'code-nav-popup-item' + (idx === 0 ? ' selected' : '');
      item.style.flexDirection = 'column';
      item.style.alignItems = 'flex-start';

      const topRow = document.createElement('div');
      topRow.style.display = 'flex';
      topRow.style.alignItems = 'center';
      topRow.style.width = '100%';
      topRow.style.justifyContent = 'space-between';

      const leftDiv = document.createElement('div');
      leftDiv.style.display = 'flex';
      leftDiv.style.alignItems = 'center';
      leftDiv.style.overflow = 'hidden';

      const fileSpan = document.createElement('span');
      fileSpan.className = 'code-nav-popup-file';
      fileSpan.textContent = `${u.fileName}:${u.line}`;

      const pathSpan = document.createElement('span');
      pathSpan.className = 'code-nav-popup-path';
      pathSpan.textContent = u.relativePath || u.filePath;

      leftDiv.appendChild(fileSpan);
      leftDiv.appendChild(pathSpan);
      topRow.appendChild(leftDiv);

      if (u.callerName) {
        const callerSpan = document.createElement('span');
        callerSpan.className = 'code-nav-popup-caller';
        callerSpan.textContent = `em ${u.callerName}()`;
        topRow.appendChild(callerSpan);
      }

      item.appendChild(topRow);

      // Trecho da linha de código chamadora
      if (u.lineText) {
        const snippetDiv = document.createElement('div');
        snippetDiv.className = 'code-nav-popup-snippet';
        snippetDiv.textContent = `${u.line}: ${u.lineText}`;
        item.appendChild(snippetDiv);
      }

      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeActiveUsagesPopup();
        if (window.EditorController && u.filePath) {
          window.EditorController.openFile(u.filePath, u.line, u.col);
        }
      });

      popup.appendChild(item);
      return item;
    });

    document.body.appendChild(popup);

    // Posicionamento próximo ao ponteiro do mouse
    const width = popup.offsetWidth || 380;
    const height = popup.offsetHeight || 240;
    let x = clientX;
    let y = clientY + 10;
    if (x + width > window.innerWidth) x = window.innerWidth - width - 10;
    if (y + height > window.innerHeight) y = clientY - height - 10;
    popup.style.left = Math.max(10, x) + 'px';
    popup.style.top = Math.max(10, y) + 'px';

    const keyHandler = (e) => {
      if (!activeUsagesPopup) {
        document.removeEventListener('keydown', keyHandler, true);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('keydown', keyHandler, true);
        if (usages[selectedIndex] && window.EditorController) {
          const u = usages[selectedIndex];
          removeActiveUsagesPopup();
          window.EditorController.openFile(u.filePath, u.line, u.col);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        removeActiveUsagesPopup();
        document.removeEventListener('keydown', keyHandler, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (usages.length > 0) {
          selectedIndex = (selectedIndex + 1) % usages.length;
          itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (usages.length > 0) {
          selectedIndex = (selectedIndex - 1 + usages.length) % usages.length;
          itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
        }
      }
    };

    const clickOutsideHandler = (ev) => {
      if (popup && !popup.contains(ev.target)) {
        removeActiveUsagesPopup();
        document.removeEventListener('mousedown', clickOutsideHandler, true);
        document.removeEventListener('keydown', keyHandler, true);
      }
    };

    setTimeout(() => {
      document.addEventListener('keydown', keyHandler, true);
      document.addEventListener('mousedown', clickOutsideHandler, true);
    }, 0);
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
    removeActiveUsagesPopup();
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

  // Extrai o símbolo ou caminho de arquivo clicado/focado sob o cursor
  function getSymbolOrPathAtPos(cm, pos) {
    if (!cm || !pos || pos.line < 0) return null;
    const lineText = cm.getLine(pos.line);
    if (!lineText) return null;
    const ch = pos.ch;

    // 1. Checar se a posição está dentro de aspas ('...', "...", `...`)
    const quotes = ['"', "'", '`'];
    for (const q of quotes) {
      let first = -1;
      while ((first = lineText.indexOf(q, first + 1)) !== -1) {
        if (first > 0 && lineText[first - 1] === '\\') continue;
        const second = lineText.indexOf(q, first + 1);
        if (second === -1) break;
        if (ch >= first && ch <= second) {
          const raw = lineText.substring(first + 1, second).trim();
          if (raw && (raw.includes('/') || raw.includes('\\') || raw.startsWith('.') || /\.[a-zA-Z0-9]+$/.test(raw))) {
            return {
              symbol: raw,
              range: {
                anchor: { line: pos.line, ch: first + 1 },
                head: { line: pos.line, ch: second }
              },
              isPath: true
            };
          }
        }
        first = second;
      }
    }

    // 2. Símbolo normal de código (método, função, classe)
    const wordRange = cm.findWordAt(pos);
    const symbol = cm.getRange(wordRange.anchor, wordRange.head).trim();
    if (symbol && /^[A-Za-z_$][\w$]*$/.test(symbol)) {
      return {
        symbol,
        range: wordRange,
        isPath: false
      };
    }

    return null;
  }

  // Tenta resolver a definição de uma palavra ou caminho de arquivo ao clicar com Ctrl
  async function handleCtrlClick(cm, filePath, pos, mouseEvent) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavFindDefinition) return;

    const item = getSymbolOrPathAtPos(cm, pos);
    if (!item || !item.symbol) return;

    const lineText = cm.getLine(pos.line) || '';
    const matches = await window.electronAPI.codeNavFindDefinition({ filePath, symbol: item.symbol, lineText });

    if (!Array.isArray(matches) || matches.length === 0) return;

    if (matches.length === 1) {
      if (window.EditorController && matches[0].filePath) {
        await window.EditorController.openFile(matches[0].filePath, matches[0].line);
      }
    } else {
      showDefinitionPopup(matches, item.symbol, mouseEvent.clientX, mouseEvent.clientY);
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

    // Mousemove para efeito de link sob Ctrl & Usages Badge sob hover normal
    wrapper.addEventListener('mousemove', (e) => {
      if (e.ctrlKey || e.metaKey) {
        removeActiveUsagesBadge();
        clearTimeout(usagesTimer);
        lastHoveredSymbol = null;

        const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
        const item = getSymbolOrPathAtPos(cm, pos);

        if (item && item.symbol && item.range) {
          clearHoverMarker();
          currentHoverMarker = cm.markText(item.range.anchor, item.range.head, {
            className: 'cm-nav-link'
          });
        } else {
          clearHoverMarker();
        }
        return;
      }

      clearHoverMarker();

      // Busca de Usages sob Hover sem Ctrl
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
      const item = getSymbolOrPathAtPos(cm, pos);

      if (item && item.symbol && !item.isPath) {
        if (item.symbol !== lastHoveredSymbol) {
          lastHoveredSymbol = item.symbol;
          clearTimeout(usagesTimer);
          usagesTimer = setTimeout(async () => {
            if (activeCm !== cm || currentFilePath !== filePath) return;
            if (window.electronAPI && window.electronAPI.codeNavFindUsages) {
              const usages = await window.electronAPI.codeNavFindUsages({ filePath, symbol: item.symbol });
              showUsagesBadge(item.symbol, usages, pos, e.clientX, e.clientY);
            }
          }, 350);
        }
      } else {
        if (lastHoveredSymbol !== null) {
          lastHoveredSymbol = null;
          clearTimeout(usagesTimer);
          if (!isMouseOverBadge) {
            removeActiveUsagesBadge();
          }
        }
      }
    });

    wrapper.addEventListener('mouseleave', () => {
      clearHoverMarker();
      lastHoveredSymbol = null;
      clearTimeout(usagesTimer);
      setTimeout(() => {
        if (!isMouseOverBadge) {
          removeActiveUsagesBadge();
        }
      }, 200);
    });

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

