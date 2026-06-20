import { readFile, rename, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
    })
  ]);
}

async function listAllTools(client, timeoutMs, label) {
  const tools = [];
  let cursor;

  do {
    const result = await withTimeout(client.listTools({ cursor }), timeoutMs, `${label} listTools`);
    tools.push(...(result.tools ?? []));
    cursor = result.nextCursor;
  } while (cursor);

  return tools;
}

function buildExposedToolMap(serverTools) {
  const exposedTools = new Map();

  for (const entry of serverTools) {
    entry.exposedName = `${entry.serverName}__${entry.originalName}`;
    exposedTools.set(entry.exposedName, entry);
  }

  return exposedTools;
}

function serverConfigFingerprint(config) {
  return JSON.stringify({
    command: config.command,
    args: config.args,
    cwd: config.cwd ?? null,
    env: config.env ?? null
  });
}

async function startOneServer(serverConfig) {
  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    cwd: serverConfig.cwd,
    env: serverConfig.env,
    stderr: 'pipe'
  });
  const client = new Client({ name: 'mcp-agent-bridge-gateway', version: '0.1.0' });

  transport.stderr?.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error(`[${serverConfig.serverName}] ${text}`);
    }
  });

  await withTimeout(client.connect(transport), serverConfig.timeoutMs, `${serverConfig.serverName} connect`);
  const tools = await listAllTools(client, serverConfig.timeoutMs, serverConfig.serverName);
  const enabledTools = tools.filter((tool) => !serverConfig.disabledTools.has(tool.name));

  // Capture pid at startup because the SDK clears the transport's internal
  // process reference once the child exits, making `transport.pid` undefined.
  // We also hook the underlying process exit event so we can react immediately
  // without waiting for the next health-check tick.
  const pid = transport.pid;
  let exited = false;
  const exitPromise = new Promise((resolve) => {
    try {
      const proc = transport._process;
      if (proc && typeof proc.once === 'function') {
        proc.once('exit', () => {
          exited = true;
          resolve();
        });
      } else {
        resolve();
      }
    } catch {
      resolve();
    }
  });

  return {
    serverName: serverConfig.serverName,
    timeoutMs: serverConfig.timeoutMs,
    disabledTools: serverConfig.disabledTools,
    fingerprint: serverConfigFingerprint(serverConfig),
    client,
    transport,
    tools: enabledTools,
    pid,
    exitPromise,
    isExited: () => exited
  };
}

async function stopOneServer(server) {
  await server.client.close().catch(() => {});
}

function rebuildExposedTools(runningServers) {
  const flattened = [];
  for (const server of runningServers) {
    for (const tool of server.tools) {
      flattened.push({
        serverName: server.serverName,
        timeoutMs: server.timeoutMs,
        client: server.client,
        originalName: tool.name,
        tool
      });
    }
  }
  return buildExposedToolMap(flattened);
}

export class ChildServerManager {
  constructor(config, options = {}) {
    this.config = config;
    this.runningServers = [];
    this.exposedTools = new Map();
    this.onToolsChanged = options.onToolsChanged ?? null;
    this.restartAttempts = new Map();
    this.restartTimers = new Map();
    this.pendingSpawns = new Map();
    this.healthCheckInterval = null;
    this.closed = false;
  }

  async start() {
    this.closed = false;
    this.runningServers = [];

    // Spawn all child servers in parallel and wait for them to be ready
    // before returning. This ensures tools are available immediately when
    // the client sends the first tools/list request.
    const spawnPromises = this.config.selectedServers.map((config) =>
      this.spawnAndRegister(config)
    );
    await Promise.allSettled(spawnPromises);
  }

