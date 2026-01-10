const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        await shell.trashItem(filePath);
        return { success: true };
    } catch (error) {
        console.error('Trash item failed:', error);
        return { success: false, error: error.message };
    }
});
const url = require('url');

// 1. プロトコルの特権登録 (アプリの準備が整う前に必要)
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'local-image',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            stream: true
        }
    }
]);

let mainWindow;

// Settings management
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(settingsPath)) {
            return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        }
    } catch (e) {
        console.error('Failed to load settings', e);
    }
    return {};
}

function saveSettings(settings) {
    try {
        const currentSettings = loadSettings();
        const newSettings = { ...currentSettings, ...settings };
        fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    } catch (e) {
        console.error('Failed to save settings', e);
    }
}

function createWindow() {
    const settings = loadSettings();
    const windowState = settings.windowState || {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined,
        isMaximized: false
    };

    mainWindow = new BrowserWindow({
        width: windowState.width,
        height: windowState.height,
        x: windowState.x,
        y: windowState.y,
        webPreferences: {
            // preload.js is in the same directory as main.js now
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    if (windowState.isMaximized) {
        mainWindow.maximize();
    }

    // index.html is also in the same directory (src)
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Remove menu
    mainWindow.setMenu(null);

    mainWindow.on('close', () => {
        const bounds = mainWindow.getBounds();
        const isMaximized = mainWindow.isMaximized();
        saveSettings({
            windowState: {
                width: bounds.width,
                height: bounds.height,
                x: bounds.x,
                y: bounds.y,
                isMaximized: isMaximized
            }
        });
    });
}

app.whenReady().then(() => {
    // 2. プロトコルハンドラの設定 (より確実な方法に変更)
    protocol.handle('local-image', async (request) => {
        try {
            const urlObj = new URL(request.url);
            const filePath = decodeURIComponent(urlObj.searchParams.get('path'));
            const data = fs.readFileSync(filePath);
            return new Response(data);
        } catch (error) {
            console.error('Protocol Error:', error);
            return new Response('Error loading image', { status: 500 });
        }
    });

    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('select-folder', async () => {
    const settings = loadSettings();
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        defaultPath: settings.lastFolder || app.getPath('pictures')
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        saveSettings({ lastFolder: selectedPath });
        return selectedPath;
    }
    return null;
});

ipcMain.handle('get-last-folder', () => {
    const settings = loadSettings();
    return settings.lastFolder || null;
});

ipcMain.handle('get-file-details', async (event, filePath) => {
    try {
        const stats = fs.statSync(filePath);
        return {
            size: stats.size,
            birthtime: stats.birthtime,
            mtime: stats.mtime
        };
    } catch (e) {
        console.error('Error getting file details:', e);
        return null;
    }
});

// Label Management
function getLabelFilePath(imagePath) {
    // Strategy: image.jpg -> image.jpg.txt to avoid collisions
    return `${imagePath}.txt`; 
}

function getLabelsForFile(imagePath) {
    try {
        const txtPath = getLabelFilePath(imagePath);
        if (fs.existsSync(txtPath)) {
            const content = fs.readFileSync(txtPath, 'utf-8');
            const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            // First line might be filename (as per requirement), subsequent are labels
            // Requirement: "Record filename and attributes"
            // Let's assume:
            // Line 1: filename
            // Line 2+: labels
            if (lines.length > 1) {
                return lines.slice(1);
            }
        }
    } catch (e) {
        // user might delete file manually etc.
    }
    return [];
}

ipcMain.handle('save-file-labels', async (event, { filePath, labels }) => {
    try {
        const txtPath = getLabelFilePath(filePath);
        const fileName = path.basename(filePath);
        const content = [fileName, ...labels].join('\n');
        fs.writeFileSync(txtPath, content, 'utf-8');
        return { success: true };
    } catch (e) {
        console.error('Failed to save labels:', e);
        return { success: false, error: e.message };
    }
});

// Update get-images to return labels
ipcMain.handle('get-images', async (event, folderPath) => {
    if (!folderPath) return [];

    const images = []; // Array of { path, labels }
    const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

    function walkSync(dir) {
        let files;
        try {
            files = fs.readdirSync(dir);
        } catch (e) {
            console.warn(`Skip directory (Access Denied): ${dir}`);
            return;
        }

        files.forEach(file => {
            const filePath = path.join(dir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    walkSync(filePath);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    if (extensions.includes(ext)) {
                        const labels = getLabelsForFile(filePath);
                        images.push({
                            path: filePath,
                            labels: labels
                        });
                    }
                }
            } catch (e) {
                // Skip file errors
            }
        });
    }

    try {
        walkSync(folderPath);
    } catch (e) {
        console.error('Error walking directory:', e);
    }

    return images;
});
