const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  desktopCapturer,
  nativeImage,
} = require("electron");

// === STDIO SAFETY ===
// Quando o app é lançado de forma desanexada (.desktop, systemd, autostart),
// stdout/stderr pode estar conectado a um pipe que fecha durante a vida do
// processo. Qualquer console.log subsequente lança EIO/EPIPE, que como
// "uncaughtException" causa o diálogo "A JavaScript error occurred in the
// main process" e trava os atalhos globais. Aqui silenciamos esses erros.
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

// === STEALTH MODE ===
// Substituímos `Notification` (notificação nativa do SO) por um stub vazio.
// Motivo: o app deve passar despercebido em reuniões/chamadas — ninguém
// olhando para a tela do usuário deve ver "Helper-Node: Gravando..." ou
// qualquer popup do sistema indicando que uma IA está escutando.
// Toda comunicação com o usuário acontece exclusivamente nas nossas
// próprias janelas (BrowserWindow) controladas via createOsNotificationWindow().
class Notification {
  constructor() {}
  show() {}
  close() {}
  on() { return this; }
  once() { return this; }
  removeAllListeners() { return this; }
  static isSupported() { return false; }
}
const path = require("path");
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const fs = require("fs").promises;
const fs2 = require("fs");
// const LlamaService = require('./services/llamaService.js');
const GeminiService = require("./services/geminiService.js"); // Mantido para a funcionalidade de cancelamento
const BackendService = require("./services/backendService.js");
const TesseractService = require("./services/tesseractService.js");
const OpenAIService = require("./services/openAIService.js");
const RealtimeAssistantService = require("./services/realtimeAssistantService.js");
const ipcService = require("./services/ipcService.js");
const configService = require("./services/configService.js");
const historyService = require("./services/historyService.js");

// Improve global shortcut reliability on Linux Wayland compositors
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");
}

// Function to calculate image hash for duplicate detection
function calculateImageHash(imageBuffer) {
  return crypto.createHash('md5').update(imageBuffer).digest('hex');
}

// --- SINGLE INSTANCE LOCK ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv, workingDirectory) => {
    // Focus existing window if a second instance is started
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let backendIsOnline = false;
let configWindow = null;
let shortcutsRegistered = false;

async function checkBackendStatus() {
  backendIsOnline = await BackendService.ping();
  if (backendIsOnline) {
    console.log("Backend is online.");
  } else {
  }
}

// Configurações do aplicativo
const appConfig = {
  notificationsEnabled: true,
};

let mainWindow;
let sharingCheckInterval;
let currentDisplayId = null;
let sharingActive = false;
let recordingProcess = null;
let isRecording = false;
let waitingNotificationInterval = null;
let clipboardMonitoringInterval = null;
let lastClipboardImageHash = null;
let lastProcessedImageHash = null;
let lastProcessedTimestamp = null;
const IMAGE_COOLDOWN_MS = 30000; // 30 seconds cooldown
let isProcessingImage = false; // Simple lock for image processing
const audioFilePath = path.join(__dirname, "output.wav");

// OS Integration windows
let osInputWindow = null;
let osNotificationWindow = null;
let osCaptureWindow = null;
let isOsIntegrationMode = false;
let captureToolInterval = null;
let osVoskSilenceTimer = null;

function clearOsVoskSilenceTimer() {
  if (osVoskSilenceTimer) { clearTimeout(osVoskSilenceTimer); osVoskSilenceTimer = null; }
}

const VoskStreamService = require("./services/voskStreamService.js");

const realtimeAssistantService = new RealtimeAssistantService({
  configService,
  getMainWindow: () => mainWindow,
  historyService,
  onFatalStop: () => {
    // Called when the service stops itself due to a fatal error (e.g. quota exceeded)
    isRecording = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
    }
  },
});

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 500,
    height: 420,
    title: "Configurações",
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    skipTaskbar: false,
    icon: path.join(__dirname, "assets", "linux.png"),
  });

  configWindow.loadFile("config.html");

  configWindow.on("closed", () => {
    configWindow = null;
  });
}

// OS Integration Mode Functions
function createOsInputWindow() {
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.focus();
    return;
  }

  osInputWindow = new BrowserWindow({
    width: 600,
    height: 50,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Center on screen
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  osInputWindow.setPosition(
    Math.floor((width - 600) / 2), 
    Math.floor(height / 3)
  );

  const inputHtml = path.join(__dirname, 'os-integration', 'notifications', 'integratedInput.html');

  osInputWindow.loadFile(inputHtml);

  // NOTE: deliberadamente NÃO fechamos no blur. Em Wayland/COSMIC operações de
  // paste de imagem do clipboard podem disparar um blur transitório, que
  // fechava a janela antes do usuário enviar. Use Esc para fechar.

  osInputWindow.on('closed', () => {
    osInputWindow = null;
  });
}

// Helper function to completely destroy the notification window
function destroyNotificationWindow() {
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    console.log(`🔔 DESTROYING notification window completely`);
    try {
      osNotificationWindow.removeAllListeners(); // Remove all event listeners
      osNotificationWindow.destroy(); // Use destroy instead of close for immediate effect
      console.log(`🔔 Notification window destroyed successfully`);
    } catch (e) {
      console.log(`🔔 Error destroying notification:`, e);
    }
    osNotificationWindow = null;
  }
}

function createOsNotificationWindow(type, content) {
  console.log(`🔔 Creating OS notification - Type: ${type}, Content: ${content ? content.substring(0, 50) + '...' : 'no content'}`);
  
  // FORCE CLOSE existing notification using new helper function
  destroyNotificationWindow();

  // Close capture window when loading or response appears
  if (type === 'loading' || type === 'response') {
    destroyCaptureWindow();
  }

  // Set dynamic dimensions based on type - matching the original HTML file dimensions
  let windowWidth = 160;
  let windowHeight = 96;

  if (type === 'response') {
    windowWidth = 400;
    windowHeight = 260;
  } else if (type === 'recording-live') {
    // Tamanho inicial confortável: cabe header + 1 linha de fala
    // sem precisar de scrollbar. Cresce dinamicamente via resize-overlay.
    windowWidth = 320;
    windowHeight = 110;
  }

  // Position in top right corner (5px a mais pra dentro: 25 em vez de 20)
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const posX = Math.max(0, width - windowWidth - 25);
  const posY = 60;

  const isMovableOverlay = (type === 'recording-live' || type === 'response');

  osNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    // x/y nas options é mais respeitado pelo COSMIC/Wayland do que setPosition()
    x: posX,
    y: posY,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: isMovableOverlay,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // STEALTH OVERLAY: não rouba foco da janela ativa (reunião, vídeo, IDE)
    focusable: false,
    // Some no compartilhamento de tela (Teams/Meet/Zoom screen-share)
    // — funciona em X11; em Wayland depende do compositor
    type: 'toolbar',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  // Bloqueia captura de tela do app pelos compositores que respeitam a flag
  try { osNotificationWindow.setContentProtection(true); } catch (_) {}
  // Mantém SEMPRE acima de tudo (inclusive janelas em fullscreen de browser)
  osNotificationWindow.setAlwaysOnTop(true, 'screen-saver');
  osNotificationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Reforça posição para compositores que ignoram x/y das options
  try { osNotificationWindow.setPosition(posX, posY); } catch (_) {}

  // Simply load the appropriate HTML file - let the files handle their own content
  let filePath;
  
  if (type === 'loading') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'loading.html');
  } else if (type === 'recording') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'recording.html');
  } else if (type === 'recording-live') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'recording-live.html');
  } else if (type === 'response') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'response.html');
  }

  // Load the HTML file
  osNotificationWindow.loadFile(filePath).catch(error => {
    console.error(`Error loading ${type} notification file:`, error);
  });

  // Store content for response notifications - the HTML file will handle displaying it
  if (type === 'response' && content) {
    // The response.html file will handle the content display
    osNotificationWindow.webContents.once('dom-ready', () => {
      osNotificationWindow.webContents.executeJavaScript(`
        if (typeof window.setResponseContent === 'function') {
          window.setResponseContent(${JSON.stringify(content)});
        } else {
          document.body.innerHTML = ${JSON.stringify(content)} + '<button class="close-btn" onclick="window.close()" style="position:absolute;top:5px;right:8px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0;width:20px;height:20px;z-index:1000;">×</button>';
        }
      `);
    });
  }

  osNotificationWindow.on('closed', () => {
    console.log(`🔔 OS notification window closed - Type: ${type}`);
    osNotificationWindow = null;
  });
}

function switchToOsIntegrationMode() {
  isOsIntegrationMode = true;
  
  // Start capture tool monitoring when entering OS integration mode
  startCaptureToolMonitoring();
  
  // Hide main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function switchToNormalMode() {
  isOsIntegrationMode = false;
  
  // Stop capture tool monitoring when leaving OS integration mode
  stopCaptureToolMonitoring();
  
  // Close OS integration windows
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.close();
  }
  destroyNotificationWindow(); // Use helper function instead
  destroyCaptureWindow(); // Close capture window
  
  // Stop capture tool monitoring when leaving OS integration mode
  stopCaptureToolMonitoring();
  
  // Show main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
  }
}

// Capture tool detection and window functions
function createCaptureWindow() {
  if (osCaptureWindow && !osCaptureWindow.isDestroyed()) {
    return; // Already exists
  }

  // Only show capture window if OS integration mode is active
  if (!isOsIntegrationMode) {
    return;
  }

  // Don't create capture window if notification is already active
  if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
    console.log('🎯 Notification ativa, não criando janela de captura');
    return;
  }

  console.log('🎯 Criando janela de captura');
  
  osCaptureWindow = new BrowserWindow({
    width: 120,
    height: 120,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Position in top right corner (same as loading/response notifications)
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const windowWidth = 120;
  osCaptureWindow.setPosition(width - windowWidth - 20, 60);

  // Load capture animation
  const capturePath = path.join(__dirname, 'os-integration', 'notifications', 'capture.html');
  osCaptureWindow.loadFile(capturePath).catch(error => {
    console.error('Erro ao carregar janela de captura:', error);
  });

  osCaptureWindow.on('closed', () => {
    console.log('🎯 Janela de captura fechada');
    osCaptureWindow = null;
  });
}

function destroyCaptureWindow() {
  if (osCaptureWindow && !osCaptureWindow.isDestroyed()) {
    console.log('🎯 Destruindo janela de captura');
    osCaptureWindow.close();
    osCaptureWindow = null;
  }
}

// Simple and reliable detection for when user is actively selecting screenshot area
async function detectActiveSelectionInterface() {
  try {
    // Check for active screenshot selection processes - don't fail if no matches
    const { stdout } = await execPromise('ps aux | grep -E "(gnome-screenshot|flameshot|spectacle|maim|scrot|grim|slurp|grimshot|ksnip|deepin-screenshot|xfce4-screenshooter)" | grep -v grep || true');
    
    if (!stdout.trim()) {
      return false;
    }

    const processes = stdout.split('\n').filter(line => line.trim());
    
    for (const process of processes) {
      // GNOME Screenshot in area selection mode
      if (process.includes('gnome-screenshot') && (process.includes('-a') || process.includes('--area'))) {
        return true;
      }
      
      // Flameshot in GUI mode (interactive selection)
      if (process.includes('flameshot') && process.includes('gui')) {
        return true;
      }
      
      // Spectacle in region mode
      if (process.includes('spectacle') && (process.includes('-r') || process.includes('--region'))) {
        return true;
      }
      
      // Maim with selection flag
      if (process.includes('maim') && (process.includes('-s') || process.includes('--select'))) {
        return true;
      }
      
      // Scrot with selection flag
      if (process.includes('scrot') && process.includes('-s')) {
        return true;
      }
      
      // Wayland tools
      if (process.includes('grim') || process.includes('slurp') || process.includes('grimshot')) {
        return true;
      }
      
      // Other tools
      if (process.includes('ksnip') || process.includes('deepin-screenshot') || process.includes('xfce4-screenshooter')) {
        return true;
      }
    }

    return false;
  } catch (error) {
    return false;
  }
}

function startCaptureToolMonitoring() {
  if (captureToolInterval) {
    clearInterval(captureToolInterval);
  }

  console.log('🎯 Iniciando monitoramento de interface de seleção');
  
  let captureActive = false;
  
  captureToolInterval = setInterval(async () => {
    const isCapturing = await detectActiveSelectionInterface();
    
    if (isCapturing && !captureActive) {
      // Selection interface just opened
      captureActive = true;
      createCaptureWindow();
      console.log('📸 Interface de seleção aberta');
    } else if (!isCapturing && captureActive) {
      // Selection interface just closed
      captureActive = false;
      destroyCaptureWindow();
      console.log('📸 Interface de seleção fechada');
    }
  }, 500); // Check every 500ms for better responsiveness
}

function stopCaptureToolMonitoring() {
  if (captureToolInterval) {
    clearInterval(captureToolInterval);
    captureToolInterval = null;
    console.log('🎯 Monitoramento de captura parado');
  }
  
  destroyCaptureWindow();
}

async function createWindow() {
  try {
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      backgroundColor: "#00000000",
      transparent: true,
      titleBarStyle: "hidden",
      titleBarOverlay: {
        color: "#222222",
        symbolColor: "#ffffff",
      },
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
      focusable: true,
      alwaysOnTop: false,
      show: false,
      skipTaskbar: true,
      icon: path.join(__dirname, "assets", "linux.png"),
      titleBarStyle: "hidden",
      nodeIntegration: false,
    });

    mainWindow.setContentProtection(true);

    // macOS específico - oculta o ícone da Dock
    if (process.platform === "darwin") {
      app.dock.hide();
    }

    // Tentativa adicional para KDE para ocultar app na dock
    if (process.platform === "linux") {
      mainWindow.setSkipTaskbar(true);
      mainWindow.setMenuBarVisibility(false);
      mainWindow.setTitle(""); // Janela sem título pode ajudar
    }

    if (process.env.XDG_SESSION_TYPE === "wayland") {
      mainWindow.setSkipTaskbar(true);
      console.log("Running on Wayland");
    } else {
      console.log("Running on X11");
    }

    mainWindow.on("ready-to-show", () => {
      console.log("Window ready to show");
      mainWindow.show();
      ensureWindowVisible(mainWindow);
      currentDisplayId = screen.getDisplayNearestPoint(
        mainWindow.getBounds()
      ).id;
      // Re-registra atalhos quando a janela ganha foco
      registerGlobalShortcuts();
    });

    mainWindow.on("closed", () => {
      console.log("Main window closed");
      mainWindow = null;
    });

    const indexPath = path.join(__dirname, "index.html");
    try {
      await fs.access(indexPath);
      await mainWindow.loadFile(indexPath);
      console.log("Loaded index.html successfully");
    } catch (error) {
      console.error("Error: index.html not found at", indexPath, error);
      app.quit();
      return;
    }

    // Desabilitar detecção de compartilhamento de tela
    //setupScreenSharingDetection();

    // Configuração de permissões
    mainWindow.webContents.session.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        if (permission === "autofill") {
          return callback(false);
        }
        callback(true);
      }
    );

    if (process.platform === "linux") {
      app.setAppUserModelId("com.seuapp.nome"); // ajuda o sistema a identificar melhor o app
    }
  } catch (error) {
    console.error("Error creating window:", error);
    app.quit();
  }
}

