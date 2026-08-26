// renderer/codeNavUsagesPopup.js
// Popups de Usages e Definições múltiplas do CodeNavigation.
(function () {
  'use strict';

  let activeUsagesPopup = null;
  let activeDefinitionPopup = null;

  function removeActiveUsagesPopup() {
    if (activeUsagesPopup) {
      activeUsagesPopup.remove();
      activeUsagesPopup = null;
    }
  }

  function removeActiveDefinitionPopup() {
    if (activeDefinitionPopup) {
      activeDefinitionPopup.remove();
      activeDefinitionPopup = null;
    }
  }

  function isTestUsage(u) {
    if (!u) return false;
    const pathStr = (u.relativePath || u.filePath || '').toLowerCase();
    const fileStr = (u.fileName || pathStr.split('/').pop() || '').toLowerCase();
    const callerStr = (u.callerName || '').toLowerCase();

    if (
      /(?:^|[._/-])(?:test|tests|spec|specs|it|testcase|unittest)(?:[._/-]|\.|$)/i.test(fileStr) ||
      fileStr.endsWith('test.java') || fileStr.endsWith('tests.java') ||
      fileStr.endsWith('testcase.java') || fileStr.endsWith('test.js') ||
      fileStr.endsWith('test.ts') || fileStr.endsWith('spec.js') ||
      fileStr.endsWith('spec.ts') || fileStr.endsWith('test.py') ||
      fileStr.startsWith('test_') ||
      pathStr.includes('/test/') || pathStr.includes('\\test\\') ||
      pathStr.includes('/tests/') || pathStr.includes('\\tests\\') ||
      pathStr.includes('/src/test/') || pathStr.includes('\\src\\test\\') ||
      pathStr.includes('__tests__') || pathStr.includes('__test__')
    ) {
      return true;
    }

    if (
      /^test/i.test(callerStr) ||
      /test$/i.test(callerStr) ||
      /^should/i.test(callerStr) ||
      callerStr.includes('test')
    ) {
      return true;
    }

    return false;
  }

  function showUsagesPopup(usages, symbol, clientX, clientY) {
    removeActiveUsagesPopup();
    removeActiveDefinitionPopup();

    const rawList = Array.isArray(usages) ? usages : [];

    const sortedUsages = [...rawList].sort((a, b) => {
      const aTest = isTestUsage(a);
      const bTest = isTestUsage(b);
      if (aTest && !bTest) return 1;
      if (!aTest && bTest) return -1;
      return 0;
    });

    const popup = document.createElement('div');
    popup.className = 'code-nav-popup code-nav-usages-popup';
    activeUsagesPopup = popup;

    const header = document.createElement('div');
    header.className = 'code-nav-popup-header';

    const title = document.createElement('span');
    title.className = 'code-nav-popup-title';
    title.textContent = `Usos de "${symbol}" (${sortedUsages.length})`;

    const sub = document.createElement('span');
    sub.className = 'code-nav-popup-sub';
    sub.textContent = sortedUsages.length > 0 ? 'Enter: abrir selecionado / Esc: fechar' : 'Sem chamadores no projeto';

    header.appendChild(title);
    header.appendChild(sub);
    popup.appendChild(header);

    if (sortedUsages.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.padding = '12px';
      emptyDiv.style.color = '#888';
      emptyDiv.style.textAlign = 'center';
      emptyDiv.textContent = 'Nenhum chamador encontrado para este símbolo.';
      popup.appendChild(emptyDiv);
    }

    let selectedIndex = 0;

    const itemEls = sortedUsages.map((u, idx) => {
      const isTest = isTestUsage(u);
      const item = document.createElement('div');
      item.className = 'code-nav-popup-item' + (idx === 0 ? ' selected' : '') + (isTest ? ' code-nav-usage-test' : '');
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

      const rightDiv = document.createElement('div');
      rightDiv.style.display = 'flex';
      rightDiv.style.alignItems = 'center';
      rightDiv.style.flexShrink = '0';

      if (u.callerName) {
        const callerSpan = document.createElement('span');
        callerSpan.className = 'code-nav-popup-caller';
        callerSpan.textContent = `em ${u.callerName}()`;
        rightDiv.appendChild(callerSpan);
      }

      if (isTest) {
        const testBadge = document.createElement('span');
        testBadge.className = 'code-nav-popup-test-badge';
        testBadge.textContent = 'test';
        testBadge.title = 'Ocorrência em classe ou arquivo de teste';
        rightDiv.appendChild(testBadge);
      }

      topRow.appendChild(rightDiv);
      item.appendChild(topRow);

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
        if (sortedUsages[selectedIndex] && window.EditorController) {
          const u = sortedUsages[selectedIndex];
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
        if (sortedUsages.length > 0) {
          selectedIndex = (selectedIndex + 1) % sortedUsages.length;
          itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
          itemEls[selectedIndex]?.scrollIntoView({ block: 'nearest' });
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (sortedUsages.length > 0) {
          selectedIndex = (selectedIndex - 1 + sortedUsages.length) % sortedUsages.length;
          itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
          itemEls[selectedIndex]?.scrollIntoView({ block: 'nearest' });
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

  async function openAllMatches(matches) {
    removeActiveDefinitionPopup();
    if (!Array.isArray(matches) || !matches.length) return;
    for (let i = matches.length - 1; i >= 0; i--) {
      if (window.EditorController && matches[i].filePath) {
        await window.EditorController.openFile(matches[i].filePath, matches[i].line);
      }
    }
  }

  function showDefinitionPopup(matches, symbol, clientX, clientY) {
    removeActiveDefinitionPopup();
    removeActiveUsagesPopup();
    if (!Array.isArray(matches) || !matches.length) return;

    const popup = document.createElement('div');
    popup.className = 'code-nav-popup';
    activeDefinitionPopup = popup;

    const header = document.createElement('div');
    header.className = 'code-nav-popup-header';

    const title = document.createElement('span');
    title.className = 'code-nav-popup-title';
    title.textContent = `Definições de "${symbol}" (${matches.length})`;

    const sub = document.createElement('span');
    sub.className = 'code-nav-popup-sub';
    sub.textContent = 'Enter: abrir selecionado / Alt+Enter: abrir todos / Esc: fechar';

    header.appendChild(title);
    header.appendChild(sub);
    popup.appendChild(header);

    let selectedIndex = 0;

    const itemEls = matches.map((m, idx) => {
      const item = document.createElement('div');
      item.className = 'code-nav-popup-item' + (idx === 0 ? ' selected' : '');

      const kindSpan = document.createElement('span');
      kindSpan.className = `code-nav-popup-kind kind-${m.kind || 'unknown'}`;
      kindSpan.textContent = m.kind || 'def';

      const fileSpan = document.createElement('span');
      fileSpan.className = 'code-nav-popup-file';
      fileSpan.textContent = `${m.fileName}:${m.line}`;

      const pathSpan = document.createElement('span');
      pathSpan.className = 'code-nav-popup-path';
      pathSpan.textContent = m.relativePath || m.filePath;

      item.appendChild(kindSpan);
      item.appendChild(fileSpan);
      item.appendChild(pathSpan);

      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeActiveDefinitionPopup();
        if (window.EditorController && m.filePath) {
          window.EditorController.openFile(m.filePath, m.line, m.col);
        }
      });

      popup.appendChild(item);
      return item;
    });

    document.body.appendChild(popup);

    const width = popup.offsetWidth || 340;
    const height = popup.offsetHeight || 200;
    let x = clientX;
    let y = clientY + 10;
    if (x + width > window.innerWidth) x = window.innerWidth - width - 10;
    if (y + height > window.innerHeight) y = clientY - height - 10;
    popup.style.left = Math.max(10, x) + 'px';
    popup.style.top = Math.max(10, y) + 'px';

    const keyHandler = (e) => {
      if (!activeDefinitionPopup) {
        document.removeEventListener('keydown', keyHandler, true);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        document.removeEventListener('keydown', keyHandler, true);
        if (e.altKey) {
          openAllMatches(matches);
        } else if (matches[selectedIndex] && window.EditorController) {
          const m = matches[selectedIndex];
          removeActiveDefinitionPopup();
          window.EditorController.openFile(m.filePath, m.line, m.col);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        removeActiveDefinitionPopup();
        document.removeEventListener('keydown', keyHandler, true);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = (selectedIndex + 1) % matches.length;
        itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
        itemEls[selectedIndex]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = (selectedIndex - 1 + matches.length) % matches.length;
        itemEls.forEach((el, idx) => el.classList.toggle('selected', idx === selectedIndex));
        itemEls[selectedIndex]?.scrollIntoView({ block: 'nearest' });
      }
    };

    const clickOutsideHandler = (ev) => {
      if (popup && !popup.contains(ev.target)) {
        removeActiveDefinitionPopup();
        document.removeEventListener('mousedown', clickOutsideHandler, true);
        document.removeEventListener('keydown', keyHandler, true);
      }
    };

    setTimeout(() => {
      document.addEventListener('keydown', keyHandler, true);
      document.addEventListener('mousedown', clickOutsideHandler, true);
    }, 0);
  }

  window.CodeNavUsagesPopup = {
    showUsagesPopup,
    showDefinitionPopup,
    removeActiveUsagesPopup,
    removeActiveDefinitionPopup,
    isTestUsage,
  };
})();
