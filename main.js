const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let activeProcesses = new Map();

// Path to store last used project path
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Load last used path
function getLastPath() {
    try {
        if (fs.existsSync(settingsPath)) {
            const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            return data.lastProjectPath || null;
        }
    } catch (e) { }
    return null;
}

// Save last used path
function saveLastPath(projectPath) {
    try {
        fs.writeFileSync(settingsPath, JSON.stringify({ lastProjectPath: projectPath }));
    } catch (e) { }
}

// Safe send to renderer (checks if window still exists)
function safeSend(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, data);
    }
}

// Helper to run npm commands with proper PATH (packaged apps don't inherit user's PATH)
function runNpmCommand(args, cwd) {
    // Use login shell to inherit user's PATH from .zshrc/.bashrc
    const command = `npm ${args.join(' ')}`;
    return spawn('/bin/zsh', ['-lc', command], {
        cwd: cwd,
        env: { ...process.env, FORCE_COLOR: '1' }
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 15, y: 15 },
        backgroundColor: '#1a1a1a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile('renderer/index.html');

    // Open DevTools in development
    // mainWindow.webContents.openDevTools();
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    // Kill all running processes
    activeProcesses.forEach((proc, name) => {
        proc.kill('SIGTERM');
    });
    activeProcesses.clear();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// IPC Handlers

// Get initial project path (last used, or app location)
ipcMain.handle('get-default-path', () => {
    // First check for saved last path
    const lastPath = getLastPath();
    if (lastPath && fs.existsSync(lastPath)) {
        return lastPath;
    }

    // Otherwise use app location
    if (app.isPackaged) {
        return path.dirname(app.getPath('exe').replace('/Contents/MacOS/NPM Commander', ''));
    } else {
        return path.dirname(__dirname);
    }
});

// Read project info
ipcMain.handle('load-project', async (event, projectPath) => {
    const pkgPath = path.join(projectPath, 'package.json');

    if (!fs.existsSync(pkgPath)) {
        return { error: 'No package.json found in this folder' };
    }

    // Save this path for next time
    saveLastPath(projectPath);

    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

        // Check node_modules
        const nodeModulesExists = fs.existsSync(path.join(projectPath, 'node_modules'));

        return {
            name: pkg.name || 'Unknown Project',
            version: pkg.version || '0.0.0',
            scripts: pkg.scripts || {},
            dependencies: pkg.dependencies || {},
            devDependencies: pkg.devDependencies || {},
            nodeModulesInstalled: nodeModulesExists,
            projectPath: projectPath
        };
    } catch (e) {
        return { error: e.message };
    }
});

// Select folder dialog
ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

// Run a script
ipcMain.handle('run-script', async (event, { projectPath, scriptName }) => {
    if (activeProcesses.has(scriptName)) {
        return { error: `Script '${scriptName}' is already running` };
    }

    const proc = runNpmCommand(['run', scriptName], projectPath);

    activeProcesses.set(scriptName, proc);

    proc.stdout.on('data', (data) => {
        safeSend('script-output', {
            script: scriptName,
            type: 'stdout',
            data: data.toString()
        });
    });

    proc.stderr.on('data', (data) => {
        safeSend('script-output', {
            script: scriptName,
            type: 'stderr',
            data: data.toString()
        });
    });

    proc.on('close', (code) => {
        activeProcesses.delete(scriptName);
        safeSend('script-exit', {
            script: scriptName,
            code
        });
    });

    return { success: true };
});

// Stop a script
ipcMain.handle('stop-script', async (event, scriptName) => {
    const proc = activeProcesses.get(scriptName);
    if (proc) {
        proc.kill('SIGTERM');
        activeProcesses.delete(scriptName);
        return { success: true };
    }
    return { error: 'Script not running' };
});

// Get running scripts
ipcMain.handle('get-running-scripts', () => {
    return Array.from(activeProcesses.keys());
});

// Open URL in browser
ipcMain.handle('open-url', (event, url) => {
    shell.openExternal(url);
});

// Open folder in Finder
ipcMain.handle('open-in-finder', (event, folderPath) => {
    shell.showItemInFolder(folderPath);
});

// Install dependencies
ipcMain.handle('install-deps', async (event, projectPath) => {
    return new Promise((resolve) => {
        const proc = runNpmCommand(['install'], projectPath);

        proc.stdout.on('data', (data) => {
            safeSend('script-output', {
                script: 'install',
                type: 'stdout',
                data: data.toString()
            });
        });

        proc.stderr.on('data', (data) => {
            safeSend('script-output', {
                script: 'install',
                type: 'stderr',
                data: data.toString()
            });
        });

        proc.on('close', (code) => {
            resolve({ success: code === 0 });
        });
    });
});