async function captureScreen() {
  // Check if OS integration mode is active
  const isOsIntegration = configService.getOsIntegrationStatus();
  
  if (isOsIntegration) {
    // Em COSMIC/Wayland o portal pode ser inconsistente com tools externas.
    // Tentamos primeiro a captura nativa via Electron desktopCapturer; se
    // o usuário pediu Ctrl+Shift+X explicitamente, ainda deixamos o fluxo
    // legacy abaixo rodar como fallback.
    const isCosmic = process.env.XDG_CURRENT_DESKTOP === "COSMIC";
    if (isCosmic) {
      console.log('📸 COSMIC detectado: usando captura nativa por seleção');
      try { await captureRegionNative(); return; } catch (e) {
        console.error('Captura nativa falhou, caindo no fluxo legacy:', e);
      }
    }
    
    // OS Integration Mode - show notification and process through AI
    console.log('📸 Captura iniciada no modo de integração com SO');
    
    // Show capture window while screenshot tool is running
    createCaptureWindow();
    
    const tmpPng = path.join(app.getPath("temp"), `helpernode-shot-${Date.now()}.png`);
    const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
    
    try {
      let screenshotSuccess = false;
      
      // Priority 1: Wayland - use external script for better compatibility
      if (isWayland && await commandExists("grim") && await commandExists("slurp")) {
        destroyCaptureWindow();
        await new Promise(resolve => setTimeout(resolve, 100));
        
        try {
          const scriptPath = path.join(__dirname, 'capture-screenshot.sh');
          await execPromise(`bash "${scriptPath}" "${tmpPng}"`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } catch (err) {
          console.error('Erro ao capturar:', err.message);
          destroyCaptureWindow();
          createOsNotificationWindow('response', 'Captura cancelada ou falhou.');
          return;
        }
      } 
      // Priority 2: Hyprland specific (if not caught above)
      else if (isHyprland() && await commandExists("grim") && await commandExists("slurp")) {
        const { stdout: region } = await execPromise("slurp -f '%x %y %w %h'");
        const [x, y, w, h] = region.trim().split(/\s+/);
        await execPromise(`grim -g '${x},${y} ${w}x${h}' '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      }
      // Priority 3: gnome-screenshot (works better on X11)
      else if (await commandExists("gnome-screenshot")) {
        await execPromise(`gnome-screenshot -a -f '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // Priority 4: Wayland with just grim (full screen)
      else if (isWayland && await commandExists("grim")) {
        await execPromise(`grim '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // Priority 5: ImageMagick import (X11 fallback)
      else if (await commandExists("import")) {
        await execPromise(`import -window root '${tmpPng}'`);
        screenshotSuccess = await fs2.existsSync(tmpPng);
      } 
      // No tool found
      else {
        destroyCaptureWindow();
        createOsNotificationWindow('response', 'Nenhuma ferramenta de captura encontrada.');
        return;
      }
      
      if (screenshotSuccess) {
        // Destroy capture window and show loading
        destroyCaptureWindow();
        createOsNotificationWindow('loading', 'Processando imagem...');
        
        try {
          await fs.access(tmpPng);
          
          // Validar se o arquivo tem um tamanho mínimo
          const stats = await fs.stat(tmpPng);
          if (stats.size < 100) {
            throw new Error('Screenshot file too small, probably corrupted');
          }
          
          // Read and convert to base64
          const imgBuffer = await fs.readFile(tmpPng);
          const base64Image = `data:image/png;base64,${imgBuffer.toString('base64')}`;
          
          // Extract text with OCR
          console.log('🔍 Extraindo texto da captura...');
          const ocrText = await TesseractService.getTextFromImage(base64Image);
          
          if (!ocrText || ocrText.trim().length === 0) {
            console.warn('⚠️ Nenhum texto encontrado na captura');
            destroyNotificationWindow();
            await new Promise(resolve => setTimeout(resolve, 200));
            createOsNotificationWindow('response', 'Nenhum texto encontrado na imagem.');
            return;
          }
          
          console.log('📝 Texto extraído da captura:', ocrText);
          
          // Send to AI
          createOsNotificationWindow('loading', 'Enviando para IA...');
          await processOsQuestion(ocrText);
          
        } catch (e) {
          console.error("Erro ao processar captura:", e);
          destroyNotificationWindow();
          await new Promise(resolve => setTimeout(resolve, 200));
          createOsNotificationWindow('response', 'Erro ao processar a captura.');
        } finally {
          // Clean up temp file
          try {
            await fs.unlink(tmpPng);
          } catch (unlinkError) {
            console.error('Erro ao deletar arquivo temporário:', unlinkError);
          }
        }
      } else {
        destroyCaptureWindow();
        createOsNotificationWindow('response', 'Falha ao capturar a tela.');
      }
    } catch (err) {
      console.error("Capture failed:", err);
      destroyCaptureWindow();
      createOsNotificationWindow('response', 'Erro na captura da tela.');
    }
    
  } else {
    // Normal Mode - send to main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("screen-capturing", true);

      const tmpPng = path.join(app.getPath("temp"), `helpernode-shot-${Date.now()}.png`);
      const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
      try {
        let screenshotSuccess = false;
        if (await commandExists("gnome-screenshot")) {
          await execPromise(`gnome-screenshot -a -f '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (isHyprland() && await commandExists("grim") && await commandExists("slurp")) {
          const { stdout: region } = await execPromise("slurp -f '%x %y %w %h'");
          const [x, y, w, h] = region.trim().split(/\s+/);
          await execPromise(`grim -g '${x},${y} ${w}x${h}' '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (isWayland && await commandExists("grim")) {
          await execPromise(`grim '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else if (await commandExists("import")) {
          await execPromise(`import -window root '${tmpPng}'`);
          screenshotSuccess = await fs2.existsSync(tmpPng);
        } else {
          // Sem ferramenta de sistema: tenta método interno
          try {
            const data = await TesseractService.captureAndProcessScreenshot(mainWindow);
            console.log("OCR Data (internal):", data);
            if (data) return;
            throw new Error("Internal capture returned empty data");
          } catch (error) {
            console.error("Internal capture failed:", error);
            throw new Error("No screenshot tools available");
          }
        }

        // After successful capture and before sending result, read file as base64
        if (screenshotSuccess) {
          const imgBuffer = await fs.readFile(tmpPng);
          const base64Image = `data:image/png;base64,${imgBuffer.toString('base64')}`;
          // Proceed with OCR only if file exists
          try {
            await fs.access(tmpPng);
            
            // Validar se o arquivo tem um tamanho mínimo
            const stats = await fs.stat(tmpPng);
            if (stats.size < 100) {
              throw new Error('Screenshot file too small, probably corrupted');
            }
            
            const ocrText = await TesseractService.getTextFromImage(base64Image);
            mainWindow.webContents.send("ocr-result", { 
              text: ocrText || '', 
              screenshotPath: tmpPng, 
              base64Image 
            });
          } catch (e) {
            console.error("Screenshot file not accessible for OCR:", e);
            
            // Enviar resultado com erro em vez de texto vazio
            mainWindow.webContents.send("ocr-result", { 
              text: "", 
              screenshotPath: tmpPng, 
              base64Image,
              error: "Não foi possível processar a imagem" 
            });
          }
        } else {
          mainWindow.webContents.send("screen-capturing", false);
        }
      } catch (err) {
        console.error("Capture failed:", err);
      } finally {
        mainWindow.webContents.send("screen-capturing", false);
      }
    }
  }
}

function commandExists(cmd) {
  return new Promise((resolve) => {
    exec(`command -v ${cmd}`, (error) => resolve(!error));
  });
}

ipcMain.on("process-pasted-image", (event, base64Image) => {
  console.log("Main process received pasted image.");
  if (mainWindow && !mainWindow.isDestroyed()) {
    TesseractService.processPastedImage(base64Image, mainWindow).catch(
      (error) => {
        console.error("Error processing pasted image in main process:", error);
        
        // Enviar resultado com erro em vez de falhar silenciosamente
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ocr-result', {
            text: '',
            screenshotPath: '',
            base64Image: base64Image,
            error: 'Erro ao processar imagem colada'
          });
        }
      }
    );
  }
});

ipcMain.on(
  "process-manual-input-with-image",
  async (event, { text, image }) => {
    try {
      const imageTranscription = await TesseractService.getTextFromImage(image);
      const promptInstruction = await configService.getPromptInstruction();

      const finalPrompt = `${promptInstruction}<br>${text}<br>${imageTranscription}`;

      console.log("Final prompt with image transcription:", finalPrompt);

      // Validar se há texto suficiente para enviar
      if (!text?.trim() && !imageTranscription?.trim()) {
        console.warn("No text or image transcription found, not sending to AI");
        mainWindow.webContents.send(
          "transcription-error",
          "Nenhum texto encontrado na imagem ou entrada manual"
        );
        return;
      }

      await getIaResponse(finalPrompt);
    } catch (error) {
      console.error("Error processing manual input with image:", error);
      mainWindow.webContents.send(
        "transcription-error",
        "Failed to process image with manual input."
      );
    }
  }
);

// Função para detectar ferramentas de captura ativas
async function detectCaptureTools() {
  try {
    // Lista de ferramentas de captura comuns no Linux
    const captureTools = [
      'gnome-screenshot',
      'spectacle', 
      'flameshot',
      'shutter',
      'deepin-screenshot',
      'grim',
      'slurp',
      'ksnip',
      'xfce4-screenshooter',
      'kcreenshot'
    ];
    
    // Verificar se alguma ferramenta está rodando
    for (const tool of captureTools) {
      try {
        const { stdout } = await execPromise(`pgrep -f ${tool} 2>/dev/null || echo ''`);
        if (stdout.trim()) {
          console.log(`📸 Ferramenta de captura detectada: ${tool}`);
          return tool;
        }
      } catch (e) {
        // Continua para próxima ferramenta
      }
    }
    return false;
  } catch (error) {
    console.error('Erro ao detectar ferramentas de captura:', error);
    return false;
  }
}

// Função para criar notificação intermediária simples
function createIntermediateNotification() {
  console.log('📸 Mostrando notificação de captura detectada...');
  
  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    createOsNotificationWindow('loading', 'Ferramenta de captura detectada - aguardando imagem...');
  } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
    new Notification({
      title: 'Helper-Node',
      body: 'Ferramenta de captura detectada - aguardando imagem...',
      silent: true,
    }).show();
  }
}

