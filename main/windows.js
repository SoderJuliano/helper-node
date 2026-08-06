// main/windows.js
const {
  electron, path, os, crypto, exec, spawn, util, fs, fs2,
  BackendService, GeminiCliProvider, ClaudeCliProvider, TesseractService,
  OpenAIService, RealtimeAssistantService, RealtimeOpenAiService, ipcService,
  configService, edition, knowledgeBase, fileEditService, historyService,
  helperTools, workspace, agenticWorkflow, ollamaAgenticWorkflow,
  translationAssistant, visionGuide, platformScreenCapture, runTestMode,
  analyzeInterviewImage, cloudTranscribeAudio,
  ROOT_DIR, APP_ICON, HIDE_FROM_TASKBAR, IMAGE_COOLDOWN_MS, AUDIO_TMP_DIR,
  audioFilePath, SCREENSHOT_DIRS, PROJECT_SEARCH_SKIP_DIRS, TREE_HEAVY_DIRS,
  OS_LIVE_CONTINUATION_WINDOW_MS, OS_LIVE_SAMPLE_RATE, OS_LIVE_SILENCE_RMS,
  OS_LIVE_SILENCE_MS, OS_LIVE_MAX_MS, OS_LIVE_TMP_DIR,
  state, helpers,
  app, BrowserWindow, screen, Tray, Menu
} = require('./globals.js');

helpers.createConfigWindow = function() {
  if (state.configWindow) {
    state.configWindow.focus();
    return;
  }

  const isStealth = configService.getStealthModeStatus();

  state.configWindow = new BrowserWindow({
    width: 640,
    height: 680,
    minWidth: 480,
    minHeight: 420,
    title: "Configurações",
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    hasShadow: process.platform !== 'win32',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    skipTaskbar: isStealth,
    icon: APP_ICON,
  });

  state.configWindow.loadFile("config.html");
  helpers.applyStealthProtection(state.configWindow);
  state.configWindow.setAlwaysOnTop(true, "screen-saver");

  state.configWindow.on("closed", () => {
    state.configWindow = null;
  });
}

helpers.createPreferencesWindow = function() {
  if (state.preferencesWindow) {
    state.preferencesWindow.focus();
    return;
  }

  const isStealth = configService.getStealthModeStatus();

  state.preferencesWindow = new BrowserWindow({
    width: 640,
    height: 720,
    minWidth: 480,
    minHeight: 460,
    title: "Preferências do Usuário",
    backgroundColor: "#00000000",
    transparent: true,
    frame: false,
    hasShadow: process.platform !== 'win32',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    skipTaskbar: isStealth,
    icon: APP_ICON,
  });

  state.preferencesWindow.loadFile("preferences.html");
  helpers.applyStealthProtection(state.preferencesWindow);
  state.preferencesWindow.setAlwaysOnTop(true, "screen-saver");

  state.preferencesWindow.on("closed", () => {
    state.preferencesWindow = null;
  });
}

helpers.createOsInputWindow = function() {
  if (state.osInputWindow && !state.osInputWindow.isDestroyed()) {
    state.osInputWindow.focus();
    return;
  }

  state.osInputWindow = new BrowserWindow({
    width: 600,
    height: 50,
    backgroundColor: '#00000000',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: process.platform !== 'win32',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(ROOT_DIR, "preload.js"),
    },
  });

  // Center on screen
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  state.osInputWindow.setPosition(
    Math.floor((width - 600) / 2), 
    Math.floor(height / 3)
  );

  // STEALTH: a caixa onde o usuário digita a pergunta não pode vazar em
  // gravação/compartilhamento (era a única overlay do fluxo sem proteção).
  helpers.applyStealthProtection(state.osInputWindow);
  try { state.osInputWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
  try { state.osInputWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}

  const inputHtml = path.join(ROOT_DIR, 'os-integration', 'notifications', 'integratedInput.html');

  state.osInputWindow.loadFile(inputHtml);

  // NOTE: deliberadamente NÃO fechamos no blur. Em Wayland/COSMIC operações de
  // paste de imagem do clipboard podem disparar um blur transitório, que
  // fechava a janela antes do usuário enviar. Use Esc para fechar.

  state.osInputWindow.on('closed', () => {
    state.osInputWindow = null;
  });
}

