const { app, BrowserWindow, ipcMain, globalShortcut, screen } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const fs2 = require('fs');
const LlamaService = require('./services/llamaService.js');
const TesseractService = require('./services/tesseractService.js');

let mainWindow;
let sharingCheckInterval;
let currentDisplayId = null;
let sharingActive = false;
let recordingProcess = null;
let isRecording = false;
const audioFilePath = path.join(__dirname, 'output.wav');

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
            skipTaskbar: true,
            nodeIntegration: false,
        });

        mainWindow.setContentProtection(true);

        if (process.env.XDG_SESSION_TYPE === 'wayland') {
            mainWindow.setSkipTaskbar(true);
            console.log('Running on Wayland');
        } else {
            console.log('Running on X11');
        }

        mainWindow.on('ready-to-show', () => {
            console.log('Window ready to show');
            mainWindow.show();
            ensureWindowVisible(mainWindow);
            currentDisplayId = screen.getDisplayNearestPoint(mainWindow.getBounds()).id;
            mainWindow.webContents.openDevTools();
            
            // Mover o registro de atalhos para aqui
            registerGlobalShortcuts();
        });

        mainWindow.on('closed', () => {
            console.log('Main window closed');
            mainWindow = null;
        });

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

        // Configuração de permissões
        mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'autofill') {
                return callback(false);
            }
            callback(true);
        });
    } catch (error) {
        console.error('Error creating window:', error);
        app.quit();
    }
}

async function registerGlobalShortcuts() {
    if (!mainWindow) return;

    // Limpa atalhos existentes primeiro
    globalShortcut.unregisterAll();

    const shortcuts = [
        { combo: 'CommandOrControl+D', action: 'toggle-recording' },
        { combo: 'CommandOrControl+P', action: 'capture-screen' },
        { combo: 'CommandOrControl+A', action: 'focus-window' }
    ];

    shortcuts.forEach(({ combo, action }) => {
        const registered = globalShortcut.register(combo, async () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(action);
                
                // Tratamento especial para o atalho de focus
                if (action === 'focus-window' && mainWindow.isMinimized()) {
                    mainWindow.restore();
                }

                if (action === 'toggle-recording') {
                    await toggleRecording();
                    mainWindow.webContents.send('toggle-recording', { isRecording, audioFilePath });
                }

                if (action === 'capture-screen') {
                    try {
                        const data = await TesseractService.captureAndProcessScreenshot(mainWindow);
                        console.log('OCR Data:', data);
                    } catch (error) {
                        console.error('Error in capture-screen:', error);
                    }
                }
            }
        });

        if (!registered) {
            console.error(`Failed to register shortcut: ${combo}`);
        } else {
            console.log(`Shortcut registered: ${combo}`);
        }
    });

    globalShortcut.register('Control+shift+1', () => moveToDisplay(0));
    globalShortcut.register('Control+shift+2', () => moveToDisplay(1));

    console.log('Atalhos Ctrl+1 e Ctrl+2 registrados');
}

async function toggleRecording() {
    try {
        if (isRecording) {
            if (recordingProcess) {
                recordingProcess.kill('SIGTERM');
                recordingProcess = null;
            }
            isRecording = false;
            console.log('Recording stopped');
            try {
                await fs.access(audioFilePath);
                console.log('Audio file created:', audioFilePath);
                mainWindow.webContents.send('transcription-start', { audioFilePath });
                // Iniciar transcrição com Whisper
                const audioText = await transcribeAudio(audioFilePath);
                getIaResponse(audioText);
            } catch (error) {
                isRecording = false;
                console.error('Audio file not found:', error);
                // mainWindow.webContents.send('transcription-error', 'No audio file created');
            }
        } else {
            await fs.unlink(audioFilePath).catch(() => {});
            const command = `pw-record --target=auto-null.monitor ${audioFilePath}`;
            console.log('Executing:', command);
            recordingProcess = exec(command, (error) => {
                if (error && error.signal !== 'SIGTERM' && error.code !== 0) {
                    console.error('Recording error:', error);
                    // mainWindow.webContents.send('transcription-error', 'Recording failed');
                } else {
                    console.log('Recording process ended normally');
                }
            });
            isRecording = true;
            console.log('Recording started');
        }
    } catch (error) {
        console.error('Error toggling recording:', error);
        mainWindow.webContents.send('transcription-error', 'Failed to toggle recording');
    }
}

async function getIaResponse(text) {
    try {
        const resposta = await LlamaService.responder(text);
        mainWindow.webContents.send('llama-response', { resposta });
    } catch (llamaError) {
        console.error('LLaMA error:', llamaError);
        mainWindow.webContents.send('transcription-error', 'Failed to process LLaMA response');
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
        console.error('Erro ao obter duração do áudio:', error.message);
    }
}

