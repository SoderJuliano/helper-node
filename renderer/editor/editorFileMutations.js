// renderer/editor/editorFileMutations.js
// Trata atualizações em tempo real do sistema de arquivos e renomeação de paths no editor.
(function () {
  'use strict';

  const { normPath, extOf, getFileName, LANG_LABEL_BY_EXT, CM_MODE_BY_EXT } = window.EditorConstants;

  async function handleFileMutated(ctx, { path: p, oldPath: op, origin, content, mtimeMs, deleted } = {}) {
    if (op && p) {
      handleRenamePath(ctx, op, p);
    }
    if (!p) return;
    const filePath = normPath(p);

    if (typeof window.triggerTreeRefresh === 'function') {
      window.triggerTreeRefresh();
    }
    if (typeof window.fetchAndUpdateGitStatus === 'function') {
      window.fetchAndUpdateGitStatus();
    }

    const doc = ctx.openFiles.get(filePath);
    if (!doc) return;

    if (deleted) {
      ctx.setConflictBanner('⚠ Arquivo foi excluído no disco');
      return;
    }

    if (origin === 'user') {
      ctx.setConflictBanner('');
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

    const cm = ctx.getCm();
    const activePath = ctx.getActivePath();
    const previousContent = doc.content || (cm && filePath === activePath ? cm.getValue() : '');

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

          if (window.EditorAutocomplete && window.EditorAutocomplete.clearGhostText) {
            window.EditorAutocomplete.clearGhostText();
          }

          if (origin && origin !== 'disk' && origin !== 'user' && window.EditorAiDiff) {
            window.EditorAiDiff.applyAiDiffDecorations(doc, cm, activePath, previousContent, freshContent, origin, ctx.setSaveStatus);
          }
        }

        const label = origin === 'disk'
          ? 'Atualizado em tempo real ✓'
          : origin === 'openai' ? 'Atualizado por ChatGPT ✓'
          : origin === 'claude-cli' ? 'Atualizado por Claude Code ✓'
          : origin === 'gemini-cli' ? 'Atualizado por Gemini CLI ✓'
          : `Atualizado por ${origin || 'IA'} ✓`;

        ctx.setConflictBanner('');
        ctx.setSaveStatus(label);
        setTimeout(() => {
          const statusEl = document.getElementById('fv-save-status');
          if (statusEl && statusEl.textContent === label) {
            ctx.setSaveStatus('');
          }
        }, 1800);
      }
    } else {
      ctx.setConflictBanner('⚠ Arquivo alterado externamente (você possui alterações não salvas)');
    }
  }

  function handleRenamePath(ctx, oldRaw, newRaw) {
    if (!oldRaw || !newRaw) return;
    const oldPath = normPath(oldRaw);
    const newPath = normPath(newRaw);
    let changed = false;
    const updates = [];
    ctx.openFiles.forEach((doc, filePath) => {
      const nFilePath = normPath(filePath);
      if (nFilePath === oldPath) {
        updates.push({ oldKey: filePath, newKey: newPath });
      } else if (nFilePath.startsWith(oldPath + '/') || nFilePath.startsWith(oldPath + '\\')) {
        const relative = nFilePath.substring(oldPath.length);
        updates.push({ oldKey: filePath, newKey: newPath + relative });
      }
    });

    updates.forEach(u => {
      const doc = ctx.openFiles.get(u.oldKey);
      ctx.openFiles.delete(u.oldKey);
      ctx.openFiles.set(u.newKey, doc);
      if (normPath(ctx.getActivePath()) === normPath(u.oldKey)) {
        ctx.setActivePath(u.newKey);
        changed = true;
      }
    });

    if (updates.length > 0) {
      ctx.renderTabs();
      if (changed) {
        const pathEl = document.getElementById('fv-path');
        const activePath = ctx.getActivePath();
        if (pathEl) {
          pathEl.textContent = getFileName(activePath);
          pathEl.title = activePath;
        }
        const cm = ctx.getCm();
        if (cm) {
          const ext = extOf(activePath);
          const langEl = document.getElementById('fv-lang');
          if (langEl) {
            langEl.textContent = LANG_LABEL_BY_EXT[ext] || (ext || 'texto').toUpperCase();
          }
          cm.setOption('mode', CM_MODE_BY_EXT[ext] || null);
          const indentConfig = (window.EditorConstants && typeof window.EditorConstants.detectIndentation === 'function')
            ? window.EditorConstants.detectIndentation(doc ? doc.content : '', ext)
            : (ext === 'java' || ext === 'kt' || ext === 'cs' || ext === 'cpp' || ext === 'c' || ext === 'py'
                ? { indentUnit: 4, tabSize: 4, indentWithTabs: false }
                : { indentUnit: 2, tabSize: 2, indentWithTabs: false });
          cm.setOption('indentUnit', indentConfig.indentUnit);
          cm.setOption('tabSize', indentConfig.tabSize);
          cm.setOption('indentWithTabs', indentConfig.indentWithTabs);
        }
      }
    }
  }

  window.EditorFileMutations = {
    handleFileMutated,
    handleRenamePath
  };
})();