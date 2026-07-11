const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  onToggleRecording: (callback) => ipcRenderer.on("toggle-recording", callback),
  onCapturingScreen: (callback) => ipcRenderer.on("screen-capturing", callback),
  onCaptureScreen: (callback) => ipcRenderer.on("capture-screen", callback),
  onSharingStatus: (callback) => ipcRenderer.on("sharing-status", callback),
  onManualInput: (callback) => ipcRenderer.on("manual-input", callback),
  onDebugStatusChanged: (callback) =>
    ipcRenderer.on("debug-status-changed", (event, status) => callback(status)),
  onTranscriptionResult: (callback) => {
    ipcRenderer.on("transcription-result", (event, { cleanText }) => {
      callback(cleanText);
    });
  },
  onTranscriptionError: (callback) => {
    ipcRenderer.on("transcription-error", (event, message) => {
      callback(message);
    });
  },
  onTranscriptionStart: (callback) => {
    ipcRenderer.on("transcription-start", (event, { audioFilePath }) => {
      callback(audioFilePath);
    });
  },
  onIaResponse: (callback) => {
    // ipcRenderer.on('llama-response', (event, { resposta }) => {
    //     callback(resposta);
    // });
    ipcRenderer.on("gemini-response", (event, { resposta, usedKnowledge }) => {
      callback(resposta, usedKnowledge);
    });
  },
  onOpenAIResponse: (callback) => {
    ipcRenderer.on("openai-final-response", (event, { resposta, usedKnowledge }) => {
      callback(resposta, usedKnowledge);
    });
  },
  onStreamChunk: (callback) => 
    ipcRenderer.on("gemini-stream-chunk", (event, chunk) => callback(chunk)),
  onStreamComplete: (callback) => 
    ipcRenderer.on("gemini-stream-complete", () => callback()),
  onOcrResult: (callback) =>
    ipcRenderer.on("ocr-result", (event, data) => callback(data)),
  onRealtimeAssistantUpdate: (callback) =>
    ipcRenderer.on("realtime-assistant-update", (event, data) => callback(data)),
  // sendTextToLlama: (text) => ipcRenderer.send('send-to-llama', text),
  sendTextToGemini: (text, sessionId) => ipcRenderer.send("send-to-gemini", text, sessionId),
  // Manda a IMAGEM (data URL base64) + enunciado pro modelo de visão (gpt-4o).
  // Usado quando o usuário cola/captura uma imagem no chat e o backend é OpenAI.
  sendVisionToGemini: (text, image) =>
    ipcRenderer.send("send-to-gemini-vision", { text, image }),
  sendTextToGeminiStream: (text, sessionId) => ipcRenderer.send("send-to-gemini-stream", text, sessionId),
  onAutoStream: (callback) =>
    ipcRenderer.on("send-to-gemini-stream-auto", (event, text) => callback(text)),
  // Estado do auto-close da janela 'response', decidido pelo main (cursor por
  // posição global). { state: 'paused' } | { state: 'running', ms }
  onAutoCloseState: (callback) =>
    ipcRenderer.on("autoclose-state", (event, data) => callback(data)),
  getAiModel: () => ipcRenderer.invoke("get-ai-model"),
  getOpenaiModel: () => ipcRenderer.invoke("get-openai-model"),
  setOpenaiModel: (model) => ipcRenderer.send("set-openai-model", model),
  // Claude Code CLI provider
  getClaudeCliModel: () => ipcRenderer.invoke("get-claude-cli-model"),
  setClaudeCliModel: (model) => ipcRenderer.send("set-claude-cli-model", model),
  getClaudeCliModels: () => ipcRenderer.invoke("get-claude-cli-models"),
  checkClaudeCliInstalled: () => ipcRenderer.invoke("check-claude-cli-installed"),
  claudeCliRestartSession: () => ipcRenderer.invoke("claude-cli-restart-session"),
  onClaudeCliStatus: (cb) => ipcRenderer.on("claude-cli-status", (event, data) => cb(data)),
  // Gemini CLI provider
  getGeminiCliModel: () => ipcRenderer.invoke("get-gemini-cli-model"),
  setGeminiCliModel: (model) => ipcRenderer.send("set-gemini-cli-model", model),
  getGeminiCliModels: () => ipcRenderer.invoke("get-gemini-cli-models"),
  checkGeminiCliInstalled: () => ipcRenderer.invoke("check-gemini-cli-installed"),
  geminiCliRestartSession: () => ipcRenderer.invoke("gemini-cli-restart-session"),
  onGeminiCliStatus: (cb) => ipcRenderer.on("gemini-cli-status", (event, data) => cb(data)),
  getEdition: () => ipcRenderer.invoke("get-edition"),
  openConfig: () => ipcRenderer.send("open-config-ui"),
  stopNotifications: () => ipcRenderer.send("stop-notifications"),
  startNotifications: () => ipcRenderer.send("start-notifications"),
  cancelIaRequest: () => ipcRenderer.send("cancel-ia-request"),
  isHyprland: () => ipcRenderer.invoke("is-hyprland"),
  getAvailableShortcuts: () => ipcRenderer.invoke("get-available-shortcuts"),
  onShortcutsChanged: (callback) => ipcRenderer.on("shortcuts-changed", () => callback()),
  getDebugModeStatus: () => ipcRenderer.invoke("get-debug-mode-status"), // Added for debug mode access
  getPromptInstruction: () => ipcRenderer.invoke("get-prompt-instruction"), // Added for prompt instruction access
  getBackendApiKey: () => ipcRenderer.invoke("get-backend-api-key"),
  saveBackendApiKey: (key) => ipcRenderer.send("save-backend-api-key", key),
  getBackendUrl: () => ipcRenderer.invoke("get-backend-url"),
  getLanguage: () => ipcRenderer.invoke("get-language"),
  setLanguage: (language) => ipcRenderer.send("set-language", language),
  processPastedImage: (base64Image) =>
    ipcRenderer.send("process-pasted-image", base64Image),
  processManualInputWithImage: (data) =>
    ipcRenderer.send("process-manual-input-with-image", data),
  
  // OS Integration methods
  closeOsInput: () => ipcRenderer.send("close-os-input"),
  sendOsQuestion: (text, image) => ipcRenderer.send("send-os-question", { text, image }),
  cancelRecording: () => ipcRenderer.send("cancel-recording"),
  // Fallback pra Wayland onde global shortcuts falham: renderer aciona gravação.
  triggerToggleRecording: () => ipcRenderer.send("renderer-toggle-recording"),
  resizeOverlay: (height) => ipcRenderer.send("resize-overlay", height),
  copyToClipboard: (text) => ipcRenderer.send("copy-to-clipboard", text),
  // Region select overlay → main
  regionSelected: (rect) => ipcRenderer.send("region-selected", rect),
  regionCancelled: () => ipcRenderer.send("region-cancelled"),

  // History Service methods
  addMessage: (sessionId, role, content) => ipcRenderer.invoke("add-message", sessionId, role, content),
  createNewSession: (title) => ipcRenderer.invoke("create-new-session", title),
  getLastThreeSessions: () => ipcRenderer.invoke("get-last-three-sessions"),
  getAllSessions: () => ipcRenderer.invoke("get-all-sessions"),
  seedAiSession: (messages) => ipcRenderer.invoke("seed-ai-session", messages),
  getSessionById: (id) => ipcRenderer.invoke("get-session-by-id", id),
  downloadConversationTxt: (sessionId) => ipcRenderer.invoke("download-conversation-txt", sessionId),
  newChat: () => ipcRenderer.invoke("new-chat"),
  deleteSession: (sessionId) => ipcRenderer.invoke("delete-session", sessionId),

  // Confirmacao de acoes destrutivas (systemPowerAction etc.)
  confirmActionRespond: (requestId, ok, always) =>
    ipcRenderer.send("confirm-action-respond", { requestId, ok, always }),

  // === Workspace (anexos pra contexto da IA) ===
  workspacePickFile: () => ipcRenderer.invoke("workspace:pick-file"),
  workspacePickDir: () => ipcRenderer.invoke("workspace:pick-dir"),
  workspaceList: () => ipcRenderer.invoke("workspace:list"),
  getProjectContext: () => ipcRenderer.invoke("get-project-context"),
  getProjectTree: () => ipcRenderer.invoke("get-project-tree"),
  searchProjectContent: (query) => ipcRenderer.invoke("search-project-content", query),
  readFileContent: (p) => ipcRenderer.invoke("read-file-content", p),
  getFileDiff: (payload) => ipcRenderer.invoke("get-file-diff", payload),
  renameItem: (oldPath, newPath) => ipcRenderer.invoke("workspace:rename-item", { oldPath, newPath }),
  moveItem: (srcPath, destPath) => ipcRenderer.invoke("workspace:move-item", { srcPath, destPath }),
  // === Editor de código (#file-viewer) ===
  editorSaveFile: (payload) => ipcRenderer.invoke("editor-save-file", payload),
  // Notifica o editor de qualquer mutação de arquivo (humano, OpenAI, Claude
  // Code CLI, Gemini CLI) — usado só pro indicativo de concorrência em tempo
  // real, nunca pra bloquear nada.
  onFileMutated: (cb) => ipcRenderer.on("file-mutated", (event, data) => cb(data)),
  workspaceRemove: (id) => ipcRenderer.invoke("workspace:remove", id),
  workspaceClear: () => ipcRenderer.invoke("workspace:clear"),
  workspaceOpenExternal: (p) => ipcRenderer.invoke("workspace:open-external", p),
  getWorkspaceAccessEnabled: () => ipcRenderer.invoke("get-workspace-access-enabled"),
  onWorkspaceChanged: (cb) =>
    ipcRenderer.on("workspace-changed", (event, data) => cb(data)),
  onWorkspaceFileWritten: (cb) =>
    ipcRenderer.on("workspace-file-written", (event, data) => cb(data)),
  // Configurações (janela separada) pede pra abrir um arquivo (ex.: base de
  // conhecimento) no visualizador desta janela.
  onOpenFileInViewer: (cb) =>
    ipcRenderer.on("open-file-in-viewer", (event, filePath) => cb(filePath)),
  onAiToolActivity: (cb) =>
    ipcRenderer.on("ai-tool-activity", (event, data) => cb(data)),

  // === Agentic Workflow (multi-phase) ===
  onAgenticPhaseUpdate: (cb) =>
    ipcRenderer.on("agentic-phase-update", (event, data) => cb(data)),
  onAgenticDebugInfo: (cb) =>
    ipcRenderer.on("agentic-debug-info", (event, data) => cb(data)),
  stopAgenticWorkflow: (sessionId) =>
    ipcRenderer.send("stop-agentic-workflow", sessionId),
  clearAiSessions: () => ipcRenderer.send("clear-ai-sessions"),

  // === Assistente de Tradução ===
  onTranslationResult: (cb) =>
    ipcRenderer.on("translation-result", (event, data) => cb(data)),
  onTranslationStatus: (cb) =>
    ipcRenderer.on("translation-status", (_e, status) => cb(status)),
  onTranslationLevel: (cb) =>
    ipcRenderer.on("translation-level", (_e, data) => cb(data)),
  onTranslationLoading: (cb) =>
    ipcRenderer.on("translation-loading", (_e, loading) => cb(loading)),
  onTranslationClear: (cb) =>
    ipcRenderer.on("translation-clear", () => cb()),
  translationStart: () => ipcRenderer.invoke("translation-start"),
  translationStop: () => ipcRenderer.invoke("translation-stop"),
  getAudioInputDevices: () => ipcRenderer.invoke("get-audio-input-devices"),
  // Overlay dedicado (translation-overlay.html)
  requestTranslationResize: () =>
    ipcRenderer.send("request-translation-resize"),
  overlayPosition: (pos) => ipcRenderer.send('overlay-position', pos),
});