helpers.createOsNotificationWindow = function(type, content) {
  const isOsOn = configService.getOsIntegrationStatus();
  if (!isOsOn) {
    console.log(`⚠️ Blocked createOsNotificationWindow of type ${type} because OS Integration is disabled.`);
    return;
  }
  console.log(`🔔 Creating OS notification - Type: ${type}, Content: ${content ? content.substring(0, 50) + '...' : 'no content'}`);
  
  // FORCE CLOSE existing notification using new helper function
  helpers.destroyNotificationWindow();

  // Close capture window when loading or response appears
  if (type === 'loading' || type === 'response') {
    helpers.destroyCaptureWindow();
  }

  // Set dynamic dimensions based on type - matching the original HTML file dimensions
  let windowWidth = 160;
  let windowHeight = 96;

  if (type === 'response') {
    // 2x mais alta — entrevistas têm respostas longas (TRADUÇÃO + RESPOSTA + código)
    // Forçada no canto direito (posY baixo + posX = direita) — não centralizar.
    // 500px: largura maior pra blocos de código não cortarem palavras/linhas.
    windowWidth = 500;
    windowHeight = 560;
  }

  // Position in top right corner (afasta 30px da borda direita
  // pra evitar corte em compositores que reservam barra de scroll/overflow)
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const posX = Math.max(0, width - windowWidth - 30);
  const posY = 60;

  const isMovableOverlay = (type === 'response');
  // response PRECISA de focusable=true em COSMIC/Wayland pro X fechar e pra
  // seleção de texto/copy funcionar. Sem foco, eventos de clique e seleção
  // são dropados pelo compositor.
  const isFocusable = (type === 'response');

  state.osNotificationWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    // x/y nas options é mais respeitado pelo COSMIC/Wayland do que setPosition()
    x: posX,
    y: posY,
    backgroundColor: '#00000000',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: isMovableOverlay,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // Cria escondida e só mostra DEPOIS de posicionar — COSMIC/Wayland
    // centraliza janelas frameless ao mapear (mesma técnica da translation-overlay).
    show: false,
    // STEALTH OVERLAY: não rouba foco da janela ativa por padrão,
    // mas habilita pra response (X + copy funcionarem)
    focusable: isFocusable,
    // Some no compartilhamento de tela (Teams/Meet/Zoom screen-share)
    // — funciona em X11; em Wayland depende do compositor
    type: 'toolbar',
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(ROOT_DIR, "preload.js"),
    },
  });

  // Proteção multicamada: setContentProtection + xprop X11 UTILITY atom
  helpers.applyStealthProtection(state.osNotificationWindow);
  // Mantém SEMPRE acima de tudo (inclusive janelas em fullscreen de browser)
  state.osNotificationWindow.setAlwaysOnTop(true, 'screen-saver');
  state.osNotificationWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Reforça posição para compositores que ignoram x/y das options (COSMIC/Hyprland centralizam às vezes)
  try { state.osNotificationWindow.setPosition(posX, posY); } catch (_) {}
  try { state.osNotificationWindow.setBounds({ x: posX, y: posY, width: windowWidth, height: windowHeight }); } catch (_) {}
  // Re-aplica depois do load — alguns compositors movem a janela ao mostrar
  state.osNotificationWindow.once('ready-to-show', () => {
    try { state.osNotificationWindow.setBounds({ x: posX, y: posY, width: windowWidth, height: windowHeight }); } catch (_) {}
    try { state.osNotificationWindow.show(); } catch (_) {}
    // Auto-close controlado pelo main (cursor por posição global, não por foco).
    // Pequeno atraso pra garantir que o listener de IPC do renderer já registrou.
    if (type === 'response') {
      setTimeout(() => {
        if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) helpers.startResponseAutoClose();
      }, 300);
    }
  });
  // COSMIC/Hyprland às vezes movem/centralizam a janela DEPOIS do mapping —
  // reaplica a posição uma vez após o delay (mesma técnica da translation-overlay).
  setTimeout(() => {
    if (state.osNotificationWindow && !state.osNotificationWindow.isDestroyed()) {
      try { state.osNotificationWindow.setBounds({ x: posX, y: posY, width: windowWidth, height: windowHeight }); } catch (_) {}
    }
  }, 500);

  // Simply load the appropriate HTML file - let the files handle their own content
  let filePath;
  
  if (type === 'loading') {
    filePath = path.join(ROOT_DIR, 'os-integration', 'notifications', 'loading.html');
  } else if (type === 'recording') {
    filePath = path.join(ROOT_DIR, 'os-integration', 'notifications', 'recording.html');
  } else if (type === 'response') {
    filePath = path.join(ROOT_DIR, 'os-integration', 'notifications', 'response.html');
  }

  // Load the HTML file
  state.osNotificationWindow.loadFile(filePath).catch(error => {
    console.error(`Error loading ${type} notification file:`, error);
  });

  // Store content for response notifications - the HTML file will handle displaying it
  if (type === 'response' && content) {
    // The response.html file will handle the content display
    state.osNotificationWindow.webContents.once('dom-ready', () => {
      state.osNotificationWindow.webContents.executeJavaScript(`
        if (typeof window.setResponseContent === 'function') {
          window.setResponseContent(${JSON.stringify(content)});
        } else {
          document.body.innerHTML = ${JSON.stringify(content)} + '<button class="close-btn" onclick="window.close()" style="position:absolute;top:5px;right:8px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0;width:20px;height:20px;z-index:1000;">×</button>';
        }
      `);
    });
  }

  state.osNotificationWindow.on('closed', () => {
    console.log(`🔔 OS notification window closed - Type: ${type}`);
    state.osNotificationWindow = null;
  });
}

