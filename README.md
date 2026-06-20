<p align="center">
  <img src="banner-agent_2026-06-19T04-33-42-408Z.png" alt="MCP Agent Bridge Banner" width="100%">
</p>

# MCP Agent Bridge

> 🚀 A lightweight **agent gateway** that combines multiple local **MCP servers** into a single **MCP endpoint** — with **runtime control**, **hot-reloadable configuration**, and a powerful **`bridge__execute`** tool that lets you call any child server tool without restarting.

<p align="center">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-3C873A?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="Protocol" src="https://img.shields.io/badge/MCP-Streamable_HTTP-6C47FF?style=for-the-badge">
  <img alt="Transport" src="https://img.shields.io/badge/Transport-stdio_%2B_HTTP-0A7EA4?style=for-the-badge">
  <img alt="Tunnel Ready" src="https://img.shields.io/badge/Tunnel-Ready-F38020?style=for-the-badge&logo=cloudflare&logoColor=white">
  <img alt="Meta Tools" src="https://img.shields.io/badge/Meta_Tools-5-blueviolet?style=for-the-badge">
</p>

---

## ✨ What's new in v0.3.0

```mermaid
mindmap
  root((MCP Agent Bridge v0.3.0))
    🚀 Primary Tool
      bridge__execute
        Execute any tool on any server
        1:1 response from child
        No client restart needed
    🔍 Discovery
      bridge__list_server_tools
        List tools per server
        Show input schemas
      bridge__list_servers
        Overview of all servers
        Show skipped reasons
    🎛️ Runtime Control
      bridge__enable_server
        Start server at runtime
        Persist to config
      bridge__disable_server
        Stop server at runtime
        Persist to config
    🔄 Hot Reload
      fs.watch debouncer
      Auto-apply in ~500ms
    🧠 Agent Architecture
      Bridge = Agent
      Client = Commander
      No restart needed
```

**No restarts. No external edits. Just call `bridge__execute`.**

---

## 📖 Table of contents

