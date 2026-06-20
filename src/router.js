import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError
} from '@modelcontextprotocol/sdk/types.js';

const BRIDGE_LIST_SERVERS_TOOL = {
  name: 'bridge__list_servers',
  description:
    'List all MCP child servers currently loaded by the bridge, the number of tools exposed by each, the skipped servers with reasons, and every exposed tool name. Use this to discover what the bridge currently exposes.',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Optional server name to filter by (exact match).'
      }
    },
    additionalProperties: false
  }
};

const BRIDGE_DISABLE_SERVER_TOOL = {
  name: 'bridge__disable_server',
  description:
    'Disable an MCP server by name. The server is stopped (if running) and its tools are removed. The change is persisted to the config file; the file watcher reloads within ~500ms.',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Name of the server entry in mcpServers.'
      }
    },
    required: ['server'],
    additionalProperties: false
  }
};

const BRIDGE_ENABLE_SERVER_TOOL = {
  name: 'bridge__enable_server',
  description:
    'Enable a disabled MCP server by name. The server is started and its tools are exposed. The change is persisted to the config file; the file watcher reloads within ~500ms.',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Name of the server entry in mcpServers.'
      }
    },
    required: ['server'],
    additionalProperties: false
  }
};

const BRIDGE_EXECUTE_TOOL = {
  name: 'bridge__execute',
  description:
    'Execute a tool on any loaded MCP server. This is the primary way to interact with MCP servers through the bridge. The response is returned 1:1 from the child MCP server.\n\nSupports two modes:\n- **Single**: pass `server` + `tool` + optional `args` to run one tool call.\n- **Batch**: pass `operations` (an array of `{server, tool, args}`) to chain multiple tool calls in one request. Useful for sequences like navigate → snapshot → evaluate, which would otherwise need N separate round trips.',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Single-mode: name of the MCP server (e.g. "ssh-mcp", "web-curl", "playwright-extension").'
      },
      tool: {
        type: 'string',
        description: 'Single-mode: name of the tool to execute on the server (e.g. "terminal-start", "fetch_api").'
      },
      args: {
        type: 'object',
        description: 'Single-mode: arguments to pass to the tool. Use {} or omit for tools with no required parameters.',
        additionalProperties: true
      },
      operations: {
        type: 'array',
        description: 'Batch-mode: ordered list of tool calls to execute sequentially. Each item has the same shape as the single-mode fields.',
        items: {
          type: 'object',
          properties: {
            server: { type: 'string' },
            tool: { type: 'string' },
            args: { type: 'object', additionalProperties: true }
          },
          required: ['server', 'tool'],
          additionalProperties: false
        },
        minItems: 1
      },
      stopOnError: {
        type: 'boolean',
        description: 'Batch-mode: if true (default), stop at the first failure. If false, attempt every operation and report per-operation success/failure.'
      }
    },
    additionalProperties: false
  }
};

const BRIDGE_LIST_SERVER_TOOLS_TOOL = {
  name: 'bridge__list_server_tools',
  description:
    'List all available tools for a specific MCP server, including their input schemas. Use this to discover what tools and parameters a server supports before calling bridge__execute.',
  inputSchema: {
    type: 'object',
    properties: {
      server: {
        type: 'string',
        description: 'Name of the MCP server to list tools for.'
      }
    },
    required: ['server'],
    additionalProperties: false
  }
};

const BRIDGE_META_TOOLS = [
  BRIDGE_LIST_SERVERS_TOOL,
  BRIDGE_DISABLE_SERVER_TOOL,
  BRIDGE_ENABLE_SERVER_TOOL,
  BRIDGE_EXECUTE_TOOL,
  BRIDGE_LIST_SERVER_TOOLS_TOOL
];

function buildBridgeOverview(childServerManager, filter) {
  const summary = childServerManager.getStartupSummary();
  const normalizedFilter = filter ? String(filter).trim() : '';

  const loadedServers = normalizedFilter
    ? summary.loadedServers.filter((s) => s.serverName === normalizedFilter)
    : summary.loadedServers;
  const skippedServers = normalizedFilter
    ? summary.skippedServers.filter((s) => s.serverName === normalizedFilter)
    : summary.skippedServers;
  const toolNames = normalizedFilter
    ? summary.toolNames.filter((name) => name.startsWith(`${normalizedFilter}__`))
    : summary.toolNames;

  const lines = [];
  lines.push('MCP Agent Bridge Overview');
  lines.push('===================');
  lines.push('');

  lines.push(`Loaded servers (${loadedServers.length}):`);
  if (loadedServers.length === 0) {
    lines.push('  (none)');
  } else {
    for (const server of loadedServers) {
      lines.push(`  - ${server.serverName}: ${server.toolCount} tools`);
    }
  }
  lines.push('');

  if (skippedServers.length > 0) {
    lines.push(`Skipped servers (${skippedServers.length}):`);
    for (const skipped of skippedServers) {
      lines.push(`  - ${skipped.serverName}: ${skipped.reason}`);
    }
    lines.push('');
  }

  lines.push(`Total tools exposed: ${toolNames.length}`);
  if (toolNames.length > 0) {
    lines.push('');
    lines.push('Tool names:');
    for (const name of toolNames) {
      lines.push(`  - ${name}`);
    }
  }

  return lines.join('\n');
}

