# Changelog

All notable changes to MCP Agent Bridge are documented here.

## v0.3.2 — Performance: Cloudflare Tunnel Latency Fix

### Problem

ChatGPT accessing MCP Bridge through Cloudflare Tunnel experiences significant latency.

### Root causes

- Tunnel running on HTTP/1.1 instead of HTTP/2 (no multiplexing)
- No response compression — large JSON payloads sent uncompressed through tunnel
- Tools list rebuilt on every `tools/list` request even when unchanged
- Bridge meta tool descriptions excessively verbose (~400 words for `bridge__execute`)
- Batch response JSON pretty-printed (`JSON.stringify(..., null, 2)`) adding unnecessary whitespace
- SSE keepalive interval (15s) not aggressive enough for Cloudflare's idle timeout

### Changes

| Area | Before | After |
|------|--------|-------|
| Tunnel protocol | HTTP/1.1 | HTTP/2 (`--protocol http2`) |
| Response compression | None | gzip level 6 for JSON >256B |
| Tools list caching | Rebuilt every call | Cached, invalidated on config change |
| `bridge__execute` description | ~400 words | ~40 words |
| Batch response | Pretty-printed | Compact JSON |
| SSE keepalive | 15s | 10s |
| Config reload | No client notification | `sendToolListChanged` broadcast |

### Files changed

- `src/index.js` — compression middleware, SSE keepalive tuning, cache invalidation wiring
- `src/router.js` — tools list caching, compact batch response, cache invalidation on enable/disable
- `start-bridge.bat` — added `--protocol http2` to cloudflared tunnel command
- `README.md` — added v0.3.2 release notes

---

## v0.3.1 — Session Lifecycle

- Added MCP session lifecycle cleanup with a 30-minute inactivity TTL.
- Invalid or expired `/mcp` sessions now return `404 Session not found`.
- Failed session initialization and graceful shutdown now close active transports and gateway servers.
- Added `npm test` for the bridge lifecycle regression suite.

---

## v0.3.0 — Runtime Control & Hot Reload

- Added `bridge__execute` — call any child server tool without restart.
- Added `bridge__list_servers` — overview of all loaded servers.
- Added `bridge__list_server_tools` — list tools per server with schemas.
- Added `bridge__enable_server` / `bridge__disable_server` — runtime server control.
- Hot-reloadable configuration via `fs.watch` debouncer.
- Bridge meta tools only — child server tools accessed through `bridge__execute`.
