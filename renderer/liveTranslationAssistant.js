// renderer/liveTranslationAssistant.js
// Translation Assistant UI handlers, volume feedback and stream responses.
(function() {
  'use strict';

  if (window.electronAPI && window.electronAPI.onTranslationResult) {
    const _taShow = () => {};
    const _taHide = () => {};

    const _taLive = document.getElementById('ta-live-indicator');
    if (_taLive && window.electronAPI.onTranslationStatus) {
      window.electronAPI.onTranslationStatus((status) => {
        if (status && status !== 'idle') {
          const hero = document.getElementById('welcome-hero');
          if (hero) hero.classList.add('hidden');
          if (typeof setComposerVisibility === 'function') setComposerVisibility(false);
        } else if (status === 'idle') {
          if (typeof setComposerVisibility === 'function') setComposerVisibility(true);
        }
        if (status === 'mic_open') {
          _taLive.className = 'visible state-mic';
        } else if (status === 'processing') {
          _taLive.classList.add('hidden-by-loader');
        } else if (status === 'idle') {
          _taLive.className = '';
        }
      });

      const _robot = document.getElementById('robot');
      const _animCont = document.getElementById('animation-container');
      const _syncPulse = () => {
        const busy = (_robot && _robot.style.display === 'block') ||
                     (_animCont && _animCont.style.display !== '' && _animCont.style.display !== 'none');
        _taLive.classList.toggle('hidden-by-loader', busy);
      };
      const _obs = new MutationObserver(_syncPulse);
      if (_robot) _obs.observe(_robot, { attributes: true, attributeFilter: ['style'] });
      if (_animCont) _obs.observe(_animCont, { attributes: true, attributeFilter: ['style'] });
    }

    if (window.electronAPI.onTranslationLevel) {
      const _volBox = document.getElementById('ta-volume');
      const _volMic = document.getElementById('ta-vol-mic');
      const _volSys = document.getElementById('ta-vol-sys');
      const _SIL = 300;
      const _FULL = 2500;
      window.electronAPI.onTranslationLevel(({ source, rms }) => {
        if (_volBox && _volBox.style.display !== 'block') _volBox.style.display = 'block';
        const el = source === 'mic' ? _volMic : _volSys;
        if (!el) return;
        el.style.width = Math.max(0, Math.min(100, (rms / _FULL) * 100)) + '%';
        el.classList.toggle('active', rms > _SIL);
      });
      if (window.electronAPI.onTranslationStatus) {
        window.electronAPI.onTranslationStatus((status) => {
          if (status === 'idle' && _volBox) _volBox.style.display = 'none';
        });
      }
    }

    if (window.electronAPI.onTranslationLoading) {
      const _taLoadBox = document.getElementById('ta-loading');
      window.electronAPI.onTranslationLoading((loading) => {
        if (_taLoadBox) _taLoadBox.style.display = loading ? 'block' : 'none';
      });
    }

    const _taMeta = (text) => {
      const d = document.createElement('div');
      d.className = 'ta-meta';
      d.textContent = text;
      return d;
    };

    window.electronAPI.onTranslationResult((data) => {
      const el = document.getElementById('transcription');
      if (!el) return;
      const hero = document.getElementById('welcome-hero');
      if (hero) hero.classList.add('hidden');
      const { status } = data;

      if (status === 'question') {
        _taShow(`🔊 Pergunta ${data.index}/${data.total}`, true);
        el.appendChild(_taMeta(`— Pergunta ${data.index} de ${data.total} —`));
      } else if (status === 'done' || !status) {
        _taShow(`🎤 Fale agora — até 40s`, false);
        let block = data.id ? el.querySelector(`[data-ta-id="${data.id}"]`) : null;
        if (!block) {
          block = document.createElement('div');
          block.className = 'interaction-block';
          if (data.id) block.dataset.taId = data.id;
          if (data.transcript && data.transcript.trim()) {
            const orig = document.createElement('div');
            orig.className = 'ta-original';
            const who = data.mode === 'candidate' ? '👤 Você: ' : '🎧 Entrevistador: ';
            orig.textContent = who + data.transcript;
            block.appendChild(orig);
          }
          el.appendChild(block);
        } else {
          if (data.transcript && data.transcript.trim()) {
            let orig = block.querySelector('.ta-original');
            if (!orig) {
              orig = document.createElement('div');
              orig.className = 'ta-original';
              block.insertBefore(orig, block.firstChild);
            }
            const who = data.mode === 'candidate' ? '👤 Você: ' : '🎧 Entrevistador: ';
            orig.textContent = who + data.transcript;
          }
        }
        if (data.response && data.response.trim()) {
          let resp = block.querySelector('.ia-response');
          if (!resp) {
            resp = document.createElement('div');
            resp.className = 'ia-response';
            resp.style.cssText = 'white-space: pre-wrap;';
            block.appendChild(resp);
          }
          resp.innerHTML = typeof window.formatOpenAIResponse === 'function'
            ? window.formatOpenAIResponse(data.response)
            : data.response;
        }
      } else if (status === 'listening') {
        _taShow('🎤 Fale agora — até 40s', false);
      }
      if (typeof window.scrollTranscriptionToBottom === 'function') {
        window.scrollTranscriptionToBottom('auto');
      }
    });
  }
})();
