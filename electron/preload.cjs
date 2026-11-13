// The only file access the page gets: save once, then dated backups beside that file.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// AI control, only used when it's turned on in Settings: commands in from the local connection, answers back.
contextBridge.exposeInMainWorld('canopyHost', {
  aiBridge: {
    setEnabled: (on) => ipcRenderer.send('canopy:ai-bridge', !!on),
    onCommand: (fn) => { ipcRenderer.removeAllListeners('canopy:ai-command'); ipcRenderer.on('canopy:ai-command', (e, msg) => fn(msg)); },
    reply: (msg) => ipcRenderer.send('canopy:ai-reply', msg),
  },
});

contextBridge.exposeInMainWorld('canopyApp', {
  saveAs: (name, text) => ipcRenderer.invoke('canopy:save-as', name, text),
  backup: (when, text, name) => ipcRenderer.invoke('canopy:backup', when, text, name),
  // Saving with the pictures in a textures folder beside the file; pictures a file points at, read back.
  savePackage: (name, text, files) => ipcRenderer.invoke('canopy:save-package', name, text, files),
  readImage: (file, dir) => ipcRenderer.invoke('canopy:read-image', file, dir),
  pathOf: (file) => webUtils.getPathForFile(file),
  // A .canopy file double-clicked in Explorer (or dropped on the app icon).
  onOpenFile: (fn) => { ipcRenderer.removeAllListeners('canopy:open-file'); ipcRenderer.on('canopy:open-file', (e, f) => fn(f)); ipcRenderer.send('canopy:ready'); },
  // The page can't fetch its own files from disk; the library and samples come through here.
  readSample: (name) => ipcRenderer.invoke('canopy:read-sample', name),
  // Updates: download the new Windows build from the GitHub release, install it over this one, restart.
  update: (url) => ipcRenderer.invoke('canopy:update', url),
  onUpdateProgress: (fn) => { ipcRenderer.removeAllListeners('canopy:update-progress'); ipcRenderer.on('canopy:update-progress', (e, p) => fn(p)); },
});