// Inicializar baseline do clipboard para evitar processar imagens existentes
async function initializeClipboardBaseline() {
  try {
    console.log('📋 Tentando inicializar baseline do clipboard...');
    const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
    let hasImage = false;
    let imageData = null;
    
    if (isWayland) {
      try {
        const wlResult = await execPromise('timeout 2 wl-paste --list-types 2>/dev/null || echo ""');
        if (wlResult && wlResult.stdout.includes('image/png')) {
          const imageResult = await execPromise('timeout 3 wl-paste --type image/png | base64 -w 0 2>/dev/null || echo ""');
          if (imageResult && imageResult.stdout.trim()) {
            hasImage = true;
            imageData = 'data:image/png;base64,' + imageResult.stdout.trim();
          }
        }
      } catch (e) {
        console.log('📋 Wayland clipboard não disponível, tentando X11...');
      }
    }
    
    if (!hasImage) {
      try {
        const xclipResult = await execPromise('timeout 2 xclip -selection clipboard -t TARGETS -o 2>/dev/null || echo ""');
        if (xclipResult && xclipResult.stdout.includes('image/png')) {
          const imageResult = await execPromise('timeout 3 xclip -selection clipboard -t image/png -o | base64 -w 0 2>/dev/null || echo ""');
          if (imageResult && imageResult.stdout.trim()) {
            hasImage = true;
            imageData = 'data:image/png;base64,' + imageResult.stdout.trim();
          }
        }
      } catch (e) {
        console.log('📋 X11 clipboard não disponível');
      }
    }
    
    if (hasImage && imageData) {
      const base64Data = imageData.replace(/^data:image\/png;base64,/, '');
      const currentHash = calculateImageHash(Buffer.from(base64Data, 'base64'));
      lastClipboardImageHash = currentHash;
      console.log('📋 Clipboard baseline inicializado:', currentHash.substring(0, 8));
    } else {
      console.log('📋 Nenhuma imagem no clipboard para baseline');
    }
  } catch (error) {
    console.log('📋 Baseline falhou, mas não é crítico:', error.message);
    // Não é crítico, sistema funciona sem baseline
  }
}

// Função para iniciar monitoramento do clipboard usando ferramentas nativas
function startClipboardMonitoring() {
  if (clipboardMonitoringInterval) {
    clearInterval(clipboardMonitoringInterval);
  }
  
  console.log('🎯 Iniciando monitoramento NATIVO de clipboard para novas imagens...');
  
  // Initialize with current clipboard content to avoid processing existing images
  initializeClipboardBaseline();
  
  clipboardMonitoringInterval = setInterval(async () => {
    try {
      const isPrintModeEnabled = configService.getPrintModeStatus();
      if (!isPrintModeEnabled) return;
      
      // Detect which environment we're in first to avoid running both commands
      const isWayland = process.env.XDG_SESSION_TYPE === "wayland";
      let hasImage = false;
      let imageData = null;
      let currentHash = null;
      
      if (isWayland) {
        // Try Wayland first
        try {
          const wlResult = await execPromise('wl-paste --list-types 2>/dev/null').catch(() => null);
          if (wlResult && wlResult.stdout.includes('image/png')) {
            try {
              const imageResult = await execPromise('wl-paste --type image/png | base64 -w 0');
              if (imageResult && imageResult.stdout && imageResult.stdout.trim()) {
                hasImage = true;
                imageData = 'data:image/png;base64,' + imageResult.stdout.trim();
                const base64Data = imageResult.stdout.trim();
                currentHash = calculateImageHash(Buffer.from(base64Data, 'base64'));
              }
            } catch (extractError) {
              // Silent error handling for Wayland
            }
          }
        } catch (e) {
          // Silent error handling
          // Fallback to X11 if Wayland fails
        }
      }
      
      // Try X11 if not Wayland or if Wayland failed
      if (!hasImage) {
        try {
          const xclipResult = await execPromise('xclip -selection clipboard -t TARGETS -o 2>/dev/null').catch(() => null);
          if (xclipResult && xclipResult.stdout.includes('image/png')) {
            const imageResult = await execPromise('xclip -selection clipboard -t image/png -o | base64 -w 0').catch(() => null);
            if (imageResult && imageResult.stdout) {
              hasImage = true;
              imageData = 'data:image/png;base64,' + imageResult.stdout.trim();
              const base64Data = imageResult.stdout.trim();
              currentHash = calculateImageHash(Buffer.from(base64Data, 'base64'));
            }
          }
        } catch (e) {
          // Silent error handling
          // No image found in either clipboard
          console.log('🖥️ X11 also failed');
        }
      }
      
      if (hasImage && imageData && currentHash) {
        // Check if this is the same image as before
        if (currentHash === lastClipboardImageHash) {
          // Same image still in clipboard, no need to log repeatedly
          return;
        }
        
        // Check if this image was recently processed (cooldown check)
        const now = Date.now();
        const isRecentlyProcessed = lastProcessedImageHash === currentHash && 
                                   lastProcessedTimestamp && 
                                   (now - lastProcessedTimestamp) < IMAGE_COOLDOWN_MS;
        
        if (isRecentlyProcessed) {
          console.log('🚫 Image recently processed, waiting for cooldown period...');
          lastClipboardImageHash = currentHash; // Update clipboard hash but don't process
          return;
        }
        
        // This is a new image or cooldown period has passed
        if (currentHash !== lastClipboardImageHash) {
          // Check if already processing an image
          if (isProcessingImage) {
            console.log('🔒 Já processando uma imagem, aguardando...');
            lastClipboardImageHash = currentHash; // Update hash but don't process
            return;
          }
          
          console.log('📸 NOVA IMAGEM DETECTADA no clipboard! Processando automaticamente...');
          
          // Set processing lock
          isProcessingImage = true;
          
          // Check if OS integration mode is enabled
          const isOsIntegration = configService.getOsIntegrationStatus();
          if (isOsIntegration) {
            // Use OS notification
            createOsNotificationWindow('loading', 'Nova imagem detectada! Processando...');
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({
              title: 'Helper-Node',
              body: 'Nova imagem detectada! Processando...',
              silent: true,
            }).show();
          }
          
          // Mark as processed with timestamp
          lastProcessedImageHash = currentHash;
          lastProcessedTimestamp = now;
          
          await processNewClipboardImage(imageData);
        }
        
        lastClipboardImageHash = currentHash;
      } else {
        // No image found, reset clipboard hash
        if (lastClipboardImageHash !== null) {
          console.log('🔄 No image in clipboard anymore');
          lastClipboardImageHash = null;
        }
      }
    } catch (error) {
      console.error('❌ Erro no monitoramento de clipboard:', error);
    }
  }, 3000); // Verificar a cada 3 segundos para debug
}

// Função para parar monitoramento do clipboard
function stopClipboardMonitoring() {
  if (clipboardMonitoringInterval) {
    clearInterval(clipboardMonitoringInterval);
    clipboardMonitoringInterval = null;
    lastClipboardImageHash = null;
    console.log('🛑 Monitoramento de clipboard parado');
  }
  
  // Parar também o monitoramento de captura
  stopCaptureToolMonitoring();
}

// Função para processar nova imagem do clipboard
async function processNewClipboardImage(base64Image) {
  try {
    console.log('🎯 Processando nova imagem do clipboard...');
    
    // Check if OS integration mode is enabled
    const isOsIntegration = configService.getOsIntegrationStatus();
    
    // A primeira notificação já foi exibida no clipboard monitoring
    // Não precisamos de segunda notificação de loading
    
    // Usar o TesseractService existente
    const text = await TesseractService.getTextFromImage(base64Image);
    
    if (!text || text.trim().length === 0) {
      console.warn('⚠️ Nenhum texto encontrado na imagem');
      
      if (isOsIntegration) {
        createOsNotificationWindow('response', 'Nenhum texto encontrado na imagem');
      } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
        new Notification({
          title: 'Helper-Node',
          body: 'Nenhum texto encontrado na imagem',
          silent: true,
        }).show();
      }
      return;
    }
    
    console.log('📝 Texto extraído:', text);
    
    // Notificação de envio para IA
    if (isOsIntegration) {
      createOsNotificationWindow('loading', 'Enviando para IA...');
      // Process using OS integration mode
      try {
        await processOsQuestion(text);
      } catch (error) {
        console.error('Error in processOsQuestion for clipboard image:', error);
        // Explicitly close any existing notification before showing error
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
          osNotificationWindow.close();
          osNotificationWindow = null;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        createOsNotificationWindow('response', 'Erro ao processar imagem.');
      }
    } else {
      if (appConfig.notificationsEnabled && Notification.isSupported()) {
        new Notification({
          title: 'Helper-Node',
          body: 'Enviando para IA...',
          silent: true,
        }).show();
      }
      // Usar o método existente getIaResponse
      await getIaResponse(text);
    }
    
  } catch (error) {
    console.error('❌ Erro ao processar imagem do clipboard:', error);
    
    // Check if OS integration mode is enabled for error notification
    const isOsIntegration = configService.getOsIntegrationStatus();
    
    // Notificação de erro
    if (isOsIntegration) {
      createOsNotificationWindow('response', 'Erro ao processar imagem');
    } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Erro ao processar imagem',
        silent: true,
      }).show();
    }
    
    // Enviar erro para o frontend se a janela estiver disponível
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('transcription-error', 'Erro ao processar imagem do clipboard');
    }
  } finally {
    // Always release the processing lock
    isProcessingImage = false;
    console.log('🔓 Lock de processamento liberado');
  }
}

