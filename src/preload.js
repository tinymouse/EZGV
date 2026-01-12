const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    getLastFolder: () => ipcRenderer.invoke('get-last-folder'),
    getImages: (folderPath) => ipcRenderer.invoke('get-images', folderPath),
    getFileDetails: (filePath) => ipcRenderer.invoke('get-file-details', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    selectMoveDestination: () => ipcRenderer.invoke('select-move-destination'),
    moveFile: (srcPath, destDir) => ipcRenderer.invoke('move-file', { srcPath, destDir }),
    saveFileLabels: (filePath, labels) => ipcRenderer.invoke('save-file-labels', { filePath, labels }),
    saveFileOrder: (filePath, order) => ipcRenderer.invoke('save-file-order', { filePath, order }),
    renameFile: (filePath, newName, autoSequence, separator) => ipcRenderer.invoke('rename-file', { filePath, newName, autoSequence, separator }),
    getMasterLabels: () => ipcRenderer.invoke('get-master-labels'),
    saveMasterLabels: (labels) => ipcRenderer.invoke('save-master-labels', labels),
    getGeminiApiKey: () => ipcRenderer.invoke('get-gemini-api-key'),
    saveGeminiApiKey: (key) => ipcRenderer.invoke('save-gemini-api-key', key),
    getGeminiModel: () => ipcRenderer.invoke('get-gemini-model'),
    saveGeminiModel: (model) => ipcRenderer.invoke('save-gemini-model', model),
    getAiAllowNewLabels: () => ipcRenderer.invoke('get-ai-allow-new-labels'),
    saveAiAllowNewLabels: (value) => ipcRenderer.invoke('save-ai-allow-new-labels', value),
    getSortSettings: () => ipcRenderer.invoke('get-sort-settings'),
    saveSortSettings: (settings) => ipcRenderer.invoke('save-sort-settings', settings),
    getRenameSettings: () => ipcRenderer.invoke('get-rename-settings'),
    saveRenameSettings: (settings) => ipcRenderer.invoke('save-rename-settings', settings),
    autoLabelImage: (filePath, masterLabels) => ipcRenderer.invoke('auto-label-image', { filePath, masterLabels })
});
