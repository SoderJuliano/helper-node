// main/helpers/misc.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  REALTIME_COPILOT_INSTRUCTION, realtimeOpenAiService,
  state, helpers,
  globalShortcut, screen, execPromise, appConfig, Notification
} = require('../globals.js');

const { realtimeProviderResponder } = require('./realtimeProviderResponder');
const { registerGlobalShortcuts } = require('./globalShortcuts');

helpers.checkBackendStatus = async function() {
  state.backendIsOnline = await BackendService.ping();
  if (state.backendIsOnline) {
    console.log("Backend is online.");
  }
}

helpers.realtimeProviderResponder = function(transcript, image, onDelta, contextMessages = []) {
  return realtimeProviderResponder(transcript, image, onDelta, contextMessages, helpers);
}

helpers.clearOsNotifAutoClose = function() {
  if (state.osNotifCloseTimer) {
    clearTimeout(state.osNotifCloseTimer);
    state.osNotifCloseTimer = null;
  }
}

helpers.startResponseAutoClose = function() {
  helpers.clearOsNotifAutoClose();
  if (state.osNotifKeepOpen) return;

  const seconds = configService.getOsNotificationDuration();
  if (seconds === 0) return;

  state.osNotifCloseTimer = setTimeout(() => {
    if (state.osNotifKeepOpen) return;
    if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
      state.osNotificationWindow.hide();
    }
  }, seconds * 1000);
}

helpers.switchToOsIntegrationMode = function() {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.hide();
  }
  helpers.createOsNotificationWindow();
}

helpers.switchToNormalMode = function() {
  if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
    state.osNotificationWindow.hide();
  }
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.show();
  }
}

helpers.createIntermediateNotification = function() {
  if (configService.getOsIntegrationStatus()) {
    helpers.createOsNotificationWindow();
  }
}

helpers.registerGlobalShortcuts = function() {
  return registerGlobalShortcuts();
}

helpers.getAudioSources = async function() {
  const sources = ['@DEFAULT_SOURCE@'];
  if (process.platform === 'linux') {
    try {
      const { stdout } = await execPromise('pactl get-default-sink');
      sources.push(stdout.trim() + '.monitor');
    } catch (e) {
      sources.push('@DEFAULT_MONITOR@');
    }
  }
  return sources;
}

helpers.toggleRealtimeAssistantRecording = async function() {
  if (helpers.anyRealtimeActive()) {
    await helpers.stopAllRealtime();
    state.isRecording = false;

    if (configService.getOsIntegrationStatus()) {
      helpers.sendToRealtimeAssistantOverlay("toggle-recording", {
        isRecording: false,
        isRealtimeAssistant: true,
        audioFilePath,
      });
    }

    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("toggle-recording", {
        isRecording: state.isRecording,
        isRealtimeAssistant: true,
        audioFilePath,
      });
    }

    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Assistente em tempo real desativado.",
        silent: true,
      }).show();
    }
    return;
  }

  const service = helpers.pickRealtimeService();
  const isOnline = service === realtimeOpenAiService;

  if (isOnline && !configService.getOpenIaToken()) {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("transcription-error", "Token da OpenAI não configurado.");
    }
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Erro de Configuração",
        body: "Configure o token da OpenAI para usar o assistente em tempo real.",
        silent: true,
      }).show();
    }
    return;
  }

  if (isOnline && translationAssistant.isActive()) {
    await translationAssistant.stop().catch(() => {});
  }

  await service.start();
  state.isRecording = true;

  if (configService.getOsIntegrationStatus()) {
    helpers.createRealtimeAssistantOverlay();
    helpers.sendToRealtimeAssistantOverlay("toggle-recording", {
      isRecording: true,
      isRealtimeAssistant: true,
      audioFilePath,
    });
  }

  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    state.mainWindow.webContents.send("toggle-recording", {
      isRecording: state.isRecording,
      isRealtimeAssistant: true,
      audioFilePath,
    });
  }

  if (appConfig.notificationsEnabled && Notification.isSupported()) {
    new Notification({
      title: "Helper-Node",
      body: "Assistente em tempo real ativado. Transcrição ao vivo.",
      silent: true,
    }).show();
  }
}