helpers.setupTray = function() {
  if (state.tray && !state.tray.isDestroyed()) return;
  try {
    const icon = APP_ICON;
    state.tray = new Tray(icon);
    state.tray.setToolTip("Helper Node");

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Abrir Helper Node",
        click: () => {
          if (state.mainWindow && !state.mainWindow.isDestroyed()) {
            if (state.mainWindow.isMinimized()) state.mainWindow.restore();
            state.mainWindow.show();
            state.mainWindow.focus();
          } else {
            helpers.createWindow();
          }
        }
      },
      {
        label: "Configurações",
        click: () => {
          helpers.createConfigWindow();
        }
      },
      {
        label: "Nexa AI Assistant (Janela Flutuante)",
        click: () => {
          const { toggleNexaWindow } = require("./nexa/index.js");
          toggleNexaWindow();
        }
      },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          app.quit();
        }
      }
    ]);

    state.tray.setContextMenu(contextMenu);

    state.tray.on("click", () => {
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        if (state.mainWindow.isVisible()) {
          if (state.mainWindow.isFocused()) {
            state.mainWindow.hide();
          } else {
            state.mainWindow.focus();
          }
        } else {
          if (state.mainWindow.isMinimized()) state.mainWindow.restore();
          state.mainWindow.show();
          state.mainWindow.focus();
        }
      } else {
        helpers.createWindow();
      }
    });
  } catch (e) {
    console.error("[tray] Erro ao criar System Tray:", e);
  }
};

helpers.createWindow = async function() {
  try {
    const isStealth = configService.getStealthModeStatus();

    state.mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      backgroundColor: "#00000000",
      transparent: true,
      frame: false,
      titleBarStyle: "hidden",
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(ROOT_DIR, "preload.js"),
        backgroundThrottling: false,
      },
      focusable: true,
      alwaysOnTop: false,
      show: false,
      skipTaskbar: isStealth,
      icon: APP_ICON,
      nodeIntegration: false,
    });

    // Sobrescreve o método show para evitar que a janela principal apareça se o modo Apenas Nexa estiver ativo
    const originalShow = state.mainWindow.show;
    state.mainWindow.show = function() {
      const nexaCfg = configService.getNexaConfig();
      if (nexaCfg && nexaCfg.enabled && nexaCfg.onlyNexa) {
        console.log("[MainWindow] Interceptado show() — ignorado porque o modo Apenas Nexa está ativo.");
        return;
      }
      return originalShow.apply(this, arguments);
    };

    helpers.applyStealthProtection(state.mainWindow);

    // macOS específico - oculta o ícone da Dock
    if (process.platform === "darwin") {
      app.dock.hide();
    }

    if (process.platform === "linux") {
      state.mainWindow.setSkipTaskbar(isStealth);
      state.mainWindow.setMenuBarVisibility(false);
      state.mainWindow.setTitle(""); // Janela sem título pode ajudar
    }

    if (process.env.XDG_SESSION_TYPE === "wayland") {
      state.mainWindow.setSkipTaskbar(isStealth);
      console.log("Running on Wayland");
    } else {
      console.log("Running on X11");
    }

    state.mainWindow.on("ready-to-show", () => {
      console.log("Window ready to show");
      state.mainWindow.show();
      helpers.ensureWindowVisible(state.mainWindow);
      state.currentDisplayId = screen.getDisplayNearestPoint(
        state.mainWindow.getBounds()
      ).id;
      // Re-registra atalhos quando a janela ganha foco
      helpers.registerGlobalShortcuts();
    });

    state.mainWindow.on("closed", () => {
      console.log("Main window closed");
      state.mainWindow = null;
    });

    const indexPath = path.join(ROOT_DIR, "index.html");
    try {
      await fs.access(indexPath);
      await state.mainWindow.loadFile(indexPath);
      console.log("Loaded index.html successfully");
    } catch (error) {
      console.error("Error: index.html not found at", indexPath, error);
      app.quit();
      return;
    }

    // Desabilitar detecção de compartilhamento de tela
    //helpers.setupScreenSharingDetection();

    // Configuração de permissões
    state.mainWindow.webContents.session.setPermissionRequestHandler(
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

