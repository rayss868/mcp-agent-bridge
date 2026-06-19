import { spawn } from 'node:child_process';

export function buildGatewayArgs(options) {
  const args = ['src/index.js', '--config', options.configPath, '--host', options.host, '--port', String(options.port)];

  if (options.only && options.only.length > 0) {
    args.push('--only', options.only.join(','));
  }

  if (options.token) {
    args.push('--token', options.token);
  }

  return args;
}

export function buildTunnelArgs(options) {
  return ['tunnel', '--protocol', 'http2', '--url', `http://${options.host}:${options.port}`];
}

export function spawnGatewayProcess(options) {
  return spawn('node', buildGatewayArgs(options), {
    cwd: options.projectRoot,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false
  });
}

export function spawnTunnelProcess(options) {
  return spawn(options.tunnelCommand, buildTunnelArgs(options), {
    cwd: options.projectRoot,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false
  });
}

export async function waitForHealth(options, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${options.host}:${options.port}/health`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for ${url}`);
}
