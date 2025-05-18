const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

let mainWindow;
let sharingCheckInterval;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        backgroundColor: '#00000000',
        transparent: true,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#222222',
            symbolColor: '#ffffff'
        },
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'preload.js')
        },
        focusable: true,
        alwaysOnTop: false,
        show: false
    });

     mainWindow.on('ready-to-show', () => {
        mainWindow.showInactive();
        // Armazena o display inicial
        currentDisplayId = screen.getDisplayNearestPoint(mainWindow.getBounds()).id;
    });

    mainWindow.loadFile('index.html');

    setupScreenSharingDetection();

    globalShortcut.register('CommandOrControl+D', () => {
        mainWindow.webContents.send('toggle-recording');
    });

    globalShortcut.register('CommandOrControl+P', () => {
        mainWindow.webContents.send('capture-screen');
    });

    globalShortcut.register('CommandOrControl+A', () => {
        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();  // Agora ok, pois foi ação do usuário
    });
}

function setupScreenSharingDetection() {
    // Verificação inicial
    checkScreenSharing();

    // Monitora eventos de display
    screen.on('display-metrics-changed', () => {
        checkScreenSharing();
        updateWindowPosition();
    });

    // Verificação periódica otimizada
    setInterval(checkScreenSharing, 3000);
}

async function checkScreenSharing() {
    try {
        const isSharing = await detectScreenSharing();
        if (isSharing !== sharingActive) {
            sharingActive = isSharing;
            handleScreenSharing();
        }
    } catch (error) {
        console.error('Erro na verificação:', error);
    }
}

// Adicione no início do arquivo
let currentDisplayId = null;
let sharingActive = false;

async function detectScreenSharing() {
    try {
        if (process.platform === 'darwin') {
            // macOS - verifica processos de compartilhamento
            const { stdout } = await execPromise('pgrep -fl "ScreenSharingAgent|Chrome"');
            return stdout.toString().includes('ScreenSharingAgent') || 
                   (stdout.toString().includes('Chrome') && stdout.toString().includes('--sharing-screen'));
        } else if (process.platform === 'win32') {
            // Windows - verifica Chrome em modo de compartilhamento
            const { stdout } = await exec(
                'tasklist /fi "IMAGENAME eq chrome.exe" /v | findstr /i "sharing"'
            );
            return stdout.toString().length > 0;
        } else {
            // Linux - verifica janelas de compartilhamento
            const { stdout } = await execPromise('xwininfo -root -tree | grep -i "chromium"');
            return stdout.toString().includes('sharing');
        }
    } catch (error) {
        console.error('Erro na detecção:', error);
        return false;
    }
}

// Atualize a função updateWindowPosition
function updateWindowPosition() {
    const displays = screen.getAllDisplays();
    const currentDisplay = screen.getDisplayNearestPoint(mainWindow.getBounds());
    
    if (displays.length < 2) {
        mainWindow.hide();
        return;
    }

    // Verifica se está no mesmo display que está sendo compartilhado
    const sharingDisplay = getSharingDisplay();
    if (sharingDisplay && sharingDisplay.id === currentDisplay.id) {
        const otherDisplay = displays.find(d => d.id !== currentDisplay.id);
        if (otherDisplay) {
            const { x, y } = otherDisplay.bounds;
            mainWindow.setPosition(x + 50, y + 50);
            mainWindow.showInactive();
            currentDisplayId = otherDisplay.id;
        }
    }
}

// Adicione esta nova função auxiliar
function getSharingDisplay() {
    // Implementação específica por sistema operacional
    // Retorna o display que está sendo compartilhado ou null
    // Esta é uma implementação simplificada - pode precisar de ajustes
    return screen.getPrimaryDisplay();
}

function handleScreenSharing() {
    if (sharingActive) {
        updateWindowPosition();
    } else {
        mainWindow.showInactive();
    }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    clearInterval(sharingCheckInterval);
    if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// IPC Handlers
ipcMain.on('toggle-recording', () => {
    console.log('Gravação iniciada/parada');
});

ipcMain.on('capture-screen', () => {
    console.log('Captura de tela solicitada');
});