import process from 'node:process';
import { watch } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadGatewayConfig, parseCliArgs } from './config.js';
import { ChildServerManager } from './childServers.js';
import { createGatewayServer } from './router.js';
import { createSessionRegistry } from './mcpSessions.js';
import { TunnelManager } from './tunnel.js';
import { getProjectRoot, isSeaBuild, readUiHtml } from './sea-paths.js';

const __dirname = getProjectRoot(import.meta.url);

function sendJson(res, status, body) {
  res.status(status).json(body);
}

// Keeps long-running SSE responses alive through Cloudflare Tunnel.
// Cloudflare drops streams that stay idle (~100s). For MCP streaming
// responses we periodically write an SSE comment frame so the origin
// never looks idle to the proxy. Only active for SSE, never JSON.
const SSE_KEEPALIVE_INTERVAL_MS = 10 * 1000;

// ── Response compression ───────────────────────────────────────
// Compresses JSON responses with gzip to reduce tunnel transfer size.
// Skips if client doesn't accept gzip, response is <256B, or already handled.
function compressionMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    const accept = req.get('accept-encoding') || '';
    if (!accept.includes('gzip')) {
      return originalJson(body);
    }

    const payload = JSON.stringify(body);
    if (payload.length < 256) {
      return originalJson(body);
    }

    // Remove default content-length so we can set compressed size later
    res.removeHeader('content-length');
    res.set('content-encoding', 'gzip');
    res.set('vary', 'Accept-Encoding');

    const gzip = createGzip({ level: 6 });
    const chunks = [];
    gzip.on('data', (chunk) => chunks.push(chunk));
    gzip.on('end', () => {
      const compressed = Buffer.concat(chunks);
      res.set('content-length', String(compressed.length));
      res.status(200).end(compressed);
    });
    gzip.end(Buffer.from(payload));
    return res;
  };

  next();
}

function sseKeepaliveMiddleware(req, res, next) {
  const originalWrite = res.write.bind(res);
  const originalWriteHead = res.writeHead.bind(res);
  let lastWriteAt = 0;
  let timer = null;

  // A stream is SSE and open once headers have been sent with an
  // event-stream content type.
  const isSseResponse = () => String(res.getHeader('content-type') || '').includes('text/event-stream');

  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  let started = false;
  const maybeStart = () => {
    if (started || !isSseResponse()) return;
    started = true;
    lastWriteAt = Date.now();
    timer = setInterval(() => {
      if (Date.now() - lastWriteAt >= SSE_KEEPALIVE_INTERVAL_MS) {
        originalWrite(': keepalive\n\n');
      }
    }, SSE_KEEPALIVE_INTERVAL_MS);
    if (timer.unref) timer.unref();
  };

  res.write = (chunk, ...args) => {
    lastWriteAt = Date.now();
    // Safety net: start keepalive on the first body chunk if writeHead
    // didn't already trigger it.
    maybeStart();
    return originalWrite(chunk, ...args);
  };

  res.writeHead = (...args) => {
    const result = originalWriteHead(...args);
    maybeStart();
    return result;
  };

  res.on('finish', stop);
  res.on('close', stop);

  next();
}

