const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pngPath = path.join(root, 'chatgpt-plugin', 'logo.png');
const icoPath = path.join(root, 'dist', 'sea', 'mcp-bridge.ico');
const png = fs.readFileSync(pngPath);
if (png.readUInt32BE(16) !== 128 || png.readUInt32BE(20) !== 128) {
  throw new Error('Expected a 128x128 PNG icon');
}
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(128, 6);
header.writeUInt8(128, 7);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
fs.mkdirSync(path.dirname(icoPath), { recursive: true });
fs.writeFileSync(icoPath, Buffer.concat([header, png]));
console.log(`Created ${icoPath}`);
