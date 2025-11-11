const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onToggleRecording: (callback) => ipcRenderer.on('toggle-recording', callback),
    onCapturingScreen: (callback) => ipcRenderer.on('screen-capturing', callback),
    onCaptureScreen: (callback) => ipcRenderer.on('capture-screen', callback),
    onSharingStatus: (callback) => ipcRenderer.on('sharing-status', callback),
    onTranscriptionResult: (callback) => {
        ipcRenderer.on('transcription-result', (event, { cleanText }) => {
            callback(cleanText);
        });
    },
    onTranscriptionError: (callback) => {
        ipcRenderer.on('transcription-error', (event, message) => {
            callback(message);
        });
    },
    onTranscriptionStart: (callback) => {
        ipcRenderer.on('transcription-start', (event, { audioFilePath }) => {
            callback(audioFilePath);
        });
    },
    onIaResponse: (callback) => {
        // ipcRenderer.on('llama-response', (event, { resposta }) => {
        //     callback(resposta);
        // });
        ipcRenderer.on('gemini-response', (event, { resposta }) => {
            callback(resposta);
        });
    },
    onOcrResult: (callback) => ipcRenderer.on('ocr-result', (event, data) => callback(data)),
    // sendTextToLlama: (text) => ipcRenderer.send('send-to-llama', text),
    sendTextToGemini: (text) => ipcRenderer.send('send-to-gemini', text),
});