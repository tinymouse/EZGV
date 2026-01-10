const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getLastFolder: () => ipcRenderer.invoke('get-last-folder'),
    getImages: (folderPath) => ipcRenderer.invoke('get-images', folderPath),
    getFileDetails: (filePath) => ipcRenderer.invoke('get-file-details', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    saveFileLabels: (filePath, labels) => ipcRenderer.invoke('save-file-labels', { filePath, labels })
});
