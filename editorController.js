// editorController.js — controla o editor de código embutido (#file-viewer) com suporte a N abas.
//
// Modelado como Map<path, doc> suportando a renderização de abas dinâmicas
// no #fv-tabs-container.
(function () {
  'use strict';

  const { CM_MODE_BY_EXT, LANG_LABEL_BY_EXT, normPath, extOf, getFileName } = window.EditorConstants;

  const openFiles = new Map();
  let activePath = null;
  let cm = null;
  let autocompleteTimer = null;

  function ensureCm() {
    if (cm) return cm;
    if (!window.CodeMirror) return null;
    const body = document.getElementById('fv-body');
    if (!body) return null;
    body.innerHTML = '';
    const ta = document.createElement('textarea');
    body.appendChild(ta);
    cm = window.CodeMirror.fromTextArea(ta, {
      lineNumbers: true,
      gutters: ['CodeMirror-linenumbers', 'code-nav-gutter', 'app-runner-gutter'],
      theme: 'dracula',
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      styleActiveLine: false,
      extraKeys: {
        'Ctrl-F': 'findPersistent', 'Cmd-F': 'findPersistent',
        'Ctrl-G': 'findNext', 'Shift-Ctrl-G': 'findPrev',
        'Cmd-G': 'findNext', 'Shift-Cmd-G': 'findPrev',
        'Ctrl-Space': 'autocomplete',
        'Tab': (editor) => (window.EditorAutocomplete.getGhostTextMarker() ? window.EditorAutocomplete.acceptGhostText(editor) : window.CodeMirror.Pass),
        'Esc': (editor) => (window.EditorAutocomplete.getGhostTextMarker() ? window.EditorAutocomplete.clearGhostText() : window.CodeMirror.Pass)
      },
    });

    const savedEditorFontSize = localStorage.getItem('editor_font_size');
    const wrapperEl = cm.getWrapperElement();
    if (savedEditorFontSize && wrapperEl) {
      wrapperEl.style.fontSize = savedEditorFontSize + 'px';
      setTimeout(() => cm.refresh(), 0);
    }

    const handleEditorWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        const delta = e.deltaY < 0 ? 1 : -1;
        let currentSize = parseFloat(wrapperEl.style.fontSize) || 13;
        let newSize = Math.min(40, Math.max(8, currentSize + delta));
        wrapperEl.style.fontSize = newSize + 'px';
        localStorage.setItem('editor_font_size', newSize);
        cm.refresh();
        if (typeof window.showZoomToast === 'function') {
          window.showZoomToast(`🔍 Zoom do Editor: ${newSize}px`);
        }
      }
    };

    if (wrapperEl && !wrapperEl._hasWheelZoom) {
      wrapperEl._hasWheelZoom = true;
      wrapperEl.addEventListener('wheel', handleEditorWheel, { passive: false });
    }

    cm.on('inputRead', (editor, change) => {
      if (change.origin === '+input') {
        const text = change.text[0];
        if (/^[a-zA-Z_0-9\.\<]$/.test(text)) {
          const cur = editor.getCursor();
          const token = editor.getTokenAt(cur);
          if (token.type && (token.type.includes('comment') || token.type.includes('string'))) {
            return;
          }
          editor.showHint({
            completeSingle: false,
            hint: window.EditorAutocomplete.customHint
          });
        }
      }
    });

    function syncEditorStateToMain() {
      if (!window.electronAPI || !window.electronAPI.setEditorState) return;
      if (!cm || !activePath) {
        window.electronAPI.setEditorState(null);
        return;
      }
      const doc = cm.getDoc();
      const cursor = doc.getCursor();
      const cursorIndex = doc.indexFromPos(cursor);
      window.electronAPI.setEditorState({
        path: activePath,
        content: doc.getValue(),
        cursorIndex: cursorIndex
      });
    }

    cm.on('change', (editor, change) => {
      const doc = openFiles.get(activePath);
      if (!doc) return;
      const val = cm.getValue();
      doc.content = val;
      doc.dirty = (val.replace(/\r\n/g, '\n') !== doc.originalContent.replace(/\r\n/g, '\n'));
      updateDirtyIndicator();
      renderTabs();
      syncEditorStateToMain();
      
      if (change.origin === '+input' || change.origin === '+delete') {
        if (window.EditorAutocomplete.getGhostTextMarker()) {
          const typed = window.EditorAutocomplete.incrementCharsTyped();
          if (typed > 3) {
            window.EditorAutocomplete.clearGhostText();
          }
        }
        
        if (autocompleteTimer) clearTimeout(autocompleteTimer);
        if (!window.EditorAutocomplete.getGhostTextMarker()) {
          autocompleteTimer = setTimeout(() => {
            window.EditorAutocomplete.requestAutocomplete(editor);
          }, 800);
        }
      } else if (change.origin === 'setValue') {
        window.EditorAutocomplete.clearGhostText();
      }
    });

    cm.on('cursorActivity', () => {
      syncEditorStateToMain();
    });

    return cm;
  }

  function updateDirtyIndicator() {
    const dot = document.getElementById('fv-dirty');
    const doc = openFiles.get(activePath);
    if (dot) dot.style.display = (doc && doc.dirty) ? 'inline' : 'none';
  }

  function setConflictBanner(msg) {
    const el = document.getElementById('fv-conflict');
    if (!el) return;
    el.textContent = msg || '';
    el.style.display = msg ? 'inline' : 'none';
  }

  function renderTabs() {
    window.EditorTabs.renderTabs(openFiles, activePath, {
      openFile,
      closeTab,
      closeOtherTabs,
      closeAllTabs,
      closeUnmodifiedTabs,
    });
  }

  async function closeAllTabs() {
    openFiles.clear();
    const viewer = document.getElementById('file-viewer');
    if (viewer) viewer.classList.remove('open');
    activePath = null;
    closeEditor();
    renderTabs();
  }

  async function closeOtherTabs(keepPath) {
    const pathsToClose = [];
    openFiles.forEach((doc, filePath) => {
      if (filePath !== keepPath) {
        pathsToClose.push(filePath);
      }
    });
    for (const filePath of pathsToClose) {
      openFiles.delete(filePath);
    }
    if (activePath !== keepPath) {
      await openFile(keepPath);
    } else {
      renderTabs();
    }
  }

  async function closeUnmodifiedTabs() {
    const pathsToClose = [];
    openFiles.forEach((doc, filePath) => {
      if (!doc.dirty) {
        pathsToClose.push(filePath);
      }
    });
    for (const filePath of pathsToClose) {
      openFiles.delete(filePath);
    }
    if (!openFiles.has(activePath)) {
      if (openFiles.size > 0) {
        const nextPath = openFiles.keys().next().value;
        await openFile(nextPath);
      } else {
        const viewer = document.getElementById('file-viewer');
        if (viewer) viewer.classList.remove('open');
        activePath = null;
        closeEditor();
      }
    } else {
      renderTabs();
    }
  }

  async function closeTab(filePath) {
    const doc = openFiles.get(filePath);
    if (!doc) return;

    if (cm && filePath === activePath) {
      doc.content = cm.getValue();
    }

    openFiles.delete(filePath);

    if (filePath === activePath) {
      if (openFiles.size > 0) {
        const nextPath = openFiles.keys().next().value;
        await openFile(nextPath);
      } else {
        const viewer = document.getElementById('file-viewer');
        if (viewer) viewer.classList.remove('open');
        activePath = null;
        closeEditor();
      }
    } else {
      renderTabs();
    }
  }

  async function openFile(rawFilePath, lineNum, colNum) {
    const viewer = document.getElementById('file-viewer');
    const pathEl = document.getElementById('fv-path');
    const langEl = document.getElementById('fv-lang');
    if (!viewer || !rawFilePath) return;

    let clean = String(rawFilePath).trim();
    clean = clean.replace(/^[`'"\(\[\{<]+|[`'"\)\]\}>.,;:!]+$/g, '');
    clean = clean.replace(/^file:\/\/\/?([a-zA-Z]:)/i, '$1').replace(/^file:\/\//i, '');

    if (typeof lineNum !== 'number') {
      const hashMatch = clean.match(/#L?(\d+)(?:-L?\d+)?$/i);
      if (hashMatch) {
        lineNum = parseInt(hashMatch[1], 10);
        clean = clean.replace(/#L?\d+(?:-L?\d+)?$/i, '');
      } else {
        const colonMatch = clean.match(/:(\d+)(?::\d+)?$/);
        if (colonMatch) {
          lineNum = parseInt(colonMatch[1], 10);
          clean = clean.replace(/:\d+(?::\d+)?$/, '');
        }
      }
    }
    clean = clean.replace(/^[`'"\(\[\{<]+|[`'"\)\]\}>.,;:!]+$/g, '');

    let filePath = normPath(clean);
    viewer.classList.add('open');
    setConflictBanner('');
    setSaveStatus('');
    activePath = filePath;
    if (pathEl) {
      pathEl.textContent = getFileName(filePath);
      pathEl.title = filePath;
    }

    let doc = openFiles.get(filePath);
    if (!doc) {
      if (langEl) langEl.textContent = '';
      const cmInstLoading = ensureCm();
      if (cmInstLoading) {
        cmInstLoading.setValue('Carregando…');
        setTimeout(() => cmInstLoading.refresh(), 0);
      }

      let res = null;
      try {
        res = window.electronAPI && window.electronAPI.readFileContent
          ? await window.electronAPI.readFileContent(filePath)
          : null;
      } catch (_) {}

      if (!res || !res.ok) {
        const errorMsg = (res && res.error) || 'erro desconhecido';
        const cmInstErr = ensureCm();
        if (cmInstErr) {
          cmInstErr.setOption('mode', null);
          cmInstErr.setValue('// Não foi possível abrir: ' + errorMsg);
          setTimeout(() => cmInstErr.refresh(), 20);
        }
        doc = { content: '// Não foi possível abrir: ' + errorMsg, originalContent: '', mtimeMs: 0, dirty: false };
        openFiles.set(filePath, doc);
        renderTabs();
        return;
      }

      if (res.path) {
        const canonicalPath = normPath(res.path);
        if (canonicalPath !== filePath) {
          openFiles.delete(filePath);
          filePath = canonicalPath;
          activePath = canonicalPath;
          if (pathEl) {
            pathEl.textContent = getFileName(canonicalPath);
            pathEl.title = canonicalPath;
          }
        }
      }

      doc = { content: res.content, originalContent: res.content, mtimeMs: res.mtimeMs, dirty: false };
      openFiles.set(filePath, doc);
    } else if (!doc.dirty && !filePath.includes('.jar!') && !filePath.includes('.zip!')) {
      try {
        if (window.electronAPI && window.electronAPI.readFileContent) {
          const res = await window.electronAPI.readFileContent(filePath);
          if (res && res.ok && typeof res.content === 'string') {
            doc.content = res.content;
            doc.originalContent = res.content;
            if (res.mtimeMs) doc.mtimeMs = res.mtimeMs;
          }
        }
      } catch (_) {}
    }

    const cmInst = ensureCm();
    if (!cmInst) return;
    const ext = extOf(filePath);
    const isDependencySource = filePath.includes('.jar!') || filePath.includes('.zip!');
    if (langEl) {
      langEl.textContent = (LANG_LABEL_BY_EXT[ext] || (ext || 'texto').toUpperCase()) + (isDependencySource ? ' · lib' : '');
    }
    cmInst.setOption('mode', CM_MODE_BY_EXT[ext] || null);
    cmInst.setOption('readOnly', isDependencySource);

    if (cmInst.getValue() !== doc.content) {
      cmInst.setValue(doc.content);
      cmInst.clearHistory();
    }
    updateDirtyIndicator();
    renderTabs();
    if (window.CodeNavigation) {
      window.CodeNavigation.attach(cmInst, filePath);
    }
    if (!isDependencySource) {
      if (window.ImportChecker) {
        window.ImportChecker.attach(cmInst, filePath);
      }
      if (window.AppRunnerGutter) {
        window.AppRunnerGutter.attach(cmInst, filePath);
      }
    }
    if (typeof window.revealPathInTree === 'function') {
      try { window.revealPathInTree(filePath); } catch (_) {}
    }
    cmInst.refresh();
    setTimeout(() => {
      cmInst.refresh();
      if (typeof lineNum === 'number' && lineNum > 0) {
        const line = lineNum - 1;
        const ch = (typeof colNum === 'number' && colNum > 0) ? colNum - 1 : 0;
        cmInst.setCursor({ line, ch });
        cmInst.scrollIntoView({ line, ch }, 150);
        cmInst.focus();
        try {
          const lineHandle = cmInst.addLineClass(line, 'background', 'code-nav-highlight-line');
          setTimeout(() => {
            if (cmInst) cmInst.removeLineClass(lineHandle, 'background', 'code-nav-highlight-line');
          }, 1500);
        } catch (_) {}
      } else {
        cmInst.focus();
      }
    }, 30);
  }

  async function saveActive() {
    if (!activePath) return;
    const doc = openFiles.get(activePath);
    if (!doc) return;
    if (activePath.includes('.jar!') || activePath.includes('.zip!')) {
      setSaveStatus('Arquivo de dependência é somente leitura');
      return;
    }
    if (!window.electronAPI || !window.electronAPI.editorSaveFile) {
      setSaveStatus('Salvar indisponível');
      return;
    }
    setSaveStatus('Salvando…');
    try {
      const res = await window.electronAPI.editorSaveFile({
        path: activePath,
        content: doc.content,
        expectedMtimeMs: doc.mtimeMs,
      });
      if (res && res.ok) {
        doc.originalContent = doc.content;
        doc.dirty = false;
        doc.mtimeMs = res.mtimeMs;
        updateDirtyIndicator();
        renderTabs();
        setConflictBanner(res.conflict ? '⚠ arquivo foi alterado por fora — salvo mesmo assim' : '');
        setSaveStatus('Salvo ✓');
        setTimeout(() => setSaveStatus(''), 1500);
      } else {
        setSaveStatus('Erro ao salvar: ' + ((res && res.error) || '?'));
      }
    } catch (e) {
      setSaveStatus('Erro ao salvar: ' + e.message);
    }
  }

  function setSaveStatus(msg) {
    const el = document.getElementById('fv-save-status');
    if (el) el.textContent = msg || '';
  }

  function toggleChatVisibility(show) {
    const mainEl = document.getElementById('main');
    if (!mainEl) return;
    let shouldHide;
    if (typeof show === 'boolean') {
      shouldHide = !show;
    } else {
      shouldHide = !mainEl.classList.contains('chat-hidden');
    }
    if (shouldHide) {
      mainEl.classList.add('chat-hidden');
      document.body.classList.add('chat-hidden');
    } else {
      mainEl.classList.remove('chat-hidden');
      document.body.classList.remove('chat-hidden');
    }
    if (cm) {
      setTimeout(() => cm.refresh(), 50);
    }
  }

  function closeEditor() {
    activePath = null;
    setConflictBanner('');
    const mainEl = document.getElementById('main');
    if (mainEl) mainEl.classList.remove('chat-hidden');
    document.body.classList.remove('chat-hidden');
  }

  function isDirty(filePath) {
    const doc = openFiles.get(filePath || activePath);
    return !!(doc && doc.dirty);
  }

  function focusSearch() {
    if (!cm) return;
    cm.focus();
    cm.execCommand('findPersistent');
  }

  function hasOpenFile() { return !!activePath; }

  const mutationCtx = {
    openFiles,
    getActivePath: () => activePath,
    setActivePath: (p) => { activePath = p; },
    getCm: () => cm,
    setConflictBanner,
    setSaveStatus,
    renderTabs
  };

  async function onFileMutated(payload) {
    if (window.EditorFileMutations) {
      await window.EditorFileMutations.handleFileMutated(mutationCtx, payload);
    }
  }

  function renamePath(oldPath, newPath) {
    if (window.EditorFileMutations) {
      window.EditorFileMutations.handleRenamePath(mutationCtx, oldPath, newPath);
    }
  }

  function hasFocus() {
    return !!(cm && cm.hasFocus());
  }

  window.EditorController = { openFile, saveActive, closeEditor, isDirty, focusSearch, hasOpenFile, renamePath, hasFocus, closeAllTabs, toggleChatVisibility, getCm: () => cm };

  if (window.electronAPI && window.electronAPI.onFileMutated) {
    window.electronAPI.onFileMutated(onFileMutated);
  }
})();
