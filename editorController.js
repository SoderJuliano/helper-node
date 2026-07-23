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
      doc.dirty = (val !== doc.originalContent);
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
      nameSpan.textContent = String(filePath).split('/').pop() || filePath;
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

      container.appendChild(tab);
    });
  }

  // Fecha uma aba específica
  async function closeTab(filePath) {
    const doc = openFiles.get(filePath);
    if (!doc) return;

    if (cm && filePath === activePath) {
      doc.content = cm.getValue();
    }

    if (doc.dirty) {
      const confirm = window.confirm(`O arquivo "${String(filePath).split('/').pop()}" possui alterações não salvas. Deseja fechar e descartar?`);
      if (!confirm) return;
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
  async function openFile(filePath) {
    const viewer = document.getElementById('file-viewer');
    const pathEl = document.getElementById('fv-path');
    const langEl = document.getElementById('fv-lang');
    if (!viewer || !filePath) return;

    viewer.classList.add('open');
    setConflictBanner('');
    setSaveStatus('');
    activePath = filePath;
    if (pathEl) {
      pathEl.textContent = String(filePath).split('/').slice(-3).join('/');
      pathEl.title = filePath;
    }

    let doc = openFiles.get(filePath);
    if (!doc) {
      langEl.textContent = '';
      const cmInstLoading = ensureCm();
      if (cmInstLoading) cmInstLoading.setValue('Carregando…');

      let res = null;
      try {
        res = window.electronAPI && window.electronAPI.readFileContent
          ? await window.electronAPI.readFileContent(filePath)
          : null;
      } catch (_) {}

      if (!res || !res.ok) {
        const cmInstErr = ensureCm();
        if (cmInstErr) {
          cmInstErr.setOption('mode', null);
          cmInstErr.setValue('// Não foi possível abrir: ' + ((res && res.error) || 'erro desconhecido'));
        }
        return;
      }
      doc = { content: res.content, originalContent: res.content, mtimeMs: res.mtimeMs, dirty: false };
      openFiles.set(filePath, doc);
    }

    const cmInst = ensureCm();
    if (!cmInst) return;
    const ext = extOf(filePath);
    langEl.textContent = LANG_LABEL_BY_EXT[ext] || (ext || 'texto').toUpperCase();
    cmInst.setOption('mode', CM_MODE_BY_EXT[ext] || null);
    cmInst.setValue(doc.content);
    cmInst.clearHistory(); // trocar de arquivo não deve deixar Ctrl+Z voltar pro arquivo anterior
    updateDirtyIndicator();
    renderTabs();
    setTimeout(() => cmInst.refresh(), 0); // corrige medidas quando o painel estava fechado ao criar o CM
  }

  async function saveActive() {
    if (!activePath) return;
    const doc = openFiles.get(activePath);
    if (!doc) return;
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

  // Fechar NÃO descarta o buffer (fica em openFiles) — reabrir o mesmo arquivo
  // na mesma sessão preserva a edição não salva. Só limpa o "qual é o arquivo
  // ativo agora" pra parar de reagir a file-mutated de um arquivo que não está
  // mais visível.
  function closeEditor() {
    activePath = null;
    setConflictBanner('');
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

  // Reage a mutações de arquivo vindas de qualquer origem (ver main.js:
  // emitFileMutated). Só sinaliza — nunca sobrescreve o buffer sozinho, nunca
  // bloqueia nada. É o "indicativo em tempo real" pedido: se a IA mexeu no
  // MESMO arquivo que está aberto agora, avisa; se não é o arquivo aberto,
  // ignora silenciosamente.
  function onFileMutated({ path: p, origin } = {}) {
    if (!p || origin === 'user') return;
    if (p !== activePath) return;
    const label = origin === 'openai' ? 'ChatGPT' : origin === 'claude-cli' ? 'Claude Code' : origin === 'gemini-cli' ? 'Gemini CLI' : (origin || 'IA');
    setConflictBanner(`⚠ ${label} está mexendo neste arquivo agora`);
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
          pathEl.textContent = String(activePath).split('/').slice(-3).join('/');
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

  window.EditorController = { openFile, saveActive, closeEditor, isDirty, focusSearch, hasOpenFile, renamePath };

  if (window.electronAPI && window.electronAPI.onFileMutated) {
    window.electronAPI.onFileMutated(onFileMutated);
  }
})();