async function registerGlobalShortcuts() {
  if (!mainWindow) return;

  globalShortcut.unregisterAll();

  const isLinux = process.platform === "linux";
  const baseShortcuts = isLinux
    ? [
        { combo: "Ctrl+D", action: "toggle-recording" },
        { combo: "Ctrl+I", action: "manual-input" },
        { combo: "Ctrl+A", action: "focus-window" },
        { combo: "Ctrl+Shift+C", action: "open-config" },
        { combo: "Ctrl+Shift+X", action: "capture-screen" },
        { combo: "Ctrl+Shift+S", action: "capture-region-native" },
        { combo: "Ctrl+Shift+1", action: "move-to-display-0" },
        { combo: "Ctrl+Shift+2", action: "move-to-display-1" },
      ]
    : [
        { combo: "CommandOrControl+D", action: "toggle-recording" },
        { combo: "CommandOrControl+I", action: "manual-input" },
        { combo: "CommandOrControl+A", action: "focus-window" },
        { combo: "CommandOrControl+Shift+C", action: "open-config" },
        { combo: "CommandOrControl+Shift+X", action: "capture-screen" },
        { combo: "CommandOrControl+Shift+S", action: "capture-region-native" },
        { combo: "CommandOrControl+Shift+1", action: "move-to-display-0" },
        { combo: "CommandOrControl+Shift+2", action: "move-to-display-1" },
      ];

  // Fallback variants for Linux to improve reliability across environments
  const fallbackShortcuts = isLinux
    ? [
        { combo: "CommandOrControl+I", action: "manual-input" },
        { combo: "CommandOrControl+Shift+X", action: "capture-screen" },
        { combo: "CommandOrControl+Shift+1", action: "move-to-display-0" },
        { combo: "CommandOrControl+Shift+2", action: "move-to-display-1" },
      ]
    : [];

  const allShortcuts = [...baseShortcuts, ...fallbackShortcuts];

  allShortcuts.forEach(({ combo, action }) => {
    const registered = globalShortcut.register(combo, async () => {
      if (action === "open-config") {
        createConfigWindow();
        return;
      }
      
      // Handle manual-input action for OS integration mode
      if (action === "manual-input") {
        await bringWindowToFocus(); // This function already handles OS integration mode
        return;
      }
      
      // Handle recording action (works in both modes)
      if (action === "toggle-recording") {
        await toggleRecording();
        return;
      }
      
      // Handle capture screen action (works in both modes)
      if (action === "capture-screen") {
        await captureScreen();
        return;
      }

      // Captura full-screen automática (sem seleção, sem prompt) → OCR → IA
      if (action === "capture-region-native") {
        try { await captureFullScreenAuto(); } catch (e) { console.error('captureFullScreenAuto failed:', e); }
        return;
      }
      
      // Handle display movement (only works in normal mode)
      if (action === "move-to-display-0") {
        moveToDisplay(0);
        return;
      }
      if (action === "move-to-display-1") {
        moveToDisplay(1);
        return;
      }
      
      // Other actions that require main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(action);
        if (action === "focus-window" && mainWindow.isMinimized()) {
          mainWindow.restore();
        }
      }
    });
    console.log(
      registered
        ? `Shortcut registered: ${combo}`
        : `Failed to register shortcut: ${combo}`
    );
  });

  // Log final registration state for key shortcuts
  ["Ctrl+I", "CommandOrControl+I", "Ctrl+Shift+X", "CommandOrControl+Shift+X", "Ctrl+Shift+1", "CommandOrControl+Shift+1", "Ctrl+Shift+2", "CommandOrControl+Shift+2"].forEach(
    (accel) => {
      try {
        const ok = globalShortcut.isRegistered(accel);
        console.log(`isRegistered(${accel}): ${ok}`);
      } catch (e) {
        // noop
      }
    }
  );
}

// Retorna as fontes de áudio: microfone + monitor do sistema
async function getAudioSources() {
  const sources = ['@DEFAULT_SOURCE@'];
  try {
    const { stdout } = await execPromise('pactl get-default-sink');
    sources.push(stdout.trim() + '.monitor');
  } catch (e) {
    sources.push('@DEFAULT_MONITOR@');
  }
  return sources;
}

async function toggleRealtimeAssistantRecording() {
  const isRealtimeActive = realtimeAssistantService.isActive();

  if (isRealtimeActive) {
    await realtimeAssistantService.stop();
    isRecording = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", {
        isRecording,
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

  const token = configService.getOpenIaToken();
  if (!token) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("transcription-error", "Token da OpenAI não configurado.");
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

  await realtimeAssistantService.start();
  isRecording = true;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("toggle-recording", {
      isRecording,
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

async function toggleRecording() {
  try {
    const isRealtimeAssistantEnabled = configService.getRealtimeAssistantStatus();
    if (isRealtimeAssistantEnabled) {
      await toggleRealtimeAssistantRecording();
      return;
    }

    if (isRecording) {
      // === STOP RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();

      if (isOsIntegration && VoskStreamService.isRunning()) {
        // OS Integration + Vosk (modo conversa contínua):
        // Ctrl+D segundo toque = encerra a sessão (não envia nada extra,
        // pois as perguntas já foram respondidas inline).
        clearOsVoskSilenceTimer();
        VoskStreamService.stop();
        isRecording = false;
        console.log("OS Integration: conversa contínua encerrada");
        destroyNotificationWindow();
        return;
      }

      if (recordingProcess) {
        recordingProcess.kill("SIGTERM");
        recordingProcess = null;
      }
      isRecording = false;
      console.log("Recording stopped");

      if (!isOsIntegration) {
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({ title: "Helper-Node", body: "Ok, aguarde...", silent: true }).show();
        }
        mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
      } else {
        destroyNotificationWindow();
        createOsNotificationWindow('loading', 'Processando áudio...');
      }

      try {
        await fs.access(audioFilePath);
        console.log("Audio file created:", audioFilePath);

        if (!isOsIntegration) {
          mainWindow.webContents.send("transcription-start", { audioFilePath });
        }

        // Converter áudio para formato compatível com Whisper
        const convertedAudioPath = path.join(__dirname, "output_converted.wav");
        await execPromise(`ffmpeg -i ${audioFilePath} -ar 16000 -ac 1 -sample_fmt s16 -y ${convertedAudioPath}`);

        const audioText = await transcribeAudio(convertedAudioPath);

        try { await fs.unlink(audioFilePath); } catch (_) {}
        try { await fs.unlink(convertedAudioPath); } catch (_) {}

        if (!audioText || !audioText.trim() || audioText === "[BLANK_AUDIO]") {
          if (isOsIntegration) {
            createOsNotificationWindow('response', 'Nenhum áudio detectado. Tente novamente.');
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({ title: "Helper-Node", body: "Nenhum áudio detectado.", silent: true }).show();
          }
          return;
        }

        const aiModel = configService.getAiModel();
        if (isOsIntegration) {
          await processOsQuestion(audioText);
        } else if (aiModel === 'llama-stream') {
          mainWindow.webContents.send("send-to-gemini-stream-auto", audioText);
        } else {
          getIaResponse(audioText);
        }
      } catch (error) {
        isRecording = false;
        console.error("Audio processing failed:", error);
        try { await fs.unlink(audioFilePath).catch(() => {}); } catch (_) {}
        try { await fs.unlink(path.join(__dirname, "output_converted.wav")).catch(() => {}); } catch (_) {}
      }
    } else {
      // === START RECORDING ===
      const isOsIntegration = configService.getOsIntegrationStatus();

      if (isOsIntegration) {
        // OS Integration: use Vosk streaming with live text window
        isRecording = true;
        console.log("OS Integration: Starting Vosk live recording");

        // Create live recording window
        destroyNotificationWindow();
        createOsNotificationWindow('recording-live', '');

        // Detect audio sources (mic + system monitor)
        const audioSources = await getAudioSources();

        // Start Vosk streaming
        const modelPath = path.join(__dirname, "vosk-model");
        await VoskStreamService.start({
          audioSources,
          modelPath,
          onEvent: (event) => {
            if (!osNotificationWindow || osNotificationWindow.isDestroyed()) return;
            if (event.type === 'partial') {
              osNotificationWindow.webContents.executeJavaScript(
                `window.appendPartial(${JSON.stringify(event.text)})`
              ).catch(() => {});
            } else if (event.type === 'result') {
              osNotificationWindow.webContents.executeJavaScript(
                `window.appendSentence(${JSON.stringify(event.text)})`
              ).catch(() => {});
              // Conversa contínua: detectar perguntas e responder inline
              maybeAnswerInline(event.text).catch(err => console.error('inline answer error:', err));
            }
          },
        });

        mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
      } else {
        // Normal mode: record from mic + whisper
        await fs.unlink(audioFilePath).catch(() => {});
        const command = `parec --device=@DEFAULT_SOURCE@ --rate=16000 --channels=1 --format=s16le --raw > "${audioFilePath}"`;
        console.log("Executing:", command);
        recordingProcess = exec(command, (error) => {
          if (error && error.signal !== "SIGTERM" && error.code !== 0) {
            console.error("Recording error:", error);
          }
        });
        isRecording = true;
        console.log("Recording started");

        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({ title: "Helper-Node", body: "Gravando...", silent: true }).show();
        }
        mainWindow.webContents.send("toggle-recording", { isRecording, audioFilePath });
      }
    }
  } catch (error) {
    console.error("Error toggling recording:", error);
    mainWindow.webContents.send(
      "transcription-error",
      "Failed to toggle recording"
    );
  }
}

function formatForPlainTextNotification(html) {
  let text = html;
  // Substitui tags de bloco por quebras de linha para melhor legibilidade
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<\/li>/gi, "\n");

  // Converte tags de ênfase para uma sintaxe similar a markdown
  text = text.replace(/<strong>(.*?)<\/strong>/gi, "**");
  text = text.replace(/<b>(.*?)<\/b>/gi, "**");
  text = text.replace(/<em>(.*?)<\/em>/gi, "__");
  text = text.replace(/<i>(.*?)<\/i>/gi, "__");

  // Remove quaisquer tags HTML restantes
  text = text.replace(/<[^>]*>/g, "");

  // Decodifica entidades HTML comuns
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  return text.trim();
}

function chunkText(text, chunkSize = 250) {
  const finalChunks = [];
  const lines = text.split("\n");

  for (const line of lines) {
    if (line.trim() === "") continue;

    if (line.length <= chunkSize) {
      finalChunks.push(line.trim());
    } else {
      // This line is too long, so we chunk it.
      let remaining = line;
      while (remaining.length > 0) {
        let chunk = remaining.substring(0, chunkSize);
        const lastSpace = chunk.lastIndexOf(" ");

        if (lastSpace > 0 && remaining.length > chunkSize) {
          chunk = chunk.substring(0, lastSpace);
        }

        finalChunks.push(chunk.trim());
        remaining = remaining.substring(chunk.length).trim();
      }
    }
  }
  return finalChunks;
}

function formatToHTML(text) {
  if (!text) return "";

  const escapeHTML = (str) => {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  };

  let formatted = text;
  const codeBlocks = [];

  // Capturar blocos de código
  formatted = formatted.replace(
    /```(\w+)?\n([\s\S]*?)\n```/g,
    (match, lang, code) => {
      const codeId = `code-block-${codeBlocks.length}`;
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(
        `<pre><button class="copy-button" data-code-id="${codeId}">[Copy]</button><code id="${codeId}" class="language-${
          lang || "text"
        }">${escapeHTML(code)}</code></pre>`
      );
      return placeholder;
    }
  );

  const lines = formatted.split("\n");
  const formattedLines = [];

  for (let line of lines) {
    if (line.match(/__CODE_BLOCK_\d+__/)) {
      formattedLines.push(line);
      continue;
    }

    line = line.replace(/\*\*(.*?)\*\*|__(.*?)__/g, "<strong>$1$2</strong>");
    line = line.replace(/(?<!\*)\*(.*?)\*(?!\*)|_(.*?)_/g, "<em>$1$2</em>");
    if (line.match(/^\s*[-*]\s+(.+)/)) {
      line = line.replace(/^\s*[-*]\s+(.+)/, "<li>$1</li>");
    } else if (line.trim()) {
      line = `<p>${line}</p>`;
    }

    formattedLines.push(line);
  }

  formatted = formattedLines.filter((line) => line.trim()).join("<br>");

  if (formatted.includes("<li>")) {
    formatted = formatted
      .replace(/(<li>.*?(?:<br>|$))/g, "$1")
      .replace(/(<li>.*?(?:<br>|$)(?:<li>.*?(?:<br>|$))*)/g, "<ul>$1</ul>");
    formatted = formatted.replace(/<ul><br>|<br><\/ul>/g, "");
  }

  codeBlocks.forEach((block, index) => {
    formatted = formatted.replace(`__CODE_BLOCK_${index}__`, block);
  });

  formatted = formatted.replace(/(<br>)+$/, "").replace(/^(<br>)+/, "");
  return formatted;
}

async function getIaResponse(text) {
  console.log("getIaResponse called with text:", text);
  waitingNotificationInterval = setInterval(() => {
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Aguarde, gerando uma resposta...",
        silent: true,
      }).show();
    }
  }, 10000);

  let resposta;
  try {
    const aiModel = configService.getAiModel();
    console.log("Current AI Model:", aiModel);

    if (aiModel === 'openIa') {
        const token = configService.getOpenIaToken();
        const instruction = configService.getPromptInstruction();
        if (!token) {
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({
                    title: "Erro de Configuração",
                    body: "O token da OpenAI não está configurado. Por favor, adicione o token nas configurações.",
                    silent: true,
                }).show();
            }
            clearInterval(waitingNotificationInterval);
            waitingNotificationInterval = null;
            return;
        }
        const openAiModel = configService.getOpenAiModel();
        resposta = await OpenAIService.makeOpenAIRequest(text, token, instruction, openAiModel);
    } else {
        if (backendIsOnline) {
          console.log("Tentando usar o Backend Service...");
          try {
            resposta = await BackendService.responder(text);
          } catch (backendError) {
            console.error(
              "Falha no Backend Service, usando Gemini como fallback...",
              backendError
            );
            backendIsOnline = false; // Marca como offline para a próxima tentativa ser mais rápida
            resposta = await GeminiService.responder(text);
          }
        } else {
          console.log("Backend offline, usando Gemini Service...");
          resposta = await GeminiService.responder(text);
        }
    }

    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;

    // Formata a resposta para exibição na UI
    const formattedResposta = formatToHTML(resposta);
    mainWindow.webContents.send("gemini-response", { resposta: formattedResposta });

    // Usa a resposta crua para a notificação de texto simples
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      const plainTextBody = formatForPlainTextNotification(resposta);
      const chunks = chunkText(plainTextBody);

      (async () => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (chunk) {
            new Notification({
              title: `Resposta do Assistente (${i + 1}/${chunks.length})`,
              body: chunk,
              silent: true,
            }).show();

            if (i < chunks.length - 1) {
              await new Promise((res) => setTimeout(res, 2000));
            }
          }
        }
      })();
    }
  } catch (error) {
    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;

    console.error("IA service error:", error);
    mainWindow.webContents.send(
      "transcription-error",
      "Failed to process IA response"
    );
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Erro do Assistente",
        body: "Não foi possível gerar uma resposta de nenhuma fonte.",
        silent: true,
      }).show();
    }
  }
}

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execPromise(
      `ffprobe -v error -show_entries format=duration -of json "${filePath}"`
    );
    const data = JSON.parse(stdout);
    const duration = parseFloat(data.format.duration);
    console.log(`Duração do áudio: ${duration} segundos`);
    return duration;
  } catch (error) {
    console.error("Erro ao obter duração do áudio:", error.message);
  }
}

