const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  Notification,
} = require("electron");
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
const ipcService = require("./services/ipcService.js");
const configService = require("./services/configService.js");

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

function createConfigWindow() {
  if (configWindow) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 500,
    height: 350,
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

  osInputWindow.on('blur', () => {
    if (osInputWindow && !osInputWindow.isDestroyed()) {
      osInputWindow.close();
    }
  });

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
  }

  osNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
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

  // Position in top right corner
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  osNotificationWindow.setPosition(width - windowWidth - 20, 60);

  // Simply load the appropriate HTML file - let the files handle their own content
  let filePath;
  
  if (type === 'loading') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'loading.html');
  } else if (type === 'recording') {
    filePath = path.join(__dirname, 'os-integration', 'notifications', 'recording.html');
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
    // COSMIC Desktop has issues with interactive screenshot tools in Electron
    const isCosmic = process.env.XDG_CURRENT_DESKTOP === "COSMIC";
    
    if (isCosmic) {
      console.log('📸 Captura de tela não suportada no modo integrado do COSMIC');
      createOsNotificationWindow('response', 'Captura de tela não disponível no modo integrado. Use o modo janela (Ctrl+Shift+C para abrir configurações).');
      return;
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
        { combo: "Ctrl+Shift+1", action: "move-to-display-0" },
        { combo: "Ctrl+Shift+2", action: "move-to-display-1" },
      ]
    : [
        { combo: "CommandOrControl+D", action: "toggle-recording" },
        { combo: "CommandOrControl+I", action: "manual-input" },
        { combo: "CommandOrControl+A", action: "focus-window" },
        { combo: "CommandOrControl+Shift+C", action: "open-config" },
        { combo: "CommandOrControl+Shift+X", action: "capture-screen" },
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

// Função para detectar o sink de áudio padrão do sistema
async function getDefaultAudioSink() {
  try {
    const { stdout } = await execPromise('pactl get-default-sink');
    const defaultSink = stdout.trim();
    console.log(`🔊 Default audio sink detected: ${defaultSink}`);
    return `${defaultSink}.monitor`;
  } catch (error) {
    console.error('❌ Error detecting default sink, using fallback:', error.message);
    // Fallback para @DEFAULT_MONITOR@ que é um alias do PipeWire
    return '@DEFAULT_MONITOR@';
  }
}

async function toggleRecording() {
  try {
    if (isRecording) {
      if (recordingProcess) {
        recordingProcess.kill("SIGTERM");
        recordingProcess = null;
      }
      isRecording = false;
      console.log("Recording stopped");
      
      // Check if OS integration mode is enabled
      const isOsIntegration = configService.getOsIntegrationStatus();
      if (isOsIntegration) {
        // FORCE CLOSE any existing notification first using helper function
        destroyNotificationWindow();
        // Use OS notification for recording stopped
        createOsNotificationWindow('loading', 'Processando áudio...');
      } else {
        // Use system notification
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({
            title: "Helper-Node",
            body: "Ok, aguarde...",
            silent: true,
          }).show();
        }
        mainWindow.webContents.send("toggle-recording", {
          isRecording,
          audioFilePath,
        });
      }
      try {
        await fs.access(audioFilePath);
        console.log("Audio file created:", audioFilePath);
        
        const isOsIntegration = configService.getOsIntegrationStatus();
        if (!isOsIntegration) {
          mainWindow.webContents.send("transcription-start", { audioFilePath });
        }

        // Acelerar o áudio em 2x com ffmpeg
        const spedUpAudioPath = path.join(__dirname, "output_2x.wav");
        // const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=2.0" -y ${spedUpAudioPath}`;
        // const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=3.0" -y ${spedUpAudioPath}`;
        const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=2.0" -y ${spedUpAudioPath}`;
        await execPromise(ffmpegCommand);
        console.log("Audio sped up by 2x:", spedUpAudioPath);

        // Iniciar transcrição com Whisper usando o áudio acelerado
        const audioText = await transcribeAudio(spedUpAudioPath);

        // Limpar arquivos de áudio após transcrição bem-sucedida
        try {
          await fs.unlink(audioFilePath);
          console.log("Arquivo de áudio original deletado:", audioFilePath);
        } catch (unlinkError) {
          console.error("Erro ao deletar arquivo de áudio original:", unlinkError);
        }
        
        try {
          await fs.unlink(spedUpAudioPath);
          console.log("Arquivo de áudio acelerado deletado:", spedUpAudioPath);
        } catch (unlinkError) {
          console.error("Erro ao deletar arquivo de áudio acelerado:", unlinkError);
        }

        if (audioText === "[BLANK_AUDIO]") {
          console.log("Áudio em branco detectado, não enviando para a IA.");
          if (isOsIntegration) {
            createOsNotificationWindow('response', 'Nenhum áudio detectado. Tente novamente.');
          } else if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({
              title: "Helper-Node",
              body: "Nenhum áudio detectado. Tente novamente.",
              silent: true,
            }).show();
          }
          return; // Sai da função sem chamar getIaResponse
        }
        
        // Check AI model configuration and use appropriate method
        const aiModel = configService.getAiModel();
        console.log("Audio transcription - using AI model:", aiModel);
        
        if (isOsIntegration) {
          // Process using OS integration mode
          await processOsQuestion(audioText);
        } else if (aiModel === 'llama-stream') {
          // Use stream method for llama-stream
          mainWindow.webContents.send("send-to-gemini-stream-auto", audioText);
        } else {
          // Use regular method for other models
          getIaResponse(audioText);
        }
      } catch (error) {
        isRecording = false;
        console.error("Audio file not found or processing failed:", error);
        
        // Limpar arquivos de áudio mesmo em caso de erro
        try {
          await fs.unlink(audioFilePath).catch(() => {});
          await fs.unlink(path.join(__dirname, "output_2x.wav")).catch(() => {});
          console.log("Arquivos de áudio limpos após erro");
        } catch (cleanupError) {
          console.error("Erro ao limpar arquivos de áudio:", cleanupError);
        }
        // mainWindow.webContents.send('transcription-error', 'No audio file created');
      }
    } else {
      await fs.unlink(audioFilePath).catch(() => {});
      
      // Detectar automaticamente o sink de áudio correto
      const audioTarget = await getDefaultAudioSink();
      const command = `pw-record --target=${audioTarget} ${audioFilePath}`;
      console.log("Executing:", command);
      recordingProcess = exec(command, (error) => {
        if (error && error.signal !== "SIGTERM" && error.code !== 0) {
          console.error("Recording error:", error);
          // mainWindow.webContents.send('transcription-error', 'Recording failed');
        } else {
          console.log("Recording process ended normally");
        }
      });
      isRecording = true;
      console.log("Recording started");
      
      // Check if OS integration mode is enabled
      const isOsIntegration = configService.getOsIntegrationStatus();
      if (isOsIntegration) {
        // Use OS notification for recording started
        createOsNotificationWindow('recording', 'Gravando áudio...');
      } else {
        // Use system notification and send to main window
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
          new Notification({
            title: "Helper-Node",
            body: "Gravando...",
            silent: true,
          }).show();
        }
        mainWindow.webContents.send("toggle-recording", {
          isRecording,
          audioFilePath,
        });
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
        resposta = await OpenAIService.makeOpenAIRequest(text, token, instruction);
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

async function transcribeAudio(filePath) {
  try {
    // Obter a duração do áudio
    const duration = await getAudioDuration(filePath);

    const whisperPath = path.join(__dirname, "whisper/build/bin/whisper-cli");
    const modelPathTiny = path.join(__dirname, "whisper/models/ggml-tiny.bin");
    const modelPathSmall = path.join(
      __dirname,
      "whisper/models/ggml-small.bin"
    );

    // Verificar se os modelos existem
    if (!fs2.existsSync(modelPathTiny)) {
      throw new Error(`Modelo tiny não encontrado: ${modelPathTiny}`);
    }
    if (!fs2.existsSync(modelPathSmall)) {
      throw new Error(`Modelo small não encontrado: ${modelPathSmall}`);
    }

    // Escolher modelo e parâmetros com base na duração
    let modelPath, command;
    if (duration > 20) {
      modelPath = modelPathTiny;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l auto --threads 16 --no-timestamps --best-of 3 --beam-size 2`;
      console.log("Usando modelo tiny");
    } else {
      modelPath = modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l auto --threads 18 --no-timestamps --best-of 3 --beam-size 2`;
      console.log("Usando modelo small");
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
        mainWindow.webContents.send("transcription-result", { cleanText });

        if (
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
    mainWindow.webContents.send(
      "transcription-error",
      "Failed to transcribe audio"
    );
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
        resposta = await OpenAIService.makeOpenAIRequest(text, token, instruction);
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

// Handler to cancel recording from OS notification
ipcMain.on("cancel-recording", () => {
  console.log('Cancel recording requested from OS notification');
  
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

async function processOsQuestion(text, image = null) {
  console.log(`🤖 processOsQuestion called - FORCEFULLY closing any notifications`);
  
  try {
    const aiModel = configService.getAiModel();
    let resposta;
    
    // If image is provided, extract text from it first
    let extractedText = '';
    if (image) {
      console.log(`🖼️ Processing pasted image with Tesseract OCR...`);
      try {
        extractedText = await TesseractService.getTextFromImage(image);
        console.log(`✅ Extracted text: ${extractedText.substring(0, 100)}...`);
        // Combine the text input with extracted text
        text = text ? `${text}\n\nTexto extraído da imagem:\n${extractedText}` : extractedText;
      } catch (ocrError) {
        console.error('Error extracting text from image:', ocrError);
        text = text ? text : 'Erro ao extrair texto da imagem.';
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
      console.log(`🤖 Making OpenAI request...`);
      resposta = await OpenAIService.makeOpenAIRequest(text, token, instruction);
      console.log(`🤖 Got OpenAI response: ${resposta.substring(0, 50)}...`);
    } else {
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

app.whenReady().then(async () => {
  configService.initialize();
  OpenAIService.initialize();
  await createWindow();
  ipcService.start({
    toggleRecording,
    moveToDisplay,
    bringWindowToFocus,
    captureScreen,
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
  if (process.platform !== "darwin" && !mainWindow) {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopClipboardMonitoring();
});
