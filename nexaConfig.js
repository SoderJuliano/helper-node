// nexaConfig.js
// Controlador para a janela dedicada de Configurações da Nexa
const { ipcRenderer } = require("electron");

// Botões de controle da janela frameless
document.getElementById('win-maximize-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-toggle-maximize');
});

document.getElementById('win-close-btn')?.addEventListener('click', (e) => {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  ipcRenderer.send('window-close');
});

// Elementos DOM
const nexaToggle = document.getElementById("nexa-toggle");
const nexaStatus = document.getElementById("nexa-status");
const nexaOpenWindowBtn = document.getElementById("nexa-open-window-btn");
const googleTtsKey = document.getElementById("google-tts-key");
const clearGoogleTtsKeyBtn = document.getElementById("clear-google-tts-key");
const googleTtsTestBtn = document.getElementById("google-tts-test-btn");
const googleTtsTestResult = document.getElementById("google-tts-test-result");
const googleTtsVoiceSelect = document.getElementById("google-tts-voice");
const googleTtsPreviewBtn = document.getElementById("google-tts-preview-btn");
const googleTtsRateInput = document.getElementById("google-tts-rate");
const googleTtsRateVal = document.getElementById("google-tts-rate-val");
const googleTtsPitchInput = document.getElementById("google-tts-pitch");
const googleTtsPitchVal = document.getElementById("google-tts-pitch-val");
const nexaMicSelect = document.getElementById("nexa-mic-select");
const nexaMicRefreshBtn = document.getElementById("nexa-mic-refresh");
const saveBtn = document.getElementById("save-btn");
const openConfigBtn = document.getElementById("open-config-btn");
const nexaToast = document.getElementById("nexa-toast");

function showToast(msg, isError = true) {
  if (!nexaToast) return;
  nexaToast.textContent = msg;
  nexaToast.style.background = isError ? "rgba(239, 68, 68, 0.9)" : "rgba(16, 185, 129, 0.9)";
  nexaToast.style.display = "block";
  nexaToast.scrollIntoView({ behavior: "smooth" });
  setTimeout(() => {
    if (nexaToast) nexaToast.style.display = "none";
  }, 4000);
}

function updateNexaStatus(enabled) {
  if (nexaStatus) {
    nexaStatus.textContent = enabled ? "ON" : "OFF";
    nexaStatus.className = enabled ? "status-badge active" : "status-badge";
  }
}

if (nexaToggle) {
  nexaToggle.addEventListener("change", () => {
    updateNexaStatus(nexaToggle.checked);
  });
}

if (clearGoogleTtsKeyBtn && googleTtsKey) {
  clearGoogleTtsKeyBtn.addEventListener("click", () => {
    googleTtsKey.value = "";
    if (googleTtsTestResult) googleTtsTestResult.textContent = "";
  });
}

// Sliders de taxa e tom
if (googleTtsRateInput && googleTtsRateVal) {
  googleTtsRateInput.addEventListener("input", () => {
    const val = parseFloat(googleTtsRateInput.value).toFixed(2);
    googleTtsRateVal.textContent = `${val}x`;
  });
}

if (googleTtsPitchInput && googleTtsPitchVal) {
  googleTtsPitchInput.addEventListener("input", () => {
    const val = parseFloat(googleTtsPitchInput.value).toFixed(1);
    googleTtsPitchVal.textContent = `${val > 0 ? '+' : ''}${val} st`;
  });
}

// Abrir avatar flutuante
if (nexaOpenWindowBtn) {
  nexaOpenWindowBtn.addEventListener("click", () => {
    ipcRenderer.invoke("nexa:open").catch(() => {});
  });
}

// Enumerar microfones
async function populateMicrophones(savedMicId = "") {
  if (!nexaMicSelect) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === "audioinput");

    nexaMicSelect.innerHTML = '<option value="">Padrão do Sistema</option>';
    audioInputs.forEach((dev, idx) => {
      const opt = document.createElement("option");
      opt.value = dev.deviceId;
      opt.textContent = dev.label || `Microfone ${idx + 1}`;
      if (savedMicId && dev.deviceId === savedMicId) {
        opt.selected = true;
      }
      nexaMicSelect.appendChild(opt);
    });
  } catch (err) {
    console.warn("[nexaConfig] Falha ao enumerar microfones:", err.message);
  }
}

if (nexaMicRefreshBtn) {
  nexaMicRefreshBtn.addEventListener("click", () => {
    populateMicrophones(nexaMicSelect ? nexaMicSelect.value : "");
  });
}

// Testar conexão TTS
if (googleTtsTestBtn) {
  googleTtsTestBtn.addEventListener("click", async () => {
    const keyVal = googleTtsKey ? googleTtsKey.value.trim() : "";
    if (!keyVal) {
      if (googleTtsTestResult) {
        googleTtsTestResult.style.color = "#f87171";
        googleTtsTestResult.textContent = "Informe a credencial ou chave primeiro.";
      }
      return;
    }

    if (googleTtsTestResult) {
      googleTtsTestResult.style.color = "#94a3b8";
      googleTtsTestResult.textContent = "Testando conexão...";
    }
    googleTtsTestBtn.disabled = true;

    try {
      const res = await ipcRenderer.invoke("google-tts-test", keyVal);
      if (res && res.ok) {
        if (googleTtsTestResult) {
          googleTtsTestResult.style.color = "#34d399";
          googleTtsTestResult.textContent = `Conectado! Latência: ${res.latencyMs || 0}ms`;
        }
      } else {
        if (googleTtsTestResult) {
          googleTtsTestResult.style.color = "#f87171";
          googleTtsTestResult.textContent = `Erro: ${(res && res.error) || 'Falha de autenticação'}`;
        }
      }
    } catch (err) {
      if (googleTtsTestResult) {
        googleTtsTestResult.style.color = "#f87171";
        googleTtsTestResult.textContent = `Erro: ${err.message}`;
      }
    } finally {
      googleTtsTestBtn.disabled = false;
    }
  });
}

