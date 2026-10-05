import process from 'node:process';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildGatewayArgs, waitForHealth, normalizePort } from './launch.js';
import { parseCliArgs } from '../config.js';

function openBrowser(url) {
  const [command, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];

  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true });
  child.on('error', () => {});
  child.unref();
}

export async function runLauncher() {
  const options = parseCliArgs(process.argv.slice(2));
  const host = options.host;
  const port = normalizePort(options.port);
  const gatewayArgs = buildGatewayArgs(options);
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;

  console.log('[launcher] starting gateway...');
  const gateway = spawn('node', gatewayArgs, { stdio: 'inherit' });

  let opened = false;
  gateway.on('exit', (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0));
  });

  try {
    await waitForHealth({ host, port, timeoutMs: 60000 });
    console.log(`[launcher] gateway ready at ${url}`);
    if (!opened) {
      opened = true;
      openBrowser(url);
    }
  } catch (error) {
    console.error(`[launcher] ${error.message}`);
    console.error('[launcher] gateway tidak sehat dalam 60s — cek log di atas');
    gateway.kill();
    process.exit(1);
  }

  const shutdown = (signal) => {
    console.log(`\n[launcher] ${signal} — menghentikan gateway...`);
    gateway.kill();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLauncher().catch((error) => {
    console.error(`[launcher] ${error.message}`);
    process.exit(1);
  });
}
