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

  function extOf(p) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(p || '');
    return m ? m[1].toLowerCase() : '';
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
      },
    });
    cm.on('change', () => {
      const doc = openFiles.get(activePath);
      if (!doc) return;
      const val = cm.getValue();
      doc.content = val;
      doc.dirty = (val !== doc.originalContent);
      updateDirtyIndicator();
      renderTabs();
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

  window.EditorController = { openFile, saveActive, closeEditor, isDirty, focusSearch, hasOpenFile };

  if (window.electronAPI && window.electronAPI.onFileMutated) {
    window.electronAPI.onFileMutated(onFileMutated);
  }
})();
