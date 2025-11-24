const { app, BrowserWindow, ipcMain, globalShortcut, screen, Notification } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const fs2 = require('fs');
// const LlamaService = require('./services/llamaService.js');
const GeminiService = require('./services/geminiService.js'); // Mantido para a funcionalidade de cancelamento
const BackendService = require('./services/backendService.js');
const TesseractService = require('./services/tesseractService.js');
const ipcService = require('./services/ipcService.js');

let backendIsOnline = false;

async function checkBackendStatus() {
    backendIsOnline = await BackendService.ping();
    if (backendIsOnline) {
        console.log('Backend is online.');
    } else {
        console.log('Backend is offline.');
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
            icon: path.join(__dirname, 'assets', 'linux.png'),
            titleBarStyle: 'hidden',
            nodeIntegration: false,
        });

        mainWindow.setContentProtection(true);

         // macOS específico - oculta o ícone da Dock
        if (process.platform === 'darwin') {
            app.dock.hide()
        }

        // Tentativa adicional para KDE para ocultar app na dock
        if (process.platform === 'linux') {
            mainWindow.setSkipTaskbar(true)
            mainWindow.setMenuBarVisibility(false)
            mainWindow.setTitle('') // Janela sem título pode ajudar
        }

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
            // mainWindow.webContents.openDevTools();
            
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

        if (process.platform === 'linux') {
            app.setAppUserModelId('com.seuapp.nome'); // ajuda o sistema a identificar melhor o app
        }
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
        { combo: 'CommandOrControl+I', action: 'manual-input' },
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
                }

                if (action === 'capture-screen') {
                    mainWindow.webContents.send('screen-capturing', true);
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

// async function toggleRecording() {
//     try {
//         if (isRecording) {
//             if (recordingProcess) {
//                 recordingProcess.kill('SIGTERM');
//                 recordingProcess = null;
//             }
//             isRecording = false;
//             console.log('Recording stopped');
//             try {
//                 await fs.access(audioFilePath);
//                 console.log('Audio file created:', audioFilePath);
//                 mainWindow.webContents.send('transcription-start', { audioFilePath });
//                 // Iniciar transcrição com Whisper
//                 const audioText = await transcribeAudio(audioFilePath);
//                 getIaResponse(audioText);
//             } catch (error) {
//                 isRecording = false;
//                 console.error('Audio file not found:', error);
//                 // mainWindow.webContents.send('transcription-error', 'No audio file created');
//             }
//         } else {
//             await fs.unlink(audioFilePath).catch(() => {});
//             const command = `pw-record --target=auto-null.monitor ${audioFilePath}`;
//             console.log('Executing:', command);
//             recordingProcess = exec(command, (error) => {
//                 if (error && error.signal !== 'SIGTERM' && error.code !== 0) {
//                     console.error('Recording error:', error);
//                     // mainWindow.webContents.send('transcription-error', 'Recording failed');
//                 } else {
//                     console.log('Recording process ended normally');
//                 }
//             });
//             isRecording = true;
//             console.log('Recording started');
//         }
//     } catch (error) {
//         console.error('Error toggling recording:', error);
//         mainWindow.webContents.send('transcription-error', 'Failed to toggle recording');
//     }
// }

async function toggleRecording() {
    try {
        if (isRecording) {
            if (recordingProcess) {
                recordingProcess.kill('SIGTERM');
                recordingProcess = null;
            }
            isRecording = false;
            console.log('Recording stopped');
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({ title: 'Helper-Node', body: 'Ok, aguarde...', silent: true }).show();
            }
            mainWindow.webContents.send('toggle-recording', { isRecording, audioFilePath });
            try {
                await fs.access(audioFilePath);
                console.log('Audio file created:', audioFilePath);
                mainWindow.webContents.send('transcription-start', { audioFilePath });

                // Acelerar o áudio em 2x com ffmpeg
                const spedUpAudioPath = path.join(__dirname, 'output_2x.wav');
                // const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=2.0" -y ${spedUpAudioPath}`;
                // const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=3.0" -y ${spedUpAudioPath}`;
                const ffmpegCommand = `ffmpeg -i ${audioFilePath} -filter:a "atempo=2.0" -y ${spedUpAudioPath}`;
                await execPromise(ffmpegCommand);
                console.log('Audio sped up by 2x:', spedUpAudioPath);

                // Iniciar transcrição com Whisper usando o áudio acelerado
                const audioText = await transcribeAudio(spedUpAudioPath);

                if (audioText === '[BLANK_AUDIO]') {
                    console.log('Áudio em branco detectado, não enviando para a IA.');
                    if (appConfig.notificationsEnabled && Notification.isSupported()) {
                        new Notification({
                            title: 'Helper-Node',
                            body: 'Nenhum áudio detectado. Tente novamente.',
                            silent: true,
                        }).show();
                    }
                    return; // Sai da função sem chamar getIaResponse
                }
                getIaResponse(audioText);
            } catch (error) {
                isRecording = false;
                console.error('Audio file not found or processing failed:', error);
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
            if (appConfig.notificationsEnabled && Notification.isSupported()) {
                new Notification({ title: 'Helper-Node', body: 'Gravando...', silent: true }).show();
            }
            mainWindow.webContents.send('toggle-recording', { isRecording, audioFilePath });
        }
    } catch (error) {
        console.error('Error toggling recording:', error);
        mainWindow.webContents.send('transcription-error', 'Failed to toggle recording');
    }
}

// async function getIaResponse(text) {
//     try {
//         // const resposta = await LlamaService.responder(text);
//         const resposta = await GeminiService.responder(text);
//         mainWindow.webContents.send('gemini-response', { resposta });
//     } catch (llamaError) {
//         console.error('LLaMA error:', llamaError);
//         mainWindow.webContents.send('transcription-error', 'Failed to process LLaMA response');
//     }
// }

function formatForPlainTextNotification(html) {
    let text = html;
    // Substitui tags de bloco por quebras de linha para melhor legibilidade
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n');
    text = text.replace(/<\/li>/gi, '\n');

    // Converte tags de ênfase para uma sintaxe similar a markdown
    text = text.replace(/<strong>(.*?)<\/strong>/gi, '*$1*');
    text = text.replace(/<b>(.*?)<\/b>/gi, '*$1*');
    text = text.replace(/<em>(.*?)<\/em>/gi, '_$1_');
    text = text.replace(/<i>(.*?)<\/i>/gi, '_$1_');

    // Remove quaisquer tags HTML restantes
    text = text.replace(/<[^>]*>/g, '');

    // Decodifica entidades HTML comuns
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    return text.trim();
}

function chunkText(text, chunkSize = 250) {
    const finalChunks = [];
    const lines = text.split('\n');

    for (const line of lines) {
        if (line.trim() === '') continue;

        if (line.length <= chunkSize) {
            finalChunks.push(line.trim());
        } else {
            // This line is too long, so we chunk it.
            let remaining = line;
            while (remaining.length > 0) {
                let chunk = remaining.substring(0, chunkSize);
                const lastSpace = chunk.lastIndexOf(' ');

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
                title: 'Helper-Node',
                body: 'Aguarde, gerando uma resposta...',
                silent: true,
            }).show();
        }
    }, 10000);

    let resposta;
    try {
        if (backendIsOnline) {
            console.log('Tentando usar o Backend Service...');
            try {
                resposta = await BackendService.responder(text);
            } catch (backendError) {
                console.error('Falha no Backend Service, usando Gemini como fallback...', backendError);
                backendIsOnline = false; // Marca como offline para a próxima tentativa ser mais rápida
                resposta = await GeminiService.responder(text);
            }
        } else {
            console.log('Backend offline, usando Gemini Service...');
            resposta = await GeminiService.responder(text);
        }

        clearInterval(waitingNotificationInterval);
        waitingNotificationInterval = null;

        mainWindow.webContents.send('gemini-response', { resposta });

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
                            await new Promise(res => setTimeout(res, 2000));
                        }
                    }
                }
            })();
        }
    } catch (error) {
        clearInterval(waitingNotificationInterval);
        waitingNotificationInterval = null;
        
        console.error('IA service error:', error);
        mainWindow.webContents.send('transcription-error', 'Failed to process IA response');
        if (appConfig.notificationsEnabled && Notification.isSupported()) {
            new Notification({
                title: 'Erro do Assistente',
                body: 'Não foi possível gerar uma resposta de nenhuma fonte.',
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

                if (appConfig.notificationsEnabled && Notification.isSupported() && cleanText) {
                    const notification = new Notification({
                        title: 'Helper-Node',
                        body: 'Usuário perguntou: ' + cleanText,
                        silent: true,
                    });
                    notification.show();
                }

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
            console.log("Chrome gravando a tela");
            sharingActive = isSharing;
            handleScreenSharing();
        }
    } catch (error) {
        console.error('Erro na verificação:', error);
    }
}

// async function detectChromeScreenSharing() {
//     try {
//         const { stdout } = await execPromise(`ps aux | grep '[c]hrome' | grep -E '--type=renderer.*(pipewire|screen-capture|WebRTCPipeWireCapturer)'`);
//         const isSharing = stdout.toLowerCase().includes('chrome') && stdout.includes('pipewire');
//         if (isSharing) {
//             console.log('Chrome screen-sharing detected in process:', stdout.trim());
//         }
//         return isSharing;
//     } catch (error) {
//         console.log('No Chrome screen-sharing detected:', error.message);
//         return false;
//     }
// }

async function detectChromeScreenSharing() {
    try {
        const { stdout } = await execPromise(`ps aux | grep '[c]hrome' | grep -E -- '--type=renderer.*(pipewire|screen-capture|WebRTCPipeWireCapturer)'`);
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

// ipcMain.on('send-to-llama', async (event, text) => {
//     try {
//         const resposta = await LlamaService.responder(text);
//         event.sender.send('llama-response', { resposta });
//     } catch (llamaError) {
//         console.error('LLaMA error:', llamaError);
//         event.sender.send('transcription-error', 'Failed to process LLaMA response');
//     }
// });


ipcMain.on('send-to-gemini', async (event, text) => {
    try {
        let resposta;
        if (backendIsOnline) {
            console.log('IPC: Tentando usar o Backend Service...');
            try {
                resposta = await BackendService.responder(text);
            } catch (backendError) {
                console.error('IPC: Falha no Backend Service, usando Gemini como fallback...', backendError);
                backendIsOnline = false; // Marcar como offline
                resposta = await GeminiService.responder(text);
            }
        } else {
            console.log('IPC: Backend offline, usando Gemini Service...');
            resposta = await GeminiService.responder(text);
        }
        event.sender.send('gemini-response', { resposta });
    } catch (error) {
        console.error('IPC: IA service error:', error);
        event.sender.send('transcription-error', 'Failed to process IA response from any source');
    }
});

ipcMain.on('stop-notifications', () => {
    if (waitingNotificationInterval) {
        clearInterval(waitingNotificationInterval);
        waitingNotificationInterval = null;
    }
    console.log('Notifications stopped');
});

ipcMain.on('start-notifications', () => {
    console.log('Notifications restarted');
});

ipcMain.on('cancel-ia-request', () => {
    // Atualmente, o cancelamento só funciona para o GeminiService.
    // O BackendService não tem um método de cancelamento implementado.
    GeminiService.cancelCurrentRequest();
    
    if (waitingNotificationInterval) {
        clearInterval(waitingNotificationInterval);
        waitingNotificationInterval = null;
    }
    console.log('IA request cancelled');
});

app.whenReady().then(() => {
    createWindow();
    ipcService.start(toggleRecording);

    // Verifica o status do backend ao iniciar e depois periodicamente
    checkBackendStatus();
    setInterval(checkBackendStatus, 60000); // Verifica a cada 60 segundos
});


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