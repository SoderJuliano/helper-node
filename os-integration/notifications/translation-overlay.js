// os-integration/notifications/translation-overlay.js
// Client logic and IPC handlers for Translation Assistant Overlay.
(function() {
  'use strict';
  const api = window.electronAPI || {};

  function updateStatus(status) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const map = {
      mic_open:   { cls: 'listening',  txt: 'Ouvindo' },
      speaking:   { cls: 'speaking',   txt: 'Fala detectada' },
      processing: { cls: 'processing', txt: 'Traduzindo…' },
      idle:       { cls: '',           txt: 'Aguardando…' },
    };
    const s = map[status] || map.idle;
    if (dot) {
      dot.className = '';
      if (s.cls) dot.classList.add(s.cls);
    }
    if (text) text.textContent = s.txt;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderResponseHtml(text) {
    if (!text) return '';
    let html = '';
    const codeRe = /```(\w*)\n([\s\S]*?)```/g;
    let lastIdx = 0, m;
    const renderInline = (t) => escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+?)`/g, '<code class="inline-code" title="Clique para copiar">$1</code>')
      .replace(/\n/g, '<br>');
    while ((m = codeRe.exec(text)) !== null) {
      const before = text.slice(lastIdx, m.index);
      if (before.trim()) html += '<p>' + renderInline(before) + '</p>';
      const lang = (m[1] || 'text').toLowerCase();
      const code = m[2].replace(/\n$/, '');
      html += '<pre><button class="copy-btn">copy</button><code class="lang-' + lang + '">' + escapeHtml(code) + '</code></pre>';
      lastIdx = codeRe.lastIndex;
    }
    const tail = text.slice(lastIdx);
    if (tail.trim()) html += '<p>' + renderInline(tail) + '</p>';
    return html;
  }

  function formatImageResponse(text) {
    if (!text) return '';
    return escapeHtml(text)
      .replace(/📸 O QUE É:/g, '<div class="img-section-label">📸 O que é</div>')
      .replace(/💡 ABORDAGEM:/g, '<div class="img-section-label">💡 Abordagem</div>')
      .replace(/✍️ SUGESTÃO:/g, '<div class="img-section-label">✍️ Sugestão</div>')
      .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre>$1</pre>')
      .replace(/\n/g, '<br>');
  }

  let userScrolledUp = false;
  const messagesContainer = document.getElementById('messages');
  if (messagesContainer) {
    messagesContainer.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) {
        userScrolledUp = true;
      } else if (e.deltaY > 0) {
        const distFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
        if (distFromBottom <= 25) {
          userScrolledUp = false;
        }
      }
    }, { passive: true });

    messagesContainer.addEventListener('scroll', () => {
      const distFromBottom = messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight;
      if (distFromBottom > 35) {
        userScrolledUp = true;
      } else if (distFromBottom <= 15) {
        userScrolledUp = false;
      }
    }, { passive: true });
  }

  function scrollToBottomIfNeeded(force = false) {
    if (!messagesContainer) return;
    if (force || !userScrolledUp) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  let resizeTimer = null;
  function requestSmoothResize(immediate = false) {
    if (!api.requestTranslationResize) return;
    if (immediate) {
      if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = null; }
      requestAnimationFrame(() => api.requestTranslationResize());
      return;
    }
    if (!resizeTimer) {
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        requestAnimationFrame(() => api.requestTranslationResize());
      }, 200);
    }
  }

  function addMessage(data) {
    const { transcript, response, mode, type, id, streaming } = data || {};
    if (!transcript && !response) return;

    const empty = document.getElementById('empty');
    if (empty) empty.remove();

    const container = messagesContainer;
    if (!container) return;

    if (type === 'image') {
      const block = document.createElement('div');
      block.className = 'message-block image-block';
      const content = response || transcript;
      block.innerHTML = `<div class="img-section-label" style="color:#a78bfa;margin-top:0">📸 análise de tela</div>` +
        `<div class="image-response">${formatImageResponse(content)}</div>`;
      container.appendChild(block);
      scrollToBottomIfNeeded();
      requestSmoothResize(true);
      return;
    }

    let block = id ? container.querySelector(`[data-ta-id="${id}"]`) : null;
    if (!block) {
      block = document.createElement('div');
      block.className = 'message-block ' + (mode || 'interviewer');
      if (id) block.dataset.taId = id;

      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ts = document.createElement('div');
      ts.className = 'timestamp';
      ts.textContent = (mode === 'candidate' ? 'Você' : 'Entrevistador') + ' · ' + hh + ':' + mm;
      block.appendChild(ts);

      if (transcript) {
        const t = document.createElement('div');
        t.className = 'transcript';
        t.textContent = transcript;
        block.appendChild(t);
      }
      container.appendChild(block);
    } else {
      if (transcript) {
        let t = block.querySelector('.transcript');
        if (!t) {
          t = document.createElement('div');
          t.className = 'transcript';
          block.appendChild(t);
        }
        if (t.textContent !== transcript) {
          t.textContent = transcript;
        }
      }
    }

    if (response) {
      const traduMatch = response.match(/TRADU[ÇC][ÃA]O:\s*([\s\S]*?)(?=\n*RESPOSTA:|$)/i);
      const respMatch  = response.match(/RESPOSTA:\s*([\s\S]*)$/i);
      const trad = traduMatch ? traduMatch[1].trim() : '';
      const resp = respMatch  ? respMatch[1].trim()  : (traduMatch ? '' : response);

      if (trad) {
        let td = block.querySelector('.translation');
        if (!td) {
          td = document.createElement('div');
          td.className = 'translation';
          block.appendChild(td);
        }
        if (td.textContent !== trad) td.textContent = trad;
      }

      if (resp) {
        let rl = block.querySelector('.response-label');
        if (!rl) {
          rl = document.createElement('div');
          rl.className = 'response-label';
          block.appendChild(rl);
        }
        const labelText = mode === 'candidate' ? 'Avaliação' : 'Sugestão';
        if (rl.textContent !== labelText) rl.textContent = labelText;

        let rd = block.querySelector('.response');
        if (!rd) {
          rd = document.createElement('div');
          rd.className = 'response';
          block.appendChild(rd);
        }
        const renderedHtml = renderResponseHtml(resp);
        if (rd.innerHTML !== renderedHtml) {
          rd.innerHTML = renderedHtml;
        }
      }
    }

    scrollToBottomIfNeeded();
    requestSmoothResize(streaming === false);
  }

  function clearMessages() {
    const container = messagesContainer;
    if (container) {
      container.innerHTML = '<div id="empty">Histórico limpo</div>';
      userScrolledUp = false;
    }
  }

  document.getElementById('btn-left')?.addEventListener('click', () => {
    window.electronAPI?.overlayPosition?.('left');
  });
  document.getElementById('btn-center')?.addEventListener('click', () => {
    window.electronAPI?.overlayPosition?.('center');
  });
  document.getElementById('btn-right')?.addEventListener('click', () => {
    window.electronAPI?.overlayPosition?.('right');
  });
  document.getElementById('btn-monitor')?.addEventListener('click', () => {
    window.electronAPI?.overlayPosition?.('next-monitor');
  });

  document.addEventListener('dragstart', (e) => e.preventDefault());
  if (api.platform !== 'linux' && api.startWindowDrag) {
    const handles = [document.getElementById('pos-header'), document.getElementById('status-bar')].filter(Boolean);
    handles.forEach((h) => {
      h.style.cursor = 'move';
      h.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, a, input, textarea, pre, code')) return;
        e.preventDefault();
        api.startWindowDrag();
      });
    });
    const end = () => api.endWindowDrag && api.endWindowDrag();
    window.addEventListener('mouseup', end);
    window.addEventListener('blur', end);
  }

  if (api.setIgnoreMouseEvents && api.platform !== 'linux') {
    window.addEventListener('mousemove', (e) => {
      const isInteractive = e.target && e.target.closest && e.target.closest('#pos-header, .pos-btn, #status-bar, #messages, pre, code, button, a');
      if (isInteractive) {
        api.setIgnoreMouseEvents(false);
      } else {
        api.setIgnoreMouseEvents(true, { forward: true });
      }
    });
    window.addEventListener('mouseleave', () => {
      api.setIgnoreMouseEvents(true, { forward: true });
    });
  }

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.copy-btn');
    if (btn) {
      const pre = btn.closest('pre');
      const code = pre ? pre.querySelector('code') : null;
      if (!code) return;
      try {
        if (api.copyToClipboard) api.copyToClipboard(code.textContent);
        else await navigator.clipboard.writeText(code.textContent);
        btn.classList.add('copied');
        btn.textContent = '✓ copiado';
        setTimeout(() => { btn.classList.remove('copied'); btn.textContent = 'copy'; }, 1300);
      } catch (_) {}
      return;
    }

    const inlineCode = e.target.closest('.response code.inline-code');
    if (inlineCode) {
      try {
        const originalText = inlineCode.textContent;
        if (api.copyToClipboard) api.copyToClipboard(originalText);
        else await navigator.clipboard.writeText(originalText);
        
        const originalBg = inlineCode.style.background;
        inlineCode.style.background = 'rgba(74, 222, 128, 0.35)';
        inlineCode.style.color = '#4ade80';
        const originalTitle = inlineCode.title;
        inlineCode.title = 'Copiado!';
        
        setTimeout(() => {
          inlineCode.style.background = originalBg;
          inlineCode.style.color = '';
          inlineCode.title = originalTitle;
        }, 1000);
      } catch (_) {}
    }
  });

  // === ZOOM / TAMANHO DA FONTE (Ctrl + '+', '-', '0', MouseWheel) ===
  const ZOOM_STORAGE_KEY = 'helper_translation_zoom_factor';
  const MIN_ZOOM = 0.6;
  const MAX_ZOOM = 2.5;
  const ZOOM_STEP = 0.1;
  let zoomToastTimeout = null;

  function showZoomToast(text) {
    let toast = document.getElementById('zoom-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'zoom-toast';
      toast.className = 'zoom-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(zoomToastTimeout);
    zoomToastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 1200);
  }

  function getSavedZoomFactor() {
    try {
      const saved = localStorage.getItem(ZOOM_STORAGE_KEY);
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) return val;
      }
    } catch (_) {}
    return 1.0;
  }

  function applyZoom(factor, notify = true) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(factor * 10) / 10));
    try {
      if (api.setZoomFactor) {
        api.setZoomFactor(clamped);
      } else if (window.electron && window.electron.webFrame) {
        window.electron.webFrame.setZoomFactor(clamped);
      } else {
        document.documentElement.style.zoom = `${clamped}`;
      }
      localStorage.setItem(ZOOM_STORAGE_KEY, clamped.toString());
    } catch (e) {
      console.warn('Erro ao aplicar zoom:', e);
    }
    if (notify) {
      const percent = Math.round(clamped * 100);
      showZoomToast(`🔍 Zoom: ${percent}%`);
    }
    return clamped;
  }

  function initZoom() {
    const saved = getSavedZoomFactor();
    if (saved !== 1.0) {
      applyZoom(saved, false);
    }
  }

  document.addEventListener('keydown', async (e) => {
    // Atalhos de Zoom: Ctrl + '+' / '-' / '0'
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const isPlus = e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd';
      const isMinus = e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract';
      const isZero = e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0';

      if (isPlus) {
        e.preventDefault();
        e.stopPropagation();
        const cur = api.getZoomFactor ? api.getZoomFactor() : getSavedZoomFactor();
        applyZoom(cur + ZOOM_STEP, true);
        return;
      }
      if (isMinus) {
        e.preventDefault();
        e.stopPropagation();
        const cur = api.getZoomFactor ? api.getZoomFactor() : getSavedZoomFactor();
        applyZoom(cur - ZOOM_STEP, true);
        return;
      }
      if (isZero) {
        e.preventDefault();
        e.stopPropagation();
        applyZoom(1.0, true);
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      const sel = window.getSelection()?.toString();
      if (sel && sel.trim().length > 0) {
        try {
          if (api.copyToClipboard) api.copyToClipboard(sel);
          else await navigator.clipboard.writeText(sel);
        } catch (_) {}
      }
    }
  });

  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
      const cur = api.getZoomFactor ? api.getZoomFactor() : getSavedZoomFactor();
      applyZoom(cur + delta, true);
    }
  }, { passive: false });

  document.addEventListener('copy', (e) => {
    const sel = window.getSelection()?.toString();
    if (sel && sel.trim().length > 0) {
      try {
        if (api.copyToClipboard) api.copyToClipboard(sel);
        if (e.clipboardData) e.clipboardData.setData('text/plain', sel);
      } catch (_) {}
    }
  });

  if (api.onTranslationResult) api.onTranslationResult((data) => addMessage(data));
  if (api.onTranslationStatus) api.onTranslationStatus((status) => updateStatus(status));
  if (api.onTranslationClear)  api.onTranslationClear(() => clearMessages());

  initZoom();
  updateStatus('mic_open');
})();