export function createGatewayServer(childServerManager) {
  const server = new Server(
    {
      name: 'mcp-agent-bridge-gateway',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {
          listChanged: true
        }
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    // Only expose bridge meta tools to clients. Child server tools are
    // accessible exclusively through `bridge__execute` so the bridge
    // stays the single point of contact (1:1 AI ↔ bridge contract).
    tools: [...BRIDGE_META_TOOLS]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params?.name;

    if (!toolName) {
      throw new McpError(ErrorCode.InvalidParams, 'Missing tool name');
    }

    if (toolName === BRIDGE_LIST_SERVERS_TOOL.name) {
      const filter = request.params?.arguments?.server;
      return {
        content: [
          {
            type: 'text',
            text: buildBridgeOverview(childServerManager, filter)
          }
        ]
      };
    }

    if (toolName === BRIDGE_DISABLE_SERVER_TOOL.name) {
      const serverName = request.params?.arguments?.server;
      if (!serverName || typeof serverName !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid "server" argument');
      }
      try {
        const result = await childServerManager.disableServer(serverName);
        return {
          content: [
            {
              type: 'text',
              text: `Disabled "${result.serverName}". Config updated at ${result.configPath}. The file watcher will reload within ~500ms.`
            }
          ]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Failed to disable server: ${message}` }],
          isError: true
        };
      }
    }

    if (toolName === BRIDGE_ENABLE_SERVER_TOOL.name) {
      const serverName = request.params?.arguments?.server;
      if (!serverName || typeof serverName !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid "server" argument');
      }
      try {
        const result = await childServerManager.enableServer(serverName);
        return {
          content: [
            {
              type: 'text',
              text: `Enabled "${result.serverName}". Config updated at ${result.configPath}. The file watcher will reload within ~500ms.`
            }
          ]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Failed to enable server: ${message}` }],
          isError: true
        };
      }
    }

    if (toolName === BRIDGE_EXECUTE_TOOL.name) {
      const args = request.params?.arguments ?? {};

      // Batch mode: { operations: [{ server, tool, args }, ...] }
      if (args.operations !== undefined) {
        if (!Array.isArray(args.operations) || args.operations.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, '"operations" must be a non-empty array');
        }
        const stopOnError = args.stopOnError !== false;
        const results = [];
        for (let index = 0; index < args.operations.length; index += 1) {
          const op = args.operations[index];
          if (!op || typeof op !== 'object' || typeof op.server !== 'string' || typeof op.tool !== 'string') {
            results.push({
              index,
              ok: false,
              error: 'Each operation must be an object with "server" and "tool" strings'
            });
            if (stopOnError) break;
            continue;
          }
          const exposedName = `${op.server}__${op.tool}`;
          try {
            const result = await childServerManager.callTool(exposedName, op.args ?? {});
            results.push({
              index,
              server: op.server,
              tool: op.tool,
              ok: true,
              result
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({
              index,
              server: op.server,
              tool: op.tool,
              ok: false,
              error: message
            });
            if (stopOnError) break;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  mode: 'batch',
                  total: args.operations.length,
                  completed: results.length,
                  stoppedOnError: stopOnError && results.length < args.operations.length,
                  results
                },
                null,
                2
              )
            }
          ]
        };
      }

      // Single mode: { server, tool, args }
      const { server, tool } = args;
      if (!server || typeof server !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid "server" argument');
      }
      if (!tool || typeof tool !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid "tool" argument');
      }
      const exposedName = `${server}__${tool}`;
      try {
        // callTool returns the raw result from the child MCP server (1:1)
        return await childServerManager.callTool(exposedName, args.args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: message
            }
          ],
          isError: true
        };
      }
    }

    if (toolName === BRIDGE_LIST_SERVER_TOOLS_TOOL.name) {
      const serverName = request.params?.arguments?.server;
      if (!serverName || typeof serverName !== 'string') {
        throw new McpError(ErrorCode.InvalidParams, 'Missing or invalid "server" argument');
      }
      const tools = childServerManager.getToolsForServer(serverName);
      if (!tools) {
        return {
          content: [
            {
              type: 'text',
              text: `Server "${serverName}" not found or not loaded.`
            }
          ],
          isError: true
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              server: serverName,
              toolCount: tools.length,
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema
              }))
            }, null, 2)
          }
        ]
      };
    }

    try {
      return await childServerManager.callTool(toolName, request.params?.arguments ?? {});
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: message
          }
        ],
        isError: true
      };
    }
  });

  return server;
}
