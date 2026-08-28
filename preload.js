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
  // Modo IDE (pasta/arquivos anexados no sidebar): Ctrl+D transcreve o áudio
  // via Whisper mas NÃO envia sozinho pra IA — o texto vai pro composer pra
  // o usuário revisar/editar e enviar manualmente (Shift+Enter ou botão).
  onIdeAudioTranscribing: (callback) => {
    ipcRenderer.on("ide-audio-transcribing", (event, data) => callback(data));
  },
  onIdeAudioTranscribed: (callback) => {
    ipcRenderer.on("ide-audio-transcribed", (event, { text }) => callback(text));
  },
  cancelRecording: () => ipcRenderer.send("renderer-cancel-recording"),
  onTranscriptionError: (callback) => {
    ipcRenderer.on("transcription-error", (event, err) => callback(err));
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
  setAiModel: (model) => ipcRenderer.send("set-ai-model", model),
  getOpenaiModel: () => ipcRenderer.invoke("get-openai-model"),
  setOpenaiModel: (model) => ipcRenderer.send("set-openai-model", model),
  getOpenaiReasoningEffort: () => ipcRenderer.invoke("get-openai-reasoning-effort"),
  setOpenaiReasoningEffort: (effort) => ipcRenderer.send("set-openai-reasoning-effort", effort),
  getOpenaiVisionModel: () => ipcRenderer.invoke("get-openai-vision-model"),
  setOpenaiVisionModel: (model) => ipcRenderer.send("set-openai-vision-model", model),
  getOllamaLocalModel: () => ipcRenderer.invoke("get-ollama-local-model"),
  setOllamaLocalModel: (model) => ipcRenderer.send("set-ollama-local-model", model),
  checkOllamaLocalStatus: () => ipcRenderer.invoke("check-ollama-local-status"),
  onAiModelChanged: (cb) => ipcRenderer.on("ai-model-changed", (event, data) => cb(data)),
  // Claude Code CLI provider
  getClaudeCliModel: () => ipcRenderer.invoke("get-claude-cli-model"),
  setClaudeCliModel: (model) => ipcRenderer.send("set-claude-cli-model", model),
  getClaudeCliModels: () => ipcRenderer.invoke("get-claude-cli-models"),
  checkClaudeCliInstalled: () => ipcRenderer.invoke("check-claude-cli-installed"),
  claudeCliRestartSession: () => ipcRenderer.invoke("claude-cli-restart-session"),
  onClaudeCliStatus: (cb) => ipcRenderer.on("claude-cli-status", (event, data) => cb(data)),
  // GitHub Copilot CLI provider
  getCopilotCliModel: () => ipcRenderer.invoke("get-copilot-cli-model"),
  setCopilotCliModel: (model) => ipcRenderer.send("set-copilot-cli-model", model),
  getCopilotCliModels: () => ipcRenderer.invoke("get-copilot-cli-models"),
  checkCopilotCliInstalled: () => ipcRenderer.invoke("check-copilot-cli-installed"),
  onCopilotCliStatus: (cb) => ipcRenderer.on("copilot-cli-status", (event, data) => cb(data)),
  // Gemini CLI provider
  getGeminiCliModel: () => ipcRenderer.invoke("get-gemini-cli-model"),
  setGeminiCliModel: (model) => ipcRenderer.send("set-gemini-cli-model", model),
  getGeminiCliModels: (force) => ipcRenderer.invoke("get-gemini-cli-models", force),
  checkGeminiCliInstalled: () => ipcRenderer.invoke("check-gemini-cli-installed"),
  geminiCliRestartSession: () => ipcRenderer.invoke("gemini-cli-restart-session"),
  onGeminiCliStatus: (cb) => ipcRenderer.on("gemini-cli-status", (event, data) => cb(data)),
  getBackendModel: () => ipcRenderer.invoke("get-backend-model"),
  setBackendModel: (model) => ipcRenderer.send("set-backend-model", model),
  getEdition: () => ipcRenderer.invoke("get-edition"),
  openConfig: () => ipcRenderer.send("open-config-ui"),
  stopNotifications: () => ipcRenderer.send("stop-notifications"),
  startNotifications: () => ipcRenderer.send("start-notifications"),
  cancelIaRequest: () => ipcRenderer.send("cancel-ia-request"),
  isHyprland: () => ipcRenderer.invoke("is-hyprland"),
  getAvailableShortcuts: () => ipcRenderer.invoke("get-available-shortcuts"),
  // Navegação de Código (Go to Definition / Implementações / Usages)
  codeNavFindDefinition: (payload) => ipcRenderer.invoke("code-nav-find-definition", payload),
  codeNavFindUsages: (payload) => ipcRenderer.invoke("code-nav-find-usages", payload),
  codeNavGetImplementations: (payload) => ipcRenderer.invoke("code-nav-get-implementations", payload),
  codeNavGetGutterInfo: (payload) => ipcRenderer.invoke("code-nav-get-gutter-info", payload),
  codeNavReindex: (payload) => ipcRenderer.invoke("code-nav-reindex", payload),
  // Checador de Imports (sublinhado vermelho + auto-import, JS/TS e Java)
  importCheckGetDiagnostics: (payload) => ipcRenderer.invoke("import-check-get-diagnostics", payload),
  importCheckGetQuickFixes: (payload) => ipcRenderer.invoke("import-check-get-quickfixes", payload),
  importCheckGetJavaStatus: (payload) => ipcRenderer.invoke("import-check-get-java-status", payload),
  // Dependências Java (nó "Dependencies" da árvore — Maven/Gradle)
  javaDepsListJars: (payload) => ipcRenderer.invoke("java-deps:list-jars", payload),
  javaDepsListClasses: (payload) => ipcRenderer.invoke("java-deps:list-classes", payload),
  javaDepsDetect: (payload) => ipcRenderer.invoke("java-deps:detect", payload),
  javaDepsSync: (payload) => ipcRenderer.invoke("java-deps:sync", payload),
  javaDepsGetSyncLog: (payload) => ipcRenderer.invoke("java-deps:get-sync-log", payload),
  onJavaDepsChanged: (cb) => ipcRenderer.on("java-deps-changed", (event, data) => cb(data)),
  onShortcutsChanged: (callback) => ipcRenderer.on("shortcuts-changed", () => callback()),
  getDebugModeStatus: () => ipcRenderer.invoke("get-debug-mode-status"), // Added for debug mode access
  getStealthModeStatus: () => ipcRenderer.invoke("get-stealth-mode-status"),
  saveStealthModeStatus: (status) => ipcRenderer.send("save-stealth-mode-status", status),
  getPromptInstruction: () => ipcRenderer.invoke("get-prompt-instruction"), // Added for prompt instruction access
  getOpeniaToken: () => ipcRenderer.invoke("get-open-ia-token"),
  getBackendApiKey: () => ipcRenderer.invoke("get-backend-api-key"),
  saveBackendApiKey: (key) => ipcRenderer.send("save-backend-api-key", key),
  getBackendUrl: () => ipcRenderer.invoke("get-backend-url"),
  getLanguage: () => ipcRenderer.invoke("get-language"),
  setLanguage: (language) => ipcRenderer.send("set-language", language),

  // === Modo Interativo de Voz (Google TTS) ===
  getGoogleTtsConfig: () => ipcRenderer.invoke("get-google-tts-config"),
  saveGoogleTtsConfig: (cfg) => ipcRenderer.send("save-google-tts-config", cfg),
  googleTtsTest: (keyPathOrKey) => ipcRenderer.invoke("google-tts-test", keyPathOrKey),
  googleTtsListVoices: (keyPathOrKey) => ipcRenderer.invoke("google-tts-list-voices", keyPathOrKey),
  onPlayTtsAudio: (cb) => ipcRenderer.on("play-tts-audio", (event, data) => cb(data)),
  triggerTtsPlayback: (text) => ipcRenderer.send("trigger-tts-stream-playback", text),
  processPastedImage: (base64Image) =>
    ipcRenderer.send("process-pasted-image", base64Image),
  // Modo IDE: imagem colada vira ANEXO (caminho), não texto no input.
  isIdeProjectMode: () => ipcRenderer.invoke("is-ide-project-mode"),
  onImageAttached: (cb) => ipcRenderer.on("image-attached", (event, data) => cb(data)),
  // Lê a imagem direto do clipboard do SO. Necessário porque o evento `paste`
  // do Chromium só dispara quando já existe campo editável em foco — na tela
  // hero não há, e sem isso "Ctrl+V não anexa nada".
  readClipboardImage: () => ipcRenderer.invoke("read-clipboard-image"),
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
  readClipboardText: () => ipcRenderer.invoke("read-clipboard-text"),
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
  renameSession: (sessionId, newTitle) => ipcRenderer.invoke("rename-session", sessionId, newTitle),

  // Confirmacao de acoes destrutivas (systemPowerAction etc.)
  confirmActionRespond: (requestId, ok, always) =>
    ipcRenderer.send("confirm-action-respond", { requestId, ok, always }),

  // === Workspace (anexos pra contexto da IA) ===
  workspacePickFile: () => ipcRenderer.invoke("workspace:pick-file"),
  workspacePickDir: () => ipcRenderer.invoke("workspace:pick-dir"),
  workspaceList: () => ipcRenderer.invoke("workspace:list"),
  workspaceAddPath: (path, type) => ipcRenderer.invoke("workspace:add-path", { path, type }),
  getProjectContext: () => ipcRenderer.invoke("get-project-context"),
  getProjectGitStatus: () => ipcRenderer.invoke("get-project-git-status"),
  getProjectTree: () => ipcRenderer.invoke("get-project-tree"),
  getDirChildren: (dirPath) => ipcRenderer.invoke("get-dir-children", dirPath),
  searchProjectContent: (query) => ipcRenderer.invoke("search-project-content", query),
  readFileContent: (p) => ipcRenderer.invoke("read-file-content", p),
  getFileDiff: (payload) => ipcRenderer.invoke("get-file-diff", payload),
  renameItem: (oldPath, newPath) => ipcRenderer.invoke("workspace:rename-item", { oldPath, newPath }),
  moveItem: (srcPath, destPath) => ipcRenderer.invoke("workspace:move-item", { srcPath, destPath }),
  createFile: (filePath, content = "") => ipcRenderer.invoke("workspace:create-file", { filePath, content }),
  createDir: (dirPath) => ipcRenderer.invoke("workspace:create-dir", { dirPath }),
  deleteItems: (paths) => ipcRenderer.invoke("workspace:delete-items", { paths }),
  pickParentDir: () => ipcRenderer.invoke("workspace:pick-parent-dir"),
  createAndOpenProject: (parentPath, folderName) => ipcRenderer.invoke("workspace:create-and-open-project", { parentPath, folderName }),
  // === Editor de código (#file-viewer) ===
  editorSaveFile: (payload) => ipcRenderer.invoke("editor-save-file", payload),
  // Notifica o editor de qualquer mutação de arquivo (humano, OpenAI, Claude
  // Code CLI, Gemini CLI) — usado só pro indicativo de concorrência em tempo
  // real, nunca pra bloquear nada.
  onFileMutated: (cb) => ipcRenderer.on("file-mutated", (event, data) => cb(data)),
  onGitStatusChanged: (cb) => ipcRenderer.on("git-status-changed", (event, data) => cb(data)),
  workspaceRemove: (id) => ipcRenderer.invoke("workspace:remove", id),
  workspaceClear: () => ipcRenderer.invoke("workspace:clear"),
  workspaceOpenExternal: (p) => ipcRenderer.invoke("workspace:open-external", p),
  getWorkspaceAccessEnabled: () => ipcRenderer.invoke("get-workspace-access-enabled"),
  onWorkspaceChanged: (cb) =>
    ipcRenderer.on("workspace-changed", (event, data) => cb(data)),
  onWorkspaceFileWritten: (cb) =>
    ipcRenderer.on("workspace-file-written", (event, data) => cb(data)),
  onSymbolIndexerStatus: (cb) =>
    ipcRenderer.on("symbol-indexer-status", (event, data) => cb(data)),
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
  getMicDevice: () => ipcRenderer.invoke("get-mic-device"),
  setMicDevice: (deviceId) => ipcRenderer.send("set-mic-device", deviceId),
  // Overlay dedicado (translation-overlay.html)
  requestTranslationResize: () =>
    ipcRenderer.send("request-translation-resize"),
  overlayPosition: (pos) => ipcRenderer.send('overlay-position', pos),

  // === Assistente Guiado por Visão (vision-guide-overlay.html) ===
  onVisionGuideMessage: (cb) =>
    ipcRenderer.on("vision-guide-message", (_e, data) => cb(data)),
  onVisionGuideStatus: (cb) =>
    ipcRenderer.on("vision-guide-status", (_e, status) => cb(status)),
  onVisionGuideClear: (cb) =>
    ipcRenderer.on("vision-guide-clear", () => cb()),
  requestVisionGuideResize: () =>
    ipcRenderer.send("request-vision-guide-resize"),
  // Minimiza o overlay do tutor temporariamente (safe point). Ele restaura
  // sozinho na posição original quando a IA manda uma nova dica.
  visionGuideMinimize: () =>
    ipcRenderer.send("vision-guide-minimize"),
  // Botão [h] "me ajuda, travei": tira print agora e refaz o plano do que falta.
  visionGuideHelp: () =>
    ipcRenderer.send("vision-guide-help"),
  // Pausa/retoma o assistente (para prints + áudio). O main responde o novo
  // estado por 'vision-guide-paused' pra o overlay atualizar o botão.
  visionGuideTogglePause: () =>
    ipcRenderer.send("vision-guide-toggle-pause"),
  onVisionGuidePaused: (cb) =>
    ipcRenderer.on("vision-guide-paused", (_e, paused) => cb(paused)),
  setVisionGuideConfig: (partial) =>
    ipcRenderer.send("set-vision-guide-config", partial),
  getVisionGuideConfig: () =>
    ipcRenderer.invoke("get-vision-guide-config"),
  getIdeAutocomplete: (payload) => 
    ipcRenderer.invoke("ide-autocomplete", payload),
  setEditorState: (state) => ipcRenderer.send("set-editor-state", state),

  realtimeMinimize: () => ipcRenderer.send("realtime-overlay-minimize"),
  platform: process.platform,
  // Drag manual de janelas frameless (Windows/macOS): o app-region:drag é
  // instável em janelas transparent+frameless no Windows. Ver main.js.
  startWindowDrag: () => ipcRenderer.send('frameless-drag-start'),
  endWindowDrag: () => ipcRenderer.send('frameless-drag-end'),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),

  // === Terminal Connection ===
  terminalInit: (dim) => ipcRenderer.invoke("terminal:init", dim),
  terminalInput: (data) => ipcRenderer.send("terminal:input", data),
  terminalResize: (dim) => ipcRenderer.send("terminal:resize", dim),
  onTerminalOutput: (cb) => ipcRenderer.on("terminal:output", (event, data) => cb(data)),
  onTerminalClosed: (cb) => ipcRenderer.on("terminal:closed", (event, data) => cb(data)),

  // === Nexa Module API ===
  getNexaConfig: () => ipcRenderer.invoke("nexa:get-config"),
  saveNexaConfig: (cfg) => ipcRenderer.send("nexa:save-config", cfg),
  getAnimations: () => ipcRenderer.invoke("nexa:get-animations"),
  toggleNexa: () => ipcRenderer.invoke("nexa:toggle"),
  getNexaState: () => ipcRenderer.invoke("nexa:get-state"),
  isNexaOpen: () => ipcRenderer.invoke("nexa:is-open"),
  sendNexaTtsEnded: () => ipcRenderer.send("nexa:tts-ended"),
  onNexaStateChange: (cb) => ipcRenderer.on("nexa:state-change", (event, data) => cb(data)),
  onPlayTtsAudio: (cb) => ipcRenderer.on("play-tts-audio", (event, data) => cb(data)),
  onPlayAnimation: (cb) => ipcRenderer.on("nexa:play-animation", (event, data) => cb(data)),
  logToMain: (level, msg) => ipcRenderer.send("nexa:log-to-main", { level, msg }),
  onRequestWebcam: (cb) => ipcRenderer.on("nexa:request-webcam", (event, data) => cb(data)),
  sendWebcamReply: (requestId, base64) => ipcRenderer.send("nexa:webcam-reply-" + requestId, base64),
  nexaReadFile: (p) => ipcRenderer.invoke("nexa:read-file", p),
  resizeNexaWindow: (w, h) => ipcRenderer.invoke("nexa:resize-window", w, h),

  // === App Runner (Java / Spring Boot / Gradle / Maven / JUnit) ===
  appRunnerDetectJdks: (preferredPath) => ipcRenderer.invoke("app-runner-detect-jdks", preferredPath),
  appRunnerDetectProject: (projectDir) => ipcRenderer.invoke("app-runner-detect-project", projectDir),
  appRunnerParseJava: (payload) => ipcRenderer.invoke("app-runner-parse-java", payload),
  appRunnerRun: (payload) => ipcRenderer.invoke("app-runner-run", payload),
  appRunnerStop: () => ipcRenderer.invoke("app-runner-stop"),
  appRunnerGetStatus: () => ipcRenderer.invoke("app-runner-get-status"),
  appRunnerGetConfig: (projectDir) => ipcRenderer.invoke("app-runner-get-config", projectDir),
  appRunnerSaveConfig: (projectDirOrPayload, maybeConfig) => {
    let payload;
    if (typeof projectDirOrPayload === "string") {
      payload = { projectDir: projectDirOrPayload, config: maybeConfig || {} };
    } else if (projectDirOrPayload && typeof projectDirOrPayload === "object") {
      payload = projectDirOrPayload;
    } else {
      payload = {};
    }
    return ipcRenderer.invoke("app-runner-save-config", payload);
  },
  appRunnerReimportIntelliJ: (projectDir) => ipcRenderer.invoke("app-runner-reimport-intellij", projectDir),
  openAppRunnerConfig: (projectDir) => ipcRenderer.send("open-app-runner-config", projectDir),
  onOpenAppRunnerConfigModal: (cb) => ipcRenderer.on("open-app-runner-config-modal", (event, projectDir) => cb(projectDir)),
  onAppRunnerStreamChunk: (cb) => ipcRenderer.on("app-runner-stream-chunk", (event, chunk) => cb(chunk)),
  onAppRunnerStatusChanged: (cb) => ipcRenderer.on("app-runner-status-changed", (event, status) => cb(status)),
  onAppRunnerTestEvent: (cb) => ipcRenderer.on("app-runner-test-event", (event, data) => cb(data)),
  onAppRunnerTestSummary: (cb) => ipcRenderer.on("app-runner-test-summary", (event, data) => cb(data)),
  onAppRunnerAppEvent: (cb) => ipcRenderer.on("app-runner-app-event", (event, data) => cb(data)),
  // === Git Conflict Resolver (3-Way Merge) ===
  gitConflictGetStatus: (projectPath) => ipcRenderer.invoke("git-conflict-get-status", projectPath),
  gitConflictGetFile3Way: (payload) => ipcRenderer.invoke("git-conflict-get-file-3way", payload),
  gitConflictSaveResolved: (payload) => ipcRenderer.invoke("git-conflict-save-resolved", payload),
  gitConflictAbortMerge: (projectPath) => ipcRenderer.invoke("git-conflict-abort-merge", projectPath),
});
