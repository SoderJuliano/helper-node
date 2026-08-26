// renderer/importChecker.js
// Checador de imports do modo IDE (JS/TS via TypeScript Compiler API, Java via
// classpath do Maven/Gradle e auto-import Spring/JDK) — sublinha em vermelho ondulado
// o import/simbolo nao resolvido, mostra popup interativo no hover com botao de 1 clique
// para importar e sugere auto-import no clique direito e Alt+Enter, igual ao IntelliJ.
(function () {
  'use strict';

  const DEBOUNCE_MS = 600;

  let markers = [];
  let debounceTimer = null;
  let activeCm = null;
  let currentFilePath = null;
  let checkSeq = 0;
  let hoverPopup = null;
  let hoverPopupDiag = null;
  let popupCloseTimer = null;

  function clearMarkers() {
    markers.forEach((m) => m.clear());
    markers = [];
  }

  function removeHoverPopup() {
    clearTimeout(popupCloseTimer);
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
      hoverPopupDiag = null;
    }
  }

  function scheduleRemoveHoverPopup(delay = 180) {
    clearTimeout(popupCloseTimer);
    popupCloseTimer = setTimeout(() => {
      removeHoverPopup();
    }, delay);
  }

  async function runCheck(cm, filePath) {
    if (!window.electronAPI || !window.electronAPI.importCheckGetDiagnostics) return;
    const mySeq = ++checkSeq;
    const content = cm.getValue();
    let diagnostics = [];
    try {
      diagnostics = await window.electronAPI.importCheckGetDiagnostics({ filePath, content });
    } catch (_) {
      diagnostics = [];
    }

    if (mySeq !== checkSeq || activeCm !== cm || currentFilePath !== filePath) return;

    clearMarkers();
    if (!Array.isArray(diagnostics)) return;

    for (const d of diagnostics) {
      try {
        const anchor = { line: d.line - 1, ch: d.col - 1 };
        const head = { line: (d.endLine || d.line) - 1, ch: (d.endCol || d.col) - 1 };
        if (anchor.line < 0 || head.line < anchor.line) continue;
        if (head.line === anchor.line && head.ch <= anchor.ch) continue;
        const marker = cm.markText(anchor, head, { className: 'cm-import-error' });
        marker._importDiag = d;
        markers.push(marker);
      } catch (_) {}
    }
  }

  function scheduleCheck(cm, filePath) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runCheck(cm, filePath), DEBOUNCE_MS);
  }

  function diagnosticsAtPos(pos) {
    const found = [];
    for (const m of markers) {
      const range = m.find();
      if (!range) continue;
      const afterStart = pos.line > range.from.line || (pos.line === range.from.line && pos.ch >= range.from.ch);
      const beforeEnd = pos.line < range.to.line || (pos.line === range.to.line && pos.ch <= range.to.ch);
      if (afterStart && beforeEnd) found.push(m._importDiag);
    }
    return found;
  }

  // Insere `import <fqn>;` de forma inteligente, ordenada e sem duplicacoes
  function insertJavaImport(cm, fqn) {
    if (!cm || !fqn) return;
    const doc = cm.getDoc();
    const content = doc.getValue();
    const lines = content.split('\n');
    const importLines = [];
    let packageLineIdx = -1;
    let firstImportLineIdx = -1;
    let lastImportLineIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^package\s+[a-zA-Z0-9_.]+\s*;/.test(trimmed)) {
        packageLineIdx = i;
        continue;
      }

      const impMatch = trimmed.match(/^import(?:\s+static)?\s+([a-zA-Z0-9_.]+)(\.\*)?\s*;/);
      if (impMatch) {
        if (firstImportLineIdx === -1) firstImportLineIdx = i;
        lastImportLineIdx = i;

        const importedFqn = impMatch[1];
        const isWildcard = !!impMatch[2];

        if (!isWildcard && importedFqn === fqn) return;
        if (isWildcard) {
          const pkg = fqn.substring(0, fqn.lastIndexOf('.'));
          if (importedFqn === pkg) return;
        }

        importLines.push({ lineIdx: i, text: trimmed, fqn: importedFqn });
      }
    }

    const newImportText = `import ${fqn};`;

    if (firstImportLineIdx !== -1 && lastImportLineIdx !== -1) {
      const allImports = importLines.map((item) => item.text);
      allImports.push(newImportText);

      allImports.sort((a, b) => {
        const aIsStatic = a.startsWith('import static');
        const bIsStatic = b.startsWith('import static');
        if (aIsStatic !== bIsStatic) return aIsStatic ? 1 : -1;
        return a.localeCompare(b);
      });

      const uniqueImports = Array.from(new Set(allImports));
      const from = { line: firstImportLineIdx, ch: 0 };
      const to = { line: lastImportLineIdx, ch: doc.getLine(lastImportLineIdx).length };
      doc.replaceRange(uniqueImports.join('\n'), from, to);
    } else if (packageLineIdx !== -1) {
      const lineLen = doc.getLine(packageLineIdx).length;
      doc.replaceRange('\n\n' + newImportText, { line: packageLineIdx, ch: lineLen });
    } else {
      doc.replaceRange(newImportText + '\n\n', { line: 0, ch: 0 });
    }

    if (currentFilePath) {
      scheduleCheck(cm, currentFilePath);
    }
  }

  function applyTsFix(cm, filePath, fix) {
    const sameFile = fix.changes.filter((c) => c.fileName && c.fileName.replace(/\\/g, '/').toLowerCase() === filePath.replace(/\\/g, '/').toLowerCase());
    if (sameFile.length === 0) return;
    const doc = cm.getDoc();
    const allChanges = sameFile.flatMap((c) => c.textChanges).sort((a, b) => b.start - a.start);
    for (const tc of allChanges) {
      const from = doc.posFromIndex(tc.start);
      const to = doc.posFromIndex(tc.start + tc.length);
      doc.replaceRange(tc.newText, from, to);
    }
    if (currentFilePath) {
      scheduleCheck(cm, currentFilePath);
    }
  }

  function showHoverPopup(cm, filePath, diag, clientX, clientY) {
    if (hoverPopupDiag === diag) {
      clearTimeout(popupCloseTimer);
      return;
    }
    removeHoverPopup();

    const popup = document.createElement('div');
    popup.className = 'import-check-hover-popup';

    const msgDiv = document.createElement('div');
    msgDiv.className = 'import-check-popup-msg';
    msgDiv.textContent = diag.message;
    popup.appendChild(msgDiv);

    const isJava = filePath.toLowerCase().endsWith('.java');

    if (isJava && Array.isArray(diag.suggestions) && diag.suggestions.length > 0) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'import-check-popup-actions';

      const topCandidates = diag.suggestions.slice(0, 3);
      topCandidates.forEach((fqn, idx) => {
        const btn = document.createElement('button');
        btn.className = 'import-check-popup-btn' + (idx === 0 ? ' primary' : '');
        btn.innerHTML = `<span class="btn-icon">⚡</span> Importar <strong>${fqn}</strong>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          removeHoverPopup();
          insertJavaImport(cm, fqn);
        });
        actionsDiv.appendChild(btn);
      });

      if (diag.suggestions.length > 3) {
        const moreHint = document.createElement('div');
        moreHint.className = 'import-check-popup-more';
        moreHint.textContent = `+${diag.suggestions.length - 3} opções (clique direito ou Alt+Enter)`;
        actionsDiv.appendChild(moreHint);
      }

      popup.appendChild(actionsDiv);
    }

    popup.addEventListener('mouseenter', () => {
      clearTimeout(popupCloseTimer);
    });
    popup.addEventListener('mouseleave', () => {
      scheduleRemoveHoverPopup(100);
    });

    document.body.appendChild(popup);

    let x = clientX;
    let y = clientY + 18;
    const w = popup.offsetWidth || 280;
    if (x + w > window.innerWidth) x = window.innerWidth - w - 10;
    popup.style.left = Math.max(10, x) + 'px';
    popup.style.top = y + 'px';

    hoverPopup = popup;
    hoverPopupDiag = diag;
  }

  async function showQuickFixMenu(cm, filePath, diag, clientX, clientY) {
    removeHoverPopup();
    document.querySelectorAll('.import-check-quickfix-menu').forEach((m) => m.remove());

    const isJava = filePath.toLowerCase().endsWith('.java');
    let items = [];

    if (isJava) {
      items = (diag.suggestions || []).map((fqn) => ({
        label: `⚡ Importar ${fqn}`,
        run: () => insertJavaImport(cm, fqn),
      }));
    } else if (window.electronAPI && window.electronAPI.importCheckGetQuickFixes) {
      let fixes = [];
      try {
        fixes = await window.electronAPI.importCheckGetQuickFixes({
          filePath, content: cm.getValue(), start: diag.start, length: diag.length, errorCodes: [diag.code],
        });
      } catch (_) {}
      items = (fixes || [])
        .filter((f) => f.fixName !== 'disableJsDiagnostics')
        .map((f) => ({ label: f.description, run: () => applyTsFix(cm, filePath, f) }));
    }

    if (items.length === 0) return;

    const menu = document.createElement('div');
    menu.className = 'code-editor-context-menu import-check-quickfix-menu';
    for (const item of items) {
      const btn = document.createElement('button');
      btn.innerHTML = `<span>${item.label}</span>`;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        menu.remove();
        item.run();
      });
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);

    const w = menu.offsetWidth || 200;
    const h = menu.offsetHeight || 60;
    let x = clientX;
    let y = clientY;
    if (x + w > window.innerWidth) x = window.innerWidth - w - 10;
    if (y + h > window.innerHeight) y = window.innerHeight - h - 10;
    menu.style.left = Math.max(10, x) + 'px';
    menu.style.top = Math.max(10, y) + 'px';

    const dismiss = (ev) => {
      if (menu && !menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
  }

  function attachImportChecker(cm, filePath) {
    if (!cm || !filePath) return;
    activeCm = cm;
    currentFilePath = filePath;
    clearMarkers();
    removeHoverPopup();
    clearTimeout(debounceTimer);
    runCheck(cm, filePath);

    const wrapper = cm.getWrapperElement();
    if (wrapper._hasImportCheck) return;
    wrapper._hasImportCheck = true;

    cm.on('change', () => {
      if (activeCm !== cm) return;
      scheduleCheck(cm, currentFilePath);
    });

    wrapper.addEventListener('mousemove', (e) => {
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
      const diags = diagnosticsAtPos(pos);
      if (diags.length > 0) {
        showHoverPopup(cm, currentFilePath, diags[0], e.clientX, e.clientY);
      } else {
        scheduleRemoveHoverPopup(120);
      }
    });

    wrapper.addEventListener('mouseleave', () => {
      scheduleRemoveHoverPopup(150);
    });

    // Atalho Alt + Enter para auto-import imediato (estilo IntelliJ)
    cm.on('keydown', (cmInst, e) => {
      if (e.altKey && e.key === 'Enter') {
        const cur = cmInst.getCursor();
        const diags = diagnosticsAtPos(cur);
        if (diags.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          const d = diags[0];
          if (Array.isArray(d.suggestions) && d.suggestions.length === 1) {
            insertJavaImport(cmInst, d.suggestions[0]);
          } else {
            const coords = cmInst.cursorCoords(true, 'page');
            showQuickFixMenu(cmInst, currentFilePath, d, coords.left, coords.bottom);
          }
        }
      }
    });

    // Menu de contexto com clique direito
    wrapper.addEventListener('contextmenu', (e) => {
      const pos = cm.coordsChar({ left: e.clientX, top: e.clientY });
      const diags = diagnosticsAtPos(pos);
      if (diags.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        showQuickFixMenu(cm, currentFilePath, diags[0], e.clientX, e.clientY);
      }
    }, true);
  }

  window.ImportChecker = { attach: attachImportChecker };
})();