function startConfigWatcher(configPath, onlyValue, manager, onReload) {
  let debounceTimer = null;
  let closed = false;

  const trigger = async () => {
    if (closed) return;
    try {
      const fresh = await loadGatewayConfig(configPath, onlyValue);
      await manager.reloadFromConfig(fresh);
      onReload?.();
    } catch (error) {
      console.error(`[mcp-agent-bridge] reload failed: ${error.message}`);
    }
  };

  let watcher;
  try {
    watcher = watch(configPath, { persistent: true }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(trigger, 500);
    });
    watcher.on('error', (error) => {
      console.error(`[mcp-agent-bridge] config watcher error: ${error.message}`);
    });
    console.error(`[mcp-agent-bridge] watching ${configPath} for changes`);
  } catch (error) {
    console.error(`[mcp-agent-bridge] could not watch ${configPath}: ${error.message}`);
    return () => {};
  }

  return () => {
    closed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (isSeaBuild()) {
    const hasStdioFlag = process.argv.includes('--stdio') || process.argv.includes('--no-stdio');
    if (!hasStdioFlag) options.stdio = false;
    if (!options.configPath) {
      const { mkdir, writeFile, access } = await import('node:fs/promises');
      const cfgDir = path.join(__dirname, 'config');
      await mkdir(cfgDir, { recursive: true }).catch(() => {});
      const defCfg = path.join(cfgDir, 'default.json');
      try { await access(defCfg); }
      catch {
        try {
          const sea = process.getBuiltinModule('node:sea');
          const embedded = sea.getAsset('config/default.example.json', 'utf8');
          if (embedded) await writeFile(defCfg, embedded, 'utf8');
        } catch {}
        try { await access(defCfg); }
        catch { await writeFile(defCfg, '{\n  "mcpServers": {}\n}\n', 'utf8'); }
      }
      options.configPath = defCfg;
    }
  }
  const gatewayConfig = await loadGatewayConfig(options.configPath, options.only);

  // Set is filled in below once we know whether we're in stdio or HTTP mode.
  const activeServers = new Set();
  const childServerManager = new ChildServerManager(gatewayConfig, {
    onToolsChanged: () => {
      for (const server of activeServers) {
        try {
          server.sendToolListChanged();
        } catch (error) {
          console.error(`[mcp-agent-bridge] sendToolListChanged failed: ${error.message}`);
        }
      }
    }
  });
  await childServerManager.start();

  if (options.stdio) {
    const { server, invalidateToolsCache } = createGatewayServer(childServerManager);
    const stopWatcher = startConfigWatcher(gatewayConfig.resolvedConfigPath, options.only, childServerManager, invalidateToolsCache);

    activeServers.add(server);
    const transport = new StdioServerTransport();

    const shutdown = async () => {
      stopWatcher();
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
      await childServerManager.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await server.connect(transport);

    const summary = childServerManager.getStartupSummary();
    console.error(`[mcp-agent-bridge] stdio mode active`);
    console.error(`[mcp-agent-bridge] Loaded servers: ${summary.loadedServers.map((s) => `${s.serverName} (${s.toolCount})`).join(', ') || '(none)'}`);
    console.error(`[mcp-agent-bridge] Skipped servers: ${summary.skippedServers.map((s) => `${s.serverName}:${s.reason}`).join(', ') || '(none)'}`);
    return;
  }

  const app = createMcpExpressApp({ host: '0.0.0.0' });
  app.use(compressionMiddleware);
  const sessions = createSessionRegistry({ ttlMs: 30 * 60 * 1000 });

  app.get('/health', (_req, res) => {
    sendJson(res, 200, {
      ok: true,
      config: gatewayConfig.resolvedConfigPath,
      summary: childServerManager.getStartupSummary()
    });
  });

  app.use('/mcp', (req, res, next) => {
    if (!options.token) {
      next();
      return;
    }

    const authHeader = req.header('authorization') || '';
    if (authHeader === `Bearer ${options.token}`) {
      next();
      return;
    }

    sendJson(res, 401, {
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Unauthorized'
      },
      id: null
    });
  });

  app.use('/mcp', sseKeepaliveMiddleware);

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];

    try {
      let transport = sessionId ? sessions.get(sessionId) : undefined;

      if (transport) {
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (sessionId) {
        sendJson(res, 404, {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Session not found'
          },
          id: null
        });
        return;
      }

      if (!isInitializeRequest(req.body)) {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: initialize required before session use'
          },
          id: null
        });
        return;
      }

      const { server } = createGatewayServer(childServerManager);
      activeServers.add(server);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, transport);
        }
      });

      transport.onclose = () => {
        const closingSessionId = transport.sessionId;
        if (closingSessionId && sessions.get(closingSessionId) === transport) {
          sessions.remove(closingSessionId);
        }
        activeServers.delete(server);
      };

      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        await transport.close().catch(() => {});
        activeServers.delete(server);
        await server.close().catch(() => {});
        throw error;
      }
    } catch (error) {
      console.error('Error handling MCP request:', error);

      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling MCP stream:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing MCP stream');
      }
    }
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      res.status(404).send('Session not found');
      return;
    }

    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('Error handling session termination:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  // ── REST API for ChatGPT Plugin ─────────────────────────────
  // Thin REST wrapper — ChatGPT discovers tools dynamically via /bridge/servers.
  app.get('/bridge/servers', async (_req, res) => {
    const summary = childServerManager.getStartupSummary();
    const servers = summary.loadedServers.map((s) => ({
      name: s.serverName,
      toolCount: s.toolCount,
      tools: (childServerManager.getToolsForServer(s.serverName) ?? []).map((t) => t.name.replace(`${s.serverName}__`, ''))
    }));
    res.json({ servers });
  });

  app.get('/bridge/servers/:name/tools', async (req, res) => {
    const tools = childServerManager.getToolsForServer(req.params.name);
    if (!tools) {
      return res.status(404).json({ error: `Server "${req.params.name}" not found` });
    }
    res.json({
      server: req.params.name,
      toolCount: tools.length,
      tools: tools.map((t) => ({ name: t.name.replace(`${req.params.name}__`, ''), description: t.description, inputSchema: t.inputSchema }))
    });
  });

  app.post('/bridge/execute', async (req, res) => {
    const { server, tool, args } = req.body ?? {};
    if (!server || !tool) {
      return sendJson(res, 400, { error: 'Missing "server" or "tool"' });
    }
    try {
      const result = await childServerManager.callTool(`${server}__${tool}`, args ?? {});
      res.json({ ok: true, result });
    } catch (error) {
      res.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/bridge/batch', async (req, res) => {
    const { operations, stopOnError } = req.body ?? {};
    if (!Array.isArray(operations) || operations.length === 0) {
      return sendJson(res, 400, { error: '"operations" must be a non-empty array' });
    }
    const stop = stopOnError !== false;
    const results = [];
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      if (!op?.server || !op?.tool) {
        results.push({ index: i, ok: false, error: 'Missing server/tool' });
        if (stop) break;
        continue;
      }
      try {
        const result = await childServerManager.callTool(`${op.server}__${op.tool}`, op.args ?? {});
        results.push({ index: i, server: op.server, tool: op.tool, ok: true, result });
      } catch (error) {
        results.push({ index: i, server: op.server, tool: op.tool, ok: false, error: error instanceof Error ? error.message : String(error) });
        if (stop) break;
      }
    }
    res.json({ ok: true, total: operations.length, completed: results.length, results });
  });

  // ── Admin UI routes ──────────────────────────────────────────
  const uiDir = path.resolve(__dirname, '..', 'ui');

  app.get(['/', '/ui'], async (_req, res) => {
    try {
      const html = await readUiHtml(import.meta.url);
      res.type('html').send(html);
    } catch {
      res.status(404).send('UI not found');
    }
  });

  app.get('/api/servers', async (_req, res) => {
    try {
      const raw = await readFile(gatewayConfig.resolvedConfigPath, 'utf8');
      const parsed = JSON.parse(raw);
      const entries = parsed?.mcpServers ?? {};
      const running = childServerManager.getStartupSummary().loadedServers;
      const runningMap = {};
      for (const s of running) runningMap[s.serverName] = s.toolCount;

      const servers = Object.entries(entries).map(([name, cfg]) => ({
        name,
        disabled: cfg.disabled === true,
        command: cfg.command,
        args: cfg.args,
        cwd: cfg.cwd ?? null,
        env: cfg.env ?? null,
        timeout: cfg.timeout ?? null,
        disabledTools: cfg.disabledTools ?? null,
        toolCount: runningMap[name] ?? 0,
        tools: (childServerManager.getToolsForServer(name) ?? []).map(t => t.name)
      }));

      res.json({ configPath: gatewayConfig.resolvedConfigPath, servers });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.patch('/api/servers/:name/toggle', async (req, res) => {
    try {
      const serverName = req.params.name;
      const raw = await readFile(gatewayConfig.resolvedConfigPath, 'utf8');
      const parsed = JSON.parse(raw);
      const entry = parsed?.mcpServers?.[serverName];
      if (!entry) {
        res.status(404).json({ error: `Server "${serverName}" not found` });
        return;
      }

      const current = entry.disabled === true;
      entry.disabled = !current;
      if (entry.disabled === false) delete entry.disabled;

      await writeFile(gatewayConfig.resolvedConfigPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
      res.json({ server: serverName, disabled: entry.disabled === true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Full server config update
  app.patch('/api/servers/:name', async (req, res) => {
    try {
      const serverName = req.params.name;
      const raw = await readFile(gatewayConfig.resolvedConfigPath, 'utf8');
      const parsed = JSON.parse(raw);
      const entry = parsed?.mcpServers?.[serverName];
      if (!entry) {
        res.status(404).json({ error: `Server "${serverName}" not found` });
        return;
      }

      const body = req.body ?? {};

      if (body.command !== undefined) {
        if (typeof body.command !== 'string' || !body.command.trim()) {
          res.status(400).json({ error: '"command" must be a non-empty string' });
          return;
        }
        entry.command = body.command.trim();
      }

      if (body.args !== undefined) {
        if (!Array.isArray(body.args)) {
          res.status(400).json({ error: '"args" must be an array of strings' });
          return;
        }
        entry.args = body.args.map(v => String(v));
      }

      if (body.cwd !== undefined) {
        if (body.cwd === null || body.cwd === '') {
          delete entry.cwd;
        } else {
          entry.cwd = String(body.cwd);
        }
      }

      if (body.env !== undefined) {
        if (body.env === null || (typeof body.env === 'object' && Object.keys(body.env).length === 0)) {
          delete entry.env;
        } else if (typeof body.env === 'object') {
          entry.env = {};
          for (const [k, v] of Object.entries(body.env)) {
            entry.env[String(k)] = String(v);
          }
        } else {
          res.status(400).json({ error: '"env" must be an object of key-value pairs' });
          return;
        }
      }

      if (body.timeout !== undefined) {
        if (body.timeout === null || body.timeout === '') {
          delete entry.timeout;
        } else {
          const t = Number(body.timeout);
          if (!Number.isFinite(t) || t <= 0) {
            res.status(400).json({ error: '"timeout" must be a positive number (seconds)' });
            return;
          }
          entry.timeout = t;
        }
      }

      if (body.disabledTools !== undefined) {
        if (!Array.isArray(body.disabledTools)) {
          res.status(400).json({ error: '"disabledTools" must be an array of strings' });
          return;
        }
        if (body.disabledTools.length === 0) {
          delete entry.disabledTools;
        } else {
          entry.disabledTools = body.disabledTools.map(v => String(v));
        }
      }

      if (body.disabled !== undefined) {
        if (body.disabled) {
          entry.disabled = true;
        } else {
          delete entry.disabled;
        }
      }

      await writeFile(gatewayConfig.resolvedConfigPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');

      const running = childServerManager.getStartupSummary().loadedServers;
      const toolCount = running.find(s => s.serverName === serverName)?.toolCount ?? 0;

      res.json({
        server: serverName,
        disabled: entry.disabled === true,
        command: entry.command,
        args: entry.args,
        cwd: entry.cwd ?? null,
        env: entry.env ?? null,
        timeout: entry.timeout ?? null,
        disabledTools: entry.disabledTools ?? [],
        toolCount
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Tunnel control ──────────────────────────────────────────
  const tunnelManager = new TunnelManager({ host: options.host, port: options.port });
  await tunnelManager.loadSettings();

  app.get('/api/tunnel', (_req, res) => {
    res.json(tunnelManager.status());
  });

  app.put('/api/tunnel/settings', async (req, res) => {
    try {
      await tunnelManager.saveSettings(req.body ?? {});
      res.json(tunnelManager.status());
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/tunnel/start', async (req, res) => {
    try {
      const state = await tunnelManager.start(req.body ?? {});
      res.json(state);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/tunnel/stop', (_req, res) => {
    res.json(tunnelManager.stop());
  });

  const stopWatcher = startConfigWatcher(gatewayConfig.resolvedConfigPath, options.only, childServerManager, () => {
    for (const server of activeServers) {
      server.sendToolListChanged?.();
    }
  });

  const serverInstance = app.listen(options.port, options.host, async (error) => {
    if (error) {
      console.error('Failed to start gateway:', error);
      process.exit(1);
    }

    const summary = childServerManager.getStartupSummary();
    console.log(`Gateway listening at http://${options.host}:${options.port}/mcp`);
    console.log(`Health endpoint: http://${options.host}:${options.port}/health`);
    console.log(`Loaded servers: ${summary.loadedServers.map((server) => `${server.serverName} (${server.toolCount})`).join(', ') || '(none)'}`);
    console.log(`Skipped servers: ${summary.skippedServers.map((server) => `${server.serverName}:${server.reason}`).join(', ') || '(none)'}`);

    if (tunnelManager.settings.autoStart && !tunnelManager.isRunning()) {
      tunnelManager.start().then((state) => {
        console.log(`Tunnel running at ${state.url} (provider: ${state.provider})`);
      }).catch((error) => {
        console.error(`Tunnel auto-start failed: ${error.message}`);
      });
    }
  });

  const shutdown = async () => {
    stopWatcher();
    tunnelManager.stop();
    await new Promise((resolve) => serverInstance.close(resolve));
    await sessions.close();
    for (const server of activeServers) {
      await server.close().catch(() => {});
    }
    await childServerManager.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
