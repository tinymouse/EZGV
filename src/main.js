const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'フォルダを選択',
        defaultPath: path.join(settings.lastFolder || app.getPath('pictures'), '表示したいフォルダを開き「このフォルダを選択」ボタンを押してください'),
        buttonLabel: 'このフォルダを選択',
        showOverwriteConfirmation: false, // 上書き確認を無効化
        filters: [
            { name: 'すべてのファイル', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        // 保存ダイアログで指定されたパスの「親フォルダ」を取得
        const selectedPath = path.dirname(result.filePath);
        saveSettings({ lastFolder: selectedPath });
        return selectedPath;
    }
    return null;
});

ipcMain.handle('select-move-destination', async () => {
    const settings = loadSettings();
    const result = await dialog.showSaveDialog(mainWindow, {
        title: 'フォルダを選択',
        defaultPath: path.join(settings.lastMoveDir || settings.lastFolder || app.getPath('pictures'), '移動先のフォルダを開き「このフォルダへ移動」ボタンを押してください'),
        buttonLabel: 'このフォルダへ移動',
        showOverwriteConfirmation: false, // 上書き確認を無効化
        filters: [
            { name: 'すべてのファイル', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePath) {
        const selectedPath = path.dirname(result.filePath);
        saveSettings({ lastMoveDir: selectedPath });
        return selectedPath;
    }
    return null;
});

ipcMain.handle('get-last-folder', () => {
    const settings = loadSettings();
    return settings.lastFolder || null;
});

ipcMain.handle('get-master-labels', () => {
    const settings = loadSettings();
    const defaults = [
        { name: '人物', group: '基本' },
        { name: '風景', group: '基本' },
        { name: '一人', group: '人数' },
        { name: '複数', group: '人数' }
    ];

    if (!settings.masterLabels) return defaults;

    // Migration: if it's strings, convert to objects
    if (settings.masterLabels.length > 0 && typeof settings.masterLabels[0] === 'string') {
        return settings.masterLabels.map(name => {
            const def = defaults.find(d => d.name === name);
            return { name, group: def ? def.group : '未分類' };
        });
    }

    return settings.masterLabels;
});

ipcMain.handle('save-master-labels', (event, labels) => {
    // labels: [{ name, group }, ...]
    saveSettings({ masterLabels: labels });
    return { success: true };
});

ipcMain.handle('get-gemini-api-key', () => {
    const settings = loadSettings();
    return settings.geminiApiKey || '';
});

ipcMain.handle('save-gemini-api-key', (event, key) => {
    saveSettings({ geminiApiKey: key });
    return { success: true };
});

ipcMain.handle('get-gemini-model', () => {
    const settings = loadSettings();
    return settings.geminiModel || 'gemini-2.5-flash';
});

ipcMain.handle('save-gemini-model', (event, model) => {
    saveSettings({ geminiModel: model });
    return { success: true };
});

ipcMain.handle('get-ai-allow-new-labels', () => {
    const settings = loadSettings();
    return settings.aiAllowNewLabels !== false; // Default to true
});

ipcMain.handle('save-ai-allow-new-labels', (event, value) => {
    saveSettings({ aiAllowNewLabels: value });
    return { success: true };
});

ipcMain.handle('get-sort-settings', () => {
    const settings = loadSettings();
    return {
        type: settings.sortType || 'folder',
        order: settings.sortOrder || 'asc'
    };
});

ipcMain.handle('save-sort-settings', (event, { type, order }) => {
    saveSettings({ sortType: type, sortOrder: order });
    return { success: true };
});

ipcMain.handle('auto-label-image', async (event, { filePath, masterLabels }) => {
    try {
        const settings = loadSettings();
        const apiKey = settings.geminiApiKey;
        const modelName = settings.geminiModel || 'gemini-2.5-flash';
        const allowNew = settings.aiAllowNewLabels !== false;

        if (!apiKey) throw new Error('Gemini APIキーが設定されていません。管理画面の「AI設定」で設定してください。');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        const imageData = fs.readFileSync(filePath);
        const imageBase64 = imageData.toString('base64');

        const labelNames = masterLabels.map(l => l.name).join(', ');

        let prompt;
        if (allowNew) {
            prompt = `
                Analyze this image and suggest appropriate labels in Japanese.
                Select relevant ones from this predefined list if they apply: [${labelNames}].
                You can also add new descriptive labels if none of the above are sufficient.
                Return ONLY a comma-separated list of labels (e.g. "人物, 風景, 海").
                Do not include any other text.
            `;
        } else {
            prompt = `
                Analyze this image and select appropriate labels in Japanese ONLY from the following list: [${labelNames}].
                DO NOT create any new labels. If no labels apply, return an empty string.
                Return ONLY a comma-separated list of labels.
                Do not include any other text.
            `;
        }

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: imageBase64,
                    mimeType: "image/jpeg" // common format, works for most
                }
            }
        ]);

        const response = await result.response;
        const text = response.text();

        // Clean up response: split by comma, trim
        const suggestedLabels = text.split(/[,、\n]/).map(s => s.trim()).filter(s => s && s.length > 0);

        return { success: true, labels: suggestedLabels };
    } catch (error) {
        console.error('Gemini error:', error);
        return { success: false, error: error.message };
    }
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

// Metadata Management
function getMetadataForFile(imagePath) {
    try {
        const txtPath = getLabelFilePath(imagePath);
        if (fs.existsSync(txtPath)) {
            const content = fs.readFileSync(txtPath, 'utf-8');
            const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            if (lines.length > 0) {
                // Line 1: filename (ignored during parsing but required for format)
                let order = 0;
                let labels = [];
                let labelStart = 1;

                if (lines.length > 1 && lines[1].startsWith('ORDER:')) {
                    order = parseInt(lines[1].replace('ORDER:', '').trim()) || 0;
                    labelStart = 2;
                }
                labels = lines.slice(labelStart);
                return { order, labels };
            }
        }
    } catch (e) { }
    return { order: 1000000, labels: [] }; // Default high order
}

ipcMain.handle('save-file-labels', async (event, { filePath, labels }) => {
    try {
        const metadata = getMetadataForFile(filePath);
        const txtPath = getLabelFilePath(filePath);
        const fileName = path.basename(filePath);

        const lines = [fileName];
        if (metadata.order !== undefined) lines.push(`ORDER: ${metadata.order}`);
        lines.push(...labels);

        fs.writeFileSync(txtPath, lines.join('\n'), 'utf-8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('save-file-order', async (event, { filePath, order }) => {
    try {
        const metadata = getMetadataForFile(filePath);
        const txtPath = getLabelFilePath(filePath);
        const fileName = path.basename(filePath);

        const lines = [fileName, `ORDER: ${order}`, ...metadata.labels];
        fs.writeFileSync(txtPath, lines.join('\n'), 'utf-8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('move-file', async (event, { srcPath, destDir }) => {
    try {
        if (!fs.existsSync(destDir)) {
            return { success: false, error: '移動先フォルダが存在しません。' };
        }

        const fileName = path.basename(srcPath);
        const destPath = path.join(destDir, fileName);

        // Move the image
        fs.renameSync(srcPath, destPath);

        // Move label file if exists
        const srcLabel = getLabelFilePath(srcPath);
        if (fs.existsSync(srcLabel)) {
            const destLabel = getLabelFilePath(destPath);
            fs.renameSync(srcLabel, destLabel);
        }

        return { success: true };
    } catch (e) {
        console.error('Failed to move file:', e);
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
                        const metadata = getMetadataForFile(filePath);
                        images.push({
                            path: filePath,
                            labels: metadata.labels,
                            order: metadata.order,
                            mtime: stat.mtimeMs
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
