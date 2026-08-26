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
      if (translationEnabledToggle.checked && realtimeAssistantToggle && realtimeAssistantToggle.checked) {
        realtimeAssistantToggle.checked = false;
        if (window.ConfigToggles) window.ConfigToggles.updateRealtimeAssistantStatus(false);
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
    try { devices = await ipcRenderer.invoke('get-audio-input-devices'); } catch (_) {}
    translationMicSelect.innerHTML = '<option value="">Automático (padrão do sistema)</option>';
    for (const d of (devices || [])) {
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
      ipcRenderer.send('set-translation-assistant-config', { micDevice: translationMicSelect.value });
    });
  }
  if (translationMicRefresh) {
    translationMicRefresh.addEventListener('click', () => {
      populateMicDevices(translationMicSelect ? translationMicSelect.value : '');
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
        await populateMicDevices(ta.micDevice || '');
      }

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
