// renderer/workspaceTreeEvents.js
// Node event wiring, drag-drop and wheel zoom for workspace tree.
(function() {
  'use strict';

  function wireTreeNodeEvents(node, e, projectPath) {
    if (selectedPaths.size > 0) {
      const checkbox = document.createElement('span');
      checkbox.className = 'ws-tree-checkbox' + (selectedPaths.has(e.path) ? ' checked' : '');
      checkbox.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ev.preventDefault();
        if (selectedPaths.has(e.path)) {
          selectedPaths.delete(e.path);
        } else {
          selectedPaths.add(e.path);
        }
        if (typeof window.updateSelectionUi === 'function') window.updateSelectionUi();
        window.renderTree();
      });
      node.insertBefore(checkbox, node.firstChild);
    }

    node.draggable = (renamingPath !== e.path) && !e.synthetic;
    node.addEventListener('dragstart', (ev) => {
      if (e.synthetic) return;
      ev.dataTransfer.setData('text/plain', e.path);
      ev.dataTransfer.effectAllowed = 'move';
      node.style.opacity = '0.5';
    });
    node.addEventListener('dragend', () => {
      node.style.opacity = '';
      document.querySelectorAll('.ws-tree-node').forEach(n => n.classList.remove('drag-over'));
    });
    node.addEventListener('dragover', (ev) => {
      if (e.synthetic) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      if (e.isDir) {
        node.classList.add('drag-over');
      }
    });
    node.addEventListener('dragleave', () => {
      node.classList.remove('drag-over');
    });
    node.addEventListener('drop', async (ev) => {
      if (e.synthetic) return;
      ev.preventDefault();
      node.classList.remove('drag-over');
      const srcPath = ev.dataTransfer.getData('text/plain');
      if (!srcPath || srcPath === e.path) return;

      let destDir = e.path;
      if (!e.isDir) {
        const lastSlash = Math.max(e.path.lastIndexOf('/'), e.path.lastIndexOf('\\'));
        destDir = e.path.substring(0, lastSlash);
      }

      const srcParent = srcPath.substring(0, Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\')));
      if (srcParent === destDir) return;

      if (destDir.startsWith(srcPath + '/') || destDir.startsWith(srcPath + '\\') || destDir === srcPath) {
        if (typeof showToast === 'function') showToast('Não é possível mover uma pasta para dentro dela mesma.');
        return;
      }

      const res = await window.electronAPI.moveItem(srcPath, destDir);
      if (res.ok) {
        if (typeof window.refreshProjectTree === 'function') await window.refreshProjectTree();
      } else {
        if (typeof showToast === 'function') showToast('Erro ao mover: ' + res.error);
      }
    });

    node.addEventListener('contextmenu', (ev) => {
      if (e.synthetic && e.synthetic !== 'java-deps' && e.synthetic !== 'java-deps-status') {
        ev.preventDefault();
        ev.stopPropagation();
        return;
      }
      if (typeof window.showTreeContextMenu === 'function') window.showTreeContextMenu(ev, e);
    });

    node.addEventListener('click', (ev) => {
      if (ev.target.closest('.ws-tree-checkbox') || renamingPath) return;
      if (e.synthetic === 'java-deps-status') return;
      if (e.isDir) {
        if (typeof window.toggleDir === 'function') window.toggleDir(e);
      } else {
        if (typeof window.openFileViewer === 'function') window.openFileViewer(e.path);
      }
    });
  }

  function showZoomToast(text) {
    let toast = document.getElementById('zoom-level-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zoom-level-toast';
      toast.style.cssText = 'position:fixed; bottom:24px; right:24px; z-index:20000; background:rgba(20,20,28,0.92); color:#50fa7b; border:1px solid rgba(80,250,123,0.4); border-radius:18px; padding:6px 14px; font-family:var(--font-ui, system-ui, sans-serif); font-size:12px; font-weight:600; box-shadow:0 6px 20px rgba(0,0,0,0.6); pointer-events:none; transition:opacity 0.2s ease, transform 0.2s ease; backdrop-filter:blur(8px);';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
    }, 1200);
  }

  function setupTreeWheelZoom() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || sidebar._hasTreeWheelZoom) return;
    sidebar._hasTreeWheelZoom = true;

    const savedTreeFontSize = localStorage.getItem('ws_tree_font_size');
    if (savedTreeFontSize) {
      document.documentElement.style.setProperty('--ws-tree-font-size', `${savedTreeFontSize}px`);
      const wsTreeEl = document.getElementById('ws-tree');
      if (wsTreeEl) wsTreeEl.style.fontSize = `${savedTreeFontSize}px`;
    }

    sidebar.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        const wsTreeEl = document.getElementById('ws-tree');
        if (!wsTreeEl) return;

        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY < 0 ? 0.8 : -0.8;
        let currentSize = parseFloat(getComputedStyle(wsTreeEl).fontSize) || parseFloat(wsTreeEl.style.fontSize) || 12.5;
        let newSize = Math.min(28, Math.max(8, Math.round((currentSize + delta) * 10) / 10));

        document.documentElement.style.setProperty('--ws-tree-font-size', `${newSize}px`);
        wsTreeEl.style.fontSize = `${newSize}px`;
        localStorage.setItem('ws_tree_font_size', newSize);

        showZoomToast(`Fonte da Árvore: ${newSize}px`);
      }
    }, { passive: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupTreeWheelZoom);
  } else {
    setupTreeWheelZoom();
  }

  window.wireTreeNodeEvents = wireTreeNodeEvents;
  window.showZoomToast = showZoomToast;
})();
