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

ipcMain.handle('canopy:read-sample', async (e, name) => {
  const file = path.basename(String(name));
  if (!/^[\w ().-]+\.(canopy|json)$/.test(file)) throw new Error('Not a sample file');
  return fs.readFile(path.join(__dirname, '..', 'dist', 'samples', file), 'utf8');
});

// Only this project's own release files are downloaded; GitHub redirects them to its file host.
const UPDATE_FROM = 'https://github.com/7bajwa/Canopy/releases/download/';
function download(url, to, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    require('node:https').get(url, { headers: { 'User-Agent': 'Canopy-updater' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) { res.resume(); download(res.headers.location, to, onProgress, hops + 1).then(resolve, reject); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`download answered ${res.statusCode}`)); return; }
      const total = +res.headers['content-length'] || 0; let got = 0; let last = 0;
      const out = require('node:fs').createWriteStream(to);
      res.on('data', (c) => { got += c.length; if (total && got - last > total / 50) { last = got; onProgress(got / total); } });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject); res.on('error', reject);
    }).on('error', reject);
  });
}

// The install runs after this app has closed: unzip, copy over the install folder (adding and replacing files,
// never deleting), start the new one. Settings and backups live in the user's app data, not here.
ipcMain.handle('canopy:update', async (e, url) => {
  try {
    if (!app.isPackaged) return 'only the installed PC app updates itself';
    if (!String(url).startsWith(UPDATE_FROM) || !/\.zip$/i.test(url)) return 'not a Canopy release file';
    const tmp = path.join(app.getPath('temp'), 'canopy-update');
    await fs.rm(tmp, { recursive: true, force: true });
    await fs.mkdir(tmp, { recursive: true });
    const zip = path.join(tmp, 'canopy.zip');
    await download(url, zip, (p) => e.sender.send('canopy:update-progress', p));
    const dest = path.dirname(process.execPath);
    const ps1 = path.join(tmp, 'install.ps1');
    await fs.writeFile(ps1, [
      'param([string]$Zip, [string]$Dest, [int]$Wait, [string]$Exe)',
      "Wait-Process -Id $Wait -ErrorAction SilentlyContinue",
      "$out = Join-Path (Split-Path $Zip) 'files'",
      'Expand-Archive -LiteralPath $Zip -DestinationPath $out -Force',
      '$src = Get-ChildItem -LiteralPath $out -Directory | Select-Object -First 1',
      'robocopy $src.FullName $Dest /E /R:5 /W:1 /NFL /NDL /NJH /NJS | Out-Null',
      'Start-Process -FilePath $Exe',
    ].join('\r\n'), 'utf8');
    require('node:child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', ps1, '-Zip', zip, '-Dest', dest, '-Wait', String(process.pid), '-Exe', process.execPath], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return true;
  } catch (err) { return err.message; }
});

// Saving with textures beside the file: the .canopy, then a textures folder next to it.
ipcMain.handle('canopy:save-package', async (e, name, text, files) => {
  const res = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), { defaultPath: name, filters: [{ name: 'Canopy plant', extensions: ['canopy'] }] });
  if (res.canceled || !res.filePath) return false;
  await fs.writeFile(res.filePath, text, 'utf8');
  savedAs = res.filePath;
  const dir = path.dirname(res.filePath);
  for (const f of files || []) {
    // Names come from the page: only textures/<plain name>.<picture> lands, inside that folder.
    if (!/^textures\/[\w ().-]+\.(png|jpe?g|webp|bin)$/i.test(String(f?.name))) continue;
    await fs.mkdir(path.join(dir, 'textures'), { recursive: true });
    await fs.writeFile(path.join(dir, f.name), Buffer.from(f.data));
  }
  return true;
});

// A picture a file points at, as a data URL: an absolute path, or one relative to the file's folder.
const PICTURE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
ipcMain.handle('canopy:read-image', async (e, file, dir) => {
  const p = path.isAbsolute(String(file)) ? String(file) : path.join(String(dir || ''), String(file));
  const type = PICTURE[path.extname(p).toLowerCase()];
  if (!type) return null;
  const st = await fs.stat(p).catch(() => null);
  if (!st?.isFile() || st.size > 200 * 1024 * 1024) return null;
  return `data:${type};base64,${(await fs.readFile(p)).toString('base64')}`;
});

// .canopy files open in Canopy and show its icon in Explorer (registered for this user only, no admin needed).
function registerFileType() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  const exe = process.execPath;
  const reg = (key, value) => require('node:child_process').spawnSync('reg', ['add', `HKCU\\Software\\Classes\\${key}`, '/ve', '/d', value, '/f'], { windowsHide: true });
  reg('.canopy', 'Canopy.Plant');
  reg('Canopy.Plant', 'Canopy plant');
  reg('Canopy.Plant\\DefaultIcon', `"${exe}",0`);
  reg('Canopy.Plant\\shell\\open\\command', `"${exe}" "%1"`);
}

// A file Canopy was started with, or handed while it is already open, goes to the page once it is ready for it.
const fileArg = (argv) => argv.slice(1).find((a) => /\.canopy$/i.test(a) && !a.startsWith('-'));
let pendingFile = fileArg(process.argv);
async function sendFile(p) {
  if (!p) return;
  try {
    const text = await fs.readFile(p, 'utf8');
    savedAs = p;
    mainWin?.webContents.send('canopy:open-file', { name: path.basename(p), text, dir: path.dirname(p) });
  } catch { /* a file that can't be read is left alone */ }
}
ipcMain.on('canopy:ready', () => { if (pendingFile) { sendFile(pendingFile); pendingFile = null; } });
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (e, argv) => {
  if (mainWin) { if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
  sendFile(fileArg(argv));
});

app.whenReady().then(() => {
  registerFileType();
  const win = mainWin = new BrowserWindow({
    width: 1600, height: 950, autoHideMenuBar: true, backgroundColor: '#11160f', title: 'Canopy',
    icon: path.join(__dirname, '..', 'dist', 'favicon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Email and web links open outside the app (the Library's Request an asset, GitHub pages).
  const outside = (url) => /^(mailto:|https:)/i.test(url);
  win.webContents.on('will-navigate', (e, url) => { if (outside(url)) { e.preventDefault(); require('electron').shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (outside(url)) { require('electron').shell.openExternal(url); return { action: 'deny' }; } return { action: 'allow' }; });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
app.on('window-all-closed', () => { stopBridge(); app.quit(); });
