const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

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
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        },
        autoHideMenuBar: true
    });

    if (windowState.isMaximized) {
        mainWindow.maximize();
    }

    mainWindow.loadFile('index.html');

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
    // Register protocol for local images
    protocol.registerFileProtocol('local-image', (request, callback) => {
        const url = request.url.replace(/^local-image:\/\//, '');
        try {
            return callback(decodeURIComponent(url));
        } catch (error) {
            console.error(error);
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

ipcMain.handle('get-images', async (event, folderPath) => {
    if (!folderPath) return [];

    const images = [];
    const extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

    function walkSync(dir) {
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            const filePath = path.join(dir, file);
            try {
                const stat = fs.statSync(filePath);
                if (stat.isDirectory()) {
                    walkSync(filePath);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    if (extensions.includes(ext)) {
                        images.push(filePath);
                    }
                }
            } catch (e) {
                console.error(`Error processing ${filePath}:`, e);
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
