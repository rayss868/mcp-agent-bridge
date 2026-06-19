import path from 'node:path';

function toAbsolutePath(filePath, baseDir) {
  if (!filePath) {
    return filePath;
  }

  return path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(baseDir, filePath);
}

export function parseCliArgs(argv) {
  const options = {
    configPath: null,
    only: null,
    host: '127.0.0.1',
    port: 8787,
    token: process.env.MCP_BRIDGE_TOKEN || null,
    stdio: true
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--config') {
      options.configPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--config=')) {
      options.configPath = arg.slice('--config='.length);
      continue;
    }

    if (arg === '--only') {
      options.only = argv[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg.startsWith('--only=')) {
      options.only = arg.slice('--only='.length);
      continue;
    }

    if (arg === '--host') {
      options.host = argv[index + 1] ?? options.host;
      index += 1;
      continue;
    }

    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length) || options.host;
      continue;
    }

    if (arg === '--port') {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) {
        options.port = value;
      }
      index += 1;
      continue;
    }

    if (arg.startsWith('--port=')) {
      const value = Number(arg.slice('--port='.length));
      if (Number.isFinite(value) && value > 0) {
        options.port = value;
      }
      continue;
    }

    if (arg === '--token') {
      options.token = argv[index + 1] ?? options.token;
      index += 1;
      continue;
    }

    if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length) || options.token;
      continue;
    }

    if (arg === '--stdio') {
      options.stdio = true;
    }
  }

  return options;
}

export async function loadGatewayConfig(configPath, onlyValue) {
  if (!configPath) {
    throw new Error('Missing required --config path');
  }

  const resolvedConfigPath = path.resolve(configPath);
  const baseDir = path.dirname(resolvedConfigPath);
  const raw = await import('node:fs/promises').then((fs) => fs.readFile(resolvedConfigPath, 'utf8'));
  const parsed = JSON.parse(raw);
  const serverEntries = parsed?.mcpServers;

  if (!serverEntries || typeof serverEntries !== 'object') {
    throw new Error(`Invalid config at ${resolvedConfigPath}: missing mcpServers object`);
  }

  const allowlist = onlyValue
    ? new Set(
        onlyValue
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      )
    : null;

  const selectedServers = [];
  const skippedServers = [];

  for (const [serverName, serverConfig] of Object.entries(serverEntries)) {
    if (!serverConfig || typeof serverConfig !== 'object') {
      skippedServers.push({ serverName, reason: 'invalid-config' });
      continue;
    }

    if (serverConfig.disabled === true) {
      skippedServers.push({ serverName, reason: 'disabled' });
      continue;
    }

    if (allowlist && !allowlist.has(serverName)) {
      skippedServers.push({ serverName, reason: 'not-in-only' });
      continue;
    }

    if (!serverConfig.command || typeof serverConfig.command !== 'string') {
      skippedServers.push({ serverName, reason: 'missing-command' });
      continue;
    }

    const args = Array.isArray(serverConfig.args)
      ? serverConfig.args.map((value) => String(value))
      : [];

    selectedServers.push({
      serverName,
      command: serverConfig.command,
      args,
      cwd: serverConfig.cwd ? toAbsolutePath(serverConfig.cwd, baseDir) : undefined,
      env: serverConfig.env && typeof serverConfig.env === 'object' ? serverConfig.env : undefined,
      timeoutMs: typeof serverConfig.timeout === 'number' ? serverConfig.timeout * 1000 : 60000,
      disabledTools: Array.isArray(serverConfig.disabledTools)
        ? new Set(serverConfig.disabledTools.map((value) => String(value)))
        : new Set()
    });
  }

  return {
    resolvedConfigPath,
    selectedServers,
    skippedServers,
    allowlist: allowlist ? [...allowlist] : null
  };
}
