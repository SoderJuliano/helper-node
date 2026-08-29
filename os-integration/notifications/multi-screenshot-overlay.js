(function() {
  'use strict';
  const api = window.electronAPI || {};

  const state = {
    screenshots: [],
  };

  const countBadge = document.getElementById('count-badge');
  const emptyState = document.getElementById('empty-state');
  const thumbnailsList = document.getElementById('thumbnails-list');
  const thumbnailsWrapper = document.getElementById('thumbnails-wrapper');
  const btnSend = document.getElementById('btn-send');
  const btnClear = document.getElementById('btn-clear');
  const btnClose = document.getElementById('btn-close');

  function render() {
    const count = state.screenshots.length;
    if (countBadge) countBadge.textContent = String(count);

    if (btnSend) {
      btnSend.disabled = (count === 0);
      if (count === 0) {
        btnSend.innerHTML = '<span class="btn-icon">🚀</span><span class="btn-text">Enviar</span><span class="btn-shortcut">Alt+S</span>';
      } else {
        btnSend.innerHTML = `<span class="btn-icon">🚀</span><span class="btn-text">Enviar (${count})</span><span class="btn-shortcut">Alt+S</span>`;
      }
    }

    if (count === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      if (thumbnailsList) thumbnailsList.innerHTML = '';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';
    if (!thumbnailsList) return;

    thumbnailsList.innerHTML = '';

    state.screenshots.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'thumb-card';
      card.dataset.id = item.id;

      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.src = item.base64Image || item.base64 || '';
      img.alt = `Print #${index + 1}`;

      const badge = document.createElement('div');
      badge.className = 'thumb-badge';
      badge.textContent = `#${index + 1}`;

      const delBtn = document.createElement('button');
      delBtn.className = 'thumb-delete';
      delBtn.title = 'Remover captura';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeScreenshot(item.id);
      });

      card.appendChild(img);
      card.appendChild(badge);
      card.appendChild(delBtn);
      thumbnailsList.appendChild(card);
    });

    if (thumbnailsWrapper) {
      setTimeout(() => {
        thumbnailsWrapper.scrollTop = thumbnailsWrapper.scrollHeight;
      }, 20);
    }
  }

  function addScreenshot(data) {
    if (!data) return;
    const id = data.id || `shot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const base64Image = data.base64Image || data.base64 || '';
    state.screenshots.push({
      id,
      base64Image,
      timestamp: data.timestamp || Date.now(),
    });
    render();
  }

  function removeScreenshot(id) {
    state.screenshots = state.screenshots.filter(s => s.id !== id);
    if (api.batchRemoveItem) {
      api.batchRemoveItem(id);
    }
    render();
  }

  function clearAll() {
    state.screenshots = [];
    if (api.batchClear) {
      api.batchClear();
    }
    render();
  }

  function sendAll() {
    if (state.screenshots.length === 0) return;
    if (btnSend) {
      btnSend.disabled = true;
      btnSend.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">Enviando...</span>';
    }
    if (api.batchSend) {
      api.batchSend();
    }
  }

  function closeOverlay() {
    if (api.batchClose) {
      api.batchClose();
    }
  }

  if (btnSend) btnSend.addEventListener('click', sendAll);
  if (btnClear) btnClear.addEventListener('click', clearAll);
  if (btnClose) btnClose.addEventListener('click', closeOverlay);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeOverlay();
    } else if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      sendAll();
    }
  });

  if (api.platform !== 'linux' && api.startWindowDrag) {
    const header = document.getElementById('batch-header');
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, kbd')) return;
        e.preventDefault();
        api.startWindowDrag();
      });
    }
    const end = () => api.endWindowDrag && api.endWindowDrag();
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  }

  if (api.onBatchAddImage) {
    api.onBatchAddImage((data) => {
      addScreenshot(data);
    });
  }

  if (api.onBatchRemoveImage) {
    api.onBatchRemoveImage((id) => {
      state.screenshots = state.screenshots.filter(s => s.id !== id);
      render();
    });
  }

  if (api.onBatchClear) {
    api.onBatchClear(() => {
      state.screenshots = [];
      render();
    });
  }

  if (api.getBatchScreenshots) {
    api.getBatchScreenshots().then((items) => {
      if (Array.isArray(items)) {
        state.screenshots = items;
      }
      render();
    }).catch(() => {
      render();
    });
  } else {
    render();
  }
})();
