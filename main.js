const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  desktopCapturer,
  nativeImage,
  clipboard,
} = require("electron");

// Require globals
const { state, helpers, configService, helperTools, OpenAIService, historyService, ipcService, translationAssistant, visionGuide, GeminiCliProvider, ClaudeCliProvider } = require("./main/globals.js");

// Load modules to register helpers
require("./main/state.js");
require("./main/windows.js");
require("./main/overlays.js");
require("./main/helpers/windowPosition.js");
require("./main/terminal.js");
require("./main/helpers/audio.js");
require("./main/helpers/clipboard.js");
require("./main/helpers/screenshot.js");
require("./main/helpers/captureWatch.js");
require("./main/helpers/workspace.js");
require("./main/helpers/stealth.js");
require("./main/helpers/aiResponse.js");
require("./main/helpers/getIaResponse.js");
require("./main/helpers/capture.js");
require("./main/helpers/misc.js");
// Depois de misc.js: usa helpers.getEffectiveAiModel em runtime.
require("./main/helpers/imagePaste.js");

// Register IPC handlers
require("./main/ipc/window.js")();
require("./main/ipc/chat.js")();
require("./main/ipc/workspace.js")();
require("./main/ipc/workspaceActions.js")();
require("./main/ipc/terminal.js")();
require("./main/ipc/audio.js")();
require("./main/ipc/shortcuts.js")();
require("./main/ipc/history.js")();
require("./main/ipc/codeNav.js")();
require("./main/ipc/importCheck.js")();
require("./main/ipc/javaDeps.js")();

// Unhandled exception silencers
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if (err && (err.code === "EPIPE" || err.code === "EIO")) return;
  });
}
process.on("uncaughtException", (err) => {
  if (err && (err.code === "EPIPE" || err.code === "EIO")) return;
  try { console.error("[uncaughtException]", err); } catch (_) {}
});
process.on("unhandledRejection", (reason) => {
  try { console.error("[unhandledRejection]", reason); } catch (_) {}
});

// IPC Log Override
const originalEmit = ipcMain.emit;
const NOISY_IPC_CHANNELS = new Set([
  'native-audio-pcm', 'native-audio-log', 'terminal:input', 'terminal:output',
  'frameless-drag-start', 'frameless-drag-end', 'window-close', 'window-move', 'window-resize',
  'get-backend-url', 'get-backend-api-key', 'get-ai-model', 'get-edition',
  'get-openai-model', 'get-gemini-cli-model', 'get-claude-cli-model', 'get-ollama-local-model',
  'get-backend-model', 'get-open-ia-token', 'get-prompt-instruction', 'get-language',
  'get-stealth-mode-status', 'get-print-mode-status', 'get-debug-mode-status', 'get-os-integration-status',
  'get-realtime-assistant-status', 'get-workspace-access-enabled', 'get-helper-tools-enabled',
  'save-debug-mode-status', 'save-print-mode-status', 'save-os-integration-status',
  'save-realtime-assistant-status', 'save-stealth-mode-status', 'save-prompt-instruction'
]);

ipcMain.emit = function (event, ...args) {
  if (typeof event === 'string' && !event.startsWith('__') && !NOISY_IPC_CHANNELS.has(event)) {
    if (/token|api-?key|secret|password|senha|auth/i.test(event)) {
      console.log(`[IPC LOG] Channel: ${event}, Args: [redacted]`);
    } else {
      try {
        console.log(`[IPC LOG] Channel: ${event}, Args:`, JSON.stringify(args.slice(1)).slice(0, 400));
      } catch (e) {
        console.log(`[IPC LOG] Channel: ${event} (Args serialization failed)`);
      }
    }
  }
  return originalEmit.apply(ipcMain, arguments);
};

// Notification Stub for Stealth
class Notification {
  constructor() {}
  show() {}
  close() {}
  on() { return this; }
  once() { return this; }
  removeAllListeners() { return this; }
  static isSupported() { return false; }
}

// Shared status checks (e.g. sharingCheckInterval)
state.sharingCheckInterval = setInterval(helpers.checkScreenSharing, 1000);

const { initializeNexa } = require("./main/nexa/index.js");

