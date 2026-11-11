// Moves the packaged Windows app into release/v0.NN/Win.
const fs = require('fs');
const path = require('path');
const { dir } = require('./release-dir.cjs');
const from = path.join(__dirname, '..', 'release', '.win-tmp', 'Canopy-win32-x64');
const to = path.join(dir, 'Win', 'Canopy-win32-x64');
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(path.dirname(to), { recursive: true });
// A rename fails (EPERM) while Windows still scans the new .exe, so copy instead when it does.
try { fs.renameSync(from, to); } catch { fs.cpSync(from, to, { recursive: true }); }
try { fs.rmSync(path.join(__dirname, '..', 'release', '.win-tmp'), { recursive: true, force: true, maxRetries: 5 }); } catch { console.warn('release/.win-tmp is still in use; delete it later.'); }
console.log(`Windows: ${to}`);
