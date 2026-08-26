// renderer/codeNavigation.js
// Addon frontend do CodeMirror 5 para navegação de código (Go to Definition com Ctrl+Clique, Usages Tooltip sob Hover & Gutter Icons de Implementação)
(function () {
  'use strict';

  let currentHoverMarker = null;
  let activeCm = null;
  let currentFilePath = null;
  let activeCodeLensWidgets = [];

  function clearHoverMarker() {
    if (currentHoverMarker) {
      currentHoverMarker.clear();
      currentHoverMarker = null;
    }
  }

  function clearCodeLensWidgets() {
    if (activeCodeLensWidgets.length) {
      activeCodeLensWidgets.forEach(w => {
        try { w.clear(); } catch (_) {}
      });
      activeCodeLensWidgets = [];
    }
  }

  async function updateCodeLensUsages(cm, filePath) {
    clearCodeLensWidgets();
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavFindUsages) return;

    try {
      const items = await window.electronAPI.codeNavGetGutterInfo({ filePath });
      if (!Array.isArray(items)) return;

      for (const item of items) {
        if (!item.line || !item.symbol) continue;
        const lineIdx = item.line - 1;
        const usages = await window.electronAPI.codeNavFindUsages({ filePath, symbol: item.symbol });
        const count = Array.isArray(usages) ? usages.length : 0;
        if (count === 0) continue;

        const lensEl = document.createElement('div');
        lensEl.className = 'intellij-codelens-line';

        const hint = document.createElement('span');
        hint.className = 'intellij-codelens-hint';
        hint.textContent = `${count} ${count === 1 ? 'usage' : 'usages'}`;
        hint.title = `Clique para ver ${count} ${count === 1 ? 'uso' : 'usos'} de ${item.symbol}()`;

        hint.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (window.CodeNavUsagesPopup) {
            window.CodeNavUsagesPopup.showUsagesPopup(usages, item.symbol, ev.clientX, ev.clientY);
          }
        });

        lensEl.appendChild(hint);
        try {
          const widget = cm.addLineWidget(lineIdx, lensEl, { above: true, coverGutter: false, noHScroll: true });
          activeCodeLensWidgets.push(widget);
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[codeNavigation] erro ao atualizar CodeLens usages:', err);
    }
  }

  async function updateGutterMarkers(cm, filePath) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavGetGutterInfo) return;

    cm.clearGutter('code-nav-gutter');
    updateCodeLensUsages(cm, filePath).catch(() => {});

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
          if (window.CodeHighlight && item.symbol) {
            const destCm = window.EditorController.getCm && window.EditorController.getCm();
            if (destCm) {
              window.CodeHighlight.attach(destCm);
              window.CodeHighlight.pin(destCm, item.symbol);
            }
          }
        });

        const lineIdx = item.line - 1;
        cm.setGutterMarker(lineIdx, 'code-nav-gutter', iconEl);
      }
    } catch (err) {
      console.warn('[codeNavigation] erro ao buscar gutter info:', err);
    }
  }

  function getSymbolOrPathAtPos(cm, pos) {
    if (!cm || !pos || pos.line < 0) return null;
    const lineText = cm.getLine(pos.line);
    if (!lineText) return null;
    const ch = pos.ch;

    const token = cm.getTokenAt(pos);
    const tokenType = (token && token.type) ? token.type : '';

    if (tokenType.includes('comment')) {
      return null;
    }

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

    if (tokenType.includes('string') || tokenType.includes('keyword')) {
      return null;
    }

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

  function isMethodAtPos(cm, pos, symbol) {
    if (!cm || !pos || !symbol) return false;
    const lineText = cm.getLine(pos.line) || '';
    if (!lineText) return false;

    const trimmedLine = lineText.trim();
    if (/^(?:import|from|package|require|using|use)\b/i.test(trimmedLine)) {
      return false;
    }

    const wordRange = cm.findWordAt(pos);
    const word = cm.getRange(wordRange.anchor, wordRange.head).trim();
    if (word !== symbol) return false;

    const startCh = wordRange.anchor.ch;
    const endCh = wordRange.head.ch;

    const before = lineText.substring(0, startCh);
    const after = lineText.substring(endCh);
    const trimmedAfter = after.trim();

    if (/(?:class|interface|enum|struct|record|type)\s+$/i.test(before)) {
      return false;
    }

    if (/^\s*(?:<[^>]+>\s*)?\(/i.test(after)) {
      return true;
    }

    if (/(?:const|let|var)\s+$/i.test(before) && /^\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/i.test(after)) {
      return true;
    }

    if (/(?:const|let|var)\s+$/i.test(before) && /^\s*=\s*(?:async\s*)?function\b/i.test(after)) {
      return true;
    }

    if (/^\s*:\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>)/i.test(after)) {
      return true;
    }

    if (/(?:async\s+)?def\s+$/i.test(before)) {
      return true;
    }

    if (/(?:async\s+)?function\*?\s+$/i.test(before)) {
      return true;
    }

    if (/(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|override|async)\s+)+[A-Za-z0-9_$<>[\].,?]+\s*$/i.test(before) && trimmedAfter.startsWith('(')) {
      return true;
    }

    if (pos.line > 0 && trimmedAfter.startsWith('(')) {
      const prevLine = (cm.getLine(pos.line - 1) || '').trim();
      if (prevLine.startsWith('@')) {
        return true;
      }
    }

    return false;
  }

  async function handleCtrlClick(cm, filePath, pos, mouseEvent) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.codeNavFindDefinition) return;

    const item = getSymbolOrPathAtPos(cm, pos);
    if (!item || !item.symbol) return;

    const lineText = cm.getLine(pos.line) || '';
    const matches = await window.electronAPI.codeNavFindDefinition({ filePath, symbol: item.symbol, lineText, content: cm.getValue() });

    if (!Array.isArray(matches) || matches.length === 0) return;

    const alvo = matches[0];
    if (window.EditorController && alvo.filePath) {
      await window.EditorController.openFile(alvo.filePath, alvo.line);
      if (window.CodeHighlight && item.symbol) {
        const destCm = window.EditorController.getCm && window.EditorController.getCm();
        if (destCm) {
          window.CodeHighlight.attach(destCm);
          window.CodeHighlight.pin(destCm, item.symbol);
        }
      }
    }
  }

  function attachCodeNavigation(cm, filePath) {
    if (!cm) return;
    activeCm = cm;
    currentFilePath = filePath;

    updateGutterMarkers(cm, filePath);

    if (window.CodeHighlight) {
      window.CodeHighlight.attach(cm);
      window.CodeHighlight.attachRuler(cm);
    }

    const wrapper = cm.getWrapperElement();
    if (wrapper._hasCodeNav) return;
    wrapper._hasCodeNav = true;

    if (window.electronAPI && window.electronAPI.onSymbolIndexerStatus) {
      window.electronAPI.onSymbolIndexerStatus((data) => {
        if (data && data.status === 'completed' && activeCm && currentFilePath) {
          updateGutterMarkers(activeCm, currentFilePath);
        }
      });
    }

    wrapper.addEventListener('contextmenu', (e) => {
      if (window.CodeNavContextMenu) {
        window.CodeNavContextMenu.showEditorContextMenu(cm, currentFilePath, e, getSymbolOrPathAtPos);
      }
    });

    let rafPendente = false;
    let ultimaPos = null;
    const onMouseMove = (e) => {
      if (rafPendente) return;
      rafPendente = true;
      requestAnimationFrame(() => {
        rafPendente = false;
        const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
        const mesma = ultimaPos && pos && ultimaPos.line === pos.line && ultimaPos.ch === pos.ch;
        if (mesma && !e.ctrlKey && !e.metaKey) return;
        ultimaPos = pos ? { line: pos.line, ch: pos.ch } : null;
        handleMouseMove(e, pos);
      });
    };
    wrapper.addEventListener('mousemove', onMouseMove);

    const handleMouseMove = (e, posPreCalculada) => {
      if (e.ctrlKey || e.metaKey) {
        const item = getSymbolOrPathAtPos(cm, posPreCalculada);
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
    };

    wrapper.addEventListener('mouseleave', () => {
      clearHoverMarker();
    });

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

    wrapper.addEventListener('keydown', async (e) => {
      if ((e.altKey && e.key === 'F7') || (e.shiftKey && e.key === 'F12')) {
        const cursor = cm.getCursor();
        const selection = cm.getSelection().trim();
        let targetSymbol = (/^[A-Za-z_$][\w$]*$/.test(selection)) ? selection : null;
        if (!targetSymbol) {
          const item = getSymbolOrPathAtPos(cm, cursor);
          targetSymbol = (item && item.symbol && !item.isPath) ? item.symbol : null;
        }
        if (!targetSymbol) {
          const wordRange = cm.findWordAt(cursor);
          const word = cm.getRange(wordRange.anchor, wordRange.head).trim();
          if (word && /^[A-Za-z_$][\w$]*$/.test(word)) {
            targetSymbol = word;
          }
        }
        if (targetSymbol && window.electronAPI && window.electronAPI.codeNavFindUsages && window.CodeNavUsagesPopup) {
          e.preventDefault();
          e.stopPropagation();
          const coords = cm.charCoords(cursor, 'window');
          const usages = await window.electronAPI.codeNavFindUsages({ filePath: currentFilePath, symbol: targetSymbol });
          window.CodeNavUsagesPopup.showUsagesPopup(usages, targetSymbol, coords.left, coords.bottom);
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
    updateGutterMarkers,
    getSymbolOrPathAtPos,
    isMethodAtPos,
  };
})();
