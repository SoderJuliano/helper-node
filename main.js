const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  screen,
  Notification,
} = require("electron");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");
const execPromise = util.promisify(exec);
const fs = require("fs").promises;
const fs2 = require("fs");
// const LlamaService = require('./services/llamaService.js');
const GeminiService = require("./services/geminiService.js"); // Mantido para a funcionalidade de cancelamento
const BackendService = require("./services/backendService.js");
const TesseractService = require("./services/tesseractService.js");
const ipcService = require("./services/ipcService.js");
const configService = require("./services/configService.js");

let backendIsOnline = false;
let configWindow = null;

async function checkBackendStatus() {
  backendIsOnline = await BackendService.ping();
  if (backendIsOnline) {
    console.log("Backend is online.");
  } else {
    console.log("Backend is offline.");
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
const audioFilePath = path.join(__dirname, "output.wav");

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
      // mainWindow.webContents.openDevTools();

      // Mover o registro de atalhos para aqui
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("screen-capturing", true);

    // Primeiro, escolhe a melhor ferramenta disponível para o ambiente
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

      if (!screenshotSuccess) {
        mainWindow.webContents.send("transcription-error", "A captura de tela foi cancelada ou falhou. Certifique-se de selecionar uma área e que a ferramenta de captura está instalada.");
        console.error("Screenshot tool did not produce a file: ", tmpPng);
        return;
      }

      // Se chegou aqui, temos um PNG capturado: envia para OCR
      const base64Image = await fs.readFile(tmpPng, { encoding: "base64" });
      await TesseractService.processPastedImage(`data:image/png;base64,${base64Image}`, mainWindow);
      console.log("Screenshot OCR completed");
    } catch (err) {
      console.error("Screen capture error:", err);
      mainWindow.webContents.send("transcription-error", "Falha ao capturar a tela");
    } finally {
      try { await fs.unlink(tmpPng); } catch (_) {}
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

async function registerGlobalShortcuts() {
  if (!mainWindow) return;

  // Limpa atalhos existentes primeiro
  globalShortcut.unregisterAll();

  const shortcuts = [
    { combo: "CommandOrControl+D", action: "toggle-recording" },
    { combo: "CommandOrControl+I", action: "manual-input" },
    { combo: "CommandOrControl+A", action: "focus-window" },
    { combo: "CommandOrControl+Shift+C", action: "open-config" },
    { combo: "CommandOrControl+Shift+F", action: "capture-screen" },
  ];

  shortcuts.forEach(({ combo, action }) => {
    const registered = globalShortcut.register(combo, async () => {
      if (action === "open-config") {
        createConfigWindow();
        return;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(action);

        // Tratamento especial para o atalho de focus
        if (action === "focus-window" && mainWindow.isMinimized()) {
          mainWindow.restore();
        }

        if (action === "toggle-recording") {
          await toggleRecording();
        }

        if (action === "capture-screen") {
          await captureScreen();
        }
      }
    });

    if (!registered) {
      console.error(`Failed to register shortcut: ${combo}`);
    } else {
      console.log(`Shortcut registered: ${combo}`);
    }
  });
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
      try {
        await fs.access(audioFilePath);
        console.log("Audio file created:", audioFilePath);
        mainWindow.webContents.send("transcription-start", { audioFilePath });

        // Acelerar o áudio em 2x com ffmpeg
        const spedUpAudioPath = path.join(__dirname, "output_2x.wav");
        // const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=2.0" -y ${spedUpAudioPath}`;
        // const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=3.0" -y ${spedUpAudioPath}`;
        const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=2.0" -y ${spedUpAudioPath}`;
        await execPromise(ffmpegCommand);
        console.log("Audio sped up by 2x:", spedUpAudioPath);

        // Iniciar transcrição com Whisper usando o áudio acelerado
        const audioText = await transcribeAudio(spedUpAudioPath);

        if (audioText === "[BLANK_AUDIO]") {
          console.log("Áudio em branco detectado, não enviando para a IA.");
          if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({
              title: "Helper-Node",
              body: "Nenhum áudio detectado. Tente novamente.",
              silent: true,
            }).show();
          }
          return; // Sai da função sem chamar getIaResponse
        }
        getIaResponse(audioText);
      } catch (error) {
        isRecording = false;
        console.error("Audio file not found or processing failed:", error);
        // mainWindow.webContents.send('transcription-error', 'No audio file created');
      }
    } else {
      await fs.unlink(audioFilePath).catch(() => {});
      const command = `pw-record --target=auto-null.monitor ${audioFilePath}`;
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

async function getIaResponse(text) {
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

    clearInterval(waitingNotificationInterval);
    waitingNotificationInterval = null;

    mainWindow.webContents.send("gemini-response", { resposta });

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
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l auto --best-of 2 --beam-size 2`;
      console.log("Usando modelo tiny");
    } else {
      modelPath = modelPathSmall;
      command = `${whisperPath} -m ${modelPath} -f ${filePath} -l auto --threads 16 --no-timestamps --best-of 2 --beam-size 2`;
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

function moveToDisplay(index) {
  const hyprlandDetected = isHyprland();
  console.log(`isHyprland() detectado: ${hyprlandDetected}`);

  if (hyprlandDetected) {
    const pid = process.pid;
    const workspace = index + 1; // Mapeia o índice 0 para o workspace 1, 1 para 2, etc.
    const command = `hyprctl dispatch movetoworkspace ${workspace},pid:${pid}`;

    console.log(`Executando comando Hyprland: ${command}`);
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error("--- Falha no Comando Hyprland ---");
        console.error(
          `Erro ao mover para o workspace: ${JSON.stringify(error, null, 2)}`
        );
        return;
      }
      if (stderr) {
        console.error("--- Stderr do Comando Hyprland ---");
        console.error(stderr);
      }
      console.log("--- Stdout do Comando Hyprland ---");
      console.log(stdout);
      mainWindow.focus(); // Tentar focar após mover
    });
  } else {
    // Lógica existente para KDE, GNOME, etc.
    console.log(`Movendo para o monitor ${index}`);
    const displays = screen.getAllDisplays();
    if (index < displays.length) {
      const display = displays[index];
      const bounds = display.bounds;

      const winWidth = 800;
      const winHeight = 600;
      const x = bounds.x + Math.round((bounds.width - winWidth) / 2);
      const y = bounds.y + Math.round((bounds.height - winHeight) / 2);

      mainWindow.setBounds({ x, y, width: winWidth, height: winHeight });
      mainWindow.show(); // Garante que a janela esteja visível
      mainWindow.focus();
    } else {
      console.log(`Monitor ${index + 1} não encontrado.`);
    }
  }
}

async function bringWindowToFocus() {
  console.log(
    "bringWindowToFocus: Tentando trazer a janela para o foco e abrir o input."
  );
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
    let resposta;
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
    event.sender.send("gemini-response", { resposta });
  } catch (error) {
    console.error("IPC: IA service error:", error);
    event.sender.send(
      "transcription-error",
      "Failed to process IA response from any source"
    );
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

// IPC Handlers for Language
ipcMain.handle("get-language", () => {
  return configService.getLanguage();
});

ipcMain.on("set-language", (event, language) => {
  configService.setLanguage(language);
});

app.whenReady().then(async () => {
  configService.initialize();
  await createWindow();
  ipcService.start({
    toggleRecording,
    moveToDisplay,
    bringWindowToFocus,
    captureScreen,
  });

  // Envia o status inicial do modo debug para a janela principal
  if (mainWindow && !mainWindow.isDestroyed()) {
    const initialDebugStatus = configService.getDebugModeStatus();
    mainWindow.webContents.send("debug-status-changed", initialDebugStatus);
  }

  // Verifica o status do backend ao iniciar e depois periodicamente
  checkBackendStatus();
  setInterval(checkBackendStatus, 60000); // Verifica a cada 60 segundos
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
});
