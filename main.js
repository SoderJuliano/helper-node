const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises; // Use promises for file checks
const execPromise = util.promisify(exec);

let mainWindow;
let sharingCheckInterval;
let currentDisplayId = null;
let sharingActive = false;

async function createWindow() {
    try {
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
                nodeIntegration: false,
                contextIsolation: true,
                preload: path.join(__dirname, 'preload.js')
            },
            focusable: true,
            alwaysOnTop: false,
            show: false,
            skipTaskbar: true // Hide from taskbar (X11/Wayland)
        });

        // Wayland-specific settings (optional, as skipTaskbar is usually enough)
        if (process.env.XDG_SESSION_TYPE === 'wayland') {
            mainWindow.setSkipTaskbar(true);
            console.log('Running on Wayland');
        } else {
            console.log('Running on X11');
        }

        mainWindow.on('ready-to-show', () => {
            console.log('Window ready to show');
            mainWindow.show(); // Use show() for testing to ensure visibility
            currentDisplayId = screen.getDisplayNearestPoint(mainWindow.getBounds()).id;
            mainWindow.webContents.openDevTools(); // Keep DevTools for debugging
        });

        // Verify index.html exists
        const indexPath = path.join(__dirname, 'index.html');
        try {
            await fs.access(indexPath);
            await mainWindow.loadFile(indexPath);
            console.log('Loaded index.html successfully');
        } catch (error) {
            console.error('Error: index.html not found at', indexPath, error);
            app.quit();
            return;
        }

        setupScreenSharingDetection();

        // Register global shortcuts
        globalShortcut.register('Control+Shift+D', () => {
            console.log('Toggle recording triggered');
            mainWindow.webContents.send('toggle-recording');
        });

        globalShortcut.register('Control+Shift+P', () => {
            console.log('Capture screen triggered');
            mainWindow.webContents.send('capture-screen');
        });

        globalShortcut.register('Control+Shift+A', () => {
            console.log('Show window triggered');
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show(); // Use show() for testing
        });
    } catch (error) {
        console.error('Error creating window:', error);
        app.quit();
    }
}

function setupScreenSharingDetection() {
    checkScreenSharing();
    sharingCheckInterval = setInterval(checkScreenSharing, 3000);

    screen.on('display-metrics-changed', () => {
        console.log('Display metrics changed');
        checkScreenSharing();
        updateWindowPosition();
    });
}

async function checkScreenSharing() {
    try {
        const isSharing = await detectScreenSharing();
        if (isSharing !== sharingActive) {
            sharingActive = isSharing;
            console.log('Screen sharing status changed:', sharingActive);
            handleScreenSharing();
        }
    } catch (error) {
        console.error('Error in screen sharing detection:', error);
    }
}

async function detectScreenSharing() {
    try {
        const sharingApps = ['chrome', 'teams', 'zoom', 'obs', 'discord'];
        const { stdout } = await execPromise(`ps aux | grep -E '${sharingApps.join('|')}' | grep -v grep`);
        const processes = stdout.toString().toLowerCase();
        console.log('Running processes:', processes);

        // Check for screen-sharing apps (simplified for reliability)
        return sharingApps.some(app => processes.includes(app));
    } catch (error) {
        console.error('Error detecting screen sharing:', error);
        return false;
    }
}

function updateWindowPosition() {
    try {
        const displays = screen.getAllDisplays();
        const currentDisplay = screen.getDisplayNearestPoint(mainWindow.getBounds());

        if (displays.length < 2) {
            console.log('Single display detected, hiding window');
            mainWindow.hide();
            return;
        }

        const sharingDisplay = getSharingDisplay();
        if (sharingDisplay && sharingDisplay.id === currentDisplay.id) {
            const otherDisplay = displays.find(d => d.id !== currentDisplay.id);
            if (otherDisplay) {
                const { x, y } = otherDisplay.bounds;
                mainWindow.setPosition(x + 50, y + 50);
                mainWindow.show(); // Use show() for testing
                currentDisplayId = otherDisplay.id;
                console.log('Moved window to display:', currentDisplayId);
            }
        } else {
            mainWindow.show(); // Use show() for testing
        }
    } catch (error) {
        console.error('Error updating window position:', error);
    }
}

function getSharingDisplay() {
    return screen.getPrimaryDisplay(); // Simplified for now
}

function handleScreenSharing() {
    try {
        if (sharingActive) {
            console.log('Screen sharing active, updating position');
            updateWindowPosition();
        } else {
            console.log('No screen sharing, showing window');
            mainWindow.show(); // Use show() for testing
        }
    } catch (error) {
        console.error('Error handling screen sharing:', error);
    }
}

app.whenReady().then(async () => {
    try {
        await createWindow();
    } catch (error) {
        console.error('Error in app.whenReady:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    console.log('All windows closed');
    clearInterval(sharingCheckInterval);
    app.quit();
});

app.on('will-quit', () => {
    console.log('Unregistering shortcuts');
    globalShortcut.unregisterAll();
});

ipcMain.on('toggle-recording', () => {
    console.log('Recording toggled');
});

ipcMain.on('capture-screen', () => {
    console.log('Screen capture requested');
});