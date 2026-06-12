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
    ipcRenderer.on("gemini-response", (event, { resposta }) => {
      callback(resposta);
    });
  },
  onOpenAIResponse: (callback) => {
    ipcRenderer.on("openai-final-response", (event, { resposta }) => {
      callback(resposta);
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
  sendTextToGemini: (text) => ipcRenderer.send("send-to-gemini", text),
  sendTextToGeminiStream: (text) => ipcRenderer.send("send-to-gemini-stream", text),
  onAutoStream: (callback) =>
    ipcRenderer.on("send-to-gemini-stream-auto", (event, text) => callback(text)),
  getAiModel: () => ipcRenderer.invoke("get-ai-model"),
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
  resizeOverlay: (height) => ipcRenderer.send("resize-overlay", height),
  copyToClipboard: (text) => ipcRenderer.send("copy-to-clipboard", text),
  // Region select overlay → main
  regionSelected: (rect) => ipcRenderer.send("region-selected", rect),
  regionCancelled: () => ipcRenderer.send("region-cancelled"),

  // History Service methods
  addMessage: (sessionId, role, content) => ipcRenderer.invoke("add-message", sessionId, role, content),
  createNewSession: (title) => ipcRenderer.invoke("create-new-session", title),
  getLastThreeSessions: () => ipcRenderer.invoke("get-last-three-sessions"),
  getSessionById: (id) => ipcRenderer.invoke("get-session-by-id", id),
  downloadConversationTxt: (sessionId) => ipcRenderer.invoke("download-conversation-txt", sessionId),
  newChat: () => ipcRenderer.invoke("new-chat"),
  deleteSession: (sessionId) => ipcRenderer.invoke("delete-session", sessionId),

  // Confirmacao de acoes destrutivas (systemPowerAction etc.)
  confirmActionRespond: (requestId, ok) =>
    ipcRenderer.send("confirm-action-respond", { requestId, ok }),

  // === Workspace (anexos pra contexto da IA) ===
  workspacePickFile: () => ipcRenderer.invoke("workspace:pick-file"),
  workspacePickDir: () => ipcRenderer.invoke("workspace:pick-dir"),
  workspaceList: () => ipcRenderer.invoke("workspace:list"),
  workspaceRemove: (id) => ipcRenderer.invoke("workspace:remove", id),
  workspaceClear: () => ipcRenderer.invoke("workspace:clear"),
  workspaceOpenExternal: (p) => ipcRenderer.invoke("workspace:open-external", p),
  getWorkspaceAccessEnabled: () => ipcRenderer.invoke("get-workspace-access-enabled"),
  onWorkspaceChanged: (cb) =>
    ipcRenderer.on("workspace-changed", (event, data) => cb(data)),
  onWorkspaceFileWritten: (cb) =>
    ipcRenderer.on("workspace-file-written", (event, data) => cb(data)),

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
  onTranslationClear: (cb) =>
    ipcRenderer.on("translation-clear", () => cb()),
  translationStart: () => ipcRenderer.invoke("translation-start"),
  translationStop: () => ipcRenderer.invoke("translation-stop"),
  // Overlay dedicado (translation-overlay.html)
  requestTranslationResize: () =>
    ipcRenderer.send("request-translation-resize"),
  overlayPosition: (pos) => ipcRenderer.send('overlay-position', pos),
});
