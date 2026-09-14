// nexaConfig.js
// Controlador para a janela de Configurações da Nexa
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

// Abrir / Focar avatar flutuante
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

// Testar conexão Google TTS
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

// Disparo de animações de teste
document.querySelectorAll(".anim-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const animName = btn.getAttribute("data-anim");
    if (animName) {
      ipcRenderer.send("nexa:play-animation", { name: animName });
      const prevBg = btn.style.backgroundColor;
      btn.style.backgroundColor = "#3b82f6";
      setTimeout(() => { btn.style.backgroundColor = prevBg; }, 250);
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
    const micId = nexaMicSelect ? nexaMicSelect.value : "";

    if (isNexaOn && !ttsKey) {
      showToast("Para ativar a Nexa, informe as credenciais do Google Cloud Text-to-Speech.");
      return;
    }

    // Salva configurações de TTS
    ipcRenderer.send("save-google-tts-config", {
      enabled: isNexaOn,
      keyPathOrKey: ttsKey
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

    if (ttsCfg && googleTtsKey) {
      googleTtsKey.value = ttsCfg.keyPathOrKey || "";
    }

    await populateMicrophones(micDevice);
  } catch (err) {
    console.error("[nexaConfig] Erro ao carregar configurações:", err);
  }
});
