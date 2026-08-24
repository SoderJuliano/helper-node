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

// Tools e ações que contam como "mexendo em arquivo / código".
// Acionam o estado WORKING (animação de digitação em teclado digital).
const FILE_TOOLS = new Set([
  "readFile", "readFileChunk", "writeFile", "appendToFile", "patchFile",
  "deleteFile", "listDir", "fileInfo", "findFiles", "searchInFiles",
  "read_file", "read_file_chunk", "write_file", "write_to_file", "append_to_file",
  "patch_file", "replace_file_content", "delete_file", "list_dir", "file_info",
  "find_files", "find_by_name", "search_in_files", "grep_search", "view_file",
  "edit_file", "read_url_content", "save_file", "execute_code", "run_command"
]);

function isFileOrDevTool(toolName, toolLabel) {
  if (!toolName && !toolLabel) return true;
  const n = String(toolName || "").toLowerCase().trim();
  const l = String(toolLabel || "").toLowerCase().trim();

  if (FILE_TOOLS.has(toolName) || FILE_TOOLS.has(n)) return true;

  const keywords = [
    "file", "read", "write", "edit", "patch", "grep", "search", "save",
    "arquivo", "lendo", "escrevendo", "editando", "salvando", "substituindo",
    "modificando", "código", "code", "view", "find", "list", "replace"
  ];
  return keywords.some((kw) => n.includes(kw) || l.includes(kw));
}

// Segura o WORKING por um instante depois da última tool para transição suave
const WORKING_EXIT_DELAY_MS = 1200;

let activeFileTools = 0;
let stateBeforeWorking = null;
let workingExitTimer = null;

function onFileToolStart({ name, label } = {}) {
  if (!isFileOrDevTool(name, label)) return;

  activeFileTools++;
  if (workingExitTimer) {
    clearTimeout(workingExitTimer);
    workingExitTimer = null;
  }

  const current = nexaState.getState();
  if (current !== "WORKING" && current !== "SPEAKING") {
    stateBeforeWorking = current;
    nexaState.setState("WORKING");
  }
}

function onFileToolEnd({ name, label } = {}) {
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

  webContents.send = function(channel, ...args) {
    const nexaCfg = configService.getNexaConfig ? configService.getNexaConfig() : null;
    const isNexaOn = !!(nexaCfg && nexaCfg.enabled);

    // 1. Intercepta ai-tool-activity (Gemini CLI, Claude CLI, Copilot, Agentic)
    if (channel === "ai-tool-activity") {
      const act = args[0];
      if (act) {
        if (act.phase === "start") {
          onFileToolStart({ name: act.name || act.id, label: act.label });
        } else if (act.phase === "done" || act.phase === "error") {
          onFileToolEnd({ name: act.name || act.id, label: act.label });
        }
      }
    }

    // 2. Intercepta eventos específicos do Claude CLI e Gemini CLI
    if (channel === "claude-cli:tool-start" || channel === "gemini-cli:tool-start") {
      const toolInfo = args[0] || {};
      onFileToolStart({ name: toolInfo.name || toolInfo.id, label: toolInfo.label });
    } else if (channel === "claude-cli:tool-done" || channel === "gemini-cli:tool-done") {
      const toolInfo = args[0] || {};
      onFileToolEnd({ name: toolInfo.name || toolInfo.id, label: toolInfo.label });
    }

    // 3. Respostas textuais e ações da Nexa
    if (channel === "gemini-response" || channel === "openai-final-response" || channel === "claude-response") {
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
      if (activeFileTools === 0 && nexaState.getState() === "WORKING") {
        nexaState.setState("IDLE");
      }
      return originalSend.call(webContents, channel, ...args);
    }

    if (channel === "gemini-stream-end" || channel === "claude-stream-end") {
      if (activeFileTools === 0 && nexaState.getState() === "WORKING") {
        nexaState.setState("IDLE");
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
  BrowserWindow.getAllWindows().forEach((win) => {
    hookWebContents(win.webContents);
  });

  // Estado WORKING: escuta a execução de tools de arquivo no helperTools
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
    if (nexaState.getState() !== "SPEAKING" && nexaState.getState() !== "WORKING") {
      nexaState.setState("THINKING");
    }
  }

  // 4. Recebimento de Áudio do Google TTS
  if (channel === "play-tts-audio") {
    nexaState.setState("SPEAKING");
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

  // 5. Operações de leitura/escrita direta de arquivos no workspace / editor
  if (
    channel === "write-file-content" ||
    channel === "save-file-content" ||
    channel === "patch-file" ||
    channel === "create-file" ||
    channel === "delete-file"
  ) {
    onFileToolStart({ name: channel, label: "Arquivo modificado no workspace" });
    setTimeout(() => {
      onFileToolEnd({ name: channel, label: "Arquivo modificado no workspace" });
    }, 1500);
  }
}

module.exports = {
  setupNexaIntegration
};