async function transcribeAudio(filePath, options = {}) {
  const { emitRenderer = true, emitNotifications = true } = options;

  try {
    // Obter a duração do áudio
    const duration = await getAudioDuration(filePath);

    const whisperPath = path.join(__dirname, "whisper/build/bin/whisper-cli");
    const modelPathSmall = path.join(__dirname, "whisper/models/ggml-small.bin");
    const modelPathMedium = path.join(__dirname, "whisper/models/ggml-medium.bin");

    // Determinar idioma do whisper com base na configuração do app
    const savedLang = configService.getLanguage();
    const whisperLang = savedLang === 'us-en' ? 'en' : 'pt';

    // Escolher modelo e parâmetros com base na duração
    // medium = melhor qualidade, entende nomes próprios e termos em inglês misturados com pt-br
    // small = fallback para áudios longos (> 60s) onde velocidade importa mais
    let modelPath, command;
    if (duration > 60) {
      modelPath = modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l ${whisperLang} --threads 16 --no-timestamps --best-of 3 --beam-size 3`;
      console.log("Usando modelo small (áudio longo)");
    } else {
      modelPath = fs2.existsSync(modelPathMedium) ? modelPathMedium : modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l ${whisperLang} --threads 18 --no-timestamps --best-of 5 --beam-size 5`;
      console.log(`Usando modelo ${modelPath.includes('medium') ? 'medium' : 'small'}`);
    }

    console.log("Executing whisper:", command);
    return new Promise((resolve, reject) => {
      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error("Whisper error:", stderr);
          mainWindow.webContents.send(
            "transcription-error",
            "Failed to transcribe audio"
          );
          reject(error);
          return;
        }
        const text = stdout.trim();
        console.log("Transcription:", text || "No text recognized");
        const cleanText = await limparTranscricao(text);
        if (emitRenderer && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("transcription-result", { cleanText });
        }

        if (
          emitNotifications &&
          appConfig.notificationsEnabled &&
          Notification.isSupported() &&
          cleanText
        ) {
          const notification = new Notification({
            title: "Helper-Node",
            body: "Usuário perguntou: " + cleanText,
            silent: true,
          });
          notification.show();
        }

        resolve(cleanText);
      });
    });
  } catch (error) {
    console.error("Transcription error:", error);
    if (emitRenderer && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(
        "transcription-error",
        "Failed to transcribe audio"
      );
    }
  }
}

async function limparTranscricao(texto) {
  return texto
    .replace(
      /\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g,
      ""
    )
    .trim();
}

function setupScreenSharingDetection() {
  checkScreenSharing();
  sharingCheckInterval = setInterval(checkScreenSharing, 3000);

  screen.on("display-metrics-changed", () => {
    console.log("Display metrics changed");
    checkScreenSharing();
    updateWindowPosition();
  });
}

async function checkScreenSharing() {
  try {
    const isSharing = await detectScreenSharing();
    if (isSharing !== sharingActive) {
      console.log("Chrome gravando a tela");
      sharingActive = isSharing;
      handleScreenSharing();
    }
  } catch (error) {
    console.error("Erro na verificação:", error);
  }
}

async function detectChromeScreenSharing() {
  try {
    const { stdout } = await execPromise(
      `ps aux | grep '[c]hrome' | grep -E -- '--type=renderer.*(pipewire|screen-capture|WebRTCPipeWireCapturer)'`
    );
    const isSharing =
      stdout.toLowerCase().includes("chrome") && stdout.includes("pipewire");
    if (isSharing) {
      console.log("Chrome screen-sharing detected in process:", stdout.trim());
    }
    return isSharing;
  } catch (error) {
    console.log("No Chrome screen-sharing detected:", error.message);
    return false;
  }
}

async function detectScreenSharing() {
  try {
    const sharingApps = ["chrome", "teams", "zoom", "obs", "discord"];
    const { stdout } = await execPromise(
      `ps aux | grep -E '${sharingApps.join("|")}' | grep -v grep`
    );
    const processes = stdout.toString().toLowerCase();
    const sharingIndicators = [
      "--type=renderer",
      "--enable-features=WebRTCPipeWireCapturer",
      "screen-sharing",
    ];
    return (
      sharingApps.some(
        (app) =>
          processes.includes(app) &&
          sharingIndicators.some((indicator) => processes.includes(indicator))
      ) || detectChromeScreenSharing()
    );
  } catch (error) {
    console.error("Error detecting screen sharing:", error);
    return false;
  }
}

function updateWindowPosition() {
  try {
    const displays = screen.getAllDisplays();
    const currentDisplay = screen.getDisplayNearestPoint(
      mainWindow.getBounds()
    );

    if (displays.length < 2) {
      console.log("Single display detected, hiding window");
      mainWindow.hide();
      return;
    }

    const sharingDisplay = getSharingDisplay();
    if (sharingDisplay && sharingDisplay.id === currentDisplay.id) {
      const otherDisplay = displays.find((d) => d.id !== currentDisplay.id);
      if (otherDisplay) {
        const otherIndex = displays.findIndex((d) => d.id === otherDisplay.id);
        console.log("Attempting to move to display index:", otherIndex);
        moveToDisplay(otherIndex);
        // Verify movement
        const newBounds = mainWindow.getBounds();
        const newDisplay = screen.getDisplayNearestPoint(newBounds);
        if (newDisplay.id === otherDisplay.id) {
          currentDisplayId = otherDisplay.id;
          console.log(
            "Successfully moved to display index:",
            otherIndex,
            "ID:",
            currentDisplayId
          );
        } else {
          console.error("Failed to move to display index:", otherIndex);
        }
      }
    } else {
      mainWindow.show();
      console.log("Window already on non-shared display");
    }
  } catch (error) {
    console.error("Error updating window position:", error);
  }
}

function getSharingDisplay() {
  return screen.getPrimaryDisplay();
}

function handleScreenSharing() {
  try {
    if (sharingActive && mainWindow && !mainWindow.isDestroyed()) {
      console.log("Screen sharing active, updating position");
      updateWindowPosition();
      mainWindow.setContentProtection(true);
    } else {
      console.log("No screen sharing, showing window");
      mainWindow.show();
    }
  } catch (error) {
    console.error("Error handling screen sharing:", error);
  }
}

function ensureWindowVisible(win) {
  const windowBounds = win.getBounds();
  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    return (
      windowBounds.x >= x &&
      windowBounds.x < x + width &&
      windowBounds.y >= y &&
      windowBounds.y < y + height
    );
  });

  if (!visible) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.workArea;
    const newX = x + Math.round((width - windowBounds.width) / 2);
    const newY = y + Math.round((height - windowBounds.height) / 2);
    console.log("Janela fora da tela. Reposicionando para:", newX, newY);
    win.setBounds({
      x: newX,
      y: newY,
      width: windowBounds.width,
      height: windowBounds.height,
    });
  }
}

function isHyprland() {
  return !!process.env.HYPRLAND_INSTANCE_SIGNATURE;
}

function moveToDisplay(targetIndex) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  if (displays.length === 0) return;

  // Clamp index
  const idx = Math.max(0, Math.min(targetIndex, displays.length - 1));
  const targetDisplay = displays[idx];
  const bounds = targetDisplay.workArea || targetDisplay.bounds;

  // Position window centered on target display
  const [winW, winH] = mainWindow.getSize();
  const x = Math.floor(bounds.x + (bounds.width - winW) / 2);
  const y = Math.floor(bounds.y + (bounds.height - winH) / 2);

  mainWindow.setBounds({ x, y, width: winW, height: winH });
  mainWindow.focus();
  currentDisplayId = targetDisplay.id;
  console.log(`Moved window to display index ${idx} (id=${targetDisplay.id})`);
}

async function bringWindowToFocus() {
  console.log(
    "bringWindowToFocus: Tentando trazer a janela para o foco e abrir o input."
  );
  
  // Check if OS integration mode is enabled
  const isOsIntegration = configService.getOsIntegrationStatus();
  if (isOsIntegration) {
    // Use OS integration input instead
    createOsInputWindow();
    return;
  }
  
  if (!mainWindow) return;

  if (isHyprland()) {
    try {
      const pid = process.pid;
      // Obter o workspace ativo atual
      const { stdout: wsStdout } = await execPromise(
        "hyprctl activeworkspace -j"
      );
      const activeWorkspace = JSON.parse(wsStdout);
      const workspaceId = activeWorkspace.id;

      console.log(
        `Hyprland: Movendo janela para o workspace ${workspaceId} e tornando flutuante.`
      );

      // Mover para o workspace atual
      await execPromise(
        `hyprctl dispatch movetoworkspace ${workspaceId},pid:${pid}`
      );
      // Tornar flutuante
      await execPromise(`hyprctl dispatch setprop pid:${pid} floating 1`);
      // Focar a janela
      await execPromise(`hyprctl dispatch focuswindow pid:${pid}`);

      mainWindow.show();
      console.log("Hyprland: Janela movida e focada com input manual.");
    } catch (error) {
      console.error("Erro ao mover/focar janela no Hyprland:", error);
    }
  } else {
    // Lógica para ambientes que não são Hyprland
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);

    const { x, y } = currentDisplay.workArea;
    const winWidth = mainWindow.getBounds().width;
    const winHeight = mainWindow.getBounds().height;

    const newX = x + Math.round((currentDisplay.workArea.width - winWidth) / 2);
    const newY =
      y + Math.round((currentDisplay.workArea.height - winHeight) / 2);

    mainWindow.setBounds({
      x: newX,
      y: newY,
      width: winWidth,
      height: winHeight,
    });
    mainWindow.show();
    mainWindow.focus();
    console.log("Janela movida e focada com input manual (ambiente padrão).");
  }

  // Abrir o input manual no renderizador
  mainWindow.webContents.send("manual-input");
}

