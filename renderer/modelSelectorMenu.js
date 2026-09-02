// renderer/modelSelectorMenu.js
// Dropdown menu positioning and button state for model selector.
(function() {
  'use strict';

  function buildModelMenu(anchor, models, getCurrentValue, onSelect, options = {}) {
    document.querySelectorAll('.composer-model-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'composer-model-menu';
    menu.style.cssText = 'position:absolute; z-index:9999; background:var(--bg-elevated, #181c24); border:1px solid var(--border-strong, rgba(255,255,255,0.15)); border-radius:8px; padding:6px; box-shadow:0 10px 30px rgba(0,0,0,0.55); min-width:240px; max-width:320px; -webkit-app-region: no-drag; font-family:var(--font-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);';
    
    const composerModelName = document.getElementById('composer-model-name');
    const current = composerModelName ? composerModelName.textContent : '';

    if (options && options.effortSelector) {
      const effortBox = document.createElement('div');
      effortBox.style.cssText = 'padding:4px 6px 8px 6px; border-bottom:1px solid rgba(255,255,255,0.08); margin-bottom:6px;';
      
      const title = document.createElement('div');
      title.textContent = 'Esforço de Raciocínio (Effort):';
      title.style.cssText = 'font-size:11px; font-weight:600; color:var(--text-3, #888); margin-bottom:6px;';
      effortBox.appendChild(title);

      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex; gap:4px; width:100%;';

      const levels = [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' }
      ];

      let currentEffort = (options.effortSelector.getCurrentEffort && options.effortSelector.getCurrentEffort()) || 'medium';

      const updateEffortButtons = () => {
        btnGroup.querySelectorAll('.effort-btn').forEach(btn => {
          const isSelected = btn.dataset.effort === String(currentEffort).toLowerCase();
          btn.style.background = isSelected ? 'var(--accent-2, #007acc)' : 'rgba(255,255,255,0.06)';
          btn.style.color = isSelected ? '#ffffff' : 'var(--text-2, #ccc)';
          btn.style.fontWeight = isSelected ? '600' : 'normal';
          btn.style.border = isSelected ? '1px solid var(--accent-2, #007acc)' : '1px solid rgba(255,255,255,0.12)';
        });
      };

      levels.forEach(lvl => {
        const eb = document.createElement('button');
        eb.type = 'button';
        eb.className = 'effort-btn';
        eb.dataset.effort = lvl.id;
        eb.textContent = lvl.label;
        eb.style.cssText = 'flex:1; padding:5px 0; font-size:11px; border-radius:4px; cursor:pointer; text-align:center; transition:all 0.15s ease;';
        eb.addEventListener('click', (e) => {
          e.stopPropagation();
          currentEffort = lvl.id;
          updateEffortButtons();
          if (options.effortSelector.onEffortChange) {
            options.effortSelector.onEffortChange(lvl.id);
          }
        });
        btnGroup.appendChild(eb);
      });

      updateEffortButtons();
      effortBox.appendChild(btnGroup);
      menu.appendChild(effortBox);
    }

    const listContainer = document.createElement('div');
    listContainer.className = 'composer-model-list';
    listContainer.style.cssText = 'max-height:260px; overflow-y:auto;';

    models.forEach(opt => {
      const b = document.createElement('button');
      b.type = 'button';
      const active = opt.label === current || opt.value === getCurrentValue();
      b.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:10px; width:100%; text-align:left; background:transparent; border:none; color:' + (active ? 'var(--accent-2, #00aaff)' : 'var(--text-2, #e0e0e0)') + '; font-size:12px; padding:7px 10px; cursor:pointer; border-radius:5px; font-family:var(--font-ui);';
      b.innerHTML = '<span>' + opt.label + '</span>' + (active ? '<span style="color:var(--accent-2, #00aaff);">✓</span>' : '');
      b.addEventListener('mouseenter', () => b.style.background = 'rgba(255,255,255,0.06)');
      b.addEventListener('mouseleave', () => b.style.background = 'transparent');
      b.addEventListener('click', () => {
        menu.remove();
        onSelect(opt);
      });
      listContainer.appendChild(b);
    });
    menu.appendChild(listContainer);

    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 240;
    const menuHeight = menu.offsetHeight || 220;

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
