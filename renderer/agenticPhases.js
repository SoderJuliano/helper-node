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
    
    function getActivityType(data) {
      if (!data) return 'tool';
      const k = String(data.kind || '').toLowerCase();
      const n = String(data.name || '').toLowerCase();
      const l = String(data.label || '').toLowerCase();
      if (k === 'read' || n.includes('view') || n.includes('read') || l.startsWith('lendo') || l.startsWith('lido') || l.includes('read') || l.includes('view') || l.includes('inspecion')) return 'read';
      if (k === 'edit' || n.includes('edit') || n.includes('write') || n.includes('patch') || l.startsWith('editando') || l.startsWith('criando') || l.startsWith('escrevendo') || l.startsWith('modificando') || l.startsWith('alterando') || l.includes('edit') || l.includes('write')) return 'edit';
      if (k === 'command' || n.includes('command') || n.includes('terminal') || l.includes('comando') || l.includes('command') || l.includes('rodando') || l.includes('executando')) return 'cmd';
      if (k === 'search' || n.includes('grep') || n.includes('find') || n.includes('list') || l.includes('buscando') || l.includes('localizando') || l.includes('listando') || l.includes('pesquisando')) return 'search';
      return 'tool';
    }

    function getTypeIconSvg(type) {
      if (type === 'read') return '<svg class="ai-activity-type-icon read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      if (type === 'edit') return '<svg class="ai-activity-type-icon edit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      if (type === 'cmd') return '<svg class="ai-activity-type-icon cmd" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>';
      if (type === 'search') return '<svg class="ai-activity-type-icon search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      return '<svg class="ai-activity-type-icon file" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }

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
          const actType = getActivityType(data);
          const item = document.createElement('div');
          item.className = `ai-activity-item running action-${actType}`;
          item.dataset.id = data.id;
          item.dataset.type = actType;
          const fullLabel = data.label || data.name || 'trabalhando…';
          item.title = fullLabel;

          const ic = document.createElement('span');
          ic.className = 'ai-activity-ic';
          ic.innerHTML = '<span class="ai-activity-spinner"></span>';

          const typeIc = document.createElement('span');
          typeIc.className = 'ai-activity-type-ic';
          typeIc.innerHTML = getTypeIconSvg(actType);

          const lbl = document.createElement('span');
          lbl.className = 'ai-activity-label';
          lbl.textContent = fullLabel;

          item.appendChild(ic);
          item.appendChild(typeIc);
          item.appendChild(lbl);
          feed.appendChild(item);
        } else if (evPhase === 'end' || evPhase === 'done' || evPhase === 'error' || evPhase === 'completed' || evPhase === 'finish' || evPhase === 'finished') {
          const item = feed.querySelector(`[data-id="${data.id}"]`);
          if (item) {
            item.classList.remove('running');
            const isError = !(!data.error || evPhase === 'error' || data.ok === false);
            item.classList.remove('done', 'fail');
            item.classList.add(isError ? 'fail' : 'done');
            const ic = item.querySelector('.ai-activity-ic');
            if (ic) ic.innerHTML = isError ? ACT_FAIL : ACT_CHECK;
            if (data.label) {
              item.title = data.label;
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
