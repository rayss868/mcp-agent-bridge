const fs = require('fs');
let t = fs.readFileSync('src/index.js','utf8');
t = t.replace(
`import { TunnelManager } from './tunnel.js';\n\nconst __dirname = path.dirname(fileURLToPath(import.meta.url));`,
`import { TunnelManager } from './tunnel.js';\nimport { getProjectRoot, isSeaBuild, readUiHtml } from './sea-paths.js';\n\nconst __dirname = getProjectRoot(import.meta.url);`
);
t = t.replace(
`async function main() {\n  const options = parseCliArgs(process.argv.slice(2));\n  const gatewayConfig = await loadGatewayConfig(options.configPath, options.only);`,
`async function main() {\n  const options = parseCliArgs(process.argv.slice(2));\n  if (isSeaBuild()) {\n    const hasStdioFlag = process.argv.includes('--stdio') || process.argv.includes('--no-stdio');\n    if (!hasStdioFlag) options.stdio = false;\n    if (!options.configPath) {\n      const { mkdir, writeFile, access } = await import('node:fs/promises');\n      const cfgDir = path.join(__dirname, 'config');\n      await mkdir(cfgDir, { recursive: true }).catch(() => {});\n      const defCfg = path.join(cfgDir, 'default.json');\n      try { await access(defCfg); }\n      catch {\n        try {\n          const sea = process.getBuiltinModule('node:sea');\n          const embedded = sea.getAsset('config/default.json', 'utf8');\n          if (embedded) await writeFile(defCfg, embedded, 'utf8');\n        } catch {}\n        try { await access(defCfg); }\n        catch { await writeFile(defCfg, '{\\n  \"mcpServers\": {}\\n}\\n', 'utf8'); }\n      }\n      options.configPath = defCfg;\n    }\n  }\n  const gatewayConfig = await loadGatewayConfig(options.configPath, options.only);`
);
t = t.replace(`  // \u2500\u2500 Admin UI routes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  const uiDir = path.resolve(__dirname, '..', 'ui');\n\n  app.get(['/','/ui'], async (_req, res) => {`,
`  // \u2500\u2500 Admin UI routes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  app.get(['/','/ui'], async (_req, res) => {`);
t = t.replace(`      const html = await readFile(path.join(uiDir, 'index.html'), 'utf8');`,
`      const html = await readUiHtml(import.meta.url);`);
t = t.replace("    console.log(`Gateway listening at http://${options.host}:${options.port}/mcp`);",
`    console.log(\`Gateway listening at http://\${options.host}:\${options.port}/mcp\`);`);
fs.writeFileSync('src/index.js', t);
console.log('index patched');

let t2 = fs.readFileSync('src/tunnel.js','utf8');
if (!t2.includes('ensureDir')) {
  t2 = t2.replace('  async loadSettings() {',
  `  async ensureDir() {\n    try { await mkdir(path.dirname(SETTINGS_PATH), { recursive: true }); } catch {}\n  }\n\n  async loadSettings() {`);
  t2 = t2.replace('  async saveSettings(patch) {',
  '  async saveSettings(patch) {\n    await this.ensureDir();');
  fs.writeFileSync('src/tunnel.js', t2);
}
console.log('tunnel patched');
fs.writeFileSync('src/sea-entry.js', "import './index.js';\n");
console.log('sea-entry written');
