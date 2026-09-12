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

// Tools de busca na web e acesso à internet -> acionam o estado SEARCHING (globo holográfico).
const SEARCH_TOOLS = new Set([
  "search_web", "read_url_content", "browse_web", "web_search", "google_search",
  "fetch_web", "tavily", "tavily_search", "duckduckgo", "weather", "get_weather",
  "web_browser", "read_browser_page", "search_internet", "internet_search", "web_fetch"
]);

function isWebSearchTool(toolName, toolLabel) {
  if (!toolName && !toolLabel) return false;
  const n = String(toolName || "").toLowerCase().trim();
  const l = String(toolLabel || "").toLowerCase().trim();

  if (SEARCH_TOOLS.has(toolName) || SEARCH_TOOLS.has(n)) return true;

  const keywords = [
    "search_web", "read_url", "web_search", "google_search", "pesquisando na web",
    "lendo página web", "busca na web", "acessando internet", "pesquisa na internet",
    "previsão do tempo", "clima", "weather", "internet search", "browse_page", "search_engine"
  ];
  return keywords.some((kw) => n.includes(kw) || l.includes(kw));
}

// Tools e ações que contam como "mexendo em arquivo / código local".
// Acionam o estado WORKING (animação de digitação em teclado digital).
const FILE_TOOLS = new Set([
  "readFile", "readFileChunk", "writeFile", "appendToFile", "patchFile",
  "deleteFile", "listDir", "fileInfo", "findFiles", "searchInFiles",
  "read_file", "read_file_chunk", "write_file", "write_to_file", "append_to_file",
  "patch_file", "replace_file_content", "delete_file", "list_dir", "file_info",
  "find_files", "find_by_name", "search_in_files", "grep_search", "view_file",
  "edit_file", "save_file", "execute_code", "run_command"
]);

function isFileOrDevTool(toolName, toolLabel) {
  if (isWebSearchTool(toolName, toolLabel)) return false;
  if (!toolName && !toolLabel) return true;
  const n = String(toolName || "").toLowerCase().trim();
  const l = String(toolLabel || "").toLowerCase().trim();

  if (FILE_TOOLS.has(toolName) || FILE_TOOLS.has(n)) return true;

  const keywords = [
    "file", "read", "write", "edit", "patch", "grep", "search_in_files", "save",
    "arquivo", "lendo arquivo", "escrevendo", "editando", "salvando", "substituindo",
    "modificando", "código", "code", "view", "find", "list", "replace"
  ];
  return keywords.some((kw) => n.includes(kw) || l.includes(kw));
}

// Segura o WORKING e SEARCHING por um instante depois da última tool para transição suave
const WORKING_EXIT_DELAY_MS = 1200;
const SEARCH_EXIT_DELAY_MS = 1000;

let activeFileTools = 0;
let stateBeforeWorking = null;
let workingExitTimer = null;

let activeSearchTools = 0;
let stateBeforeSearch = null;
let searchExitTimer = null;

function onSearchToolStart({ name, label } = {}) {
  if (!isWebSearchTool(name, label)) return;

  activeSearchTools++;
  if (searchExitTimer) {
    clearTimeout(searchExitTimer);
    searchExitTimer = null;
  }

  const current = nexaState.getState();
  if (current !== "SEARCHING" && current !== "SPEAKING") {
    stateBeforeSearch = current;
    nexaState.setState("SEARCHING");
  }
}

function onSearchToolEnd({ name, label } = {}) {
  activeSearchTools = Math.max(0, activeSearchTools - 1);
  if (activeSearchTools > 0) return;

  if (searchExitTimer) clearTimeout(searchExitTimer);
  searchExitTimer = setTimeout(() => {
    searchExitTimer = null;
    if (activeSearchTools > 0) return;
    if (nexaState.getState() !== "SEARCHING") return;

    const back = stateBeforeSearch && stateBeforeSearch !== "SEARCHING" ? stateBeforeSearch : "IDLE";
    stateBeforeSearch = null;
    nexaState.setState(back);
  }, SEARCH_EXIT_DELAY_MS);
}

