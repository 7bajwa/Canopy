// Puts the Android test build in release/v0.NN/Apk, under a name that says what it is.
const fs = require('fs');
const path = require('path');
const { dir, name } = require('./release-dir.cjs');
const from = path.join(__dirname, '..', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const to = path.join(dir, 'Apk', `Canopy-${name}.apk`);
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.copyFileSync(from, to);
console.log(`APK: ${to}`);