async function transcribeAudio(filePath) {
    try {
        // Obter a duração do áudio
        const duration = await getAudioDuration(filePath);

        const whisperPath = path.join(__dirname, 'whisper/build/bin/whisper-cli');
        const modelPathTiny = path.join(__dirname, 'whisper/models/ggml-tiny.bin');
        const modelPathSmall = path.join(__dirname, 'whisper/models/ggml-small.bin');

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
            console.log('Usando modelo tiny');
        } else {
            modelPath = modelPathSmall;
            command = `${whisperPath} -m ${modelPath} -f ${filePath} -l auto --threads 16 --no-timestamps --best-of 2 --beam-size 2`;
            console.log('Usando modelo small');
        }

        console.log('Executing whisper:', command);
        return new Promise((resolve, reject) => {
            exec(command, async (error, stdout, stderr) => {
                if (error) {
                    console.error('Whisper error:', stderr);
                    mainWindow.webContents.send('transcription-error', 'Failed to transcribe audio');
                    reject(error);
                    return;
                }
                const text = stdout.trim();
                console.log('Transcription:', text || 'No text recognized');
                const cleanText = await limparTranscricao(text);
                mainWindow.webContents.send('transcription-result', { cleanText });
                resolve(cleanText);
            });
        });
    } catch (error) {
        console.error('Transcription error:', error);
        mainWindow.webContents.send('transcription-error', 'Failed to transcribe audio');
    }
}

async function limparTranscricao(texto) {
    return texto.replace(/\[\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}\]\s*/g, '').trim();
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
            console.log("Chrome grando a tela");
            sharingActive = isSharing;
            handleScreenSharing();
        }
    } catch (error) {
        console.error('Erro na verificação:', error);
    }
}

async function detectChromeScreenSharing() {
    try {
        const { stdout } = await execPromise(`ps aux | grep '[c]hrome' | grep -E '--type=renderer.*(pipewire|screen-capture|WebRTCPipeWireCapturer)'`);
        const isSharing = stdout.toLowerCase().includes('chrome') && stdout.includes('pipewire');
        if (isSharing) {
            console.log('Chrome screen-sharing detected in process:', stdout.trim());
        }
        return isSharing;
    } catch (error) {
        console.log('No Chrome screen-sharing detected:', error.message);
        return false;
    }
}

async function detectScreenSharing() {
    try {
        const sharingApps = ['chrome', 'teams', 'zoom', 'obs', 'discord'];
        const { stdout } = await execPromise(`ps aux | grep -E '${sharingApps.join('|')}' | grep -v grep`);
        const processes = stdout.toString().toLowerCase();
        const sharingIndicators = ['--type=renderer', '--enable-features=WebRTCPipeWireCapturer', 'screen-sharing'];
        return sharingApps.some(app => processes.includes(app) && sharingIndicators.some(indicator => processes.includes(indicator))) || detectChromeScreenSharing();
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
                const otherIndex = displays.findIndex(d => d.id === otherDisplay.id);
                console.log('Attempting to move to display index:', otherIndex);
                moveToDisplay(otherIndex);
                // Verify movement
                const newBounds = mainWindow.getBounds();
                const newDisplay = screen.getDisplayNearestPoint(newBounds);
                if (newDisplay.id === otherDisplay.id) {
                    currentDisplayId = otherDisplay.id;
                    console.log('Successfully moved to display index:', otherIndex, 'ID:', currentDisplayId);
                } else {
                    console.error('Failed to move to display index:', otherIndex);
                }
            }
        } else {
            mainWindow.show();
            console.log('Window already on non-shared display');
        }
    } catch (error) {
        console.error('Error updating window position:', error);
    }
}

function getSharingDisplay() {
    return screen.getPrimaryDisplay();
}

function handleScreenSharing() {
    try {
        if (sharingActive && mainWindow && !mainWindow.isDestroyed()) {
            console.log('Screen sharing active, updating position');
            updateWindowPosition();
            mainWindow.setContentProtection(true);
        } else {
            console.log('No screen sharing, showing window');
            mainWindow.show();
        }
    } catch (error) {
        console.error('Error handling screen sharing:', error);
    }
}

function ensureWindowVisible(win) {
    const windowBounds = win.getBounds();
    const displays = screen.getAllDisplays();
    const visible = displays.some(display => {
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
        console.log('Janela fora da tela. Reposicionando para:', newX, newY);
        win.setBounds({ x: newX, y: newY, width: windowBounds.width, height: windowBounds.height });
    }
}

function moveToDisplay(index) {
    console.log("cheguei"+index);
    const displays = screen.getAllDisplays();
    if (index < displays.length) {
        const display = displays[index];
        const bounds = display.bounds;

        const winWidth = 800;
        const winHeight = 600;
        const x = bounds.x + Math.round((bounds.width - winWidth) / 2);
        const y = bounds.y + Math.round((bounds.height - winHeight) / 2);

        mainWindow.setBounds({ x, y, width: winWidth, height: winHeight });
        mainWindow.show(); // Garante que ela fique visível
        mainWindow.focus();
    } else {
        console.log(`Monitor ${index + 1} não encontrado`);
    }
}

ipcMain.on('send-to-llama', async (event, text) => {
    try {
        const resposta = await LlamaService.responder(text);
        event.sender.send('llama-response', { resposta });
    } catch (llamaError) {
        console.error('LLaMA error:', llamaError);
        event.sender.send('transcription-error', 'Failed to process LLaMA response');
    }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    console.log('All windows closed');
    clearInterval(sharingCheckInterval);
    if (recordingProcess) {
        recordingProcess.kill('SIGTERM');
    }
    if (process.platform !== 'darwin' && !mainWindow) {
        app.quit();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});