  async spawnAndRegister(serverConfig) {
    let resolveSpawn;
    const pendingPromise = new Promise((resolve) => {
      resolveSpawn = resolve;
    });
    this.pendingSpawns.set(serverConfig.serverName, pendingPromise);

    try {
      const server = await startOneServer(serverConfig);
      if (this.closed) {
        await stopOneServer(server).catch(() => {});
        return;
      }
      this.runningServers.push(server);
      this.scheduleHealthCheck(server);
      this.exposedTools = rebuildExposedTools(this.runningServers);
      this.restartAttempts.delete(serverConfig.serverName);
      console.error(
        `[mcp-agent-bridge] ${serverConfig.serverName} ready (${server.tools.length} tools)`
      );
      if (this.onToolsChanged) {
        try {
          this.onToolsChanged();
        } catch (error) {
          console.error(`[mcp-agent-bridge] onToolsChanged callback failed: ${error.message}`);
        }
      }
      resolveSpawn(server);
    } catch (error) {
      resolveSpawn(null);
      if (this.closed) return;
      console.error(`[mcp-agent-bridge] failed to start ${serverConfig.serverName}: ${error.message}`);
      this.scheduleRestart(serverConfig);
    } finally {
      this.pendingSpawns.delete(serverConfig.serverName);
    }
  }

  scheduleHealthCheck(server) {
    if (this.closed) return;
    if (!this.healthCheckInterval) {
      console.error(`[mcp-agent-bridge] starting health checker (5s interval)`);
      this.healthCheckInterval = setInterval(() => this.runHealthCheck(), 5000);
      this.healthCheckInterval.unref?.();
    }

    // React immediately when the child process exits, without waiting for the
    // next health-check tick.
    if (server.exitPromise && typeof server.exitPromise.then === 'function') {
      server.exitPromise.then(() => {
        if (this.closed) return;
        // Skip if this server has already been replaced or removed.
        if (!this.runningServers.includes(server)) return;
        console.error(`[mcp-agent-bridge] child process exited: ${server.serverName}`);
        const config = this.config.selectedServers.find((c) => c.serverName === server.serverName);
        if (config) {
          this.scheduleRestart(config);
        }
      }).catch(() => {});
    }
  }

  runHealthCheck() {
    if (this.closed) return;

    for (const server of this.runningServers) {
      if (typeof server.isExited === 'function' && server.isExited()) {
        continue; // already scheduled for restart
      }
      const pid = server.pid;
      if (pid === undefined || pid === null) {
        continue;
      }
      try {
        process.kill(pid, 0);
      } catch {
        console.error(`[mcp-agent-bridge] detected dead process: ${server.serverName} (pid ${pid})`);
        const config = this.config.selectedServers.find((c) => c.serverName === server.serverName);
        if (config) {
          this.scheduleRestart(config);
        }
      }
    }
  }

  scheduleRestart(serverConfig) {
    if (this.closed) return;

    if (this.restartTimers.has(serverConfig.serverName)) {
      return;
    }

    const attempts = (this.restartAttempts.get(serverConfig.serverName) ?? 0) + 1;
    this.restartAttempts.set(serverConfig.serverName, attempts);
    const delayMs = Math.min(60000, 1000 * Math.pow(2, attempts - 1));

    console.error(
      `[mcp-agent-bridge] scheduling restart of ${serverConfig.serverName} in ${Math.round(delayMs / 1000)}s (attempt ${attempts})`
    );

    const timer = setTimeout(async () => {
      this.restartTimers.delete(serverConfig.serverName);
      if (this.closed) return;

      const currentConfig = this.config.selectedServers.find((c) => c.serverName === serverConfig.serverName);
      if (!currentConfig) {
        console.error(`[mcp-agent-bridge] ${serverConfig.serverName} no longer in config, skipping restart`);
        return;
      }

      const oldServer = this.runningServers.find((s) => s.serverName === serverConfig.serverName);
      if (oldServer) {
        this.runningServers = this.runningServers.filter((s) => s.serverName !== serverConfig.serverName);
        await stopOneServer(oldServer).catch(() => {});
      }

      try {
        const newServer = await startOneServer(currentConfig);
        this.runningServers.push(newServer);
        this.scheduleHealthCheck(newServer);
        this.exposedTools = rebuildExposedTools(this.runningServers);
        this.restartAttempts.delete(serverConfig.serverName);
        console.error(
          `[mcp-agent-bridge] ${serverConfig.serverName} restarted successfully (${newServer.tools.length} tools)`
        );
        if (this.onToolsChanged) {
          try {
            this.onToolsChanged();
          } catch (error) {
            console.error(`[mcp-agent-bridge] onToolsChanged callback failed: ${error.message}`);
          }
        }
      } catch (error) {
        console.error(`[mcp-agent-bridge] restart of ${serverConfig.serverName} failed: ${error.message}`);
        this.scheduleRestart(currentConfig);
      }
    }, delayMs);

    timer.unref?.();
    this.restartTimers.set(serverConfig.serverName, timer);
  }