ipcMain.on("send-to-gemini", async (event, text) => {
  try {
    const aiModel = configService.getAiModel();
    let resposta;

    if (aiModel === 'openIa') {
        const token = configService.getOpenIaToken();
        const instruction = configService.getPromptInstruction();
        if (!token) {
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({
                    title: "Erro de Configuração",
                    body: "O token da OpenAI não está configurado. Por favor, adicione o token nas configurações.",
                    silent: true,
                }).show();
            }
            return;
        }
        const openAiModel = configService.getOpenAiModel();
        resposta = await OpenAIService.makeOpenAIRequest(text, token, instruction, openAiModel);
        event.sender.send("openai-final-response", { resposta });
        return; // Exit here to prevent further processing by the generic response handler
    } else {
        if (backendIsOnline) {
          console.log("IPC: Tentando usar o Backend Service...");
          try {
            resposta = await BackendService.responder(text);
          } catch (backendError) {
            console.error(
              "IPC: Falha no Backend Service, usando Gemini como fallback...",
              backendError
            );
            backendIsOnline = false; // Marcar como offline
            resposta = await GeminiService.responder(text);
          }
        } else {
          console.log("IPC: Backend offline, usando Gemini Service...");
          resposta = await GeminiService.responder(text);
        }
    }
    event.sender.send("gemini-response", { resposta });
  } catch (error) {
    console.error("IPC: IA service error:", error);
    event.sender.send(
      "transcription-error",
      "Failed to process IA response from any source"
    );
  }
});

ipcMain.on("send-to-gemini-stream", async (event, text) => {
  try {
    console.log("IPC: Usando Backend Stream Service...");
    
    await BackendService.responderStream(
      text,
      // onChunk
      (chunk) => {
        event.sender.send("gemini-stream-chunk", chunk);
      },
      // onComplete
      () => {
        event.sender.send("gemini-stream-complete");
      },
      // onError
      (error) => {
        console.error("Stream error:", error);
        event.sender.send("transcription-error", error.message);
      }
    );
  } catch (error) {
    console.error("IPC: Stream service error:", error);
    event.sender.send("transcription-error", "Failed to process stream response");
  }
});

ipcMain.on("stop-notifications", () => {
  if (waitingNotificationInterval) {
    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;
  }
  console.log("Notifications stopped");
});

ipcMain.on("start-notifications", () => {
  console.log("Notifications restarted");
});

ipcMain.on("cancel-ia-request", () => {
  // Atualmente, o cancelamento só funciona para o GeminiService.
  // O BackendService não tem um método de cancelamento implementado.
  GeminiService.cancelCurrentRequest();

  if (waitingNotificationInterval) {
    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;
  }
  console.log("IA request cancelled");
});

ipcMain.handle("is-hyprland", () => {
  return isHyprland();
});

ipcMain.handle("get-backend-url", async () => {
  return await BackendService.getApiUrl();
});

// IPC Handlers for Config
ipcMain.handle("get-prompt-instruction", () => {
  return configService.getPromptInstruction();
});

ipcMain.on("save-prompt-instruction", (event, instruction) => {
  configService.setPromptInstruction(instruction);
});

ipcMain.handle("get-debug-mode-status", () => {
  return configService.getDebugModeStatus();
});

ipcMain.on("save-debug-mode-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    realtimeAssistantService.stop().catch(() => {});
  }

  configService.setDebugModeStatus(status);
  // Notifica a janela principal e a de configuração sobre a mudança
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("debug-status-changed", status);
  }
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.webContents.send("debug-status-changed", status);
  }
});

// IPC Handlers for Print Mode
ipcMain.handle("get-print-mode-status", () => {
  return configService.getPrintModeStatus();
});

ipcMain.on("save-print-mode-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    realtimeAssistantService.stop().catch(() => {});
  }

  configService.setPrintModeStatus(status);
  console.log('Print mode status changed to:', status);
  
  if (status) {
    // Notificação de ativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Modo automático ativado! Tire prints e aguarde as respostas...',
        silent: true,
      }).show();
    }
    
    startClipboardMonitoring();
    // Capture tool monitoring só funciona no OS integration mode
  } else {
    // Notificação de desativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Modo automático desativado',
        silent: true,
      }).show();
    }
    
    stopClipboardMonitoring();
  }
});

// IPC Handlers for OS Integration
ipcMain.handle("get-os-integration-status", () => {
  return configService.getOsIntegrationStatus();
});

ipcMain.on("save-os-integration-status", (event, status) => {
  if (status && configService.getRealtimeAssistantStatus()) {
    configService.setRealtimeAssistantStatus(false);
    realtimeAssistantService.stop().catch(() => {});
  }

  configService.setOsIntegrationStatus(status);
  console.log('OS Integration status changed to:', status);
  
  if (status) {
    // Automatically enable print mode when OS integration is enabled
    configService.setPrintModeStatus(true);
    
    // Notificação de ativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Integração com SO ativada! Interface minimalista habilitada.',
        silent: true,
      }).show();
    }
    
    startClipboardMonitoring();
    startCaptureToolMonitoring(); // Monitoramento de ferramentas de captura apenas no OS integration
    // Switch to OS integration mode
    switchToOsIntegrationMode();
  } else {
    // Notificação de desativação
    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Integração com SO desativada',
        silent: true,
      }).show();
    }
    
    // Switch back to normal mode
    switchToNormalMode();
  }
});

ipcMain.handle("get-realtime-assistant-status", () => {
  return configService.getRealtimeAssistantStatus();
});

ipcMain.on("save-realtime-assistant-status", async (event, status) => {
  configService.setRealtimeAssistantStatus(status);
  console.log('Realtime assistant status changed to:', status);

  if (status) {
    // Exclusividade: desliga os modos que podem conflitar
    configService.setDebugModeStatus(false);
    configService.setPrintModeStatus(false);
    configService.setOsIntegrationStatus(false);

    stopClipboardMonitoring();
    stopCaptureToolMonitoring();
    switchToNormalMode();

    if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: 'Helper-Node',
        body: 'Assistente em tempo real habilitado. Inicie/parar com Ctrl+D.',
        silent: true,
      }).show();
    }
  } else {
    await realtimeAssistantService.stop().catch(() => {});
    isRecording = false;

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("toggle-recording", {
        isRecording,
        audioFilePath,
      });
    }
  }
});

// IPC Handlers for Language
ipcMain.handle("get-language", () => {
  return configService.getLanguage();
});

ipcMain.on("set-language", (event, language) => {
  configService.setLanguage(language);
});

// IPC Handlers for AI Model
ipcMain.handle("get-ai-model", () => {
  return configService.getAiModel();
});

ipcMain.on("set-ai-model", (event, aiModel) => {
  configService.setAiModel(aiModel);
});

// IPC Handlers for OpenAI Model
ipcMain.handle("get-openai-model", () => {
  return configService.getOpenAiModel();
});

ipcMain.on("set-openai-model", (event, model) => {
  configService.setOpenAiModel(model);
});

// IPC Handlers for OpenAI Token
ipcMain.handle("get-open-ia-token", () => {
    return configService.getOpenIaToken();
});

ipcMain.on("set-open-ia-token", (event, token) => {
    configService.setOpenIaToken(token);
});

// OS Integration IPC handlers
ipcMain.on("close-os-input", () => {
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.close();
  }
});

ipcMain.on("send-os-question", async (event, data) => {
  const text = typeof data === 'string' ? data : data.text;
  const image = typeof data === 'object' ? data.image : null;
  
  // Close input window
  if (osInputWindow && !osInputWindow.isDestroyed()) {
    osInputWindow.close();
  }
  
  // Show loading notification
  createOsNotificationWindow('loading', 'Processando pergunta...');
  
  try {
    // Process the question using existing getIaResponse logic but with OS notifications
    await processOsQuestion(text, image);
  } catch (error) {
    console.error('Error processing OS question:', error);
    createOsNotificationWindow('response', 'Erro ao processar pergunta.');
  }
});

// Resize do overlay recording-live conforme o conteúdo cresce.
ipcMain.on("resize-overlay", (event, height) => {
  if (!osNotificationWindow || osNotificationWindow.isDestroyed()) return;
  try {
    const [w] = osNotificationWindow.getSize();
    const newH = Math.max(110, Math.min(700, parseInt(height, 10) || 110));
    osNotificationWindow.setSize(w, newH);
  } catch (_) {}
});

// === Captura full-screen automática (sem seleção, sem prompt do portal) ===
// Usa ferramentas nativas do compositor (grim/gnome-screenshot/scrot/import).
// É o que mais se aproxima da experiência "PrintScreen → vai direto pra IA"
// que o usuário tinha no Garuda. Sem clique extra, sem janela de seleção.
async function captureFullScreenAuto() {
  const tmpDir = path.join(app.getPath('temp'), `helpernode-shot-${Date.now()}`);
  const tmpPng = path.join(app.getPath('temp'), `helpernode-shot-${Date.now()}.png`);
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
  const isCosmic = (process.env.XDG_CURRENT_DESKTOP || '').toUpperCase().includes('COSMIC');
  let success = false;
  let capturedPath = null;

  // Helper: tenta um comando que escreve direto em tmpPng
  async function tryCmd(label, cmd) {
    try {
      await execPromise(cmd);
      const ok = fs2.existsSync(tmpPng);
      if (ok) console.log(`📸 captura via ${label} OK`);
      capturedPath = ok ? tmpPng : null;
      return ok;
    } catch (e) {
      console.warn(`📸 ${label} falhou: ${(e && e.stderr ? e.stderr : e.message || e).toString().trim()}`);
      try { if (fs2.existsSync(tmpPng)) fs2.unlinkSync(tmpPng); } catch (_) {}
      return false;
    }
  }

  try {
    // === ORDEM DE PRIORIDADE — TODAS STEALTH (sem prompt do portal) ===

    // 1) COSMIC: cosmic-screenshot
    //    Sintaxe correta: --interactive=false --notify=false --save-dir <dir>
    //    A ferramenta gera um arquivo dentro de save-dir; pegamos o mais recente.
    if (isCosmic) {
      if (await commandExists('cosmic-screenshot')) {
        try {
          await fs.mkdir(tmpDir, { recursive: true });
          await execPromise(
            `cosmic-screenshot --interactive=false --notify=false --save-dir '${tmpDir}'`
          );
          // Encontra o arquivo gerado (PNG mais recente no diretório)
          const files = (await fs.readdir(tmpDir))
            .filter(f => f.toLowerCase().endsWith('.png'))
            .map(f => path.join(tmpDir, f));
          if (files.length > 0) {
            capturedPath = files[0];
            success = true;
            console.log('📸 captura via cosmic-screenshot OK:', capturedPath);
          }
        } catch (e) {
          console.warn('📸 cosmic-screenshot falhou:',
            (e && e.stderr ? e.stderr : e.message || e).toString().trim());
        }
      } else {
        // STEALTH NÃO É POSSÍVEL EM COSMIC SEM ESTA FERRAMENTA.
        // O Electron desktopCapturer abriria o diálogo "Compartilhar tela",
        // que é justamente o que queremos evitar. Falhamos com instrução clara.
        createOsNotificationWindow('response',
          '<b>cosmic-screenshot</b> não está instalado.<br>' +
          'É necessário para captura silenciosa no COSMIC.<br><br>' +
          'Instale com:<br><code>sudo apt install cosmic-screenshot</code>');
        return;
      }
    }

    // 2) Wayland NÃO-COSMIC (Sway/Hyprland/Wayfire): grim
    if (!success && isWayland && !isCosmic && await commandExists('grim')) {
      success = await tryCmd('grim', `grim '${tmpPng}'`);
    }

    // 3) X11: gnome-screenshot (sem prompt, captura full-screen)
    if (!success && !isWayland && await commandExists('gnome-screenshot')) {
      success = await tryCmd('gnome-screenshot', `gnome-screenshot -f '${tmpPng}'`);
    }

    // 4) X11: spectacle (KDE)
    if (!success && !isWayland && await commandExists('spectacle')) {
      success = await tryCmd('spectacle', `spectacle -b -n -o '${tmpPng}'`);
    }

    // 5) X11: scrot
    if (!success && !isWayland && await commandExists('scrot')) {
      success = await tryCmd('scrot', `scrot -o '${tmpPng}'`);
    }

    // 6) X11: ImageMagick import
    if (!success && !isWayland && await commandExists('import')) {
      success = await tryCmd('import', `import -window root '${tmpPng}'`);
    }

    // ⚠️ NÃO usamos desktopCapturer do Electron como fallback:
    //    em Wayland ele SEMPRE dispara o diálogo "Compartilhar a tela"
    //    do XDG Portal — quebra o stealth e exige clique do usuário.
    //    Melhor falhar com mensagem clara do que vazar a presença do app.

    if (!success) {
      const hint = isCosmic
        ? 'Instale: <code>sudo apt install cosmic-screenshot</code>'
        : isWayland
          ? 'Instale: <code>sudo apt install grim</code>'
          : 'Instale: <code>sudo apt install gnome-screenshot</code>';
      createOsNotificationWindow('response',
        `Não foi possível capturar a tela silenciosamente.<br>${hint}`);
      return;
    }

    // Mostra loading discreto
    createOsNotificationWindow('loading', 'Analisando captura...');

    const imgBuffer = await fs.readFile(capturedPath);
    const base64 = imgBuffer.toString('base64');
    // limpeza
    try { await fs.unlink(capturedPath); } catch (_) {}
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch (_) {}

    // Delega TODO o trabalho (OCR + roteamento texto/visão + IA) para
    // processOsQuestion. NÃO montamos prompt aqui — evita duplicação de OCR.
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      await processOsQuestion('', base64);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      // Modo janela: roda OCR só pra exibir
      let ocrText = '';
      try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
      mainWindow.webContents.send('ocr-result', {
        text: ocrText,
        image: `data:image/png;base64,${base64}`,
      });
    }
  } catch (e) {
    console.error('captureFullScreenAuto failed:', e);
    createOsNotificationWindow('response', 'Erro ao capturar a tela.');
  }
}

