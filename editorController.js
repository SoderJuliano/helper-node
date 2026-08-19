// editorController.js — controla o editor de código embutido (#file-viewer) com suporte a N abas.
//
// Fonte única de edição dos arquivos do projeto: o humano usa este caminho
// diretamente; os agentes de IA (OpenAI/Claude Code CLI/Gemini CLI) hoje
// escrevem por conta própria e só NOTIFICAM este controller via o evento
// 'file-mutated' (ver main.js) — não editam o buffer daqui ainda. É o
// primeiro passo pra eles convergirem pra cá também, sem quebrar o que já
// funciona. Ver ARCHITECTURE.md > Editor de código.
//
// Modelado como Map<path, doc> suportando a renderização de abas dinâmicas
// no #fv-tabs-container.
(function () {
  'use strict';

  // Extensão → modo do CodeMirror.
  const CM_MODE_BY_EXT = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: { name: 'javascript', typescript: true }, tsx: { name: 'javascript', typescript: true },
    json: { name: 'javascript', json: true },
    java: 'text/x-java', cs: 'text/x-csharp', c: 'text/x-csrc', h: 'text/x-csrc',
    cpp: 'text/x-c++src', hpp: 'text/x-c++src',
    py: 'python', html: 'htmlmixed', htm: 'htmlmixed',
    css: 'css', scss: 'css', xml: 'xml',
    md: 'markdown', sh: 'shell', bash: 'shell',
    yml: 'yaml', yaml: 'yaml', sql: 'sql', go: 'go', rs: 'rust', php: 'php', rb: 'ruby',
  };
  const LANG_LABEL_BY_EXT = {
    js: 'JS', jsx: 'JSX', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX',
    java: 'JAVA', cs: 'C#', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++',
    py: 'PY', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', xml: 'XML',
    json: 'JSON', md: 'MD', sh: 'SH', bash: 'SH', yml: 'YAML', yaml: 'YAML',
    sql: 'SQL', go: 'GO', rs: 'RUST', php: 'PHP', rb: 'RUBY',
  };

  function normPath(p) {
    if (!p) return '';
    let norm = String(p).replace(/\\/g, '/');
    if (norm.length >= 2 && norm[1] === ':') {
      norm = norm[0].toUpperCase() + norm.substring(1);
    }
    return norm;
  }

  // path -> { content, originalContent, mtimeMs, dirty }
  const openFiles = new Map();
  let activePath = null;
  let cm = null; // instância única do CodeMirror, reaproveitada entre arquivos
  
  let autocompleteTimer = null;
  let ghostTextMarker = null;
  let ghostSuggestion = '';
  let charsTypedSinceSuggestion = 0;
  
  function showIdeNotification(msg) {
    const notif = document.getElementById('ide-tutor-notif');
    const msgEl = document.getElementById('ide-tutor-msg');
    if (!notif || !msgEl) return;
    msgEl.textContent = msg;
    notif.classList.add('visible');
  }
  
  function hideIdeNotification() {
    const notif = document.getElementById('ide-tutor-notif');
    if (notif) notif.classList.remove('visible');
  }

  function clearGhostText() {
    if (ghostTextMarker) {
      ghostTextMarker.clear();
      ghostTextMarker = null;
    }
    ghostSuggestion = '';
    charsTypedSinceSuggestion = 0;
    hideIdeNotification();
  }

  function acceptGhostText(editor) {
    if (!ghostTextMarker || !ghostSuggestion) return;
    const pos = ghostTextMarker.find();
    if (pos) {
      const suggestion = ghostSuggestion;
      clearGhostText();
      editor.replaceRange(suggestion, pos);
      editor.setCursor(editor.posFromIndex(editor.indexFromPos(pos) + suggestion.length));
    } else {
      clearGhostText();
    }
  }

  async function requestAutocomplete(editor) {
    if (!window.electronAPI || !window.electronAPI.getIdeAutocomplete) return;
    const cursor = editor.getCursor();
    const doc = editor.getDoc();
    
    // Pegar ~500 chars antes e depois
    const content = doc.getValue();
    const cursorIndex = doc.indexFromPos(cursor);
    const prefix = content.slice(Math.max(0, cursorIndex - 500), cursorIndex);
    const suffix = content.slice(cursorIndex, Math.min(content.length, cursorIndex + 500));
    const lang = editor.getOption('mode') || 'text';

    showIdeNotification('Tutor: Analisando contexto...');
    
    const suggestion = await window.electronAPI.getIdeAutocomplete({ prefix, suffix, lang });
    if (!suggestion) {
      hideIdeNotification();
      return;
    }
    
    // Checar se o cursor ainda é o mesmo
    const newCursor = editor.getCursor();
    if (newCursor.line !== cursor.line || newCursor.ch !== cursor.ch) {
      hideIdeNotification();
      return; // Usuário moveu o cursor
    }
    
    // Aplicar ghost text
    clearGhostText();
    ghostSuggestion = suggestion;
    charsTypedSinceSuggestion = 0;
    
    const span = document.createElement('span');
    span.style.opacity = '0.5';
    span.style.fontStyle = 'italic';
    span.textContent = suggestion;
    span.className = 'ghost-text';
    
    ghostTextMarker = editor.setBookmark(cursor, { widget: span, insertLeft: true });
    showIdeNotification('Tutor: Sugestão (Tab para aceitar, Esc para cancelar)');
  }

  function extOf(p) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(p || '');
    return m ? m[1].toLowerCase() : '';
  }

  function getFileName(p) {
    if (!p) return '';
    const norm = String(p).replace(/\\/g, '/');
    return norm.split('/').pop() || norm;
  }

  function customHint(editor) {
    const mode = editor.getOption('mode');
    let modeHint = null;
    const cmLib = window.CodeMirror;
    if (!cmLib) return null;
    
    const modeName = (mode && typeof mode === 'object') ? mode.name : mode;
    if (modeName === 'javascript') {
      modeHint = cmLib.hint.javascript;
    } else if (modeName === 'css') {
      modeHint = cmLib.hint.css;
    } else if (modeName === 'htmlmixed' || modeName === 'html' || modeName === 'xml') {
      modeHint = cmLib.hint.html || cmLib.hint.xml;
    }
    
    const anywordHint = cmLib.hint.anyword;
    let result = null;
    
    if (modeHint) {
      try { result = modeHint(editor); } catch (_) {}
    }
    
    if (!result || !result.list || !result.list.length) {
      if (anywordHint) {
        try { result = anywordHint(editor); } catch (_) {}
      }
    } else if (anywordHint) {
      try {
        const anyResult = anywordHint(editor);
        if (anyResult && anyResult.list && anyResult.list.length) {
          const listSet = new Set(result.list.map(item => typeof item === 'string' ? item : item.text));
          anyResult.list.forEach(item => {
            const text = typeof item === 'string' ? item : item.text;
            if (!listSet.has(text)) {
              result.list.push(item);
            }
          });
        }
      } catch (_) {}
    }
    return result;
  }

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
      gutters: ['CodeMirror-linenumbers', 'code-nav-gutter'],
      theme: 'dracula',
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      styleActiveLine: false,
      extraKeys: {
        'Ctrl-F': 'findPersistent',
        'Cmd-F': 'findPersistent',
        'Ctrl-G': 'findNext',
        'Shift-Ctrl-G': 'findPrev',
        'Cmd-G': 'findNext',
        'Shift-Cmd-G': 'findPrev',
        'Ctrl-Space': 'autocomplete',
        'Tab': (editor) => {
          if (ghostTextMarker) {
            acceptGhostText(editor);
          } else {
            return window.CodeMirror.Pass;
          }
        },
        'Esc': (editor) => {
          if (ghostTextMarker) {
            clearGhostText();
          } else {
            return window.CodeMirror.Pass;
          }
        }
      },
    });

    // Restaurar font-size salvo do editor no CodeMirror
    const savedEditorFontSize = localStorage.getItem('editor_font_size');
    const wrapperEl = cm.getWrapperElement();
    if (savedEditorFontSize && wrapperEl) {
      wrapperEl.style.fontSize = savedEditorFontSize + 'px';
      setTimeout(() => cm.refresh(), 0);
    }

    // Ctrl + Wheel Zoom no editor de código
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
            hint: customHint
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
      
      // Lógica de cancelamento / debouce do ghost text
      if (change.origin === '+input' || change.origin === '+delete') {
        if (ghostTextMarker) {
           charsTypedSinceSuggestion++;
           if (charsTypedSinceSuggestion > 3) {
             clearGhostText();
           }
        }
        
        if (autocompleteTimer) clearTimeout(autocompleteTimer);
        if (!ghostTextMarker) {
          autocompleteTimer = setTimeout(() => {
            requestAutocomplete(editor);
          }, 800);
        }
      } else if (change.origin === 'setValue') {
         clearGhostText();
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

  // Renderiza as abas de arquivos abertos
  function renderTabs() {
    const container = document.getElementById('fv-tabs-container');
    if (!container) return;
    container.innerHTML = '';

    openFiles.forEach((doc, filePath) => {
      const tab = document.createElement('div');
      tab.className = 'fv-tab';
      if (filePath === activePath) {
        tab.classList.add('active');
      }
      if (doc.dirty) {
        tab.classList.add('dirty');
      }

      // Nome do arquivo
      const nameSpan = document.createElement('span');
      nameSpan.className = 'fv-tab-name';
      nameSpan.textContent = getFileName(filePath);
      nameSpan.title = filePath;
      tab.appendChild(nameSpan);

      // Indicador de alteração não salva
      const dotSpan = document.createElement('span');
      dotSpan.className = 'fv-tab-dirty';
      dotSpan.textContent = ' ●';
      tab.appendChild(dotSpan);

      // Botão de fechar aba
      const closeBtn = document.createElement('button');
      closeBtn.className = 'fv-tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Fechar aba';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(filePath);
      });
      tab.appendChild(closeBtn);

      tab.addEventListener('click', () => {
        if (filePath !== activePath) {
          openFile(filePath);
        }
      });

      tab.addEventListener('contextmenu', (ev) => {
        showTabContextMenu(ev, filePath);
      });

      container.appendChild(tab);

      if (filePath === activePath) {
        setTimeout(() => {
          try {
            tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
          } catch (_) {}
        }, 0);
      }
    });

    const handleWheelScroll = (ev) => {
      const tabsContainer = document.getElementById('fv-tabs-container');
      if (!tabsContainer) return;
      const delta = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      if (delta !== 0) {
        ev.preventDefault();
        tabsContainer.scrollLeft += delta;
      }
    };

    if (container && !container._hasWheelScroll) {
      container._hasWheelScroll = true;
      container.addEventListener('wheel', handleWheelScroll, { passive: false });
    }

    const header = document.querySelector('.fv-header');
    if (header && !header._hasContextMenu) {
      header._hasContextMenu = true;
      header.addEventListener('contextmenu', (ev) => {
        if (openFiles.size > 0) {
          showTabContextMenu(ev, activePath);
        }
      });
    }

    if (header && !header._hasWheelScroll) {
      header._hasWheelScroll = true;
      header.addEventListener('wheel', (ev) => {
        if (ev.target.closest('#fv-close') || ev.target.closest('.fv-lang') || ev.target.closest('.fv-save-status')) return;
        handleWheelScroll(ev);
      }, { passive: false });
    }
  }

  function showTabContextMenu(event, filePath) {
    event.preventDefault();
    event.stopPropagation();
    document.querySelectorAll('.fv-tab-context-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'fv-tab-context-menu';
    menu.style.cssText = 'position:fixed; z-index:10000; background:var(--bg-elevated, #1b1e24); border:1px solid var(--border, #2d2d38); border-radius:var(--radius-sm, 4px); padding:4px; box-shadow:0 4px 12px rgba(0,0,0,0.55); min-width:180px; font-family:var(--font-ui); font-size:12px; color:var(--text, #e3e3e6);';
    
    const mkItem = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'display:block; width:100%; text-align:left; background:transparent; border:none; color:inherit; font-size:inherit; font-family:inherit; padding:6px 10px; cursor:pointer; border-radius:4px; transition:background .15s;';
      b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
      b.addEventListener('mouseleave', () => b.style.background = 'transparent');
      b.addEventListener('click', () => { menu.remove(); fn(); });
      return b;
    };
    
    if (filePath) {
      menu.appendChild(mkItem('Fechar outros arquivos', () => {
        closeOtherTabs(filePath);
      }));
    }
    
    menu.appendChild(mkItem('Fechar não modificados', () => {
      closeUnmodifiedTabs();
    }));

    menu.appendChild(mkItem('Fechar todos', () => {
      closeAllTabs();
    }));
    
    document.body.appendChild(menu);
    const menuWidth = menu.offsetWidth || 180;
    const menuHeight = menu.offsetHeight || 80;
    let x = event.clientX;
    let y = event.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    const closer = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('mousedown', closer, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', closer, true), 0);
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

  // Fecha uma aba específica
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

  // Abre um arquivo no editor. Se já estava aberto nesta sessão (mesmo que o
  // painel tenha sido fechado), reaproveita o buffer em memória — inclusive
  // alterações não salvas, sem perder nada ao trocar de arquivo e voltar.
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

      // Se a resposta retornou o caminho canônico do disco, atualiza referências
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
    } else if (!doc.dirty && !filePath.includes('.jar!')) {
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
    const isDependencySource = filePath.includes('.jar!');
    if (langEl) {
      langEl.textContent = (LANG_LABEL_BY_EXT[ext] || (ext || 'texto').toUpperCase()) + (isDependencySource ? ' · lib' : '');
    }
    cmInst.setOption('mode', CM_MODE_BY_EXT[ext] || null);
    cmInst.setOption('readOnly', isDependencySource);

    if (cmInst.getValue() !== doc.content) {
      cmInst.setValue(doc.content);
      cmInst.clearHistory(); // trocar de arquivo não deve deixar Ctrl+Z voltar pro arquivo anterior
    }
    updateDirtyIndicator();
    renderTabs();
    if (!isDependencySource) {
      if (window.CodeNavigation) {
        window.CodeNavigation.attach(cmInst, filePath);
      }
      if (window.ImportChecker) {
        window.ImportChecker.attach(cmInst, filePath);
      }
    }
    // Refresh CodeMirror imediatamente e em ticks para recalcular dimensões no layout flex
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
    if (activePath.includes('.jar!')) {
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

  // Fechar NÃO descarta o buffer (fica em openFiles) — reabrir o mesmo arquivo
  // na mesma sessão preserva a edição não salva. Só limpa o "qual é o arquivo
  // ativo agora" pra parar de reagir a file-mutated de um arquivo que não está
  // mais visível.
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

  // Chamado pelo Ctrl+F global (index.html) quando o editor está aberto mas o
  // foco não está no CodeMirror ainda (ex.: clicou num botão do header antes).
  function focusSearch() {
    if (!cm) return;
    cm.focus();
    cm.execCommand('findPersistent');
  }

  function hasOpenFile() { return !!activePath; }

  // Reage a mutações de arquivo vindas de qualquer origem (disk, git pull, OpenAI, Claude CLI, Gemini CLI, etc.).
  // Atualiza abas abertas em TEMPO REAL (estilo VS Code / IntelliJ IDEA).
  async function onFileMutated({ path: p, origin, content, mtimeMs, deleted } = {}) {
    if (!p) return;
    const filePath = normPath(p);

    // Garante que a árvore lateral e status git atualizem quando qualquer arquivo mudar
    if (typeof window.triggerTreeRefresh === 'function') {
      window.triggerTreeRefresh();
    }
    if (typeof window.fetchAndUpdateGitStatus === 'function') {
      window.fetchAndUpdateGitStatus();
    }

    const doc = openFiles.get(filePath);

    // Se o arquivo não está aberto em nenhuma aba do editor, para por aqui
    if (!doc) return;

    if (deleted) {
      setConflictBanner('⚠ Arquivo foi excluído no disco');
      return;
    }

    if (origin === 'user') {
      setConflictBanner('');
      return;
    }

    let freshContent = content;
    let freshMtimeMs = mtimeMs || 0;

    if (freshContent === undefined) {
      try {
        if (window.electronAPI && window.electronAPI.readFileContent) {
          const res = await window.electronAPI.readFileContent(filePath);
          if (res && res.ok && typeof res.content === 'string') {
            freshContent = res.content;
            freshMtimeMs = res.mtimeMs || 0;
          }
        }
      } catch (_) {}
    }

    if (freshContent === undefined) return;

    if (!doc.dirty && doc.content === freshContent) return;

    // A. ABA LIMPA (o usuário NÃO digitou alterações não salvas nesta aba):
    // Atualiza o conteúdo em tempo real sem perder o cursor, rolagem nem foco!
    if (!doc.dirty) {
      doc.content = freshContent;
      doc.originalContent = freshContent;
      if (freshMtimeMs) doc.mtimeMs = freshMtimeMs;

      if (filePath === activePath && cm) {
        if (cm.getValue() !== freshContent) {
          const cursor = cm.getCursor();
          const scrollInfo = cm.getScrollInfo();

          cm.setValue(freshContent);

          try {
            cm.setCursor(cursor);
            cm.scrollTo(scrollInfo.left, scrollInfo.top);
          } catch (_) {}

          clearGhostText();
        }

        const label = origin === 'disk'
          ? 'Atualizado em tempo real ✓'
          : origin === 'openai' ? 'Atualizado por ChatGPT ✓'
          : origin === 'claude-cli' ? 'Atualizado por Claude Code ✓'
          : origin === 'gemini-cli' ? 'Atualizado por Gemini CLI ✓'
          : `Atualizado por ${origin || 'IA'} ✓`;

        setConflictBanner('');
        setSaveStatus(label);
        setTimeout(() => {
          const statusEl = document.getElementById('fv-save-status');
          if (statusEl && statusEl.textContent === label) {
            setSaveStatus('');
          }
        }, 1800);
      }
    } else {
      setConflictBanner('⚠ Arquivo alterado externamente (você possui alterações não salvas)');
    }
  }

  function renamePath(oldPath, newPath) {
    let changed = false;
    const updates = [];
    openFiles.forEach((doc, filePath) => {
      if (filePath === oldPath) {
        updates.push({ oldPath: filePath, newPath: newPath });
      } else if (filePath.startsWith(oldPath + '/') || filePath.startsWith(oldPath + '\\')) {
        const relative = filePath.substring(oldPath.length);
        updates.push({ oldPath: filePath, newPath: newPath + relative });
      }
    });

    updates.forEach(u => {
      const doc = openFiles.get(u.oldPath);
      openFiles.delete(u.oldPath);
      openFiles.set(u.newPath, doc);
      if (activePath === u.oldPath) {
        activePath = u.newPath;
        changed = true;
      }
    });

    if (updates.length > 0) {
      renderTabs();
      if (changed) {
        const pathEl = document.getElementById('fv-path');
        if (pathEl) {
          pathEl.textContent = getFileName(activePath);
          pathEl.title = activePath;
        }
        if (cm) {
          const ext = extOf(activePath);
          const langEl = document.getElementById('fv-lang');
          if (langEl) {
            langEl.textContent = LANG_LABEL_BY_EXT[ext] || (ext || 'texto').toUpperCase();
          }
          cm.setOption('mode', CM_MODE_BY_EXT[ext] || null);
        }
      }
    }
  }

  function hasFocus() {
    return !!(cm && cm.hasFocus());
  }

  // getCm: a instância do CodeMirror é única e reaproveitada entre arquivos, mas
  // quem precisa marcar texto no arquivo recém-aberto (realce de ocorrências)
  // não tem como alcançá-la de fora sem isto.
  window.EditorController = { openFile, saveActive, closeEditor, isDirty, focusSearch, hasOpenFile, renamePath, hasFocus, closeAllTabs, toggleChatVisibility, getCm: () => cm };

  if (window.electronAPI && window.electronAPI.onFileMutated) {
    window.electronAPI.onFileMutated(onFileMutated);
  }
})();