helpers.getEffectiveAiModel = function() {
  return edition.isLite() ? 'openIa' : configService.getAiModel();
}

helpers.isBinaryFile = function(filePath) {
  const fsMod = require('fs');
  let fd = null;
  try {
    fd = fsMod.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const read = fsMod.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, read).includes(0);
  } catch (_) {
    return false;
  } finally {
    if (fd !== null) { try { fsMod.closeSync(fd); } catch (_) {} }
  }
}

const ATTACHABLE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf']);

helpers.getAttachableFilePaths = function() {
  try {
    const fsMod = require('fs');
    const pathMod = require('path');
    return workspace.list()
      .filter(a => a.type === 'file' && ATTACHABLE_EXT.has(pathMod.extname(a.path).toLowerCase()))
      .map(a => a.path)
      .filter(p => { try { return fsMod.statSync(p).isFile(); } catch (_) { return false; } });
  } catch (err) {
    console.warn("Falhou ao listar anexos de imagem/documento:", err.message);
    return [];
  }
}

helpers.appendAttachmentsContext = function(prompt) {
  try {
    const attachments = workspace.list().filter(a => a.type === 'file');
    if (attachments.length > 0) {
      let contextHeader = "=== ARQUIVOS ANEXADOS AO CONTEXTO ===\n";
      contextHeader += "O usuário selecionou e anexou manualmente os seguintes arquivos no workspace:\n";
      let hasPastedImage = false;
      for (const att of attachments) {
        try {
          const fs = require('fs');
          if (!fs.existsSync(att.path)) { contextHeader += `- Caminho: ${att.path}\n`; continue; }
          const stat = fs.statSync(att.path);
          const pasted = helpers.pastedImageContextFor && helpers.pastedImageContextFor(att);
          if (pasted) { contextHeader += pasted; hasPastedImage = true; continue; }
          const binary = stat.isFile() && helpers.isBinaryFile(att.path);
          contextHeader += `- Caminho: ${att.path}${binary ? ' (binário/imagem — anexado como arquivo, não transcrito aqui)' : ''}\n`;
          if (!binary && stat.isFile() && stat.size < 150 * 1024) {
            const content = fs.readFileSync(att.path, 'utf8');
            contextHeader += `\n--- Conteúdo do arquivo (${att.path}) ---\n${content}\n--- Fim do arquivo ---\n\n`;
          }
        } catch (_) {}
      }
      contextHeader += "=== FIM DO CONTEXTO DE ANEXOS ===\n\n";
      if (hasPastedImage) {
        contextHeader += "ABRA a imagem no caminho indicado com sua ferramenta de leitura de arquivo "
          + "antes de responder — ela é a fonte da pergunta (print de console, erro, tela). "
          + "Use o texto do OCR para localizar o ponto correspondente no código do projeto.\n\n";
      }
      contextHeader += "Por favor, utilize os caminhos e conteúdos acima para responder à pergunta atual.\n\nPergunta:\n";
      return contextHeader + prompt;
    }
  } catch (err) {
    console.warn("Falhou ao anexar contexto de arquivos para o CLI:", err.message);
  }
  return prompt;
}

helpers.notifyShortcutsChanged = function() {
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    try { state.mainWindow.webContents.send("shortcuts-changed"); } catch (_) {}
  }
}

helpers.emitFileMutated = function(payload) {
  try {
    if (state.mainWindow && !state.mainWindow.isDestroyed()) {
      state.mainWindow.webContents.send("file-mutated", payload);
    }
  } catch (_) {}
}

helpers.stopFramelessDrag = function() {
  if (state._framelessDrag) {
    try { clearInterval(state._framelessDrag.timer); } catch (_) {}
    state._framelessDrag = null;
  }
}