// Ouvir demonstração da voz
let currentAudio = null;
if (googleTtsPreviewBtn) {
  googleTtsPreviewBtn.addEventListener("click", async () => {
    const keyVal = googleTtsKey ? googleTtsKey.value.trim() : "";
    const voiceVal = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C";

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    googleTtsPreviewBtn.disabled = true;
    const origText = googleTtsPreviewBtn.textContent;
    googleTtsPreviewBtn.textContent = "Sintetizando...";

    try {
      // Salva temporariamente a chave se preenchida
      if (keyVal) {
        ipcRenderer.send("save-google-tts-config", {
          enabled: true,
          keyPathOrKey: keyVal,
          voiceName: voiceVal,
          speakingRate: googleTtsRateInput ? parseFloat(googleTtsRateInput.value) : 1.0,
          pitch: googleTtsPitchInput ? parseFloat(googleTtsPitchInput.value) : 0.0
        });
      }

      const phrase = "Olá, Juliano! Eu sou a Nexa, sua assistente e copiloto de inteligência artificial.";
      const res = await ipcRenderer.invoke("google-tts-synthesize", phrase, voiceVal);

      if (res && res.audioBase64) {
        currentAudio = new Audio(`data:audio/mp3;base64,${res.audioBase64}`);
        currentAudio.play();
        currentAudio.onended = () => {
          googleTtsPreviewBtn.textContent = origText;
          googleTtsPreviewBtn.disabled = false;
        };
      } else {
        showToast((res && res.error) || "Falha ao gerar demonstração de áudio.");
        googleTtsPreviewBtn.textContent = origText;
        googleTtsPreviewBtn.disabled = false;
      }
    } catch (err) {
      showToast(`Erro na reprodução: ${err.message}`);
      googleTtsPreviewBtn.textContent = origText;
      googleTtsPreviewBtn.disabled = false;
    }
  });
}

// Disparo de animações
document.querySelectorAll(".anim-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const animName = btn.getAttribute("data-anim");
    if (animName) {
      ipcRenderer.send("nexa:play-animation", { name: animName });
      // Feedback visual momentâneo no botão
      const prevBg = btn.style.background;
      btn.style.background = "rgba(236, 72, 153, 0.4)";
      setTimeout(() => { btn.style.background = prevBg; }, 300);
    }
  });
});

// Navegação para configurações gerais
if (openConfigBtn) {
  openConfigBtn.addEventListener("click", () => {
    ipcRenderer.send("open-config-ui");
  });
}

// Salvar configurações
if (saveBtn) {
  saveBtn.addEventListener("click", async () => {
    const isNexaOn = nexaToggle ? nexaToggle.checked : false;
    const ttsKey = googleTtsKey ? googleTtsKey.value.trim() : "";
    const voiceName = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : "pt-BR-Neural2-C";
    const speakingRate = googleTtsRateInput ? parseFloat(googleTtsRateInput.value) : 1.0;
    const pitch = googleTtsPitchInput ? parseFloat(googleTtsPitchInput.value) : 0.0;
    const micId = nexaMicSelect ? nexaMicSelect.value : "";

    if (isNexaOn && !ttsKey) {
      showToast("Para ativar a Nexa, informe as credenciais do Google Cloud Text-to-Speech.");
      return;
    }

    // Salva configurações de TTS
    ipcRenderer.send("save-google-tts-config", {
      enabled: isNexaOn,
      keyPathOrKey: ttsKey,
      voiceName,
      speakingRate,
      pitch
    });

    // Salva configuração de identidade Nexa
    ipcRenderer.send("nexa:save-config", {
      enabled: isNexaOn,
      onlyNexa: false
    });

    // Salva microfone
    if (micId !== undefined) {
      ipcRenderer.send("set-mic-device", micId);
    }

    window.close();
  });
}

// Inicialização
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const [ttsCfg, nexaCfg, micDevice] = await Promise.all([
      ipcRenderer.invoke("get-google-tts-config").catch(() => null),
      ipcRenderer.invoke("nexa:get-config").catch(() => null),
      ipcRenderer.invoke("get-mic-device").catch(() => "")
    ]);

    if (nexaToggle && nexaCfg) {
      nexaToggle.checked = !!nexaCfg.enabled;
      updateNexaStatus(!!nexaCfg.enabled);
    } else {
      updateNexaStatus(false);
    }

    if (ttsCfg) {
      if (googleTtsKey) googleTtsKey.value = ttsCfg.keyPathOrKey || "";
      if (googleTtsVoiceSelect && ttsCfg.voiceName) googleTtsVoiceSelect.value = ttsCfg.voiceName;
      if (googleTtsRateInput && ttsCfg.speakingRate !== undefined) {
        googleTtsRateInput.value = ttsCfg.speakingRate;
        if (googleTtsRateVal) googleTtsRateVal.textContent = `${parseFloat(ttsCfg.speakingRate).toFixed(2)}x`;
      }
      if (googleTtsPitchInput && ttsCfg.pitch !== undefined) {
        googleTtsPitchInput.value = ttsCfg.pitch;
        const p = parseFloat(ttsCfg.pitch);
        if (googleTtsPitchVal) googleTtsPitchVal.textContent = `${p > 0 ? '+' : ''}${p.toFixed(1)} st`;
      }
    }

    await populateMicrophones(micDevice);
  } catch (err) {
    console.error("[nexaConfig] Erro ao carregar configurações:", err);
  }
});