app.whenReady().then(async () => {
  configService.initialize();
  initializeNexa();
  // Imagens coladas antigas que ninguém referencia mais (as ainda anexadas
  // são preservadas — não some print debaixo de uma conversa em andamento).
  try {
    const imageAttachments = require('./services/imageAttachments.js');
    const { workspace: ws } = require('./main/globals.js');
    imageAttachments.purgeOld(ws.list().map(a => a.path));
  } catch (_) {}
  // Modo de Teste do Tradutor é só por sessão — nunca persiste entre aberturas.
  try { configService.setTranslationAssistantConfig({ testMode: false }); } catch (_) {}
  helperTools.initialize(configService.getHelperToolsConfig());
  // Registra confirmer para tools mutantes (systemPowerAction etc.)
  try {
    const spa = require('./services/helperTools/tools/systemPowerAction');
    if (spa && typeof spa.setConfirmer === 'function') {
      spa.setConfirmer((opts) => helpers.showConfirmActionOverlay(opts));
    }
    // Write tools: confirmer + listener pra notificar UI quando arquivo for editado
    const _writeNotifier = (data) => {
      try {
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('workspace-file-written', data);
        }
      } catch (_) {}
      // Também emite no canal genérico do editor (file-mutated) — se o humano
      // tiver esse arquivo aberto, vê o indicativo de concorrência em tempo real.
      helpers.emitFileMutated({ path: data && data.path, origin: 'openai' });
    };
    for (const toolName of ['writeFile', 'appendToFile', 'deleteFile', 'patchFile', 'runShellAdvanced']) {
      try {
        const t = require(`./services/helperTools/tools/${toolName}`);
        if (t && typeof t.setConfirmer === 'function') {
          t.setConfirmer((opts) => helpers.showConfirmActionOverlay(opts));
        }
        if (t && typeof t.setOnFileWritten === 'function') {
          t.setOnFileWritten(_writeNotifier);
        }
      } catch (e) {
        console.warn(`[main] falha ao registrar confirmer pra ${toolName}:`, e.message);
      }
    }
  } catch (e) { console.warn('Confirmer setup falhou:', e.message); }
  OpenAIService.initialize();
  await historyService.initialize();
  helpers.setupTray();
  await helpers.createWindow();
  ipcService.start({
    toggleRecording: helpers.toggleRecording,
    moveToDisplay: helpers.moveToDisplay,
    bringWindowToFocus: helpers.bringWindowToFocus,
    captureScreenAuto: helpers.captureFullScreenAuto,
    openConfig: helpers.createConfigWindow,
  });

  // Indexar workspace ativo na inicialização
  try {
    const symbolIndexer = require('./services/symbolIndexer.js');
    const { workspace } = require('./main/globals.js');
    const dir = (workspace.list() || []).find(a => a.type === 'dir');
    if (dir && dir.path) {
      symbolIndexer.indexWorkspace(dir.path).catch(e => console.warn('[symbolIndexer] init workspace error:', e.message));
    }
  } catch (e) {
    console.warn('[symbolIndexer] startup index failed:', e.message);
  }

  // Roteamento de eventos do Assistente de Tradução (modo ao vivo)
  if (translationAssistant) {
    translationAssistant.onResult((data) => {
      try {
        const isOsIntegration = configService.getOsIntegrationStatus();
        if (isOsIntegration) {
          helpers.sendToTranslationOverlay('translation-result', data);
        }
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('translation-result', data);
        }
      } catch (e) {
        console.error('[TranslationAssistant] erro no callback onResult:', e.message);
      }
    });

    translationAssistant.onLevel((source, rms) => {
      try {
        const isOsIntegration = configService.getOsIntegrationStatus();
        if (isOsIntegration) {
          helpers.sendToTranslationOverlay('translation-level', { source, rms });
        }
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('translation-level', { source, rms });
        }
      } catch (e) {
        console.error('[TranslationAssistant] erro no callback onLevel:', e.message);
      }
    });

    translationAssistant.onLoading((loading) => {
      try {
        const isOsIntegration = configService.getOsIntegrationStatus();
        if (isOsIntegration) {
          helpers.sendToTranslationOverlay('translation-loading', loading);
        }
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.mainWindow.webContents.send('translation-loading', loading);
        }
      } catch (e) {
        console.error('[TranslationAssistant] erro no callback onLoading:', e.message);
      }
    });
  }

  // Envia o status inicial do modo debug para a janela principal
  if (state.mainWindow && !state.mainWindow.isDestroyed()) {
    const initialDebugStatus = configService.getDebugModeStatus();
    state.mainWindow.webContents.send("debug-status-changed", initialDebugStatus);
  }

  // Inicializa o watcher de arquivos em tempo real para o projeto ativo no workspace
  try {
    const activeDir = (workspace.list() || []).find((a) => a.type === 'dir');
    if (activeDir && activeDir.path) {
      const workspaceWatcher = require('./services/workspaceWatcher.js');
      workspaceWatcher.startWatchingProject(activeDir.path);
    }
  } catch (err) {
    console.warn('[workspaceWatcher] Erro ao auto-iniciar no boot:', err.message);
  }
  
  // Inicializar monitoramento de clipboard se print mode estiver ativo
  const initialPrintMode = configService.getPrintModeStatus();
  if (initialPrintMode) {
    console.log('🎯 Print mode estava ativo, iniciando monitoramento de clipboard...');
    helpers.startClipboardMonitoring();
    // Capture tool monitoring só no OS integration mode, não no print mode básico
  }
  
  // Inicializar Translation Assistant se estiver ativo
  const initialTaCfg = configService.getTranslationAssistantConfig ? configService.getTranslationAssistantConfig() : null;
  if (initialTaCfg && initialTaCfg.enabled) {
    const cfg = configService.getConfig();
    if (cfg.openIaToken) {
      console.log('[TranslationAssistant] enabled in config, auto-starting...');
      setTimeout(() => {
        if (!translationAssistant.isActive()) {
          const ta = cfg.translationAssistant || {};
          translationAssistant.start({
            apiKey: cfg.openIaToken,
            userName: ta.userName || '',
            userBackground: ta.userBackground || '',
            targetLanguage: ta.targetLanguage || 'pt-br',
            micDevice: ta.micDevice || '',
          }).then(() => {
            // Mutex: se OS Integration ativo, suprime monitorings que possam ter subido
            if (configService.getOsIntegrationStatus()) {
              try { helpers.stopClipboardMonitoring(); } catch (_) {}
              try { helpers.stopCaptureToolMonitoring(); } catch (_) {}
              try { helpers.stopScreenshotFolderMonitoring(); } catch (_) {}
              console.log('[mutex] auto-start TA + OS Integration: monitorings suprimidos');
              helpers.createTranslationOverlay();
              helpers.sendToTranslationOverlay('translation-status', 'mic_open');
            }
            if (state.mainWindow && !state.mainWindow.isDestroyed()) state.mainWindow.webContents.send('translation-status', 'mic_open');
          }).catch((e) => console.error('[TranslationAssistant] auto-start falhou:', e.message));
        }
      }, 1500);
    }
  }

  // Inicializar OS integration mode se estiver ativo
  const initialOsIntegration = configService.getOsIntegrationStatus();
  console.log('🔗 Checking OS integration status:', initialOsIntegration);
  if (initialOsIntegration) {
    console.log('🔗 OS integration estava ativo, iniciando modo de integração...');
    // Delay to ensure everything is loaded
    setTimeout(() => {
      helpers.switchToOsIntegrationMode();
    }, 1000);
    
    // Ensure clipboard monitoring is started for OS integration mode.
    // NÃO forçamos print mode: respeitamos a escolha do usuário. Os watchers
    // checam getPrintModeStatus() e não enviam imagens se estiver desligado.
    if (!initialPrintMode) {
      helpers.startClipboardMonitoring();
    }
    // Start capture tool monitoring for OS integration
    helpers.startCaptureToolMonitoring();
  }

  // Retoma o Tutor (Vision Guide) se ele estava ligado quando o app fechou. Sem
  // isto, o checkbox das Configurações fica marcado (config salva) mas o
  // processo de verdade nunca reinicia — parecia "sumido" a cada reabertura.
  try {
    const vgCfg = configService.getVisionGuideConfig();
    const bootCfg = configService.getConfig();
    if (vgCfg.enabled && bootCfg.openIaToken && !visionGuide.isActive()) {
      setTimeout(() => {
        visionGuide.start({
          apiKey: bootCfg.openIaToken,
          intervalSeconds: vgCfg.intervalSeconds,
          minInterventionSeconds: vgCfg.minInterventionSeconds,
          listenAudio: vgCfg.listenAudio,
          useKnowledgeBase: vgCfg.useKnowledgeBase,
        }).then(() => {
          if (configService.getOsIntegrationStatus()) {
            helpers.createVisionGuideOverlay();
            helpers.sendToVisionGuideOverlay('vision-guide-status', 'watching');
          }
        }).catch((e) => {
          console.error('[vision-guide] falha ao retomar no boot:', e.message);
          configService.setVisionGuideConfig({ enabled: false });
        });
      }, 1500);
    }
  } catch (e) { console.error('[vision-guide] erro ao checar auto-start:', e.message); }

  // Verifica o status do backend ao iniciar e depois periodicamente
  helpers.checkBackendStatus();
  setInterval(helpers.checkBackendStatus, 60000); // Verifica a cada 60 segundos
});

// Ensure shortcuts are active after app is ready
app.on("browser-window-focus", () => {
  helpers.registerGlobalShortcuts();
});

app.on("window-all-closed", () => {
  console.log("All windows closed");
  clearInterval(state.sharingCheckInterval);
  helpers.cancelDictation();
  helpers.stopAllRealtime();
  if (process.platform !== "darwin" && !state.mainWindow) {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  helpers.stopClipboardMonitoring();
  helpers.stopAllRealtime();
  if (state.tray && !state.tray.isDestroyed()) {
    try { state.tray.destroy(); } catch (_) {}
    state.tray = null;
  }
  try {
    const { closeNexaWindow } = require("./main/nexa/index.js");
    closeNexaWindow();
  } catch (_) {}
  // CLI providers: encerra processos de forma limpa.
  GeminiCliProvider.shutdown().catch(e => console.warn('[gemini-cli] shutdown error:', e.message));
  ClaudeCliProvider.shutdown().catch(e => console.warn('[claude-cli] shutdown error:', e.message));
});
