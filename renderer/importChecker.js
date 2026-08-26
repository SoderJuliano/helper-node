// renderer/importChecker.js
// Checador de imports do modo IDE (JS/TS via TypeScript Compiler API, Java via
// classpath do Maven/Gradle) — sublinha em vermelho ondulado o import/símbolo
// não resolvido, mostra a mensagem no hover e sugere o import mais provável
// no botão direito, igual ao IntelliJ. Módulo isolado, plugado no CodeMirror
// do editorController.js do mesmo jeito que renderer/codeNavigation.js.
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

  function clearMarkers() {
    markers.forEach((m) => m.clear());
    markers = [];
  }

  function removeHoverPopup() {
    if (hoverPopup) {
      hoverPopup.remove();
      hoverPopup = null;
      hoverPopupDiag = null;
    }
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
    // Resposta pode chegar depois de trocar de aba/arquivo ou de nova digitação — descarta se obsoleta
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

  function showHoverPopup(diag, clientX, clientY) {
    if (hoverPopupDiag === diag) return;
    removeHoverPopup();
    const popup = document.createElement('div');
    popup.className = 'import-check-hover-popup';
    popup.textContent = diag.message;
    document.body.appendChild(popup);

    let x = clientX;
    let y = clientY + 18;
    const w = popup.offsetWidth || 260;
    if (x + w > window.innerWidth) x = window.innerWidth - w - 10;
    popup.style.left = Math.max(10, x) + 'px';
    popup.style.top = y + 'px';

    hoverPopup = popup;
    hoverPopupDiag = diag;
  }

  // Aplica um quick fix do TypeScript (auto-import etc.) — só mexe no arquivo
  // atual; edits em outros arquivos (raro pra fix de import) ficam de fora.
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
  }

  // Insere `import <fqn>;` logo após o último import existente (ou após o
  // `package ...;`, se não houver nenhum import ainda)
  function insertJavaImport(cm, fqn) {
    const doc = cm.getDoc();
    const lineCount = doc.lineCount();
    let insertAfterLine = -1;
    for (let i = 0; i < lineCount; i++) {
      const lineText = doc.getLine(i);
      if (/^\s*import\s+/.test(lineText)) insertAfterLine = i;
      else if (insertAfterLine === -1 && /^\s*package\s+/.test(lineText)) insertAfterLine = i;
    }
    const importLine = `import ${fqn};`;
    if (insertAfterLine === -1) {
      doc.replaceRange(importLine + '\n\n', { line: 0, ch: 0 });
    } else {
      doc.replaceRange('\n' + importLine, { line: insertAfterLine, ch: doc.getLine(insertAfterLine).length });
    }
  }

  async function showQuickFixMenu(cm, filePath, diag, clientX, clientY) {
    removeHoverPopup();
    document.querySelectorAll('.import-check-quickfix-menu').forEach((m) => m.remove());

    const isJava = filePath.toLowerCase().endsWith('.java');
    let items = [];

    if (isJava) {
      items = (diag.suggestions || []).map((fqn) => ({
        label: `Importar ${fqn}`,
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
    runCheck(cm, filePath); // checagem imediata ao abrir/trocar de aba

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
        showHoverPopup(diags[0], e.clientX, e.clientY);
      } else {
        removeHoverPopup();
      }
    });

    wrapper.addEventListener('mouseleave', removeHoverPopup);

    // Captura ANTES do menu de contexto do codeNavigation.js: só intercepta
    // (e some com o clique direito padrão) quando há diagnóstico na posição.
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