// === Captura nativa por seleção de região (sem dependências externas) ===
let regionSelectWindow = null;
let regionCaptureBuffer = null; // PNG buffer da tela inteira durante a seleção

async function captureRegionNative() {
  // Evita reentrância
  if (regionSelectWindow && !regionSelectWindow.isDestroyed()) {
    regionSelectWindow.focus();
    return;
  }

  const display = screen.getPrimaryDisplay();
  const { width: dw, height: dh } = display.size;
  const sf = display.scaleFactor || 1;

  // 1) Captura a tela inteira via desktopCapturer (funciona em X11/Wayland via portal)
  let sources;
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(dw * sf), height: Math.round(dh * sf) },
    });
  } catch (e) {
    console.error('desktopCapturer falhou:', e);
    createOsNotificationWindow('response', 'Não foi possível acessar a captura de tela.');
    return;
  }
  if (!sources || sources.length === 0) {
    createOsNotificationWindow('response', 'Nenhuma fonte de tela disponível.');
    return;
  }
  // Pega a primária (Linux geralmente devolve a principal primeiro)
  const screenSource = sources[0];
  const fullImage = screenSource.thumbnail;
  regionCaptureBuffer = fullImage.toPNG();

  // 2) Abre overlay transparente fullscreen para seleção
  regionSelectWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: dw,
    height: dh,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreen: true,
    focusable: true, // precisa receber clique/drag
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  // Stealth no screen-share
  try { regionSelectWindow.setContentProtection(true); } catch (_) {}
  regionSelectWindow.setAlwaysOnTop(true, 'screen-saver');

  await regionSelectWindow.loadFile(path.join(__dirname, 'os-integration', 'notifications', 'regionSelect.html'));

  regionSelectWindow.on('closed', () => {
    regionSelectWindow = null;
  });
}

ipcMain.on('region-cancelled', () => {
  if (regionSelectWindow && !regionSelectWindow.isDestroyed()) regionSelectWindow.close();
  regionCaptureBuffer = null;
});

ipcMain.on('region-selected', async (event, rect) => {
  // rect: { x, y, width, height } em px CSS do overlay
  try {
    if (regionSelectWindow && !regionSelectWindow.isDestroyed()) regionSelectWindow.close();
    if (!regionCaptureBuffer) return;
    if (!rect || rect.width < 5 || rect.height < 5) {
      regionCaptureBuffer = null;
      return;
    }

    const display = screen.getPrimaryDisplay();
    const sf = display.scaleFactor || 1;

    // Reconstrói NativeImage a partir do PNG já capturado
    const fullImg = nativeImage.createFromBuffer(regionCaptureBuffer);
    regionCaptureBuffer = null;

    const cropRect = {
      x: Math.max(0, Math.round(rect.x * sf)),
      y: Math.max(0, Math.round(rect.y * sf)),
      width: Math.max(1, Math.round(rect.width * sf)),
      height: Math.max(1, Math.round(rect.height * sf)),
    };
    const cropped = fullImg.crop(cropRect);
    const pngBuf = cropped.toPNG();
    const base64 = pngBuf.toString('base64');

    // Mostra loading discreto
    createOsNotificationWindow('loading', 'Analisando captura...');

    // Delega tudo a processOsQuestion (faz OCR + roteamento internamente)
    try {
      const isOsIntegration = configService.getOsIntegrationStatus();
      if (isOsIntegration) {
        await processOsQuestion('', base64);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        let ocrText = '';
        try { ocrText = await TesseractService.getTextFromImage(base64); } catch (_) {}
        mainWindow.webContents.send('ocr-result', { text: ocrText, image: `data:image/png;base64,${base64}` });
      }
    } catch (e) {
      console.error('Erro OCR/IA na captura nativa:', e);
      createOsNotificationWindow('response', 'Erro ao processar a captura.');
    }
  } catch (e) {
    console.error('region-selected handler error:', e);
  }
});

// Handler to cancel recording from OS notification
ipcMain.on("cancel-recording", () => {
  console.log('Cancel recording requested from OS notification');

  if (realtimeAssistantService.isActive()) {
    realtimeAssistantService.stop().catch(() => {});
    isRecording = false;
    return;
  }
  
  if (isRecording && recordingProcess) {
    recordingProcess.kill("SIGTERM");
    recordingProcess = null;
    isRecording = false;
    
    console.log("Recording cancelled by user");
    
    // Close the recording notification
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.close();
    }
    
    // Show cancelled notification
    const isOsIntegration = configService.getOsIntegrationStatus();
    if (isOsIntegration) {
      createOsNotificationWindow('response', 'Gravação cancelada.');
    } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
      new Notification({
        title: "Helper-Node",
        body: "Gravação cancelada.",
        silent: true,
      }).show();
    }
  }
});

// === Conversa contínua: detecta perguntas em sentenças finalizadas ===
// Pequenos heurísticos para evitar disparos espúrios. Roda em background,
// não bloqueia o Vosk e não fecha o overlay.
let inlineAnswerInFlight = false;
async function maybeAnswerInline(sentence) {
  if (!sentence || inlineAnswerInFlight) return;
  if (!osNotificationWindow || osNotificationWindow.isDestroyed()) return;

  const lower = sentence.toLowerCase().trim();
  if (lower.length < 6) return;

  const looksLikeQuestion =
    lower.includes('?') ||
    /^(o que|qual|quais|quanto|quantos|quantas|quem|onde|quando|por que|porque|porqu[eê]|como|sera|ser[áa])\b/.test(lower) ||
    /\b(voc[eê] sabe|me explica|pode explicar|me ajuda|qual a|qual o|tem como)\b/.test(lower);

  if (!looksLikeQuestion) return;

  inlineAnswerInFlight = true;
  try {
    osNotificationWindow.webContents.executeJavaScript(`window.showLoading()`).catch(() => {});
    await processOsQuestionWithWindow(sentence);
  } catch (e) {
    console.error('maybeAnswerInline failed:', e);
  } finally {
    inlineAnswerInFlight = false;
  }
}

async function processOsQuestionWithWindow(text) {
  // === Correção fonética ===
  // O Vosk PT-BR transcreve termos técnicos em inglês foneticamente:
  //   "paiton" / "peito" / "paitão" → Python
  //   "javascripi" / "djavascript" → JavaScript
  //   "ricte" / "ricti" → React
  //   "naide" → Node
  //   "tipescript" / "taipscripti" → TypeScript
  //   "deno" pode aparecer como "deno" mesmo, ok
  //   "doca" / "doquer" → Docker
  //   "linucs" → Linux
  //   "cosmiqui" → COSMIC
  // Aplicamos um pré-processamento leve, e ainda avisamos a IA para
  // interpretar o pedido considerando o ruído fonético.
  const correctionMap = [
    [/\b(paitão|paitao|paiton|peito|paitons?|paitan)\b/gi, 'Python'],
    [/\b(djavascripti?|javascripi|djavascripi|javascripti)\b/gi, 'JavaScript'],
    [/\b(taipescript|tipescript|taipiscripti|taipscripti|tipiscripti)\b/gi, 'TypeScript'],
    [/\b(naide(\s+(jés|geis|jeis))?|nodgeis|nodjs|naid)\b/gi, 'Node.js'],
    [/\b(ricti|ricte|reactji|réacti)\b/gi, 'React'],
    [/\b(vyou|viu (jés|geis))\b/gi, 'Vue.js'],
    [/\b(éngular|enguelar|angul[áa]r)\b/gi, 'Angular'],
    [/\b(doquer|doca|dóquer)\b/gi, 'Docker'],
    [/\b(cubernetis|cubernet|kubernetiz)\b/gi, 'Kubernetes'],
    [/\b(linucs|linukis|linaks)\b/gi, 'Linux'],
    [/\b(cosmiqui|c[oó]smiki)\b/gi, 'COSMIC'],
    [/\b(guit hub|guitirrabi|guirabi)\b/gi, 'GitHub'],
    [/\b(vis(o|u) cód|vis cod|vês code|vê[sz] c[oó]di)\b/gi, 'VS Code'],
    [/\b(ai pi ai|ei pi ai|api eis)\b/gi, 'API'],
    [/\b(djés on|jeison|gesson)\b/gi, 'JSON'],
    [/\b(s qu[ée]l|esse qu[ée]l|escu[ée]l)\b/gi, 'SQL'],
    [/\b(po(s|z)gris|postgrês)\b/gi, 'PostgreSQL'],
    [/\b(redís|réd[ie]s)\b/gi, 'Redis'],
    [/\b(open ei ai|openei|opena[ií])\b/gi, 'OpenAI'],
    [/\b(djemini|geminai)\b/gi, 'Gemini'],
    [/\b(cl[oó]di|cl[oó]de)\b/gi, 'Claude'],
    [/\b(estack ovurfláu|stack ovurfláu)\b/gi, 'Stack Overflow'],
  ];
  let normalized = text;
  for (const [re, repl] of correctionMap) normalized = normalized.replace(re, repl);

  const promptForAI = normalized === text
    ? text
    : `Pergunta (transcrição PT-BR de fala, pode ter erros fonéticos em termos técnicos em inglês — interprete com bom senso):\n\n${normalized}\n\n(Original com possíveis erros: "${text}")`;

  try {
    const aiModel = configService.getAiModel();
    let resposta;

    if (aiModel === 'openIa') {
      const token = configService.getOpenIaToken();
      const instruction = configService.getPromptInstruction();
      if (!token) {
        if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
          osNotificationWindow.webContents.executeJavaScript(`window.showResponse('Token da OpenAI não configurado.')`);
        }
        return;
      }
      const openAiModel = configService.getOpenAiModel();
      resposta = await OpenAIService.makeOpenAIRequest(promptForAI, token, instruction, openAiModel);
    } else {
      if (backendIsOnline) {
        try { resposta = await BackendService.responder(promptForAI); }
        catch (_) { resposta = await GeminiService.responder(promptForAI); }
      } else {
        resposta = await GeminiService.responder(promptForAI);
      }
    }

    // Show response in the live window (increase height to fit)
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.setSize(380, 400);
      osNotificationWindow.webContents.executeJavaScript(
        `window.showResponse(${JSON.stringify(resposta || 'Sem resposta.')})`
      ).catch(() => {});
    }
  } catch (error) {
    console.error('Error in processOsQuestionWithWindow:', error);
    if (osNotificationWindow && !osNotificationWindow.isDestroyed()) {
      osNotificationWindow.webContents.executeJavaScript(`window.showResponse('Erro ao gerar resposta.')`);
    }
  }
}

