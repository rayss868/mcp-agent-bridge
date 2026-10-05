const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist', 'sea');
fs.mkdirSync(outDir, { recursive: true });

// 1. bundle dengan esbuild ke CJS tunggal
console.log('[sea] bundling...');
execSync(
  `npx esbuild src/sea-entry.js --bundle --platform=node --format=cjs --outfile=dist/sea/bundle.cjs --log-level=info`,
  { cwd: root, stdio: 'inherit' }
);

const bundlePath = path.join(outDir, 'bundle.cjs');
const blobPath = path.join(outDir, 'sea-prep.blob');

// 2. sea-config.json
const seaConfig = {
  main: 'dist/sea/bundle.cjs',
  output: 'dist/sea/sea-prep.blob',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets: {
    'ui/index.html': path.join(root, 'ui', 'index.html'),
    'config/default.json': path.join(root, 'config', 'default.example.json')
  }
};
fs.writeFileSync(path.join(root, 'dist', 'sea', 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
console.log('[sea] sea-config written');

// 3. generate blob
console.log('[sea] generating blob...');
execSync(`node --experimental-sea-config dist/sea/sea-config.json`, { cwd: root, stdio: 'inherit' });

// 4. copy node binary -> exe (pakai node resmi bila ada, bukan nvm)
const officialNode = path.join(root, 'dist', 'sea', 'node-dist', 'node-v22.23.2-win-x64', 'node.exe');
const nodeBin = fs.existsSync(officialNode) ? officialNode : process.execPath;
const exePath = path.join(root, 'dist', 'mcp-bridge.exe');
const iconReadyNode = path.join(outDir, 'node-icon.exe');
console.log('[sea] node binary:', nodeBin);

// 5. set icon before injecting the SEA blob
console.log('[sea] setting executable icon...');
execSync('node scripts/create-icon.cjs', { cwd: root, stdio: 'inherit' });
const iconPath = path.join(outDir, 'mcp-bridge.ico');
const rceditPath = path.join(root, 'node_modules', 'rcedit', 'bin', 'rcedit.exe');
fs.copyFileSync(nodeBin, iconReadyNode);
execSync(`"${rceditPath}" "${iconReadyNode}" --set-icon "${iconPath}"`, { cwd: root, stdio: 'inherit', shell: true });
fs.copyFileSync(iconReadyNode, exePath);
console.log('[sea] copied to', exePath);

// 6. inject blob dengan postject
console.log('[sea] injecting blob...');
execSync(
  `npx postject "${exePath}" NODE_SEA_BLOB "${blobPath}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
  { cwd: root, stdio: 'inherit', shell: true }
);
console.log('[sea] DONE:', exePath);
