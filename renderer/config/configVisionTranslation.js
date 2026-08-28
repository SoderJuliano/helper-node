// renderer/config/configVisionTranslation.js
// Translation Assistant and Vision Guide / Tutor settings handlers.
(function() {
  'use strict';
  const { ipcRenderer } = require("electron");

  const translationEnabledToggle = document.getElementById('translation-enabled');
  const translationEnabledStatus = document.getElementById('translation-enabled-status');
  const translationTargetLangSelect = document.getElementById('translation-target-lang');
  const translationTestModeInput = document.getElementById('translation-test-mode');
  const translationTestModeStatus = document.getElementById('translation-test-mode-status');
  const translationMicSelect = document.getElementById('translation-mic-device');
  const translationMicRefresh = document.getElementById('translation-mic-refresh');
  const realtimeAssistantToggle = document.getElementById("realtime-assistant-toggle");

  function updateTranslationEnabledStatus(v) {
    if (translationEnabledStatus) translationEnabledStatus.textContent = v ? 'ON' : 'OFF';
  }

  function updateTranslationTestModeStatus(v) {
    if (translationTestModeStatus) translationTestModeStatus.textContent = v ? 'ON' : 'OFF';
  }

  if (translationEnabledToggle) {
    translationEnabledToggle.addEventListener('change', () => {
      updateTranslationEnabledStatus(translationEnabledToggle.checked);
      if (translationEnabledToggle.checked) {
        if (window.ConfigToggles && window.ConfigToggles.disableNexaIfActive) {
          window.ConfigToggles.disableNexaIfActive();
        }
        if (realtimeAssistantToggle && realtimeAssistantToggle.checked) {
          realtimeAssistantToggle.checked = false;
          if (window.ConfigToggles) window.ConfigToggles.updateRealtimeAssistantStatus(false);
        }
      }
      ipcRenderer.send('set-translation-assistant-config', { enabled: translationEnabledToggle.checked });
    });
  }

  if (translationTargetLangSelect) {
    translationTargetLangSelect.addEventListener('change', () => {
      ipcRenderer.send('set-translation-assistant-config', { targetLanguage: translationTargetLangSelect.value });
    });
  }

  if (translationTestModeInput) {
    translationTestModeInput.addEventListener('change', () => {
      updateTranslationTestModeStatus(translationTestModeInput.checked);
      ipcRenderer.send('set-translation-test-mode', translationTestModeInput.checked);
    });
  }

  async function populateMicDevices(selected) {
    if (!translationMicSelect) return;
    let devices = [];

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        let all = await navigator.mediaDevices.enumerateDevices();
        // Se as labels estiverem vazias, obtém permissão transitória para expor os nomes dos microfones
        if (all.some(d => d.kind === 'audioinput' && !d.label)) {
          try {
            const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            tempStream.getTracks().forEach(t => t.stop());
            all = await navigator.mediaDevices.enumerateDevices();
          } catch (_) {}
        }
        devices = all
          .filter(d => d.kind === 'audioinput')
          .map(d => ({
            name: d.deviceId,
            description: d.label || (d.deviceId === 'default' ? 'Padrão do Sistema' : `Microfone (${d.deviceId.slice(0, 8)})`)
          }));
      }
    } catch (_) {}

    if (!devices || devices.length === 0) {
      try { devices = await ipcRenderer.invoke('get-audio-input-devices'); } catch (_) {}
    }

    translationMicSelect.innerHTML = '<option value="">Automático (padrão do sistema)</option>';
    const seen = new Set();
    for (const d of (devices || [])) {
      if (!d.name || d.name === 'default' || seen.has(d.name)) continue;
      seen.add(d.name);
      const opt = document.createElement('option');
      opt.value = d.name;
      opt.textContent = d.description || d.name;
      translationMicSelect.appendChild(opt);
    }

    if (selected) {
      if (![...translationMicSelect.options].some(o => o.value === selected)) {
        const opt = document.createElement('option');
        opt.value = selected;
        opt.textContent = selected + ' (desconectado?)';
        translationMicSelect.appendChild(opt);
      }
      translationMicSelect.value = selected;
    }
  }

  if (translationMicSelect) {
    translationMicSelect.addEventListener('change', () => {
      const dev = translationMicSelect.value || '';
      ipcRenderer.send('set-mic-device', dev);
      ipcRenderer.send('set-translation-assistant-config', { micDevice: dev });
    });
  }
  if (translationMicRefresh) {
    translationMicRefresh.addEventListener('click', async () => {
      const current = translationMicSelect ? translationMicSelect.value : '';
      await populateMicDevices(current);
    });
  }

  const visionGuideEnabledToggle  = document.getElementById('vision-guide-enabled');
  const visionGuideEnabledStatus  = document.getElementById('vision-guide-enabled-status');
  const visionGuideIntervalSelect = document.getElementById('vision-guide-interval');
  const visionGuideCooldownSelect = document.getElementById('vision-guide-cooldown');
  const visionGuideAudioInput     = document.getElementById('vision-guide-audio');
  const visionGuideAudioStatus    = document.getElementById('vision-guide-audio-status');
  const visionGuideRagInput       = document.getElementById('vision-guide-rag');
  const visionGuideRagStatus      = document.getElementById('vision-guide-rag-status');

  function updateVisionGuideEnabledStatus(v) {
    if (visionGuideEnabledStatus) visionGuideEnabledStatus.textContent = v ? 'ON' : 'OFF';
  }
  function updateVisionGuideAudioStatus(v) {
    if (visionGuideAudioStatus) visionGuideAudioStatus.textContent = v ? 'ON' : 'OFF';
  }
  function updateVisionGuideRagStatus(v) {
    if (visionGuideRagStatus) visionGuideRagStatus.textContent = v ? 'ON' : 'OFF';
  }

  if (visionGuideEnabledToggle) {
    visionGuideEnabledToggle.addEventListener('change', () => {
      updateVisionGuideEnabledStatus(visionGuideEnabledToggle.checked);
      if (visionGuideEnabledToggle.checked) {
        if (translationEnabledToggle && translationEnabledToggle.checked) {
          translationEnabledToggle.checked = false;
          updateTranslationEnabledStatus(false);
          ipcRenderer.send('set-translation-assistant-config', { enabled: false });
        }
        if (realtimeAssistantToggle && realtimeAssistantToggle.checked) {
          realtimeAssistantToggle.checked = false;
          if (window.ConfigToggles) window.ConfigToggles.updateRealtimeAssistantStatus(false);
        }
      }
      ipcRenderer.send('set-vision-guide-config', { enabled: visionGuideEnabledToggle.checked });
    });
  }
  if (visionGuideIntervalSelect) {
    visionGuideIntervalSelect.addEventListener('change', () => {
      ipcRenderer.send('set-vision-guide-config', { intervalSeconds: parseInt(visionGuideIntervalSelect.value, 10) });
    });
  }
  if (visionGuideCooldownSelect) {
    visionGuideCooldownSelect.addEventListener('change', () => {
      ipcRenderer.send('set-vision-guide-config', { minInterventionSeconds: parseInt(visionGuideCooldownSelect.value, 10) });
    });
  }
  if (visionGuideAudioInput) {
    visionGuideAudioInput.addEventListener('change', () => {
      updateVisionGuideAudioStatus(visionGuideAudioInput.checked);
      ipcRenderer.send('set-vision-guide-config', { listenAudio: visionGuideAudioInput.checked });
    });
  }
  if (visionGuideRagInput) {
    visionGuideRagInput.addEventListener('change', () => {
      updateVisionGuideRagStatus(visionGuideRagInput.checked);
      ipcRenderer.send('set-vision-guide-config', { useKnowledgeBase: visionGuideRagInput.checked });
    });
  }

  (async () => {
    try {
      const globalMic = await ipcRenderer.invoke('get-mic-device');
      const ta = await ipcRenderer.invoke('get-translation-assistant-config');
      if (ta) {
        if (translationEnabledToggle) {
          translationEnabledToggle.checked = !!ta.enabled;
          updateTranslationEnabledStatus(!!ta.enabled);
        }
        if (translationTargetLangSelect) translationTargetLangSelect.value = ta.targetLanguage || 'pt-br';
        if (translationTestModeInput) {
          translationTestModeInput.checked = false;
          updateTranslationTestModeStatus(false);
        }
      }
      await populateMicDevices(globalMic || (ta && ta.micDevice) || '');

      const vg = await ipcRenderer.invoke('get-vision-guide-config');
      if (vg) {
        if (visionGuideEnabledToggle) {
          visionGuideEnabledToggle.checked = !!vg.enabled;
          updateVisionGuideEnabledStatus(!!vg.enabled);
        }
        if (visionGuideIntervalSelect) visionGuideIntervalSelect.value = String(vg.intervalSeconds || 5);
        if (visionGuideCooldownSelect) visionGuideCooldownSelect.value = String(vg.minInterventionSeconds ?? 0);
        if (visionGuideAudioInput) {
          visionGuideAudioInput.checked = vg.listenAudio !== false;
          updateVisionGuideAudioStatus(visionGuideAudioInput.checked);
        }
        if (visionGuideRagInput) {
          visionGuideRagInput.checked = vg.useKnowledgeBase !== false;
          updateVisionGuideRagStatus(visionGuideRagInput.checked);
        }
      }
    } catch (e) {
      console.warn('[VisionTranslation] load config failed:', e.message);
    }
  })();

  window.ConfigVisionTranslation = {
    updateTranslationEnabledStatus,
    updateTranslationTestModeStatus,
    updateVisionGuideEnabledStatus,
    updateVisionGuideAudioStatus,
    updateVisionGuideRagStatus,
    populateMicDevices,
  };
})();
