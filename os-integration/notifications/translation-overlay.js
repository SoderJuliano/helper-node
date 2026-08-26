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

  function addMessage(data) {
    const { transcript, response, mode, type, id } = data || {};
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
      requestAnimationFrame(() => { if (api.requestTranslationResize) api.requestTranslationResize(); });
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
        t.textContent = transcript;
      }
    }

    if (response) {
      block.querySelectorAll('.translation, .response-label, .response').forEach(n => n.remove());
      const traduMatch = response.match(/TRADU[ÇC][ÃA]O:\s*([\s\S]*?)(?=\n*RESPOSTA:|$)/i);
      const respMatch  = response.match(/RESPOSTA:\s*([\s\S]*)$/i);
      const trad = traduMatch ? traduMatch[1].trim() : '';
      const resp = respMatch  ? respMatch[1].trim()  : (traduMatch ? '' : response);

      if (trad) {
        const td = document.createElement('div');
        td.className = 'translation';
        td.textContent = trad;
        block.appendChild(td);
      }
      if (resp) {
        const rl = document.createElement('div');
        rl.className = 'response-label';
        rl.textContent = mode === 'candidate' ? 'Avaliação' : 'Sugestão';
        block.appendChild(rl);
        const rd = document.createElement('div');
        rd.className = 'response';
        rd.innerHTML = renderResponseHtml(resp);
        block.appendChild(rd);
      }
    }

    scrollToBottomIfNeeded();
    requestAnimationFrame(() => {
      if (api.requestTranslationResize) api.requestTranslationResize();
    });
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

  if (api.onTranslationResult) api.onTranslationResult((data) => addMessage(data));
  if (api.onTranslationStatus) api.onTranslationStatus((status) => updateStatus(status));
  if (api.onTranslationClear)  api.onTranslationClear(() => clearMessages());

  updateStatus('mic_open');
})();
