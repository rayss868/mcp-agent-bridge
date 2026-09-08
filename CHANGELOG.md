# Changelog

All notable changes to MCP Agent Bridge are documented here.

## [0.3.1] - 2026-09-09

### Fixed

- Added inactivity-based cleanup for Streamable HTTP MCP sessions.
- Closed session transports when sessions expire or the bridge shuts down.
- Returned `404 Session not found` for unknown or expired `/mcp` sessions.
- Cleaned up gateway servers when session initialization fails.
- Added error handling around the `/mcp` GET stream.

### Added

- Added regression tests for session expiration and access-based TTL refresh.
- Added the `npm test` script for the bridge test suite.

## [0.3.0]

- Added the admin UI, runtime server configuration editing, and bridge batch execution support.
