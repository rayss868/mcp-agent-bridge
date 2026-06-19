import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import { checkbox, confirm, input, password, select } from '@inquirer/prompts';
import { buildGatewayArgs, spawnGatewayProcess, spawnTunnelProcess, waitForHealth } from './launch.js';

const currentFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFilePath), '..', '..');
const configDir = path.join(projectRoot, 'config');
const tunnelCommand = path.join(projectRoot, 'tools', 'cloudflared.exe');

function parseUiArgs(argv) {
  const options = {
    configPath: null,
    only: null,
    host: null,
    port: null,
    token: null,
    startTunnel: null,
    yes: false,
    dryRun: false
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
      options.host = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--host=')) {
      options.host = arg.slice('--host='.length);
      continue;
    }
    if (arg === '--port') {
      options.port = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--port=')) {
      options.port = arg.slice('--port='.length);
      continue;
    }
    if (arg === '--token') {
      options.token = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--token=')) {
      options.token = arg.slice('--token='.length);
      continue;
    }
    if (arg === '--start-tunnel') {
      options.startTunnel = true;
      continue;
    }
    if (arg === '--no-tunnel') {
      options.startTunnel = false;
      continue;
    }
    if (arg === '--yes') {
      options.yes = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function resolveConfigPath(configPath) {
  if (!configPath) {
    return path.join(configDir, 'vision-web.json');
  }

  return path.isAbsolute(configPath)
    ? path.normalize(configPath)
    : path.resolve(projectRoot, configPath);
}

async function listConfigChoices() {
  const entries = await readdir(configDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function readServerChoices(configPath) {
  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  const servers = parsed?.mcpServers ?? {};

  return Object.entries(servers).map(([name, value]) => ({
    name,
    disabled: value?.disabled === true
  }));
}

function normalizeOnly(value) {
  if (!value) {
    return null;
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePort(value, fallback = 8787) {
  const port = Number(value);
  return Number.isFinite(port) && port > 0 ? port : fallback;
}

function buildSummary(options) {
  return [
    `Config : ${path.relative(projectRoot, options.configPath)}`,
    `Servers: ${options.only?.join(', ') || '(all enabled servers)'}`,
    `Bind   : http://${options.host}:${options.port}`,
    `Health : http://${options.host}:${options.port}/health`,
    `MCP    : http://${options.host}:${options.port}/mcp`,
    `Tunnel : ${options.startTunnel ? 'enabled' : 'disabled'}`,
    `Token  : ${options.token ? 'enabled' : 'disabled'}`
  ].join('\n');
}

async function promptForOptions(cliOptions) {
  const resolvedCliConfigPath = cliOptions.configPath ? resolveConfigPath(cliOptions.configPath) : null;
  const configChoices = await listConfigChoices();
  const defaultConfig = resolvedCliConfigPath ? path.basename(resolvedCliConfigPath) : 'vision-web.json';

  const configPath = cliOptions.yes && resolvedCliConfigPath
    ? resolvedCliConfigPath
    : cliOptions.yes
      ? path.join(configDir, defaultConfig)
      : path.join(
          configDir,
          await select({
            message: 'Choose a config file',
            default: defaultConfig,
            choices: configChoices.map((name) => ({ value: name, name }))
          })
        );

  const serverChoices = await readServerChoices(configPath);
  const preselectedOnly = normalizeOnly(cliOptions.only);

  let selectedServers;
  if (preselectedOnly) {
    selectedServers = preselectedOnly;
  } else if (cliOptions.yes) {
    selectedServers = serverChoices.filter((server) => !server.disabled).map((server) => server.name);
  } else {
    selectedServers = await checkbox({
      message: 'Select servers to load',
      choices: serverChoices.map((server) => ({
        value: server.name,
        name: server.disabled ? `${server.name} (disabled in config)` : server.name,
        checked: !server.disabled,
        disabled: server.disabled ? 'disabled in config' : false
      }))
    });
  }

  const host = cliOptions.host ?? (cliOptions.yes ? '127.0.0.1' : await input({
    message: 'Host to bind',
    default: '127.0.0.1'
  }));

  const port = cliOptions.port
    ? normalizePort(cliOptions.port)
    : normalizePort(
        cliOptions.yes
          ? 8787
          : await input({
              message: 'Port to bind',
              default: '8787',
              validate: (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? true : 'Enter a valid port'
            })
      );

  let token = cliOptions.token;
  if (token == null && !cliOptions.yes) {
    const useToken = await confirm({
      message: 'Protect /mcp with a bearer token?',
      default: false
    });
    token = useToken
      ? await password({
          message: 'Bearer token',
          mask: '*'
        })
      : '';
  }

  let startTunnel = cliOptions.startTunnel;
  if (startTunnel == null) {
    startTunnel = cliOptions.yes
      ? false
      : await confirm({
          message: 'Start cloudflared tunnel too?',
          default: false
        });
  }

  return {
    projectRoot,
    tunnelCommand,
    configPath,
    only: selectedServers.length > 0 ? selectedServers : null,
    host,
    port,
    token: token || null,
    startTunnel
  };
}

async function main() {
  const cliOptions = parseUiArgs(process.argv.slice(2));
  const options = await promptForOptions(cliOptions);
  const gatewayArgs = buildGatewayArgs(options);

  console.log('\nMCP Bridge launcher\n');
  console.log(buildSummary(options));
  console.log(`\nCommand: node ${gatewayArgs.join(' ')}`);

  if (cliOptions.dryRun) {
    return;
  }

  if (!cliOptions.yes) {
    const shouldLaunch = await confirm({
      message: 'Launch gateway now?',
      default: true
    });

    if (!shouldLaunch) {
      console.log('Cancelled.');
      return;
    }
  }

  const gateway = spawnGatewayProcess(options);
  const children = [gateway];

  process.on('SIGINT', () => {
    for (const child of children) {
      child.kill('SIGINT');
    }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    for (const child of children) {
      child.kill('SIGTERM');
    }
    process.exit(0);
  });

  try {
    const health = await waitForHealth(options);
    console.log('\nGateway is healthy.');
    console.log(JSON.stringify(health.summary, null, 2));
  } catch (error) {
    console.error(`\nHealth check failed: ${error.message}`);
  }

  if (options.startTunnel) {
    console.log('\nStarting cloudflared tunnel...');
    const tunnel = spawnTunnelProcess(options);
    children.push(tunnel);
  }

  gateway.on('exit', (code, signal) => {
    if (signal) {
      console.log(`Gateway exited with signal ${signal}`);
      return;
    }
    if (code !== 0) {
      console.log(`Gateway exited with code ${code}`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
