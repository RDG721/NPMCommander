const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Project management
    getDefaultPath: () => ipcRenderer.invoke('get-default-path'),
    loadProject: (path) => ipcRenderer.invoke('load-project', path),
    selectFolder: () => ipcRenderer.invoke('select-folder'),
    openInFinder: (path) => ipcRenderer.invoke('open-in-finder', path),

    // Script management
    runScript: (projectPath, scriptName) => ipcRenderer.invoke('run-script', { projectPath, scriptName }),
    stopScript: (scriptName) => ipcRenderer.invoke('stop-script', scriptName),
    getRunningScripts: () => ipcRenderer.invoke('get-running-scripts'),

    // Utilities
    openUrl: (url) => ipcRenderer.invoke('open-url', url),
    installDeps: (projectPath) => ipcRenderer.invoke('install-deps', projectPath),

    // Event listeners
    onScriptOutput: (callback) => ipcRenderer.on('script-output', (event, data) => callback(data)),
    onScriptExit: (callback) => ipcRenderer.on('script-exit', (event, data) => callback(data))
});
