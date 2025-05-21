const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onToggleRecording: (callback) => ipcRenderer.on('toggle-recording', callback),
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
    }
});