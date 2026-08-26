// os-integration/notifications/vision-guide-overlay.js
// Client logic and IPC handlers for Vision Guide Overlay.
(function() {
  'use strict';
  const api = window.electronAPI || {};

  function updateStatus(status) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const map = {
      watching: { cls: 'watching', txt: 'Observando…' },
      thinking: { cls: 'thinking', txt: 'Analisando…' },
      error:    { cls: 'error',    txt: 'Erro na análise' },
      idle:     { cls: '',         txt: 'Pausado' },
    };
    const s = map[status] || map.watching;
    if (dot) {
      dot.className = '';
      if (s.cls) dot.classList.add(s.cls);
    }
    if (text) text.textContent = s.txt;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderHtml(text) {
    if (!text) return '';
    let html = '';
    const codeRe = /```(\w*)\n([\s\S]*?)```/g;
    let lastIdx = 0, m;
    const inline = (t) => escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]+?)`/g, '<code class="inline-code" title="Clique para copiar">$1</code>')
      .replace(/\n/g, '<br>');
    while ((m = codeRe.exec(text)) !== null) {
      const before = text.slice(lastIdx, m.index);
      if (before.trim()) html += '<p>' + inline(before) + '</p>';
      const lang = (m[1] || 'text').toLowerCase();
      const code = m[2].replace(/\n$/, '');
      html += '<pre><button class="copy-btn">copy</button><code class="lang-' + lang + '">' + escapeHtml(code) + '</code></pre>';
      lastIdx = codeRe.lastIndex;
    }
    const tail = text.slice(lastIdx);
    if (tail.trim()) html += '<p>' + inline(tail) + '</p>';
    return html;
  }

  function addTip(data) {
    const text = (data && data.text) || '';
    if (!text) return;
    const empty = document.getElementById('empty');
    if (empty) empty.remove();

    const container = document.getElementById('messages');
    if (!container) return;
    const block = document.createElement('div');
    block.className = 'tip-block';

    const now = new Date();
    const hh = String(now.getHours()).padStart(2,'0');
    const mm = String(now.getMinutes()).padStart(2,'0');
    const ts = document.createElement('div');
    ts.className = 'tip-time';
    ts.textContent = 'Dica · ' + hh + ':' + mm;
    block.appendChild(ts);

    const body = document.createElement('div');
    body.className = 'tip-body';
    body.innerHTML = renderHtml(text);
    block.appendChild(body);

    container.appendChild(block);
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => { if (api.requestVisionGuideResize) api.requestVisionGuideResize(); });
  }

  function clearTips() {
    const container = document.getElementById('messages');
    if (container) {
      container.innerHTML = '<div id="empty">Histórico limpo.<br>Continuo observando.</div>';
    }
  }

  document.getElementById('btn-left')?.addEventListener('click', () => api.overlayPosition?.('left'));
  document.getElementById('btn-center')?.addEventListener('click', () => api.overlayPosition?.('center'));
  document.getElementById('btn-right')?.addEventListener('click', () => api.overlayPosition?.('right'));
  document.getElementById('btn-monitor')?.addEventListener('click', () => api.overlayPosition?.('next-monitor'));
  document.getElementById('btn-clear')?.addEventListener('click', () => clearTips());
  document.getElementById('btn-min')?.addEventListener('click', () => api.visionGuideMinimize?.());

  const btnHelp = document.getElementById('btn-help');
  btnHelp?.addEventListener('click', () => {
    api.visionGuideHelp?.();
    btnHelp.classList.add('asked');
    updateStatus('thinking');
    setTimeout(() => btnHelp.classList.remove('asked'), 1200);
  });

  const btnPause = document.getElementById('btn-pause');
  btnPause?.addEventListener('click', () => api.visionGuideTogglePause?.());
  if (api.onVisionGuidePaused) api.onVisionGuidePaused((paused) => {
    if (btnPause) {
      btnPause.textContent = paused ? '▶' : '⏸';
      btnPause.title = paused ? 'Continuar assistente' : 'Pausar assistente';
    }
    updateStatus(paused ? 'idle' : 'watching');
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
      const isInteractive = e.target && e.target.closest && e.target.closest('#pos-header, #status-bar, .pos-btn, pre, .copy-btn, code.inline-code, #messages');
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

    const inlineCode = e.target.closest('.tip-body code.inline-code');
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

  document.addEventListener('keydown', async (e) => {
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

  document.addEventListener('copy', (e) => {
    const sel = window.getSelection()?.toString();
    if (sel && sel.trim().length > 0) {
      try {
        if (api.copyToClipboard) api.copyToClipboard(sel);
        if (e.clipboardData) e.clipboardData.setData('text/plain', sel);
      } catch (_) {}
    }
  });

  if (api.onVisionGuideMessage) api.onVisionGuideMessage((data) => addTip(data));
  if (api.onVisionGuideStatus)  api.onVisionGuideStatus((status) => updateStatus(status));
  if (api.onVisionGuideClear)   api.onVisionGuideClear(() => clearTips());

  if (api.onRealtimeAssistantUpdate) {
    api.onRealtimeAssistantUpdate((payload) => {
      if (!payload || !payload.type) return;
      if (payload.type === 'segment_start') {
        updateStatus('thinking');
      } else if (payload.type === 'segment_whisper_correction' && payload.text) {
        updateStatus('thinking');
      } else if (payload.type === 'segment_response' && payload.response) {
        addTip({ text: payload.response });
        updateStatus('watching');
      } else if (payload.type === 'segment_error') {
        updateStatus('error');
      }
    });
  }

  updateStatus('watching');
})();
