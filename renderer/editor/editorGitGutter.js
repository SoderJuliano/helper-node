// renderer/editor/editorGitGutter.js
// Marcadores discretos de linhas modificadas ('m' vermelho) e adicionadas ('A' verde) no gutter do CodeMirror.
// Ultra-otimizado: operações não-bloqueantes em segundo plano, cm.operation() batching e zero jank.
(function () {
  'use strict';

  let activeCm = null;
  let activeFilePath = null;
  let updateTimer = null;
  let currentReqId = 0;
  let lastRenderedState = new Map(); // filePath -> { key, allAdded }

  async function updateGitGutter(cm, filePath, reqId) {
    if (!cm || !filePath || !window.electronAPI || !window.electronAPI.gitGetFileLineStatus) return;
    if (filePath.includes('.jar!') || filePath.includes('.zip!')) {
      cm.operation(() => cm.clearGutter('git-diff-gutter'));
      lastRenderedState.delete(filePath);
      return;
    }

    try {
      const res = await window.electronAPI.gitGetFileLineStatus({ filePath });
      
      // Se outro arquivo foi aberto ou outra requisição foi disparada enquanto consultava o git, descarta
      if (reqId !== currentReqId || activeFilePath !== filePath || activeCm !== cm) {
        return;
      }

      if (!res || !res.ok) {
        cm.operation(() => cm.clearGutter('git-diff-gutter'));
        lastRenderedState.delete(filePath);
        return;
      }

      const totalLines = cm.lineCount();
      const lines = res.lines || {};
      const stateKey = res.allAdded ? 'ALL_ADDED_' + totalLines : JSON.stringify(lines);

      // Verificação de estado: se nada mudou desde a última renderização, NÃO toca no DOM
      const prev = lastRenderedState.get(filePath);
      if (prev && prev.key === stateKey) {
        return;
      }

      // Renderização em lote atômico com CodeMirror operation (1 único repaint do navegador)
      cm.operation(() => {
        cm.clearGutter('git-diff-gutter');

        if (res.allAdded) {
          // Limita criação a 3000 marcadores para arquivos gigantescos não sobrecarregarem o DOM
          const max = Math.min(totalLines, 3000);
          for (let i = 0; i < max; i++) {
            const el = createMarker('A', 'Linha nova adicionada (Untracked)', 'added');
            cm.setGutterMarker(i, 'git-diff-gutter', el);
          }
        } else {
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
        }
      });

      lastRenderedState.set(filePath, { key: stateKey });
    } catch (err) {
      console.warn('[editorGitGutter] erro ao atualizar marcadores git:', err);
    }
  }

  function createMarker(char, tooltip, variant) {
    const el = document.createElement('div');
    el.className = 'git-gutter-marker ' + (variant || (char === 'A' ? 'added' : 'modified'));
    el.textContent = char;
    el.title = tooltip;
    return el;
  }

  function scheduleUpdate(cm, filePath, delayMs = 500) {
    if (updateTimer) clearTimeout(updateTimer);
    const reqId = ++currentReqId;
    updateTimer = setTimeout(() => {
      // Usa requestIdleCallback quando disponível para não concorrer com digitação/renderização do usuário
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => updateGitGutter(cm, filePath, reqId), { timeout: 1000 });
      } else {
        updateGitGutter(cm, filePath, reqId);
      }
    }, delayMs);
  }

  function attach(cm, filePath) {
    if (!cm) return;
    activeCm = cm;
    activeFilePath = filePath;

    // Agenda atualização em background sem bloquear o carregamento imediato do arquivo
    scheduleUpdate(cm, filePath, 20);

    const wrapper = cm.getWrapperElement();
    if (!wrapper._hasGitGutterEvents) {
      wrapper._hasGitGutterEvents = true;

      cm.on('change', () => {
        if (activeCm && activeFilePath) {
          scheduleUpdate(activeCm, activeFilePath, 600);
        }
      });
    }
  }

  // Listeners globais com debounce inteligente
  if (typeof window !== 'undefined' && window.electronAPI) {
    if (window.electronAPI.onGitStatusChanged) {
      window.electronAPI.onGitStatusChanged(() => {
        if (activeCm && activeFilePath) {
          lastRenderedState.delete(activeFilePath);
          scheduleUpdate(activeCm, activeFilePath, 100);
        }
      });
    }
    if (window.electronAPI.onWorkspaceChanged) {
      window.electronAPI.onWorkspaceChanged(() => {
        if (activeCm && activeFilePath) {
          lastRenderedState.delete(activeFilePath);
          scheduleUpdate(activeCm, activeFilePath, 250);
        }
      });
    }
    if (window.electronAPI.onFileMutated) {
      window.electronAPI.onFileMutated((data) => {
        if (activeCm && activeFilePath && (!data || !data.path || data.path === activeFilePath)) {
          lastRenderedState.delete(activeFilePath);
          scheduleUpdate(activeCm, activeFilePath, 150);
        }
      });
    }
  }

  window.EditorGitGutter = {
    attach,
    update: (cm, filePath) => scheduleUpdate(cm || activeCm, filePath || activeFilePath, 0),
    scheduleUpdate: (cm, filePath, delay) => scheduleUpdate(cm || activeCm, filePath || activeFilePath, delay),
  };
})();
