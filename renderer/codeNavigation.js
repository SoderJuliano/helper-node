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

  let badgeHideTimer = null;

  function scheduleBadgeRemoval(delayMs = 2000) {
    clearTimeout(badgeHideTimer);
    badgeHideTimer = setTimeout(() => {
      if (!isMouseOverBadge) {
        removeActiveUsagesBadge();
      }
    }, delayMs);
  }

  function removeActiveUsagesBadge() {
    clearTimeout(badgeHideTimer);
    badgeHideTimer = null;
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
    clearTimeout(badgeHideTimer);
    if (activeUsagesBadge) {
      activeUsagesBadge.remove();
      activeUsagesBadge = null;
    }

    const count = Array.isArray(usages) ? usages.length : 0;
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
      clearTimeout(badgeHideTimer);
    });

    badge.addEventListener('mouseleave', () => {
      isMouseOverBadge = false;
      scheduleBadgeRemoval(1500);
    });

    badge.addEventListener('click', (ev) => {
      ev.stopPropagation();
      isMouseOverBadge = false;
      clearTimeout(badgeHideTimer);
      removeActiveUsagesBadge();
      showUsagesPopup(usages, symbol, clientX, clientY);
    });

    document.body.appendChild(badge);
    activeUsagesBadge = badge;

    // Posicionar mais perto da palavra no CodeMirror (21px acima)
    let x = clientX;
    let y = clientY - 24;

    if (activeCm && pos) {
      try {
        const coords = activeCm.charCoords(pos, 'window');
        if (coords && coords.top > 0) {
          x = coords.left;
          y = coords.top - 21;
        }
      } catch (_) {}
    }

    const badgeWidth = badge.offsetWidth || 160;
    if (x + badgeWidth > window.innerWidth) x = window.innerWidth - badgeWidth - 10;
    if (y < 10) {
      if (activeCm && pos) {
        try {
          const coords = activeCm.charCoords(pos, 'window');
          y = (coords.bottom || clientY) + 4;
        } catch (_) { y = clientY + 18; }
      } else { y = clientY + 18; }
    }

    badge.style.left = Math.max(10, x) + 'px';
    badge.style.top = Math.max(10, y) + 'px';

    // Tempo de carência de 2.5s para permitir mover o cursor até o badge sem ele sumir
    scheduleBadgeRemoval(2500);
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
        const isMethod = item.kind === 'interface-method';
        const iconEl = document.createElement('div');
        iconEl.className = 'code-nav-gutter-icon' + (isMethod ? ' method' : '');
        iconEl.textContent = isMethod ? '↓' : 'I↓';
        iconEl.title = isMethod
          ? `Ir para a implementação de ${item.symbol}()`
          : `Ir para implementação: ${item.symbol || 'Classe'}`;
        iconEl.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!window.EditorController || !item.target.filePath) return;
          await window.EditorController.openFile(item.target.filePath, item.target.line);
          // Deixa o nome realçado no destino até o usuário clicar em qualquer
          // outro lugar — senão ele chega no arquivo sem saber onde olhar.
          if (window.CodeHighlight && item.symbol) {
            const destCm = window.EditorController.getCm && window.EditorController.getCm();
            if (destCm) {
              window.CodeHighlight.attach(destCm);
              window.CodeHighlight.pin(destCm, item.symbol);
            }
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

    // Checa o tipo do token do CodeMirror na posição atual do cursor/mouse
    const token = cm.getTokenAt(pos);
    const tokenType = (token && token.type) ? token.type : '';

    // 1. Ignorar completamente palavras dentro de comentários (//, /* */, Javadoc, docstrings)
    if (tokenType.includes('comment')) {
      return null;
    }

    // 2. Checar se a posição está dentro de aspas para ser um caminho de arquivo importado
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

    // Se estiver em uma string comum de texto (e não for caminho de importação), ignora
    if (tokenType.includes('string')) {
      return null;
    }

    // Ignorar palavras-chave de linguagem (if, return, function, class, etc.)
    if (tokenType.includes('keyword')) {
      return null;
    }

    // 3. Símbolo normal de código (método, função, variável, propriedade, classe)
    const wordRange = cm.findWordAt(pos);
    const symbol = cm.getRange(wordRange.anchor, wordRange.head).trim();

    const RESERVED_WORDS = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
      'return', 'function', 'class', 'const', 'let', 'var', 'import', 'export',
      'from', 'default', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super',
      'async', 'await', 'yield', 'typeof', 'instanceof', 'void', 'delete', 'in',
      'public', 'private', 'protected', 'static', 'final', 'abstract', 'interface',
      'implements', 'extends', 'package', 'null', 'true', 'false', 'undefined'
    ]);

    if (symbol && /^[A-Za-z_$][\w$]*$/.test(symbol) && !RESERVED_WORDS.has(symbol)) {
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
    // `content` só é usado pro fallback de dependência Java (clique num uso do
    // símbolo, não na linha do import — precisa do arquivo inteiro pra achar
    // qual import corresponde ao símbolo clicado).
    const matches = await window.electronAPI.codeNavFindDefinition({ filePath, symbol: item.symbol, lineText, content: cm.getValue() });

    if (!Array.isArray(matches) || matches.length === 0) return;

    if (matches.length === 1) {
      if (window.EditorController && matches[0].filePath) {
        await window.EditorController.openFile(matches[0].filePath, matches[0].line);
      }
    } else {
      showDefinitionPopup(matches, item.symbol, mouseEvent.clientX, mouseEvent.clientY);
    }
  }

  let activeEditorContextMenu = null;
  let activeRenameState = null;

  function removeActiveEditorContextMenu() {
    if (activeEditorContextMenu) {
      activeEditorContextMenu.remove();
      activeEditorContextMenu = null;
    }
  }

  function removeActiveRename() {
    if (activeRenameState) {
      if (activeRenameState.cleanup) {
        activeRenameState.cleanup();
      }
      activeRenameState = null;
    }
  }

  function findSymbolOccurrencesInCm(cm, symbol) {
    if (!cm || !symbol) return [];
    const occurrences = [];
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    const lineCount = cm.lineCount();

    for (let i = 0; i < lineCount; i++) {
      const lineText = cm.getLine(i);
      if (!lineText) continue;
      let match;
      while ((match = regex.exec(lineText)) !== null) {
        occurrences.push({
          line: i,
          chStart: match.index,
          chEnd: match.index + symbol.length
        });
      }
    }
    return occurrences;
  }

  async function updateProjectUsages(originalSymbol, finalName, projectUsages, currentFile) {
    if (!Array.isArray(projectUsages) || projectUsages.length === 0) return;
    const normCurrent = (currentFile || '').replace(/\\/g, '/').toLowerCase();
    
    const usagesByFile = new Map();
    for (const u of projectUsages) {
      if (!u.filePath) continue;
      const normPath = u.filePath.replace(/\\/g, '/');
      if (normPath.toLowerCase() === normCurrent) continue;
      if (!usagesByFile.has(normPath)) {
        usagesByFile.set(normPath, u.filePath);
      }
    }

    const escaped = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');

    for (const [normPath, rawPath] of usagesByFile.entries()) {
      try {
        if (window.electronAPI && window.electronAPI.readFileContent && window.electronAPI.editorSaveFile) {
          const res = await window.electronAPI.readFileContent(rawPath);
          if (res && typeof res.content === 'string') {
            if (regex.test(res.content)) {
              const updatedContent = res.content.replace(regex, finalName);
              await window.electronAPI.editorSaveFile({ filePath: rawPath, content: updatedContent });
            }
          }
        }
      } catch (err) {
        console.warn(`[codeNavigation] Erro ao renomear em ${rawPath}:`, err);
      }
    }
  }

  function startRenameMethod(cm, filePath, originalSymbol, clickPos) {
    removeActiveRename();
    removeActiveUsagesBadge();
    removeActivePopup();

    const originalDocContent = cm.getValue();
    const localOccurrences = findSymbolOccurrencesInCm(cm, originalSymbol);
    
    let projectUsages = [];
    if (window.electronAPI && window.electronAPI.codeNavFindUsages) {
      window.electronAPI.codeNavFindUsages({ filePath, symbol: originalSymbol }).then(u => {
        if (Array.isArray(u)) projectUsages = u;
      }).catch(() => {});
    }

    let renameMarkers = [];
    function updateRedHighlights(symbolToHighlight) {
      renameMarkers.forEach(m => m.clear());
      renameMarkers = [];
      if (!symbolToHighlight) return;
      const occs = findSymbolOccurrencesInCm(cm, symbolToHighlight);
      for (const occ of occs) {
        const marker = cm.markText(
          { line: occ.line, ch: occ.chStart },
          { line: occ.line, ch: occ.chEnd },
          { className: 'cm-rename-highlight-red' }
        );
        renameMarkers.push(marker);
      }
    }

    updateRedHighlights(originalSymbol);

    // Banner de Aviso com Fundo Vermelho em Destaque
    const banner = document.createElement('div');
    banner.className = 'code-rename-banner';

    const header = document.createElement('div');
    header.className = 'code-rename-header';

    const warningSpan = document.createElement('span');
    warningSpan.className = 'code-rename-warning-span';
    warningSpan.innerHTML = `<span>⚠️</span> <span>Renomeando método <strong>'${originalSymbol}'</strong> (${localOccurrences.length} uso${localOccurrences.length !== 1 ? 's' : ''})</span>`;

    const timerSpan = document.createElement('span');
    timerSpan.className = 'code-rename-timer';
    timerSpan.textContent = 'Auto-confirma em 10s';

    header.appendChild(warningSpan);
    header.appendChild(timerSpan);
    banner.appendChild(header);

    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'code-rename-input-wrapper';

    const renameInput = document.createElement('input');
    renameInput.type = 'text';
    renameInput.className = 'code-rename-input';
    renameInput.value = originalSymbol;

    inputWrapper.appendChild(renameInput);
    banner.appendChild(inputWrapper);

    const hintsRow = document.createElement('div');
    hintsRow.className = 'code-rename-hints';
    hintsRow.innerHTML = `<span><span class="code-rename-hint-key">Enter</span> confirmar</span> <span><span class="code-rename-hint-key">Esc</span> cancelar</span> <span>10s inativo (>1 char): auto-confirma</span>`;
    banner.appendChild(hintsRow);

    const wrapper = cm.getWrapperElement();
    wrapper.appendChild(banner);

    renameInput.focus();
    renameInput.select();

    let autoConfirmTimer = null;
    let countdownInterval = null;
    let remainingSeconds = 10;

    function resetTimer() {
      clearTimeout(autoConfirmTimer);
      clearInterval(countdownInterval);
      remainingSeconds = 10;
      timerSpan.textContent = `Auto-confirma em ${remainingSeconds}s`;

      countdownInterval = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds >= 0) {
          timerSpan.textContent = `Auto-confirma em ${remainingSeconds}s`;
        }
      }, 1000);

      autoConfirmTimer = setTimeout(() => {
        clearInterval(countdownInterval);
        const val = renameInput.value.trim();
        if (val.length > 1 && val !== originalSymbol) {
          confirmRename(val);
        }
      }, 10000);
    }

    resetTimer();

    renameInput.addEventListener('input', () => {
      const newName = renameInput.value.trim();
      if (newName && newName !== originalSymbol) {
        const escaped = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'g');
        const updatedDocContent = originalDocContent.replace(regex, newName);
        
        const cursor = cm.getCursor();
        cm.setValue(updatedDocContent);
        cm.setCursor(cursor);
        updateRedHighlights(newName);
      } else if (!newName || newName === originalSymbol) {
        const cursor = cm.getCursor();
        cm.setValue(originalDocContent);
        cm.setCursor(cursor);
        updateRedHighlights(originalSymbol);
      }
      resetTimer();
    });

    function confirmRename(finalName) {
      const isConfirmed = finalName && finalName.length > 1 && finalName !== originalSymbol;
      cleanup();
      if (isConfirmed) {
        const escaped = originalSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'g');
        const updatedDocContent = originalDocContent.replace(regex, finalName);
        cm.setValue(updatedDocContent);

        if (projectUsages && projectUsages.length > 0) {
          updateProjectUsages(originalSymbol, finalName, projectUsages, filePath);
        }

        if (window.EditorController && window.EditorController.markDirty) {
          window.EditorController.markDirty(filePath);
        }
      } else {
        cm.setValue(originalDocContent);
      }
    }

    function cancelRename() {
      cleanup();
      cm.setValue(originalDocContent);
    }

    function cleanup() {
      clearTimeout(autoConfirmTimer);
      clearInterval(countdownInterval);
      renameMarkers.forEach(m => m.clear());
      renameMarkers = [];
      if (banner && banner.parentNode) {
        banner.remove();
      }
      document.removeEventListener('keydown', globalKeyListener, true);
      activeRenameState = null;
    }

    const globalKeyListener = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmRename(renameInput.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    };

    renameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        confirmRename(renameInput.value.trim());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });

    document.addEventListener('keydown', globalKeyListener, true);

    activeRenameState = {
      cleanup,
      confirm: confirmRename,
      cancel: cancelRename
    };
  }

  function showEditorContextMenu(cm, filePath, event) {
    event.preventDefault();
    event.stopPropagation();

    removeActiveEditorContextMenu();
    removeActiveUsagesBadge();
    removeActivePopup();

    const selection = cm.getSelection();
    const hasSelection = selection && selection.length > 0;

    const pos = cm.coordsChar({ left: event.clientX, top: event.clientY });
    const item = getSymbolOrPathAtPos(cm, pos);
    let targetSymbol = (item && item.symbol && !item.isPath) ? item.symbol : null;

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
      const btnRename = document.createElement('button');
      btnRename.className = 'menu-item-rename menu-danger';
      btnRename.innerHTML = `<span class="menu-icon">✏️</span> <span>Renomear '${targetSymbol}'</span>`;
      btnRename.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeActiveEditorContextMenu();
        startRenameMethod(cm, filePath, targetSymbol, pos);
      });
      menu.appendChild(btnRename);
    }

    if (hasSelection) {
      const btnCopy = document.createElement('button');
      btnCopy.className = 'menu-item-copy';
      const linesCount = selection.split('\n').length;
      const label = linesCount > 1 ? `Copiar (${linesCount} linhas)` : 'Copiar';
      btnCopy.innerHTML = `<span class="menu-icon">📋</span> <span>${label}</span>`;
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

  // Configura os ouvintes de evento no CodeMirror
  function attachCodeNavigation(cm, filePath) {
    if (!cm) return;
    activeCm = cm;
    currentFilePath = filePath;

    // Atualiza calha de implementações
    updateGutterMarkers(cm, filePath);

    // Realce de ocorrências da palavra selecionada.
    if (window.CodeHighlight) window.CodeHighlight.attach(cm);

    const wrapper = cm.getWrapperElement();
    if (wrapper._hasCodeNav) return;
    wrapper._hasCodeNav = true;

    // Menu de contexto no clique do botão direito (Renomear método / Copiar seleção)
    wrapper.addEventListener('contextmenu', (e) => {
      showEditorContextMenu(cm, currentFilePath, e);
    });

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
            if (activeCm !== cm || !currentFilePath) return;
            if (window.electronAPI && window.electronAPI.codeNavFindUsages) {
              const usages = await window.electronAPI.codeNavFindUsages({ filePath: currentFilePath, symbol: item.symbol });
              showUsagesBadge(item.symbol, usages, pos, e.clientX, e.clientY);
            }
          }, 300);
        }
      } else {
        if (lastHoveredSymbol !== null) {
          lastHoveredSymbol = null;
          clearTimeout(usagesTimer);
          if (!isMouseOverBadge) {
            scheduleBadgeRemoval(1800);
          }
        }
      }
    });

    wrapper.addEventListener('mouseleave', () => {
      clearHoverMarker();
      lastHoveredSymbol = null;
      clearTimeout(usagesTimer);
      if (!isMouseOverBadge) {
        scheduleBadgeRemoval(1500);
      }
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


