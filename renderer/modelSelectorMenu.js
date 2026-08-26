// renderer/modelSelectorMenu.js
// Dropdown menu positioning and button state for model selector.
(function() {
  'use strict';

  function buildModelMenu(anchor, models, getCurrentValue, onSelect) {
    document.querySelectorAll('.composer-model-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'composer-model-menu';
    menu.style.cssText = 'position:absolute; z-index:9999; background:var(--bg-elevated); border:1px solid var(--border-strong); border-radius:8px; padding:4px; box-shadow:0 10px 30px rgba(0,0,0,0.55); min-width:200px; -webkit-app-region: no-drag;';
    
    const composerModelName = document.getElementById('composer-model-name');
    const current = composerModelName ? composerModelName.textContent : '';

    models.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      const active = opt.label === current || opt.value === getCurrentValue();
      b.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; text-align:left; background:transparent; border:none; color:' + (active ? 'var(--accent-2)' : 'var(--text-2)') + '; font-size:12px; padding:7px 10px; cursor:pointer; border-radius:5px; font-family:var(--font-ui);';
      b.innerHTML = '<span>' + opt.label + '</span>' + (active ? '<span>✓</span>' : '');
      b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
      b.addEventListener('mouseleave', () => b.style.background = 'transparent');
      b.addEventListener('click', () => {
        menu.remove();
        onSelect(opt);
      });
      menu.appendChild(b);
    });

    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 200;
    const menuHeight = menu.offsetHeight || 180;

    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;

    let top;
    if (spaceAbove >= menuHeight || spaceAbove >= spaceBelow) {
      top = r.top - menuHeight - 6;
    } else {
      top = r.bottom + 6;
    }

    if (top + menuHeight > window.innerHeight - 8) {
      top = window.innerHeight - menuHeight - 8;
    }
    if (top < 8) {
      top = 8;
      if (menuHeight > window.innerHeight - 16) {
        menu.style.maxHeight = (window.innerHeight - 16) + 'px';
        menu.style.overflowY = 'auto';
      }
    }

    let left = r.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) {
      left = 8;
    }

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    const closer = (ev) => {
      if (!menu.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closer, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closer, true), 0);
  }

  function setButtonLoading(anchor, isLoading) {
    if (!anchor) return;
    const caret = anchor.querySelector('.cm-caret');
    let spinEl = anchor.querySelector('.composer-model-spinner');
    if (isLoading) {
      if (!spinEl) {
        spinEl = document.createElement('span');
        spinEl.className = 'ai-activity-spinner composer-model-spinner';
        anchor.appendChild(spinEl);
      }
      if (caret) caret.style.display = 'none';
      spinEl.style.display = 'inline-block';
      anchor.style.pointerEvents = 'none';
    } else {
      if (caret) caret.style.display = '';
      if (spinEl) spinEl.style.display = 'none';
      anchor.style.pointerEvents = 'auto';
    }
  }

  window.buildModelMenu = buildModelMenu;
  window.setButtonLoading = setButtonLoading;
})();
