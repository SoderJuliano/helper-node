const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onToggleRecording: (callback) => ipcRenderer.on('toggle-recording', callback),
    onCaptureScreen: (callback) => ipcRenderer.on('capture-screen', callback),
    onTranscriptionStart: (callback) => ipcRenderer.on('transcription-start', callback),
    onTranscriptionError: (callback) => ipcRenderer.on('transcription-error', callback),
    onSharingStatus: (callback) => ipcRenderer.on('sharing-status', callback)
});