function onFileToolStart({ name, label } = {}) {
  if (isWebSearchTool(name, label)) {
    return onSearchToolStart({ name, label });
  }
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
  if (isWebSearchTool(name, label)) {
    return onSearchToolEnd({ name, label });
  }
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
        const toolName = act.name || act.id;
        const toolLabel = act.label;
        if (isWebSearchTool(toolName, toolLabel)) {
          if (act.phase === "start") {
            onSearchToolStart({ name: toolName, label: toolLabel });
          } else if (act.phase === "done" || act.phase === "error") {
            onSearchToolEnd({ name: toolName, label: toolLabel });
          }
        } else {
          if (act.phase === "start") {
            onFileToolStart({ name: toolName, label: toolLabel });
          } else if (act.phase === "done" || act.phase === "error") {
            onFileToolEnd({ name: toolName, label: toolLabel });
          }
        }
      }
    }

    // 2. Intercepta eventos específicos do Claude CLI e Gemini CLI
    if (channel === "claude-cli:tool-start" || channel === "gemini-cli:tool-start") {
      const toolInfo = args[0] || {};
      const toolName = toolInfo.name || toolInfo.id;
      const toolLabel = toolInfo.label;
      if (isWebSearchTool(toolName, toolLabel)) {
        onSearchToolStart({ name: toolName, label: toolLabel });
      } else {
        onFileToolStart({ name: toolName, label: toolLabel });
      }
    } else if (channel === "claude-cli:tool-done" || channel === "gemini-cli:tool-done") {
      const toolInfo = args[0] || {};
      const toolName = toolInfo.name || toolInfo.id;
      const toolLabel = toolInfo.label;
      if (isWebSearchTool(toolName, toolLabel)) {
        onSearchToolEnd({ name: toolName, label: toolLabel });
      } else {
        onFileToolEnd({ name: toolInfo.name || toolInfo.id, label: toolInfo.label });
      }
    }

    // 3. Respostas textuais e ações da Nexa
    if (channel === "gemini-response" || channel === "openai-final-response" || channel === "claude-response") {
      const payload = args[0];
      if (payload && typeof payload.resposta === "string") {
        if (payload.resposta.includes('"response"') || payload.resposta.trim().startsWith("{")) {
          const result = parseNexaResponse(payload.resposta);
          if (result && result.response) {
            if (isNexaOn) {
              handleNexaActions(result);
            }
            payload.resposta = helpers.formatToHTML(result.response);
          }
        } else if (isNexaOn) {
          const NexaResponseFilter = require("../../services/nexaVoiceAssistant/nexaResponseFilter.js");
          const filterResult = NexaResponseFilter.processResponse(payload.resposta);
          if (filterResult && filterResult.animation && filterResult.animation !== "speaking") {
            handleNexaActions({ animation: filterResult.animation });
          }
          if (filterResult && filterResult.displayText && filterResult.displayText !== payload.resposta) {
            payload.resposta = helpers.formatToHTML ? helpers.formatToHTML(filterResult.displayText) : filterResult.displayText;
          }
        }
      }
      if (activeFileTools === 0 && nexaState.getState() === "WORKING") {
        nexaState.setState("IDLE");
      }
      if (activeSearchTools === 0 && nexaState.getState() === "SEARCHING") {
        nexaState.setState("IDLE");
      }
      return originalSend.call(webContents, channel, ...args);
    }

    if (channel === "gemini-stream-end" || channel === "claude-stream-end") {
      if (activeFileTools === 0 && nexaState.getState() === "WORKING") {
        nexaState.setState("IDLE");
      }
      if (activeSearchTools === 0 && nexaState.getState() === "SEARCHING") {
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
  }

  // 6. Eventos de pesquisa na web / consulta externa
  if (
    channel === "web-search-start" ||
    channel === "search-web-start" ||
    channel === "internet-search-start"
  ) {
    onSearchToolStart({ name: channel, label: "Pesquisa na web iniciada" });
  }

  if (
    channel === "web-search-end" ||
    channel === "search-web-end" ||
    channel === "internet-search-end"
  ) {
    onSearchToolEnd({ name: channel, label: "Pesquisa na web concluída" });
  }
}

module.exports = {
  setupNexaIntegration,
  onSearchToolStart,
  onSearchToolEnd,
  isWebSearchTool
};