// === Heurística de roteamento OCR vs VISÃO ===
// Decide se vale a pena pagar pelo modo "image_url" (caro, ~150-1000 tokens
// extras) ou se o OCR já foi suficiente (TEXTO puro, barato).
//
// Manda pra VISÃO quando:
//  - OCR vazio ou muito curto (provavelmente print de gráfico/equação imagem-only)
//  - Texto tem ruído alto (muitos chars não-alfanuméricos: símbolos quebrados de OCR)
//  - Detecta operadores matemáticos (×, ÷, =, ², √, ∫, Σ, π, ≈, ≤, ≥, frações)
//  - Detecta padrão de múltipla escolha (linhas com A) B) C) ou A. B. C.)
//  - Detecta tabelas/grids (muitas linhas curtas alinhadas, separadores |)
//  - Razão "ruído/total" > 30%
function shouldUseVisionFor(ocrText) {
  if (!ocrText || !ocrText.trim()) {
    return { useVision: true, reason: 'OCR vazio (provável imagem sem texto)' };
  }
  const t = ocrText.trim();
  if (t.length < 25) {
    return { useVision: true, reason: `OCR curto demais (${t.length} chars)` };
  }

  // 1) Símbolos matemáticos / equações
  const mathSymbols = /[×÷±≠≈≤≥∞√∫∑∏πθλμωΩ²³⁴⁵⁶⁷⁸⁹⁰₀₁₂₃₄₅]/;
  if (mathSymbols.test(t)) {
    return { useVision: true, reason: 'símbolos matemáticos detectados' };
  }
  // Operadores ASCII: x= ou =? em contexto numérico (sinal de "conta")
  if (/\d\s*[x*+\-/=]\s*\d/.test(t) && /=\s*\?/.test(t)) {
    return { useVision: true, reason: 'expressão matemática com "=?" (problema a resolver)' };
  }
  // Frações tipo "1/2", "3/4" misturadas com palavras curtas
  if (/\d+\/\d+/.test(t) && t.split(/\s+/).filter(w => w.length < 3).length > 5) {
    return { useVision: true, reason: 'fração + texto picotado' };
  }

  // 2) Padrão de múltipla escolha (A) B) C)) ou (A. B. C.)
  const choicePattern = /(^|\n)\s*[A-Fa-f][).]\s+\S/g;
  const choices = (t.match(choicePattern) || []).length;
  if (choices >= 3) {
    // Tem 3+ alternativas mas OCR pode ter perdido as opções
    // Se as linhas das alternativas forem curtas/quebradas, manda visão
    return { useVision: true, reason: `múltipla escolha (${choices} alternativas)` };
  }

  // 3) Razão de ruído (caracteres não-imprimíveis-comuns)
  const totalChars = t.length;
  // Conta caracteres "esquisitos" típicos de OCR ruim:
  // chars Unicode raros, sequências de pontuação, símbolos isolados
  const noiseChars = (t.match(/[^\w\s.,!?;:()'"\-–—\/áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ\u00A0]/g) || []).length;
  const noiseRatio = noiseChars / totalChars;
  if (noiseRatio > 0.20) {
    return { useVision: true, reason: `OCR ruidoso (${(noiseRatio * 100).toFixed(0)}% chars estranhos)` };
  }

  // 4) Muitas "palavras" de 1-2 caracteres seguidas → texto picotado
  const words = t.split(/\s+/).filter(Boolean);
  const tinyWords = words.filter(w => w.length <= 2 && /[a-zA-Z]/.test(w)).length;
  if (words.length > 10 && tinyWords / words.length > 0.40) {
    return { useVision: true, reason: `texto picotado (${tinyWords}/${words.length} palavras de 1-2 chars)` };
  }

  // 5) Tabelas/grids: muitos | em linhas curtas
  const pipeLines = t.split('\n').filter(l => (l.match(/\|/g) || []).length >= 2).length;
  if (pipeLines >= 3) {
    return { useVision: true, reason: 'aparenta tabela/grid' };
  }

  // OCR limpo o suficiente — TEXTO basta
  return { useVision: false, reason: `OCR limpo (${words.length} palavras, ruído ${(noiseRatio * 100).toFixed(0)}%)` };
}

async function processOsQuestion(text, image = null) {
  console.log(`🤖 processOsQuestion called - FORCEFULLY closing any notifications`);

  try {
    const aiModel = configService.getAiModel();
    let resposta;

    // === ROTEAMENTO INTELIGENTE: TEXTO vs VISÃO ===
    // Política: imagem é ~150 tokens (low) ou ~1000+ tokens (high). Caro pra
    // mandar sempre. Estratégia:
    //   1) Roda OCR
    //   2) Decide se o OCR "basta" (texto limpo, sem matemática complexa,
    //      sem ruído fonético) → manda só TEXTO (barato)
    //   3) Se o OCR estiver bagunçado, tiver matemática/equação, tabela,
    //      gráfico, símbolos, ou for muito curto → manda IMAGEM em high detail
    let extractedText = '';
    let useVision = false;
    let visionReason = '';

    if (image) {
      try {
        extractedText = await TesseractService.getTextFromImage(image);
        console.log(`✅ OCR: ${extractedText.substring(0, 100).replace(/\n/g, ' ')}...`);
      } catch (ocrError) {
        console.warn('OCR falhou:', ocrError.message || ocrError);
        extractedText = '';
      }

      const decision = shouldUseVisionFor(extractedText);
      useVision = decision.useVision;
      visionReason = decision.reason;
      console.log(`🧭 Roteamento: ${useVision ? 'VISÃO' : 'TEXTO'} — ${visionReason}`);

      if (useVision) {
        // PROMPT LIMPO no modo visão: o OCR ruim só confunde o modelo.
        // O texto extra é mínimo — a imagem fala por si. Damos só dicas
        // que o modelo precisa pra desambiguar (ex.: "x" pode ser multiplicação).
        text = (text && text.trim() ? `${text}\n\n` : '')
          + 'Analise a IMAGEM com atenção. Responda conforme as regras do sistema.\n\n'
          + 'IMPORTANTE: na imagem, "x" entre dois números significa MULTIPLICAÇÃO '
          + '(ex.: "11x2" = 11 × 2 = 22, NÃO é 11 ao quadrado). '
          + 'Notação de potência seria "11²" ou "11^2".';
      } else {
        // OCR limpo: monta um prompt de texto puro com o conteúdo extraído
        text = (text && text.trim() ? `${text}\n\n` : '')
          + `Conteúdo extraído de uma captura de tela:\n\n${extractedText}\n\nResponda conforme as regras do sistema.`;
      }
    }

    if (aiModel === 'openIa') {
      const token = configService.getOpenIaToken();
      const instruction = configService.getPromptInstruction();
      if (!token) {
        console.log(`🔔 No OpenAI token, closing notification and showing error`);
        // Immediately close any loading notification and wait
        destroyNotificationWindow();
        await new Promise(resolve => setTimeout(resolve, 200));
        createOsNotificationWindow('response', 'Token da OpenAI não configurado.');
        return;
      }
      const sendImage = image && useVision;
      // Modelo dedicado pra visão: nano confunde notação básica em imagens.
      // gpt-4o-mini é barato e muito mais preciso em OCR/visual reasoning.
      const openAiModel = sendImage
        ? configService.getOpenAiVisionModel()
        : configService.getOpenAiModel();
      console.log(`🤖 OpenAI ${openAiModel}${sendImage ? ' [VISÃO high]' : ' [TEXTO]'}...`);
      resposta = await OpenAIService.makeOpenAIRequest(
        text,
        token,
        instruction,
        openAiModel,
        sendImage ? image : null
      );
      console.log(`🤖 Got OpenAI response: ${resposta.substring(0, 50)}...`);
    } else {
      // Backends sem visão (Gemini local, llama): só TEXTO
      if (backendIsOnline) {
        try {
          resposta = await BackendService.responder(text);
        } catch (backendError) {
          console.error("Backend failed, using Gemini fallback:", backendError);
          resposta = await GeminiService.responder(text);
        }
      } else {
        resposta = await GeminiService.responder(text);
      }
    }

    console.log(`🔔 Destroying loading notification and showing response`);
    
    // CRITICAL: Ensure the loading notification is completely destroyed before creating response
    destroyNotificationWindow();
    
    // Wait a bit longer to ensure the window is fully destroyed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Show response in OS notification with HTML formatting  
    const formattedResponse = formatToHTML(resposta);
    createOsNotificationWindow('response', formattedResponse);
    
  } catch (error) {
    console.error('Error in processOsQuestion:', error);
    
    // Destroy any existing notification before showing error
    destroyNotificationWindow();
    
    // Wait to ensure previous notification is completely destroyed
    await new Promise(resolve => setTimeout(resolve, 300));
    
    createOsNotificationWindow('response', 'Erro ao gerar resposta.');
  }
}

// ========== History IPC Handlers ==========
ipcMain.handle('get-last-three-sessions', async () => {
  try {
    return historyService.getLastThreeSessions();
  } catch (error) {
    console.error('Erro ao obter últimas 3 sessões:', error);
    return [];
  }
});

ipcMain.handle('get-session-by-id', async (event, sessionId) => {
  try {
    return historyService.getSessionById(sessionId);
  } catch (error) {
    console.error('Erro ao obter sessão:', error);
    return null;
  }
});

ipcMain.handle('add-message', async (event, sessionId, role, content) => {
  try {
    const finalSessionId = await historyService.addMessage(sessionId, role, content);
    return { success: true, sessionId: finalSessionId };
  } catch (error) {
    console.error('Erro ao adicionar mensagem ao histórico:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-new-session', async (event, title) => {
  try {
    const session = await historyService.createNewSession(title);
    return session;
  } catch (error) {
    console.error('Erro ao criar sessão:', error);
    return null;
  }
});

ipcMain.handle('new-chat', async () => {
  try {
    const session = await historyService.createNewSession('Nova conversa');
    return session;
  } catch (error) {
    console.error('Erro ao criar novo chat:', error);
    return null;
  }
});

ipcMain.handle('delete-session', async (event, sessionId) => {
  try {
    const success = await historyService.deleteSession(sessionId);
    if (success) {
      console.log(`✓ Sessão ${sessionId} deletada com sucesso`);
    }
    return { success };
  } catch (error) {
    console.error('Erro ao deletar sessão:', error);
    return { success: false, error: error.message };
  }
});

// ========== End History Handlers ==========

app.whenReady().then(async () => {
  configService.initialize();
  OpenAIService.initialize();
  await historyService.initialize();
  await createWindow();
  ipcService.start({
    toggleRecording,
    moveToDisplay,
    bringWindowToFocus,
    captureScreen,
    captureScreenAuto: captureFullScreenAuto,
    openConfig: createConfigWindow,
  });

  // Envia o status inicial do modo debug para a janela principal
  if (mainWindow && !mainWindow.isDestroyed()) {
    const initialDebugStatus = configService.getDebugModeStatus();
    mainWindow.webContents.send("debug-status-changed", initialDebugStatus);
  }
  
  // Inicializar monitoramento de clipboard se print mode estiver ativo
  const initialPrintMode = configService.getPrintModeStatus();
  if (initialPrintMode) {
    console.log('🎯 Print mode estava ativo, iniciando monitoramento de clipboard...');
    startClipboardMonitoring();
    // Capture tool monitoring só no OS integration mode, não no print mode básico
  }
  
  // Inicializar OS integration mode se estiver ativo
  const initialOsIntegration = configService.getOsIntegrationStatus();
  console.log('🔗 Checking OS integration status:', initialOsIntegration);
  if (initialOsIntegration) {
    console.log('🔗 OS integration estava ativo, iniciando modo de integração...');
    // Delay to ensure everything is loaded
    setTimeout(() => {
      switchToOsIntegrationMode();
    }, 1000);
    
    // Ensure clipboard monitoring is started for OS integration mode
    if (!initialPrintMode) {
      // If print mode wasn't already active, we need to start clipboard monitoring
      // since OS integration automatically enables print mode
      configService.setPrintModeStatus(true);
      startClipboardMonitoring();
    }
    // Start capture tool monitoring for OS integration
    startCaptureToolMonitoring();
  }

  // Verifica o status do backend ao iniciar e depois periodicamente
  checkBackendStatus();
  setInterval(checkBackendStatus, 60000); // Verifica a cada 60 segundos
});

// Ensure shortcuts are active after app is ready
app.on("browser-window-focus", () => {
  registerGlobalShortcuts();
});

app.on("window-all-closed", () => {
  console.log("All windows closed");
  clearInterval(sharingCheckInterval);
  if (recordingProcess) {
    recordingProcess.kill("SIGTERM");
  }
  realtimeAssistantService.stop().catch(() => {});
  if (process.platform !== "darwin" && !mainWindow) {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopClipboardMonitoring();
  realtimeAssistantService.stop().catch(() => {});
});
