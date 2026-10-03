// Copies the built React cockpit (../../../dist) into the approuter's resources/ folder.
const fs = require('fs');
const path = require('path');
const from = path.resolve(__dirname, '../../../dist');
const to = path.resolve(__dirname, 'resources');
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log(`copied ${from} -> ${to}`);
