// renderer/editor/editorGitGutter.js
// Marcadores discretos de linhas modificadas ('m' vermelho) e adicionadas ('A' verde) no gutter do CodeMirror.
(function () {
  'use strict';

  let activeCm = null;
  let activeFilePath = null;
  let updateTimer = null;
  let isUpdating = false;

  async function updateGitGutter(cm, filePath) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.gitGetFileLineStatus) return;
    if (filePath.includes('.jar!') || filePath.includes('.zip!')) {
      cm.clearGutter('git-diff-gutter');
      return;
    }

    try {
      isUpdating = true;
      const res = await window.electronAPI.gitGetFileLineStatus({ filePath });
      if (!res || !res.ok) {
        cm.clearGutter('git-diff-gutter');
        return;
      }

      cm.clearGutter('git-diff-gutter');

      const totalLines = cm.lineCount();

      if (res.allAdded) {
        for (let i = 0; i < totalLines; i++) {
          const el = createMarker('A', 'Linha nova adicionada (Untracked)', 'added');
          cm.setGutterMarker(i, 'git-diff-gutter', el);
        }
        return;
      }

      const lines = res.lines || {};
      for (const [lineStr, type] of Object.entries(lines)) {
        const lineIdx = parseInt(lineStr, 10) - 1;
        if (lineIdx >= 0 && lineIdx < totalLines) {
          const isAdded = type === 'A';
          const text = isAdded ? 'A' : 'm';
          const title = isAdded ? 'Linha adicionada (Git)' : 'Linha modificada (Git)';
          const el = createMarker(text, title, isAdded ? 'added' : 'modified');
          cm.setGutterMarker(lineIdx, 'git-diff-gutter', el);
        }
      }
    } catch (err) {
      console.warn('[editorGitGutter] erro ao atualizar marcadores git:', err);
    } finally {
      isUpdating = false;
    }
  }

  function createMarker(char, tooltip, variant) {
    const el = document.createElement('div');
    el.className = 'git-gutter-marker ' + (variant || (char === 'A' ? 'added' : 'modified'));
    el.textContent = char;
    el.title = tooltip;
    return el;
  }

  function scheduleUpdate(cm, filePath, delayMs = 350) {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      updateGitGutter(cm, filePath);
    }, delayMs);
  }

  function attach(cm, filePath) {
    if (!cm) return;
    activeCm = cm;
    activeFilePath = filePath;

    updateGitGutter(cm, filePath);

    const wrapper = cm.getWrapperElement();
    if (!wrapper._hasGitGutterEvents) {
      wrapper._hasGitGutterEvents = true;

      cm.on('change', () => {
        if (activeCm && activeFilePath) {
          scheduleUpdate(activeCm, activeFilePath, 400);
        }
      });
    }
  }

  // Listeners globais de mutação e git
  if (window.electronAPI) {
    if (window.electronAPI.onGitStatusChanged) {
      window.electronAPI.onGitStatusChanged(() => {
        if (activeCm && activeFilePath) {
          scheduleUpdate(activeCm, activeFilePath, 100);
        }
      });
    }
    if (window.electronAPI.onWorkspaceChanged) {
      window.electronAPI.onWorkspaceChanged(() => {
        if (activeCm && activeFilePath) {
          scheduleUpdate(activeCm, activeFilePath, 200);
        }
      });
    }
    if (window.electronAPI.onFileMutated) {
      window.electronAPI.onFileMutated((data) => {
        if (activeCm && activeFilePath && (!data || !data.path || data.path === activeFilePath)) {
          scheduleUpdate(activeCm, activeFilePath, 100);
        }
      });
    }
  }

  window.EditorGitGutter = {
    attach,
    update: (cm, filePath) => updateGitGutter(cm || activeCm, filePath || activeFilePath),
    scheduleUpdate: (cm, filePath, delay) => scheduleUpdate(cm || activeCm, filePath || activeFilePath, delay),
  };
})();
