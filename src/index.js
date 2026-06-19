import process from 'node:process';
import { watch } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadGatewayConfig, parseCliArgs } from './config.js';
import { ChildServerManager } from './childServers.js';
import { createGatewayServer } from './router.js';

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function startConfigWatcher(configPath, onlyValue, manager) {
  let debounceTimer = null;
  let closed = false;

  const trigger = async () => {
    if (closed) return;
    try {
      const fresh = await loadGatewayConfig(configPath, onlyValue);
      await manager.reloadFromConfig(fresh);
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
    const stopWatcher = startConfigWatcher(gatewayConfig.resolvedConfigPath, options.only, childServerManager);

    const server = createGatewayServer(childServerManager);
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
  const transports = {};

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

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];

    try {
      let transport = sessionId ? transports[sessionId] : undefined;

      if (transport) {
        await transport.handleRequest(req, res, req.body);
        return;
      }

      if (sessionId) {
        sendJson(res, 400, {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: Invalid session ID'
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

      const server = createGatewayServer(childServerManager);
      activeServers.add(server);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports[newSessionId] = transport;
        }
      });

      transport.onclose = async () => {
        const closingSessionId = transport.sessionId;
        if (closingSessionId && transports[closingSessionId]) {
          delete transports[closingSessionId];
        }
        activeServers.delete(server);
        await server.close().catch(() => {});
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
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
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    await transports[sessionId].handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      console.error('Error handling session termination:', error);
      if (!res.headersSent) {
        res.status(500).send('Error processing session termination');
      }
    }
  });

  const stopWatcher = startConfigWatcher(gatewayConfig.resolvedConfigPath, options.only, childServerManager);

  const serverInstance = app.listen(options.port, options.host, (error) => {
    if (error) {
      console.error('Failed to start gateway:', error);
      process.exit(1);
    }

    const summary = childServerManager.getStartupSummary();
    console.log(`Gateway listening at http://${options.host}:${options.port}/mcp`);
    console.log(`Health endpoint: http://${options.host}:${options.port}/health`);
    console.log(`Loaded servers: ${summary.loadedServers.map((server) => `${server.serverName} (${server.toolCount})`).join(', ') || '(none)'}`);
    console.log(`Skipped servers: ${summary.skippedServers.map((server) => `${server.serverName}:${server.reason}`).join(', ') || '(none)'}`);
  });

  const shutdown = async () => {
    stopWatcher();
    serverInstance.close();
    await Promise.allSettled(
      Object.values(transports).map(async (transport) => {
        await transport.close();
      })
    );
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
