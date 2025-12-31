const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getSpotifyTracks: (url) => ipcRenderer.invoke('get-spotify-tracks', url),
    downloadTrack: (trackData, path, playlistName, index) => ipcRenderer.invoke('download-track', trackData, path, playlistName, index),
    logToTerminal: (msg) => ipcRenderer.send('log-to-terminal', msg),
    onProgress: (callback) => ipcRenderer.on('download-progress', (event, value) => callback(value)),
    onLog: (callback) => ipcRenderer.on('log', (event, value) => callback(value)),
    checkLicense: () => ipcRenderer.invoke('check-license'),
    activateLicense: (key) => ipcRenderer.invoke('activate-license', key)
});
