// Puts the website build in release/v0.NN/Web, and mirrors it to release/web (tracked in git; GitHub Pages serves it).
const fs = require('fs');
const path = require('path');
const { dir } = require('./release-dir.cjs');
const from = path.join(__dirname, '..', 'dist');
for (const to of [path.join(dir, 'Web'), path.join(__dirname, '..', 'release', 'web')]) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(from, to, { recursive: true });
  // GitHub Pages skips folders starting with "_" unless told not to.
  fs.writeFileSync(path.join(to, '.nojekyll'), '');
  console.log(`Web: ${to}`);
}
