// os-integration/notifications/realtime-assistant-overlay.js
// Client logic and IPC handlers for Realtime Assistant Overlay.
(function() {
  'use strict';
  const api = window.electronAPI || {};
  let isListening = true;

  function updateStatus(status, customMsg) {
    const dot  = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    const map = {
      listening: { cls: 'listening', txt: '🎙️ Ouvindo microfone e sistema (ao vivo)...' },
      speaking:  { cls: 'speaking',  txt: '🗣️ Áudio detectado — transcrevendo...' },
      thinking:  { cls: 'thinking',  txt: '🤖 Processando resposta com IA...' },
      paused:    { cls: 'paused',    txt: '⏸️ Pausado — Pressione Ctrl+D para ouvir' },
      error:     { cls: 'error',     txt: '⚠️ ' + (customMsg || 'Erro no áudio/IA') },
    };
    const s = map[status] || map.listening;
    if (dot) {
      dot.className = '';
      if (s.cls) dot.classList.add(s.cls);
    }
    if (text) text.textContent = customMsg || s.txt;
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

  let currentTurn = {
    id: null,
    audioSource: null,
    userBlock: null,
    assistantBlock: null,
    lastUserText: '',
    lastAssistantText: ''
  };

  function handleUserText(id, text, audioSource) {
    if (!text || !text.trim()) return;
    const empty = document.getElementById('empty');
    if (empty) empty.remove();

    const container = document.getElementById('messages');
    if (!container) return;
    const src = audioSource || 'sys';
    const isMic = (src === 'mic');
    const roleClass = isMic ? 'mic-turn' : 'sys-turn';
    const roleLabel = isMic ? '🎙️ Você (Microfone)' : '🔊 Interlocutor (Sistema)';

    if (currentTurn.userBlock && !currentTurn.assistantBlock && currentTurn.audioSource === src) {
      currentTurn.id = id || currentTurn.id;
      currentTurn.lastUserText = text;
      const body = currentTurn.userBlock.querySelector('.tip-body');
      if (body) body.innerHTML = renderHtml(text);
    } else {
      const block = document.createElement('div');
      block.className = `tip-block ${roleClass}`;

      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ts = document.createElement('div');
      ts.className = 'tip-time';
      ts.textContent = roleLabel + ' · ' + hh + ':' + mm;
      block.appendChild(ts);

      const body = document.createElement('div');
      body.className = 'tip-body';
      body.innerHTML = renderHtml(text);
      block.appendChild(body);

      container.appendChild(block);

      currentTurn = {
        id: id,
        audioSource: src,
        userBlock: block,
        assistantBlock: null,
        lastUserText: text,
        lastAssistantText: ''
      };
    }
    container.scrollTop = container.scrollHeight;
  }

  function handleAssistantText(id, text) {
    if (!text || !text.trim()) return;
    const empty = document.getElementById('empty');
    if (empty) empty.remove();

    const container = document.getElementById('messages');
    if (!container) return;

    if (currentTurn.assistantBlock) {
      currentTurn.lastAssistantText = text;
      const body = currentTurn.assistantBlock.querySelector('.tip-body');
      if (body) body.innerHTML = renderHtml(text);
    } else {
      const block = document.createElement('div');
      block.className = 'tip-block assistant-turn';

      const now = new Date();
      const hh = String(now.getHours()).padStart(2,'0');
      const mm = String(now.getMinutes()).padStart(2,'0');
      const ts = document.createElement('div');
      ts.className = 'tip-time';
      ts.textContent = '🤖 Resposta IA · ' + hh + ':' + mm;
      block.appendChild(ts);

      const body = document.createElement('div');
      body.className = 'tip-body';
      body.innerHTML = renderHtml(text);
      block.appendChild(body);

      container.appendChild(block);
      currentTurn.assistantBlock = block;
      currentTurn.lastAssistantText = text;
    }
    container.scrollTop = container.scrollHeight;
  }

  function clearMessages() {
    currentTurn = { id: null, userBlock: null, assistantBlock: null, lastUserText: '', lastAssistantText: '' };
    const container = document.getElementById('messages');
    if (container) {
      container.innerHTML = '<div id="empty">Histórico limpo.<br>Continuo ouvindo áudio em segundo plano.</div>';
    }
  }

  document.getElementById('btn-left')?.addEventListener('click', () => api.overlayPosition?.('left'));
  document.getElementById('btn-center')?.addEventListener('click', () => api.overlayPosition?.('center'));
  document.getElementById('btn-right')?.addEventListener('click', () => api.overlayPosition?.('right'));
  document.getElementById('btn-monitor')?.addEventListener('click', () => api.overlayPosition?.('next-monitor'));
  document.getElementById('btn-clear')?.addEventListener('click', () => clearMessages());
  document.getElementById('btn-min')?.addEventListener('click', () => {
    if (api.realtimeMinimize) api.realtimeMinimize();
    else if (api.visionGuideMinimize) api.visionGuideMinimize();
  });

  const btnPause = document.getElementById('btn-pause');
  btnPause?.addEventListener('click', () => {
    window.electronAPI?.toggleRecordingShortcut?.();
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
        inlineCode.style.background = 'rgba(56, 189, 248, 0.35)';
        inlineCode.style.color = '#38bdf8';
        setTimeout(() => {
          inlineCode.style.background = originalBg;
          inlineCode.style.color = '';
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

  if (api.onToggleRecording) {
    api.onToggleRecording((event, data) => {
      if (!data) return;
      isListening = !!data.isRecording;
      if (isListening) {
        updateStatus('listening');
        if (btnPause) { btnPause.textContent = '⏸'; btnPause.title = 'Pausar assistente (ou use Ctrl+D)'; }
      } else {
        updateStatus('paused');
        if (btnPause) { btnPause.textContent = '▶'; btnPause.title = 'Continuar assistente (ou use Ctrl+D)'; }
      }
    });
  }

  if (api.onRealtimeAssistantUpdate) {
    api.onRealtimeAssistantUpdate((payload) => {
      if (!payload || !payload.type) return;

      switch (payload.type) {
        case 'state':
          if (payload.state === 'started') {
            isListening = true;
            updateStatus('listening');
          } else if (payload.state === 'stopped') {
            isListening = false;
            updateStatus('paused');
          }
          break;

        case 'segment_start':
          updateStatus('speaking');
          if (currentTurn.assistantBlock) {
            currentTurn = { id: null, userBlock: null, assistantBlock: null, lastUserText: '', lastAssistantText: '' };
          }
          break;

        case 'segment_partial':
          {
            const isMic = (payload.audioSource === 'mic');
            updateStatus('speaking', isMic ? '🎙️ Você falando...' : '🔊 Interlocutor falando...');
            if (payload.text && payload.text.trim().length > 3) {
              handleUserText(payload.id, payload.text, payload.audioSource || 'sys');
            }
          }
          break;

        case 'segment_whisper_correction':
          updateStatus('thinking');
          if (payload.text && payload.text.trim().length > 0) {
            handleUserText(payload.id, payload.text, payload.audioSource || 'sys');
          }
          break;

        case 'segment_response':
          updateStatus('listening');
          if (payload.response && payload.response.trim().length > 0) {
            handleAssistantText(payload.id, payload.response);
          }
          break;

        case 'segment_error':
          updateStatus('error', payload.message || 'Erro ao gerar resposta');
          break;

        case 'fatal_error':
          updateStatus('error', payload.message || 'Erro fatal');
          break;
      }
    });
  }

  updateStatus('listening');
})();
