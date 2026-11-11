// This version's release folder: release/v0.NN, named from package.json's version (0.NN.x).
const path = require('path');
const { version } = require('../package.json');
const [major, minor] = version.split('.');
const name = `v${major}.${String(minor).padStart(2, '0')}`;
module.exports = { name, dir: path.join(__dirname, '..', 'release', name) };
