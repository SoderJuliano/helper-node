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
const nexaNameInput = document.getElementById("nexa-name-input");
const resetNexaNameBtn = document.getElementById("reset-nexa-name-btn");
const nexaOpenWindowBtn = document.getElementById("nexa-open-window-btn");
const nexaMicSelect = document.getElementById("nexa-mic-select");
const nexaMicRefreshBtn = document.getElementById("nexa-mic-refresh");
const saveBtn = document.getElementById("save-btn");
const openConfigBtn = document.getElementById("open-config-btn");
const nexaToast = document.getElementById("nexa-toast");

if (resetNexaNameBtn && nexaNameInput) {
  resetNexaNameBtn.addEventListener("click", () => {
    nexaNameInput.value = "Nexa";
  });
}

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
    const micId = nexaMicSelect ? nexaMicSelect.value : "";
    const avatarMode = "raphael";
    const assistantName = (nexaNameInput && nexaNameInput.value.trim()) ? nexaNameInput.value.trim() : "Nexa";

    // Salva configuração de identidade Nexa
    ipcRenderer.send("nexa:save-config", {
      enabled: isNexaOn,
      name: assistantName,
      onlyNexa: false,
      avatarMode: avatarMode
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
    const [nexaCfg, micDevice] = await Promise.all([
      ipcRenderer.invoke("nexa:get-config").catch(() => null),
      ipcRenderer.invoke("get-mic-device").catch(() => "")
    ]);

    if (nexaCfg) {
      if (nexaNameInput) {
        nexaNameInput.value = (nexaCfg.name && nexaCfg.name.trim()) ? nexaCfg.name.trim() : "Nexa";
      }
      if (nexaToggle) {
        nexaToggle.checked = !!nexaCfg.enabled;
        updateNexaStatus(!!nexaCfg.enabled);
      }
    } else {
      if (nexaNameInput) {
        nexaNameInput.value = "Nexa";
      }
      updateNexaStatus(false);
    }

    await populateMicrophones(micDevice);
  } catch (err) {
    console.error("[nexaConfig] Erro ao carregar configurações:", err);
  }
});
