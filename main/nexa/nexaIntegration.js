/**
 * main/nexa/nexaIntegration.js
 * Camada de integração leve entre os eventos existentes do Helper Node e a Nexa.
 * Não altera nem substitui módulos legados; apenas reage a eventos e atualiza o nexaState.
 */

const { nexaState } = require("./nexaState.js");
const { sendStateToNexaWindow, isNexaWindowOpen } = require("./nexaWindow.js");
const { ipcMain, app, BrowserWindow } = require("electron");
const { NexaJsonStreamParser, parseNexaResponse, handleNexaActions } = require("./nexaResponseHelper.js");
const { configService, helpers } = require("../globals.js");

// Tools que contam como "mexendo em arquivo". Só estas acendem o WORKING —
// runCommand/runShellAdvanced (terminal), captura de tela e consultas de
// pacotes/apps ficam de fora de propósito: o pedido era ler e escrever ARQUIVO,
// não "app ocupado".
const FILE_TOOLS = new Set([
  "readFile", "readFileChunk", "writeFile", "appendToFile", "patchFile",
  "deleteFile", "listDir", "fileInfo", "findFiles", "searchInFiles"
]);

// Segura o WORKING por um instante depois da última tool. Sem isso, uma sequência
// típica (searchInFiles -> readFile -> writeFile) faria a animação piscar entre
// cada chamada, porque há milissegundos de folga entre uma e outra.
const WORKING_EXIT_DELAY_MS = 1200;

let activeFileTools = 0;
let stateBeforeWorking = null;
let workingExitTimer = null;

function onFileToolStart({ name } = {}) {
  if (!FILE_TOOLS.has(name)) return;

  activeFileTools++;
  if (workingExitTimer) {
    clearTimeout(workingExitTimer);
    workingExitTimer = null;
  }

  const current = nexaState.getState();
  // SPEAKING não é interrompido: a animação de fala acompanha um áudio que já
  // está tocando, e cortá-la no meio deixa a Nexa muda com a boca parada.
  if (current !== "WORKING" && current !== "SPEAKING") {
    stateBeforeWorking = current;
    nexaState.setState("WORKING");
  }
}

function onFileToolEnd({ name } = {}) {
  if (!FILE_TOOLS.has(name)) return;

  activeFileTools = Math.max(0, activeFileTools - 1);
  if (activeFileTools > 0) return;

  if (workingExitTimer) clearTimeout(workingExitTimer);
  workingExitTimer = setTimeout(() => {
    workingExitTimer = null;
    if (activeFileTools > 0) return;
    if (nexaState.getState() !== "WORKING") return;

    const back = stateBeforeWorking && stateBeforeWorking !== "WORKING" ? stateBeforeWorking : "IDLE";
    stateBeforeWorking = null;
    nexaState.setState(back);
  }, WORKING_EXIT_DELAY_MS);
}

function hookWebContents(webContents) {
  if (webContents._nexaHooked) return;
  webContents._nexaHooked = true;

  const originalSend = webContents.send;
  
  let streamParser = null;
  let rawStreamResponse = "";

  webContents.send = function(channel, ...args) {
    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : null;
    const isNexaOn = !!(nexaCfg && nexaCfg.enabled);



    if (channel === "gemini-response" || channel === "openai-final-response") {
      const payload = args[0];
      if (payload && typeof payload.resposta === "string" && (payload.resposta.includes('"response"') || payload.resposta.trim().startsWith("{"))) {
        const result = parseNexaResponse(payload.resposta);
        if (result && result.response) {
          if (isNexaOn) {
            handleNexaActions(result);
          }
          payload.resposta = helpers.formatToHTML(result.response);
        }
      }
      return originalSend.call(webContents, channel, ...args);
    }

    return originalSend.apply(webContents, arguments);
  };
}

function setupNexaIntegration() {
  // Sincroniza mudanças de estado com a janela da Nexa
  nexaState.on("state-changed", ({ state }) => {
    sendStateToNexaWindow(state);
  });

  // Intercepta emissões globais de IPC para detectar eventos do ciclo de áudio/IA
  const originalEmit = ipcMain.emit;
  ipcMain.emit = function (event, ...args) {
    if (typeof event === "string") {
      handleCoreEventForNexa(event, args);
    }
    return originalEmit.apply(ipcMain, arguments);
  };

  // Hook em todas as novas janelas do Electron
  app.on("browser-window-created", (event, win) => {
    hookWebContents(win.webContents);
  });

  // Hook nas janelas já ativas
  BrowserWindow.getAllWindows().forEach(win => {
    hookWebContents(win.webContents);
  });

  // Estado WORKING: escuta a execução de tools de arquivo. O helperTools expõe um
  // EventEmitter próprio (não IPC), então isto não acopla o service ao Electron.
  try {
    const helperTools = require("../../services/helperTools");
    if (helperTools && helperTools.events) {
      helperTools.events.on("tool-start", onFileToolStart);
      helperTools.events.on("tool-end", onFileToolEnd);
    }
  } catch (e) {
    console.warn("[NexaIntegration] Não foi possível escutar eventos do helperTools:", e.message);
  }
}

function handleCoreEventForNexa(channel, args) {
  // 1. Início/Fim da Gravação do Microfone e Transcrição
  if (channel === "toggle-recording" || channel === "renderer-toggle-recording") {
    const payload = args[1];
    if (payload && payload.isRecording === true) {
      nexaState.setState("LISTENING");
    } else if (payload && (payload.isRecording === false || payload.isTranscribing === true)) {
      if (nexaState.getState() === "LISTENING") {
        nexaState.setState("THINKING");
      }
    }
  }

  if (channel === "ide-audio-transcribing") {
    const payload = args[1];
    if (payload && payload.isTranscribing) {
      nexaState.setState("THINKING");
    }
  }

  // 2. Transcrição / Erro de Áudio
  if (channel === "ide-audio-transcribed" || channel === "transcription-error") {
    if (nexaState.getState() === "THINKING" || nexaState.getState() === "LISTENING") {
      nexaState.setState("IDLE");
    }
  }

  // 3. Envio de Prompt para a IA (Modo Streaming ou Convencional)
  if (
    channel === "send-to-gemini" ||
    channel === "send-to-gemini-stream" ||
    channel === "send-to-gemini-stream-auto" ||
    channel === "send-to-gemini-vision"
  ) {
    if (nexaState.getState() !== "SPEAKING") {
      nexaState.setState("THINKING");
    }
  }

  // 4. Recebimento de Áudio do Google TTS
  if (channel === "play-tts-audio") {
    nexaState.setState("SPEAKING");
    console.log("[DEBUG-TMP] play-tts-audio recebido. isNexaWindowOpen():", isNexaWindowOpen(), "args.length:", args.length, "args[1] keys:", args[1] && Object.keys(args[1]));
    // Repassa também a payload do áudio TTS para a janela da Nexa se ela estiver aberta
    if (isNexaWindowOpen()) {
      const { state } = require("../globals.js");
      if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
        const audioData = args[1];
        try {
          state.nexaWindow.webContents.send("play-tts-audio", audioData);
          console.log("[DEBUG-TMP] forward para nexaWindow enviado com sucesso.");
        } catch (e) {
          console.log("[DEBUG-TMP] ERRO ao enviar para nexaWindow:", e.message);
        }
      } else {
        console.log("[DEBUG-TMP] nexaWindow ausente ou destruída no momento do forward.");
      }
    }
  }
}

module.exports = {
  setupNexaIntegration
};