- [Overview](#-overview)
- [Why this project exists](#-why-this-project-exists)
- [Architecture](#-architecture)
- [Bridge meta tools](#-bridge-meta-tools)
- [Examples](#-examples)
- [Project structure](#-project-structure)
- [Quick start](#-quick-start)
- [CLI usage](#-cli-usage)
- [Configuration format](#-configuration-format)
- [Endpoints](#-endpoints)
- [Security notes](#-security-notes)
- [Troubleshooting](#-troubleshooting)
- [Design principles](#-design-principles)

---

## 🌍 Overview

`MCP Agent Bridge` is an **agent gateway** that turns multiple local MCP servers into one clean remote-facing MCP endpoint.

Instead of exposing or managing each MCP server separately, this bridge:

- 📖 reads a standard `mcpServers` JSON config
- 🎯 starts only the servers you want
- 🔗 aggregates their tools
- 🏷️ prefixes tool names by source server
- 🛰️ exposes its own meta tools for runtime inspection & control
- 🌐 exposes everything through a single `/mcp` endpoint
- 🚀 provides `bridge__execute` to call any child server tool **without client restart**

---

## 🧩 Why this project exists

```mermaid
graph TB
    subgraph Problems["❌ Problems"]
        direction TB
        P1["Many servers, few should run"]
        P2["Tools should stay disabled"]
        P3["Remote clients need one endpoint"]
        P4["Tool name collisions"]
        P5["Enable/disable requires restart"]
        P6["Clients don't re-fetch tools"]
    end

    subgraph Solutions["✅ MCP Agent Bridge Solutions"]
        direction TB
        S1["Selective server startup"]
        S2["disabled: true support"]
        S3["Single /mcp endpoint"]
        S4["Server-prefixed tool names"]
        S5["Runtime enable/disable"]
        S6["bridge__execute (no restart)"]
    end

    P1 --> S1
    P2 --> S2
    P3 --> S3
    P4 --> S4
    P5 --> S5
    P6 --> S6

    style Problems fill:#e94560,stroke:#fff,color:#fff
    style Solutions fill:#0f3460,stroke:#533483,color:#fff
    style P1 fill:#fff,stroke:#e94560,color:#000
    style P2 fill:#fff,stroke:#e94560,color:#000
    style P3 fill:#fff,stroke:#e94560,color:#000
    style P4 fill:#fff,stroke:#e94560,color:#000
    style P5 fill:#fff,stroke:#e94560,color:#000
    style P6 fill:#fff,stroke:#e94560,color:#000
    style S1 fill:#fff,stroke:#533483,color:#000
    style S2 fill:#fff,stroke:#533483,color:#000
    style S3 fill:#fff,stroke:#533483,color:#000
    style S4 fill:#fff,stroke:#533483,color:#000
    style S5 fill:#fff,stroke:#533483,color:#000
    style S6 fill:#fff,stroke:#533483,color:#000
```

`MCP Agent Bridge` solves those problems with a small, explicit, easy-to-debug layer — **including runtime enable/disable without restarts**.

---

## 🏗️ Architecture

### The Agent-Commander Pattern

```mermaid
graph TB
    subgraph Commander["🎯 Commander (ZCode)"]
        Z["ZCode / AI Agent"]
    end

    subgraph Agent["🤖 Agent (MCP Agent Bridge)"]
        B["Bridge Gateway"]
        R["Router"]
        M["Meta Tools"]
    end

    subgraph Children["👶 Child MCP Servers"]
        S1["🔧 ssh-mcp<br/><i>7 tools</i>"]
        S2["🌐 web-curl<br/><i>7 tools</i>"]
        S3["🎨 vision-generator<br/><i>7 tools</i>"]
        S4["🎭 playwright-extension<br/><i>61 tools</i>"]
        S5["🖥️ cpanel<br/><i>171 tools</i>"]
    end

    Z -->|"bridge__execute({server, tool, args})"| B
    Z -->|"bridge__list_servers()"| B
    Z -->|"bridge__enable_server({server})"| B
    Z -->|"bridge__disable_server({server})"| B
    Z -->|"bridge__list_server_tools({server})"| B

    B --> R
    R --> M
    R --> S1
    R --> S2
    R --> S3
    R --> S4
    R --> S5

    style Commander fill:#1a1a2e,stroke:#e94560,color:#fff
    style Agent fill:#16213e,stroke:#0f3460,color:#fff
    style Children fill:#0f3460,stroke:#533483,color:#fff
    style Z fill:#e94560,stroke:#fff,color:#fff
    style B fill:#533483,stroke:#fff,color:#fff
    style R fill:#0f3460,stroke:#fff,color:#fff
    style M fill:#e94560,stroke:#fff,color:#fff
    style S1 fill:#1a1a2e,stroke:#e94560,color:#fff
    style S2 fill:#1a1a2e,stroke:#e94560,color:#fff
    style S3 fill:#1a1a2e,stroke:#e94560,color:#fff
    style S4 fill:#1a1a2e,stroke:#e94560,color:#fff
    style S5 fill:#1a1a2e,stroke:#e94560,color:#fff
```

### Key idea

The bridge is the **agent** that manages all child server sessions. The client (ZCode) is the **commander** that sends instructions through `bridge__execute`.

**Benefits:**
- ✅ Client only needs to know 5 meta tools (not hundreds of child tools)
- ✅ Enable/disable servers without client restart
- ✅ Response is 1:1 from child server (no data transformation)
- ✅ All session management happens inside the bridge

### Request flow

```mermaid
sequenceDiagram
    participant C as 🎯 Commander
    participant B as 🤖 Bridge
    participant S as 👶 Child Server

    Note over C,S: bridge__execute Flow
    C->>B: bridge__execute({server: "web-curl", tool: "fetch_api", args: {...}})
    activate B
    B->>B: Parse server & tool name
    B->>B: Route to correct child server
    B->>S: tools/call({name: "fetch_api", args: {...}})
    activate S
    S-->>B: {content: [{type: "text", text: "..."}]}
    deactivate S
    B-->>C: {content: [{type: "text", text: "..."}]} (1:1 response)
    deactivate B

    Note over C,S: Server Management Flow
    C->>B: bridge__enable_server({server: "cpanel"})
    activate B
    B->>B: Update config file
    B->>B: Start child server process
    B->>S: Initialize MCP connection
    S-->>B: Server ready
    B-->>C: "Enabled cpanel. Config updated."
    deactivate B
```

### Enable/Disable flow

```mermaid
flowchart LR
    subgraph Input["📥 Command"]
        I1["bridge__enable_server"]
        I2["bridge__disable_server"]
    end

    subgraph Bridge["🤖 Bridge Agent"]
        B1["Update Config File"]
        B2["File Watcher Trigger"]
        B3["Start/Stop Server"]
        B4["Update Tool Map"]
    end

    subgraph Output["📤 Result"]
        O1["Server Running"]
        O2["Server Stopped"]
        O3["Tools Exposed"]
        O4["Tools Removed"]
    end

    I1 --> B1
    I2 --> B1
    B1 --> B2
    B2 --> B3
    B3 --> B4
    B4 --> O1
    B4 --> O2
    B4 --> O3
    B4 --> O4

    style Input fill:#1a1a2e,stroke:#e94560,color:#fff
    style Bridge fill:#16213e,stroke:#0f3460,color:#fff
    style Output fill:#0f3460,stroke:#533483,color:#fff
    style I1 fill:#e94560,stroke:#fff,color:#fff
    style I2 fill:#e94560,stroke:#fff,color:#fff
    style B1 fill:#533483,stroke:#fff,color:#fff
    style B2 fill:#533483,stroke:#fff,color:#fff
    style B3 fill:#533483,stroke:#fff,color:#fff
    style B4 fill:#533483,stroke:#fff,color:#fff
    style O1 fill:#0f3460,stroke:#fff,color:#fff
    style O2 fill:#0f3460,stroke:#fff,color:#fff
    style O3 fill:#0f3460,stroke:#fff,color:#fff
    style O4 fill:#0f3460,stroke:#fff,color:#fff
```

---

## 🛰️ Bridge meta tools

The bridge exposes **5 tools at the gateway level** (prefix `bridge__`) that are the **only** tools AI clients see. Child server tools are intentionally hidden from `tools/list` — clients must go through `bridge__execute` to reach them. This keeps the bridge as the single point of contact and gives a clean **1:1 contract between AI and bridge**: one command in, one (possibly batched) result out.

### `bridge__execute` 🚀

**The primary way to interact with child MCP servers.** Everything AI wants to do goes through this tool.

The response is returned **exactly as-is** from the child server (1:1 output). The bridge is a thin pass-through.

**Supports two modes:**

#### Single mode

Call one tool:

```json
{
  "server": "web-curl",
  "tool": "fetch_api",
  "args": {
    "url": "https://api.example.com/data",
    "method": "GET",
    "limit": 1000
  }
}
```

**Args:**

| Field | Type | Required | Description |
|---|---|---|---|
| `server` | string | ✅ | Name of the MCP server (e.g. `"ssh-mcp"`, `"web-curl"`, `"playwright-extension"`) |
| `tool` | string | ✅ | Name of the tool to execute (e.g. `"terminal-start"`, `"fetch_api"`) |
| `args` | object | ❌ | Arguments to pass to the tool. Use `{}` for tools with no required parameters |

#### Batch mode

Chain multiple tool calls in **one** request. Each operation runs sequentially against its target server. Use this for workflows like `navigate → snapshot → evaluate` that would otherwise need N round trips.

```json
{
  "operations": [
    {
      "server": "playwright-extension",
      "tool": "browser_navigate",
      "args": { "url": "https://example.com" }
    },
    {
      "server": "playwright-extension",
      "tool": "browser_snapshot"
    },
    {
      "server": "playwright-extension",
      "tool": "browser_evaluate",
      "args": { "function": "() => document.body.innerText" }
    }
  ],
  "stopOnError": true
}
```

**Batch args:**

| Field | Type | Required | Description |
|---|---|---|---|
| `operations` | array | ✅ | Ordered list of `{ server, tool, args }` to execute sequentially |
| `stopOnError` | boolean | ❌ | If `true` (default), stop at the first failure. If `false`, attempt every operation and report per-op status |

**Batch response:**

```json
{
  "mode": "batch",
  "total": 3,
  "completed": 3,
  "stoppedOnError": false,
  "results": [
    { "index": 0, "server": "playwright-extension", "tool": "browser_navigate", "ok": true, "result": {...} },
    { "index": 1, "server": "playwright-extension", "tool": "browser_snapshot", "ok": true, "result": {...} },
    { "index": 2, "server": "playwright-extension", "tool": "browser_evaluate", "ok": true, "result": {...} }
  ]
}
```

**More single-mode examples:**

```json
// List models from vision-generator
{ "server": "vision-generator", "tool": "list_models" }

// Start SSH terminal
{ "server": "ssh-mcp", "tool": "terminal-start", "args": { "account": "rayhan-vps" } }

// Generate an image
{ "server": "vision-generator", "tool": "generate_image", "args": { "model": "gpt-image-2", "prompt": "A cat" } }

// Take a screenshot
{ "server": "playwright-extension", "tool": "browser_take_screenshot", "args": { "type": "png" } }
```

### `bridge__list_server_tools` 🔍

List all available tools for a specific MCP server, including their input schemas. Use this to discover what tools and parameters a server supports before calling `bridge__execute`.

**Args:**

| Field | Type | Required | Description |
|---|---|---|---|
| `server` | string | ✅ | Name of the MCP server to list tools for |

**Output:** JSON object with server name, tool count, and array of tools with names, descriptions, and input schemas.

### `bridge__list_servers` 🛰️

Get a complete overview of what the bridge is currently exposing.

**Args (optional):**

| Field | Type | Description |
|---|---|---|
| `server` | string | Filter to a specific server name (exact match) |

**Output:** Plain text summary including:
- Loaded servers with tool counts
- Skipped servers with reasons
- Total exposed tool count
- Full list of exposed tool names

### `bridge__disable_server` 🔒

Disable a server at runtime. The change is **persisted to the config file** — it survives restarts.

**Args:**

| Field | Type | Required | Description |
|---|---|---|---|
| `server` | string | ✅ | Name of the server entry in `mcpServers` |

### `bridge__enable_server` 🔓

Re-enable a previously disabled server. The change is **persisted to the config file**.

**Args:**

| Field | Type | Required | Description |
|---|---|---|---|
| `server` | string | ✅ | Name of the server entry in `mcpServers` |

---

## 🏷️ Tool naming strategy

Every tool is prefixed with its source server. Bridge meta tools use the `bridge__` prefix.

```mermaid
graph LR
    subgraph Child["👶 Child Server Tools"]
        direction TB
        C1["vision-generator__list_models"]
        C2["web-curl__fetch_api"]
        C3["ssh-mcp__terminal-start"]
        C4["playwright__browser_navigate"]
    end

    subgraph Bridge["🤖 Bridge Meta Tools"]
        direction TB
        B1["bridge__execute"]
        B2["bridge__list_servers"]
        B3["bridge__list_server_tools"]
        B4["bridge__enable_server"]
        B5["bridge__disable_server"]
    end

    C1 -.- |"server prefix"| P1["vision-generator"]
    C2 -.- |"server prefix"| P2["web-curl"]
    C3 -.- |"server prefix"| P3["ssh-mcp"]
    C4 -.- |"server prefix"| P4["playwright"]

    style Child fill:#1a1a2e,stroke:#e94560,color:#fff
    style Bridge fill:#16213e,stroke:#0f3460,color:#fff
    style C1 fill:#533483,stroke:#fff,color:#fff
    style C2 fill:#533483,stroke:#fff,color:#fff
    style C3 fill:#533483,stroke:#fff,color:#fff
    style C4 fill:#533483,stroke:#fff,color:#fff
    style B1 fill:#e94560,stroke:#fff,color:#fff
    style B2 fill:#e94560,stroke:#fff,color:#fff
    style B3 fill:#e94560,stroke:#fff,color:#fff
    style B4 fill:#e94560,stroke:#fff,color:#fff
    style B5 fill:#e94560,stroke:#fff,color:#fff
    style P1 fill:#0f3460,stroke:#fff,color:#fff
    style P2 fill:#0f3460,stroke:#fff,color:#fff
    style P3 fill:#0f3460,stroke:#fff,color:#fff
    style P4 fill:#0f3460,stroke:#fff,color:#fff
```

### Why this matters

- 🚫 Avoids name collisions between servers
- 👀 Makes tool origin obvious at a glance
- 🧰 Keeps remote clients easier to debug
- 📈 Scales better as more servers are added
- 🛰️ Gives the bridge its own namespace for management tools

---

## 💡 Examples

### Enable a server and use it immediately

```
You: "Enable vision-generator on the bridge."

AI: → bridge__enable_server { "server": "vision-generator" }

Bridge: "Enabled \"vision-generator\". Config updated at /path/to/default.json."

AI: "Let me generate an image now."

AI: → bridge__execute {
      "server": "vision-generator",
      "tool": "generate_image",
      "args": {
        "model": "gpt-image-2",
        "prompt": "A cyberpunk city at night",
        "output": { "directory": "C:/Users/rayss/ZCodeProject" }
      }
    }

Bridge: (returns 1:1 response from vision-generator with image data)
```

### Explore a server's tools

```
You: "What tools does web-curl have?"

AI: → bridge__list_server_tools { "server": "web-curl" }

Bridge: {
  "server": "web-curl",
  "toolCount": 7,
  "tools": [
    { "name": "fetch_api", "description": "Performs a REST API request...", "inputSchema": {...} },
    { "name": "multi_search", "description": "Executes multiple Google search queries...", "inputSchema": {...} },
    ...
  ]
}
```

### Toggle servers dynamically

```
You: "Disable cpanel, I don't need it right now."

AI: → bridge__disable_server { "server": "cpanel" }

Bridge: "Disabled \"cpanel\". Config updated."

AI: "Done. cpanel is stopped. Its 171 tools are no longer exposed."

---

You: "Okay, turn it back on."

AI: → bridge__enable_server { "server": "cpanel" }

Bridge: "Enabled \"cpanel\". Config updated."

AI: "cpanel is back. You can use it now."
```

---

## 📁 Project structure

```mermaid
graph TB
    subgraph Root["📁 MCP_Bridge"]
        direction TB
        R1["config/"]
        R2["src/"]
        R3["tools/"]
        R4["package.json"]
        R5["README.md"]
    end

    subgraph Config["📁 config"]
        direction TB
        C1["default.json<br/><i>Real config (gitignored)</i>"]
        C2["default.example.json<br/><i>Sanitized template</i>"]
        C3["README.md<br/><i>Setup guide</i>"]
    end

    subgraph Src["📁 src"]
        direction TB
        S1["index.js<br/><i>Main server, auth, watcher</i>"]
        S2["config.js<br/><i>CLI args, config loading</i>"]
        S3["childServers.js<br/><i>Lifecycle, tool map, health</i>"]
        S4["router.js<br/><i>5 meta tools</i>"]
        S5["cli/<br/><i>Launcher</i>"]
    end

    subgraph Tools["📁 tools"]
        direction TB
        T1["cloudflared.exe<br/><i>Tunnel helper</i>"]
    end

    R1 --> Config
    R2 --> Src
    R3 --> Tools

    style Root fill:#0f3460,stroke:#533483,color:#fff
    style Config fill:#1a1a2e,stroke:#e94560,color:#fff
    style Src fill:#16213e,stroke:#0f3460,color:#fff
    style Tools fill:#1a1a2e,stroke:#e94560,color:#fff
    style R1 fill:#533483,stroke:#fff,color:#fff
    style R2 fill:#533483,stroke:#fff,color:#fff
    style R3 fill:#533483,stroke:#fff,color:#fff
    style R4 fill:#533483,stroke:#fff,color:#fff
    style R5 fill:#533483,stroke:#fff,color:#fff
    style C1 fill:#e94560,stroke:#fff,color:#fff
    style C2 fill:#533483,stroke:#fff,color:#fff
    style C3 fill:#533483,stroke:#fff,color:#fff
    style S1 fill:#e94560,stroke:#fff,color:#fff
    style S2 fill:#533483,stroke:#fff,color:#fff
    style S3 fill:#533483,stroke:#fff,color:#fff
    style S4 fill:#e94560,stroke:#fff,color:#fff
    style S5 fill:#533483,stroke:#fff,color:#fff
    style T1 fill:#533483,stroke:#fff,color:#fff
```

### Important files

| File | Purpose |
|---|---|
| `src/index.js` | Main HTTP server, session handling, auth, routes, config watcher |
| `src/config.js` | CLI argument parsing and config loading |
| `src/childServers.js` | Child server lifecycle, tool map, health check, enable/disable persistence, `getToolsForServer()` |
| `src/router.js` | Gateway MCP server with 5 meta tools (`list_servers`, `disable_server`, `enable_server`, `execute`, `list_server_tools`) |
| `src/cli/ui.js` | Interactive launcher with prompts |
| `src/cli/launch.js` | Process spawner for gateway & tunnel |
| `config/default.json` | Main config (gitignored — contains your secrets) |
| `config/default.example.json` | Sanitized template — safe to commit |

---

## ⚡ Quick start

```mermaid
flowchart LR
    subgraph Setup["📦 Setup"]
        S1["1. npm install"]
        S2["2. cp config/default.example.json config/default.json"]
        S3["3. Edit config/default.json"]
    end

    subgraph Run["🚀 Run"]
        R1["4. npm start"]
        R2["5. Check /health"]
    end

    subgraph Use["🎯 Use"]
        U1["6. Call bridge__execute"]
        U2["7. Enable/disable servers"]
    end

    S1 --> S2
    S2 --> S3
    S3 --> R1
    R1 --> R2
    R2 --> U1
    U1 --> U2

    style Setup fill:#1a1a2e,stroke:#e94560,color:#fff
    style Run fill:#16213e,stroke:#0f3460,color:#fff
    style Use fill:#0f3460,stroke:#533483,color:#fff
    style S1 fill:#533483,stroke:#fff,color:#fff
    style S2 fill:#533483,stroke:#fff,color:#fff
    style S3 fill:#533483,stroke:#fff,color:#fff
    style R1 fill:#533483,stroke:#fff,color:#fff
    style R2 fill:#533483,stroke:#fff,color:#fff
    style U1 fill:#e94560,stroke:#fff,color:#fff
    style U2 fill:#e94560,stroke:#fff,color:#fff
```

### 1. Install dependencies

```bash
npm install
```

### 2. Create your config

```bash
cp config/default.example.json config/default.json
```

Edit `config/default.json` and replace placeholders with your real values.

### 3. Start the gateway

```bash
npm start
```

### 4. Check health

```text
http://127.0.0.1:8787/health
```

### 5. Use bridge__execute

Call `bridge__execute` via your MCP client to interact with any child server.

---

## 💻 CLI usage

```mermaid
graph TB
    subgraph Commands["💻 CLI Commands"]
        direction TB
        C1["npm start<br/><i>Default shortcut</i>"]
        C2["npm run ui<br/><i>Interactive launcher</i>"]
        C3["node src/index.js<br/><i>Manual start</i>"]
    end

    subgraph Options["⚙️ Options"]
        direction TB
        O1["--config<br/><i>Path to JSON config</i>"]
        O2["--only<br/><i>Allowlist server names</i>"]
        O3["--host<br/><i>Bind host</i>"]
        O4["--port<br/><i>Bind port</i>"]
        O5["--token<br/><i>Bearer token</i>"]
        O6["--stdio<br/><i>stdio mode</i>"]
    end

    Commands --> Options

    style Commands fill:#1a1a2e,stroke:#e94560,color:#fff
    style Options fill:#16213e,stroke:#0f3460,color:#fff
    style C1 fill:#533483,stroke:#fff,color:#fff
    style C2 fill:#533483,stroke:#fff,color:#fff
    style C3 fill:#533483,stroke:#fff,color:#fff
    style O1 fill:#e94560,stroke:#fff,color:#fff
    style O2 fill:#e94560,stroke:#fff,color:#fff
    style O3 fill:#e94560,stroke:#fff,color:#fff
    style O4 fill:#e94560,stroke:#fff,color:#fff
    style O5 fill:#e94560,stroke:#fff,color:#fff
    style O6 fill:#e94560,stroke:#fff,color:#fff
```

### Default shortcut

```bash
npm start
```

### Interactive launcher

```bash
npm run ui
```

### Manual examples

```bash
node src/index.js --config config/default.json
node src/index.js --config config/default.json --only vision-generator,web-curl
node src/index.js --config config/default.json --host 127.0.0.1 --port 8787
node src/index.js --config config/default.json --token SECRET123
```

### Supported options

| Option | Description |
|---|---|
| `--config` | Path to the JSON config |
| `--only` | Comma-separated allowlist of server names |
| `--host` | Host to bind the HTTP server |
| `--port` | Port to bind the HTTP server |
| `--token` | Optional bearer token for `/mcp` |
| `--stdio` | Run as stdio MCP server (no HTTP) |

---

## 🧾 Configuration format

```mermaid
graph TB
    subgraph Config["📁 config/default.json"]
        direction TB
        C1["mcpServers"]
    end

    subgraph Server["👶 Child Server"]
        direction TB
        S1["command: node"]
        S2["args: path/to/server.js"]
        S3["env: API_KEY=value"]
        S4["cwd: /optional/path"]
        S5["disabled: true/false"]
        S6["timeout: 60 seconds"]
        S7["disabledTools: [...]"]
    end

    C1 --> Server

    style Config fill:#1a1a2e,stroke:#e94560,color:#fff
    style Server fill:#16213e,stroke:#0f3460,color:#fff
    style C1 fill:#e94560,stroke:#fff,color:#fff
    style S1 fill:#533483,stroke:#fff,color:#fff
    style S2 fill:#533483,stroke:#fff,color:#fff
    style S3 fill:#533483,stroke:#fff,color:#fff
    style S4 fill:#533483,stroke:#fff,color:#fff
    style S5 fill:#533483,stroke:#fff,color:#fff
    style S6 fill:#533483,stroke:#fff,color:#fff
    style S7 fill:#533483,stroke:#fff,color:#fff
```

### Supported fields

| Field | Meaning |
|---|---|
| `command` | Executable to run |
| `args` | Command arguments |
| `env` | Environment variables for that child process |
| `cwd` | Optional working directory |
| `disabled` | If `true`, the bridge skips that server |
| `timeout` | Per-server startup timeout in **seconds** (default 60) |
| `disabledTools` | Array of tool names to hide from the exposed list |

---

## 🌐 Endpoints

```mermaid
graph TB
    subgraph Endpoints["🌐 HTTP Endpoints"]
        direction TB
        E1["GET /health<br/><i>Status & tool list</i>"]
        E2["POST /mcp<br/><i>Primary MCP endpoint</i>"]
        E3["GET /mcp<br/><i>Session-based flows</i>"]
        E4["DELETE /mcp<br/><i>Close session</i>"]
    end

    subgraph Auth["🔐 Authentication"]
        A1["Bearer Token<br/><i>Optional</i>"]
    end

    E2 --> A1
    E3 --> A1
    E4 --> A1

    style Endpoints fill:#1a1a2e,stroke:#e94560,color:#fff
    style Auth fill:#16213e,stroke:#0f3460,color:#fff
    style E1 fill:#533483,stroke:#fff,color:#fff
    style E2 fill:#e94560,stroke:#fff,color:#fff
    style E3 fill:#533483,stroke:#fff,color:#fff
    style E4 fill:#533483,stroke:#fff,color:#fff
    style A1 fill:#0f3460,stroke:#fff,color:#fff
```

### `GET /health`

Returns a status summary with loaded servers, skipped servers, and tool list.

### `POST /mcp`

Primary MCP Streamable HTTP endpoint. Exposes the merged tool list (child servers + bridge meta tools).

### `GET /mcp`

Used for session-based MCP flows.

### `DELETE /mcp`

Closes an active MCP session.

---

## 🔐 Security notes

```mermaid
graph TB
    subgraph Security["🔐 Security Considerations"]
        direction TB
        S1["Token Protection"]
        S2["Runtime Write Warning"]
        S3["Best Practices"]
    end

    subgraph Token["🔑 Token"]
        T1["--token SECRET123"]
        T2["Authorization: Bearer SECRET123"]
    end

    subgraph Warning["⚠️ Config Mutation"]
        W1["bridge__enable/disable_server<br/>mutate config on disk"]
    end

    subgraph Practices["✅ Best Practices"]
        P1["Keep config in user-only dir"]
        P2["Don't symlink to public location"]
        P3["Treat as privileged in multi-tenant"]
    end

    S1 --> Token
    S2 --> Warning
    S3 --> Practices

    style Security fill:#1a1a2e,stroke:#e94560,color:#fff
    style Token fill:#16213e,stroke:#0f3460,color:#fff
    style Warning fill:#e94560,stroke:#fff,color:#fff
    style Practices fill:#0f3460,stroke:#533483,color:#fff
    style T1 fill:#533483,stroke:#fff,color:#fff
    style T2 fill:#533483,stroke:#fff,color:#fff
    style W1 fill:#fff,stroke:#e94560,color:#000
    style P1 fill:#fff,stroke:#533483,color:#000
    style P2 fill:#fff,stroke:#533483,color:#000
    style P3 fill:#fff,stroke:#533483,color:#000
```

### Token protection

```bash
node src/index.js --config config/default.json --token SECRET123
```

Clients need: `Authorization: Bearer SECRET123`

### ⚠️ Runtime write warning

`bridge__disable_server` and `bridge__enable_server` **mutate your config file on disk**. Consider:

- 🔒 Keep config in user-only directory
- 🚫 Don't symlink to public location
- 🛡️ Treat as privileged in multi-tenant setups

---

## 🛠️ Troubleshooting

```mermaid
graph TB
    subgraph Issues["❌ Common Issues"]
        direction TB
        I1["bridge__execute returns 'Unknown tool'"]
        I2["bridge__disable_server reports 'not found'"]
        I3["Child server fails to start"]
        I4["Config changes not taking effect"]
    end

    subgraph Solutions["✅ Solutions"]
        direction TB
        S1["Check bridge__list_servers<br/>Wait 1-2 seconds after enable"]
        S2["Server name must match exactly<br/>Use bridge__list_servers"]
        S3["Check command path<br/>Check env vars<br/>Check /health endpoint"]
        S4["Wait 500ms debounce<br/>Call bridge__list_servers"]
    end

    I1 --> S1
    I2 --> S2
    I3 --> S3
    I4 --> S4

    style Issues fill:#e94560,stroke:#fff,color:#fff
    style Solutions fill:#0f3460,stroke:#533483,color:#fff
    style I1 fill:#fff,stroke:#e94560,color:#000
    style I2 fill:#fff,stroke:#e94560,color:#000
    style I3 fill:#fff,stroke:#e94560,color:#000
    style I4 fill:#fff,stroke:#e94560,color:#000
    style S1 fill:#fff,stroke:#533483,color:#000
    style S2 fill:#fff,stroke:#533483,color:#000
    style S3 fill:#fff,stroke:#533483,color:#000
    style S4 fill:#fff,stroke:#533483,color:#000
```

---

## 🧠 Design principles

```mermaid
graph TB
    subgraph Principles["🧠 Design Principles"]
        direction LR
        P1["1️⃣ Agent-Commander<br/>Bridge = Agent<br/>Client = Commander"]
        P2["2️⃣ 1:1 Response<br/>No transformation<br/>Raw output"]
        P3["3️⃣ Standard Config<br/>Reuse mcpServers<br/>No custom schema"]
        P4["4️⃣ Persist Changes<br/>Config = Source of Truth<br/>Atomic writes"]
        P5["5️⃣ Stay Thin<br/>Route & Aggregate<br/>Not a platform"]
    end

    P1 --- P2
    P2 --- P3
    P3 --- P4
    P4 --- P5

    style Principles fill:#0f3460,stroke:#533483,color:#fff
    style P1 fill:#1a1a2e,stroke:#e94560,color:#fff
    style P2 fill:#1a1a2e,stroke:#e94560,color:#fff
    style P3 fill:#1a1a2e,stroke:#e94560,color:#fff
    style P4 fill:#1a1a2e,stroke:#e94560,color:#fff
    style P5 fill:#1a1a2e,stroke:#e94560,color:#fff
```

### 1. Agent-Commander pattern

The bridge is the **agent** that manages all child server sessions. The client is the **commander** that sends instructions through `bridge__execute`. This decouples the client from individual server tool lists.

### 2. 1:1 Response

`bridge__execute` returns the response **exactly as-is** from the child server. No data transformation, no format changes.

### 3. Standard Config

Reuse `mcpServers` instead of forcing a custom config system.

### 4. Persist Changes

When you toggle a server, the change is written to the config file. The file is the source of truth.

### 5. Stay Thin

The bridge should route, aggregate, expose, and let you toggle. It should not become a full platform.

---

## 🗺️ Roadmap ideas

- 📜 Richer structured logging
- 🔑 Better auth defaults
- 🗂️ Config profiles for different tool sets
- 🌐 Named tunnel support for stable URLs
- 📊 Optional metrics or request tracing
- ⏱️ Per-tool rate limiting
- 🪪 Audit log for meta-tool invocations

---

## ✅ Summary

```mermaid
mindmap
  root((MCP Agent Bridge))
    🚀 Core Features
      bridge__execute
        1:1 response
        No restart needed
      Runtime Control
        Enable/disable servers
        Persist to config
      Hot Reload
        fs.watch
        ~500ms debounce
    🎯 Best For
      Local Development
      Personal Automation
      Remote MCP Experiments
      On-demand Server Control
    🧠 Architecture
      Agent-Commander Pattern
      Single Endpoint
      Child Server Management
```

`MCP Agent Bridge` is a practical **agent gateway** that turns multiple local MCP servers into one clean remote MCP endpoint — with runtime control, persistent toggling, and the powerful `bridge__execute` tool.

**Best suited for:**
- 🛠️ Local development
- 🤖 Personal automation stacks
- 🧪 Remote MCP experiments
- 🪶 Lightweight gateway scenarios
- 🎛️ On-demand server control without restarts

---

## 📄 License

Not specified yet.
