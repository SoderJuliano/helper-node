// renderer/editor/editorTabs.js
// Tab management and context menus for CodeMirror editor.
(function() {
  'use strict';

  function renderTabs(openFiles, activePath, callbacks) {
    const container = document.getElementById('fv-tabs-container');
    if (!container) return;
    container.innerHTML = '';

    const getFileName = (window.EditorConstants && window.EditorConstants.getFileName) || ((p) => (p || '').split(/[/\\]/).pop() || p);

    openFiles.forEach((doc, filePath) => {
      const tab = document.createElement('div');
      tab.className = 'fv-tab';
      if (filePath === activePath) {
        tab.classList.add('active');
      }
      if (doc.dirty) {
        tab.classList.add('dirty');
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'fv-tab-name';
      nameSpan.textContent = getFileName(filePath);
      nameSpan.title = filePath;
      tab.appendChild(nameSpan);

      const dotSpan = document.createElement('span');
      dotSpan.className = 'fv-tab-dirty';
      dotSpan.textContent = ' ●';
      tab.appendChild(dotSpan);

      const closeBtn = document.createElement('button');
      closeBtn.className = 'fv-tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = 'Fechar aba';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (callbacks.closeTab) callbacks.closeTab(filePath);
      });
      tab.appendChild(closeBtn);

      tab.addEventListener('click', () => {
        if (filePath !== activePath && callbacks.openFile) {
          callbacks.openFile(filePath);
        }
      });

      tab.addEventListener('contextmenu', (ev) => {
        showTabContextMenu(ev, filePath, callbacks);
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
          showTabContextMenu(ev, activePath, callbacks);
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

  function showTabContextMenu(event, filePath, callbacks) {
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
      menu.appendChild(mkItem('Salvar (Ctrl+S)', () => {
        if (callbacks.saveFile) callbacks.saveFile(filePath);
        else if (callbacks.saveActive) callbacks.saveActive();
      }));
      menu.appendChild(mkItem('Fechar outros arquivos', () => {
        if (callbacks.closeOtherTabs) callbacks.closeOtherTabs(filePath);
      }));
    } else {
      menu.appendChild(mkItem('Salvar (Ctrl+S)', () => {
        if (callbacks.saveFile) callbacks.saveFile();
        else if (callbacks.saveActive) callbacks.saveActive();
      }));
    }
    
    menu.appendChild(mkItem('Fechar não modificados', () => {
      if (callbacks.closeUnmodifiedTabs) callbacks.closeUnmodifiedTabs();
    }));

    menu.appendChild(mkItem('Fechar todos', () => {
      if (callbacks.closeAllTabs) callbacks.closeAllTabs();
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

  async function closeAllTabs(ctx) {
    ctx.openFiles.clear();
    const viewer = document.getElementById('file-viewer');
    if (viewer) viewer.classList.remove('open');
    if (ctx.closeEditor) ctx.closeEditor();
    if (ctx.renderTabs) ctx.renderTabs();
  }

  async function closeOtherTabs(ctx, keepPath) {
    for (const filePath of Array.from(ctx.openFiles.keys())) {
      if (filePath !== keepPath) ctx.openFiles.delete(filePath);
    }
    if (ctx.getActivePath() !== keepPath && ctx.openFile) await ctx.openFile(keepPath);
    else if (ctx.renderTabs) ctx.renderTabs();
  }

  async function closeUnmodifiedTabs(ctx) {
    for (const [filePath, doc] of Array.from(ctx.openFiles.entries())) {
      if (!doc.dirty) ctx.openFiles.delete(filePath);
    }
    if (!ctx.openFiles.has(ctx.getActivePath())) {
      if (ctx.openFiles.size > 0 && ctx.openFile) await ctx.openFile(ctx.openFiles.keys().next().value);
      else {
        const viewer = document.getElementById('file-viewer');
        if (viewer) viewer.classList.remove('open');
        if (ctx.closeEditor) ctx.closeEditor();
      }
    } else if (ctx.renderTabs) {
      ctx.renderTabs();
    }
  }

  async function closeTab(ctx, filePath) {
    const doc = ctx.openFiles.get(filePath);
    if (!doc) return;
    const cm = ctx.getCm ? ctx.getCm() : null;
    if (cm && filePath === ctx.getActivePath()) doc.content = cm.getValue();
    ctx.openFiles.delete(filePath);

    if (filePath === ctx.getActivePath()) {
      if (ctx.openFiles.size > 0 && ctx.openFile) await ctx.openFile(ctx.openFiles.keys().next().value);
      else {
        const viewer = document.getElementById('file-viewer');
        if (viewer) viewer.classList.remove('open');
        if (ctx.closeEditor) ctx.closeEditor();
      }
    } else if (ctx.renderTabs) {
      ctx.renderTabs();
    }
  }

  window.EditorTabs = {
    renderTabs,
    showTabContextMenu,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    closeUnmodifiedTabs
  };
})();
