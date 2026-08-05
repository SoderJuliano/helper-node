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

function hookWebContents(webContents) {
  if (webContents._nexaHooked) return;
  webContents._nexaHooked = true;

  const originalSend = webContents.send;
  
  let streamParser = null;
  let rawStreamResponse = "";

  webContents.send = function(channel, ...args) {
    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : null;
    const isNexaOn = !!(nexaCfg && nexaCfg.enabled);

    if (isNexaOn) {
      if (channel === "gemini-stream-chunk") {
        if (!streamParser) {
          streamParser = new NexaJsonStreamParser();
          rawStreamResponse = "";
        }
        const chunk = args[0];
        rawStreamResponse += chunk;
        const cleanChunk = streamParser.processChunk(chunk);
        if (cleanChunk) {
          return originalSend.call(webContents, "gemini-stream-chunk", cleanChunk);
        }
        return; // Filtra para que o renderer não receba a estrutura do JSON
      }
      
      if (channel === "gemini-stream-complete") {
        if (streamParser) {
          const result = parseNexaResponse(rawStreamResponse, streamParser.responseText);
          handleNexaActions(result);
          streamParser = null;
        }
        return originalSend.call(webContents, "gemini-stream-complete");
      }

      if (channel === "gemini-response" || channel === "openai-final-response") {
        const payload = args[0]; // { resposta, usedKnowledge, ... }
        if (payload && payload.resposta) {
          const result = parseNexaResponse(payload.resposta);
          handleNexaActions(result);
          
          // Formata e substitui a resposta enviada ao renderer
          payload.resposta = helpers.formatToHTML(result.response);
        }
        return originalSend.call(webContents, channel, ...args);
      }
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
}

function handleCoreEventForNexa(channel, args) {
  // 1. Início/Fim da Gravação do Microfone
  if (channel === "toggle-recording" || channel === "renderer-toggle-recording") {
    const payload = args[1];
    if (payload && payload.isRecording === true) {
      nexaState.setState("LISTENING");
    } else if (payload && payload.isRecording === false) {
      if (nexaState.getState() === "LISTENING") {
        nexaState.setState("THINKING");
      }
    }
  }

  // 2. Transcrição / Erro de Áudio
  if (channel === "transcription-error") {
    if (nexaState.getState() !== "IDLE") {
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
    // Repassa também a payload do áudio TTS para a janela da Nexa se ela estiver aberta
    if (isNexaWindowOpen()) {
      const { state } = require("../globals.js");
      if (state.nexaWindow && !state.nexaWindow.isDestroyed()) {
        const audioData = args[1];
        try {
          state.nexaWindow.webContents.send("play-tts-audio", audioData);
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  setupNexaIntegration
};