  cancelRestart(serverName) {
    const timer = this.restartTimers.get(serverName);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(serverName);
    }
  }

  getToolDefinitions() {
    return [...this.exposedTools.values()].map(({ exposedName, tool }) => ({
      ...tool,
      name: exposedName
    }));
  }

  getToolsForServer(serverName) {
    const tools = [];
    for (const [exposedName, entry] of this.exposedTools) {
      if (entry.serverName === serverName) {
        tools.push({
          name: entry.originalName,
          description: entry.tool.description,
          inputSchema: entry.tool.inputSchema
        });
      }
    }
    // Also check pending spawns — server might be loading
    if (tools.length === 0 && this.pendingSpawns.has(serverName)) {
      return null; // signal: server exists but tools not ready yet
    }
    return tools.length > 0 ? tools : null;
  }

  async callTool(exposedName, args) {
    let entry = this.exposedTools.get(exposedName);

    // If the tool isn't in the cache, it might still be loading. Try to
    // resolve the server prefix (everything before `__`) against a pending
    // spawn and wait briefly for the tool list to populate.
    if (!entry) {
      const separatorIndex = exposedName.indexOf('__');
      if (separatorIndex > 0) {
        const serverName = exposedName.substring(0, separatorIndex);
        const pending = this.pendingSpawns.get(serverName);
        if (pending) {
          console.error(`[mcp-agent-bridge] tool ${exposedName} not yet loaded, waiting up to 8s for ${serverName}...`);
          const result = await Promise.race([
            pending,
            new Promise((resolve) => setTimeout(() => resolve('timeout'), 8000))
          ]);
          if (result && result !== 'timeout') {
            entry = this.exposedTools.get(exposedName);
          }
        }
      }
    }

    if (!entry) {
      throw new Error(`Unknown tool: ${exposedName}`);
    }

    return withTimeout(
      entry.client.callTool({
        name: entry.originalName,
        arguments: args ?? {}
      }),
      entry.timeoutMs,
      `${entry.serverName}:${entry.originalName} callTool`
    );
  }

  getStartupSummary() {
    return {
      loadedServers: this.runningServers.map((server) => ({
        serverName: server.serverName,
        toolCount: server.tools.length
      })),
      skippedServers: this.config.skippedServers,
      toolNames: this.getToolDefinitions().map((tool) => tool.name)
    };
  }

  async executeBatch(operations, options = {}) {
    const stopOnError = options.stopOnError !== false;

    if (!Array.isArray(operations) || operations.length === 0) {
      throw new Error('operations must be a non-empty array');
    }

    const results = [];
    for (let index = 0; index < operations.length; index += 1) {
      const op = operations[index];

      if (!op || typeof op !== 'object' || typeof op.tool !== 'string' || op.tool.length === 0) {
        results.push({
          index,
          tool: op?.tool,
          ok: false,
          error: 'Each operation must be an object with a non-empty "tool" string'
        });
        if (stopOnError) break;
        continue;
      }

      try {
        const result = await this.callTool(op.tool, op.args ?? {});
        results.push({
          index,
          tool: op.tool,
          ok: true,
          result
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          index,
          tool: op.tool,
          ok: false,
          error: message
        });
        if (stopOnError) break;
      }
    }

    return {
      total: operations.length,
      completed: results.length,
      stoppedOnError: stopOnError && results.length < operations.length,
      results
    };
  }

  async setServerDisabledFlag(serverName, disabled) {
    const configPath = this.config?.resolvedConfigPath;
    if (!configPath) {
      throw new Error('No config path available on bridge state');
    }

    const raw = await readFile(configPath, 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Failed to parse config at ${configPath}: ${error.message}`);
    }

    if (!parsed?.mcpServers || typeof parsed.mcpServers !== 'object') {
      throw new Error(`Invalid config at ${configPath}: missing mcpServers object`);
    }

    if (!Object.prototype.hasOwnProperty.call(parsed.mcpServers, serverName)) {
      throw new Error(`Server "${serverName}" not found in config`);
    }

    const serverEntry = parsed.mcpServers[serverName];
    if (typeof serverEntry !== 'object' || serverEntry === null) {
      throw new Error(`Server "${serverName}" has invalid config entry`);
    }

    if (disabled) {
      serverEntry.disabled = true;
    } else if (serverEntry.disabled === true) {
      delete serverEntry.disabled;
    }

    const tmpPath = `${configPath}.tmp`;
    const newContent = JSON.stringify(parsed, null, 2) + '\n';
    await writeFile(tmpPath, newContent, 'utf8');
    await rename(tmpPath, configPath);

    return { configPath, serverName, disabled };
  }

  async disableServer(serverName) {
    if (!serverName || typeof serverName !== 'string') {
      throw new Error('Server name must be a non-empty string');
    }
    return this.setServerDisabledFlag(serverName, true);
  }

  async enableServer(serverName) {
    if (!serverName || typeof serverName !== 'string') {
      throw new Error('Server name must be a non-empty string');
    }
    return this.setServerDisabledFlag(serverName, false);
  }

  async reloadFromConfig(newConfig) {
    const oldByName = new Map(this.runningServers.map((server) => [server.serverName, server]));
    const newByName = new Map(newConfig.selectedServers.map((config) => [config.serverName, config]));

    const next = [];

    // Stop servers that were removed or whose core config changed.
    for (const server of this.runningServers) {
      const newConfigEntry = newByName.get(server.serverName);
      const stillExists = newConfigEntry !== undefined;
      const sameCore = stillExists && serverConfigFingerprint(newConfigEntry) === server.fingerprint;

      if (!stillExists) {
        console.error(`[mcp-agent-bridge] stopping removed server: ${server.serverName}`);
        await stopOneServer(server);
        continue;
      }

      if (!sameCore) {
        console.error(`[mcp-agent-bridge] restarting changed server: ${server.serverName}`);
        await stopOneServer(server);
        try {
          next.push(await startOneServer(newConfigEntry));
        } catch (error) {
          console.error(`[mcp-agent-bridge] failed to restart ${server.serverName}: ${error.message}`);
        }
        continue;
      }

      // Unchanged core config: keep client alive, but refresh timeoutMs/disabledTools in case they changed.
      server.timeoutMs = newConfigEntry.timeoutMs;
      server.disabledTools = newConfigEntry.disabledTools;
      server.tools = server.tools.filter((tool) => !newConfigEntry.disabledTools.has(tool.name));
      next.push(server);
    }

    // Start servers that are new.
    for (const [name, config] of newByName) {
      if (oldByName.has(name)) {
        continue;
      }
      console.error(`[mcp-agent-bridge] starting new server: ${name}`);
      try {
        const newServer = await startOneServer(config);
        next.push(newServer);
        this.scheduleHealthCheck(newServer);
      } catch (error) {
        console.error(`[mcp-agent-bridge] failed to start ${name}: ${error.message}`);
        this.scheduleRestart(config);
      }
    }

    // Cancel pending restart timers for servers that are no longer in the config,
    // and for servers that we just replaced/restarted above.
    for (const name of this.restartTimers.keys()) {
      if (!newByName.has(name)) {
        this.cancelRestart(name);
        this.restartAttempts.delete(name);
      }
    }
    for (const server of next) {
      this.cancelRestart(server.serverName);
    }

    this.runningServers = next;
    this.config = newConfig;
    this.exposedTools = rebuildExposedTools(this.runningServers);

    const summary = this.getStartupSummary();
    console.error(
      `[mcp-agent-bridge] reload complete: ${summary.loadedServers.length} loaded, ${summary.skippedServers.length} skipped, ${summary.toolNames.length} tools`
    );

    if (this.onToolsChanged) {
      try {
        this.onToolsChanged();
      } catch (error) {
        console.error(`[mcp-agent-bridge] onToolsChanged callback failed: ${error.message}`);
      }
    }
  }

  async close() {
    this.closed = true;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    for (const timer of this.restartTimers.values()) {
      clearTimeout(timer);
    }
    this.restartTimers.clear();
    await Promise.allSettled(
      this.runningServers.map(async ({ client }) => {
        await client.close();
      })
    );
  }
}
