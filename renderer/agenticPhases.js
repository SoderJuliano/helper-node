// renderer/agenticPhases.js
// Agentic phase updates, thinking drawer and tool activities display.
(function() {
  'use strict';

  let activeAgenticSession = null;
  const PHASE_LABELS = {
    thinking: 'Pensando', discovery: 'Explorando', planning: 'Planejando',
    implementation: 'Implementando', review: 'Revisando',
    completed: 'Concluído', error: 'Erro',
  };

  const transcriptionElement = document.getElementById('transcription');

  if (window.electronAPI && window.electronAPI.onAgenticPhaseUpdate) {
    window.electronAPI.onAgenticPhaseUpdate(({ phase, status, sessionId, thinking }) => {
      const done = (phase === 'completed' || phase === 'error');
      if (!done) activeAgenticSession = sessionId;
      const block = transcriptionElement
        ? transcriptionElement.querySelector('.interaction-block:last-child')
        : null;
      if (!block) { if (done) activeAgenticSession = null; return; }
      let ph = block.querySelector('.ai-phase');
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'ai-phase';
        ph.innerHTML = `
            <div class="ai-phase-header">
                <span class="ai-phase-spin"></span>
                <span class="ai-phase-tag"></span>
                <button class="ai-phase-stop" title="Interromper">×</button>
                <span class="ai-phase-text"></span>
                <span class="ai-phase-toggle-icon">▶</span>
            </div>
            <div class="ai-thinking-box"></div>
        `;
        const q = block.querySelector('.question-text');
        if (q && q.nextSibling) block.insertBefore(ph, q.nextSibling);
        else block.insertBefore(ph, block.firstChild);

        const header = ph.querySelector('.ai-phase-header');
        header.addEventListener('click', (e) => {
          if (e.target.closest('.ai-phase-stop')) return;
          ph.classList.toggle('expanded');
        });

        const stop = ph.querySelector('.ai-phase-stop');
        if (stop) stop.addEventListener('click', () => {
          if (typeof window.cancelIaAndFreezeStream === 'function') {
            window.cancelIaAndFreezeStream();
          }
          if (activeAgenticSession) {
            window.electronAPI.stopAgenticWorkflow(activeAgenticSession);
          }
          const txt = ph.querySelector('.ai-phase-text');
          if (txt) txt.textContent = 'Interrompido pelo usuário';
        });
      }
      const tag = ph.querySelector('.ai-phase-tag');
      const txt = ph.querySelector('.ai-phase-text');
      if (tag) tag.textContent = PHASE_LABELS[phase] || phase;
      if (txt) txt.textContent = status || '';

      const toggleIcon = ph.querySelector('.ai-phase-toggle-icon');
      if (toggleIcon) {
        toggleIcon.style.display = thinking ? '' : 'none';
      }

      const box = ph.querySelector('.ai-thinking-box');
      if (box && thinking) {
        box.textContent = thinking;
      }

      if (done) {
        ph.classList.add(phase === 'error' ? 'error' : 'done');
        const spin = ph.querySelector('.ai-phase-spin'); if (spin) spin.remove();
        const stop = ph.querySelector('.ai-phase-stop'); if (stop) stop.remove();
        activeAgenticSession = null;
      }
      if (typeof window.scrollTranscriptionToBottom === 'function') {
        window.scrollTranscriptionToBottom('auto');
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onAgenticDebugInfo) {
    window.electronAPI.onAgenticDebugInfo(({ type, data, sessionId }) => {
      const isDebug = document.getElementById('debug-indicator')?.style.display !== 'none';
      if (!isDebug) return;

      const debugBlock = document.createElement('div');
      debugBlock.className = 'agentic-debug-block';
      
      const header = document.createElement('div');
      header.className = 'agentic-debug-header';
      header.innerHTML = `<span>🔍 DEBUG: ${type.toUpperCase()}</span><span>${new Date().toLocaleTimeString()}</span>`;
      
      const content = document.createElement('pre');
      content.style.margin = '0';
      content.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      
      debugBlock.appendChild(header);
      debugBlock.appendChild(content);
      if (transcriptionElement) {
        transcriptionElement.appendChild(debugBlock);
      }
      if (typeof window.scrollTranscriptionToBottom === 'function') {
        window.scrollTranscriptionToBottom();
      }
    });
  }

  if (window.electronAPI && window.electronAPI.onAiToolActivity) {
    const ACT_CHECK = '<svg class="ai-activity-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const ACT_FAIL = '<svg class="ai-activity-fail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    
    window.electronAPI.onAiToolActivity((data) => {
      try {
        if (!data || !data.id || !transcriptionElement) return;
        const block = transcriptionElement.querySelector('.interaction-block:last-child');
        if (!block) return;
        let feed = block.querySelector('.ai-activity');
        if (!feed) {
          feed = document.createElement('div');
          feed.className = 'ai-activity';
          const anchor = block.querySelector('.ai-phase') || block.querySelector('.question-text');
          if (anchor && anchor.nextSibling) block.insertBefore(feed, anchor.nextSibling);
          else block.appendChild(feed);
        }
        const evPhase = String(data.phase || data.state || '').toLowerCase();
        if (evPhase === 'start' || evPhase === 'running') {
          if (feed.querySelector(`[data-id="${data.id}"]`)) return;
          const item = document.createElement('div');
          item.className = 'ai-activity-item running';
          item.dataset.id = data.id;
          const ic = document.createElement('span');
          ic.className = 'ai-activity-ic';
          ic.innerHTML = '<span class="ai-activity-spinner"></span>';
          const lbl = document.createElement('span');
          lbl.className = 'ai-activity-label';
          lbl.textContent = data.label || data.name || 'trabalhando…';
          item.appendChild(ic);
          item.appendChild(lbl);
          feed.appendChild(item);
        } else if (evPhase === 'end' || evPhase === 'done' || evPhase === 'error' || evPhase === 'completed' || evPhase === 'finish' || evPhase === 'finished') {
          const item = feed.querySelector(`[data-id="${data.id}"]`);
          if (item) {
            item.classList.remove('running');
            const isError = !!(data.error || evPhase === 'error' || data.ok === false);
            item.classList.remove('done', 'fail');
            item.classList.add(isError ? 'fail' : 'done');
            const ic = item.querySelector('.ai-activity-ic');
            if (ic) ic.innerHTML = isError ? ACT_FAIL : ACT_CHECK;
            if (data.label) {
              const lbl = item.querySelector('.ai-activity-label');
              if (lbl) lbl.textContent = data.label;
            }
          }
        }
        if (typeof window.scrollTranscriptionToBottom === 'function') {
          window.scrollTranscriptionToBottom('auto');
        }
      } catch (err) {
        console.warn('ai-tool-activity render failed:', err);
      }
    });
  }
})();
