// Moves the packaged Windows app into release/v0.NN/Win.
const fs = require('fs');
const path = require('path');
const { dir } = require('./release-dir.cjs');
const from = path.join(__dirname, '..', 'release', '.win-tmp', 'Canopy-win32-x64');
const to = path.join(dir, 'Win', 'Canopy-win32-x64');
fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.renameSync(from, to);
fs.rmSync(path.join(__dirname, '..', 'release', '.win-tmp'), { recursive: true, force: true });
console.log(`Windows: ${to}`);
