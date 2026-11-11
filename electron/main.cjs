// The PC build: the same editor in its own window, with no browser around it.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

let savedAs = null;
let mainWin = null;

// AI control: a connection on this computer only, opened when the setting is on. Each request must carry the
// token written to the app's data folder, which also keeps web pages out (they can't send that header here).
const AI_PORT = 47821;
let bridge = null;
let token = '';
let seq = 0;
const waiting = new Map();

async function startBridge() {
  if (bridge) return;
  token = crypto.randomBytes(24).toString('hex');
  await fs.writeFile(path.join(app.getPath('userData'), 'ai-token.txt'), token, 'utf8');
  bridge = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/tool') { res.writeHead(404); res.end(); return; }
    if (req.headers['x-canopy-token'] !== token) { res.writeHead(403); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2e6) { res.writeHead(413); res.end(); req.destroy(); } });
    req.on('end', () => {
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); res.end(); return; }
      const id = ++seq;
      const timer = setTimeout(() => { waiting.delete(id); res.writeHead(504, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"The editor did not answer in time."}'); }, 30000);
      waiting.set(id, (reply) => { clearTimeout(timer); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(reply)); });
      mainWin?.webContents.send('canopy:ai-command', { id, tool: String(msg.tool || ''), args: msg.args && typeof msg.args === 'object' ? msg.args : {} });
    });
  });
  bridge.on('error', () => { bridge = null; });
  bridge.listen(AI_PORT, '127.0.0.1');
}

function stopBridge() {
  bridge?.close();
  bridge = null;
  fs.rm(path.join(app.getPath('userData'), 'ai-token.txt'), { force: true }).catch(() => {});
}

ipcMain.on('canopy:ai-bridge', (e, on) => { if (on) startBridge(); else stopBridge(); });
ipcMain.on('canopy:ai-reply', (e, msg) => { const done = waiting.get(msg?.id); if (done) { waiting.delete(msg.id); done(msg); } });

ipcMain.handle('canopy:save-as', async (e, name, text) => {
  const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: name, filters: [{ name: 'Canopy plant', extensions: ['canopy'] }] });
  if (res.canceled || !res.filePath) return false;
  await fs.writeFile(res.filePath, text, 'utf8');
  savedAs = res.filePath;
  return true;
});

ipcMain.handle('canopy:backup', async (e, when, text, docName) => {
  // The stamp and name come from the page, so keep them to characters that can't leave the folder.
  const safe = String(when).replace(/[^\w\- ]+/g, '');
  if (!savedAs) {
    // Before the first save, backups go to the app's own Backups folder.
    const dir = path.join(app.getPath('userData'), 'Backups');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${String(docName || 'Untitled').replace(/[^\w\- ]+/g, '') || 'Untitled'} ${safe}.canopy`), text, 'utf8');
    return true;
  }
  const { dir, name, ext } = path.parse(savedAs);
  await fs.writeFile(path.join(dir, `${name} ${safe}${ext}`), text, 'utf8');
  return true;
});

app.whenReady().then(() => {
  const win = mainWin = new BrowserWindow({
    width: 1600, height: 950, autoHideMenuBar: true, backgroundColor: '#11160f', title: 'Canopy',
    icon: path.join(__dirname, '..', 'dist', 'favicon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
app.on('window-all-closed', () => { stopBridge(); app.quit(); });
