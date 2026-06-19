# 📁 Config folder

This folder holds the MCP server definitions used by the bridge.

## ⚠️ File safety

| File | Committed to git? | What's in it |
|---|---|---|
| `*.example.json` | ✅ Yes | Sanitized templates with placeholder values |
| `default.json` | ❌ No (gitignored) | Real config — may contain API keys, tokens, local paths |
| `vision-web.json` | ❌ No (gitignored) | Real config — may contain API keys, tokens, local paths |

**Why?** Real config files typically contain secrets (API keys, OAuth tokens, cPanel credentials, Windows-specific paths). Committing them would leak credentials and break the build for other users.

## 🚀 First-time setup

1. Copy a template to a real filename:
   ```bash
   # POSIX / Git Bash
   cp config/default.example.json config/default.json

   # Windows cmd
   copy config\default.example.json config\default.json
   ```

2. Open the new file and replace every placeholder:
   - `<YOUR_API_KEY>` → your actual API key
   - `<YOUR_BEARER_TOKEN>` → your actual bearer token
   - `/absolute/path/to/...` → real absolute path on your machine
   - `https://api.example.com/v1` → real provider URL
   - `C:/path/to/your/tool.exe` → real Windows binary path

3. Set `disabled: true` on servers you don't want to run.

4. Start the bridge pointing at your real config:
   ```bash
   npm start -- --config config/default.json
   ```

## 📚 What's in the templates

### `default.example.json`

A comprehensive example showing **all** supported fields and patterns:

| Pattern | What it shows |
|---|---|
| `example-stdio-server` | Minimal Node.js stdio server with env vars |
| `example-python-server` | `uvx`-launched Python MCP package |
| `example-remote-bridge` | Remote MCP via `mcp-remote` with bearer auth |
| `example-with-working-dir` | Custom `cwd`, `timeout`, and `disabledTools` |
| `example-windows-binary` | Direct Windows `.exe` invocation |

All examples are `disabled: true` by default — flip to `false` (or remove the line) to enable.

### `vision-web.example.json`

A smaller focused template with two servers: a vision/image-generation server and a web/search server. Good starting point for image and web workflows.

## 🔄 Creating your own config

You can name the file anything — just pass it to `--config`:

```bash
node src/index.js --config config/my-custom.json
```

The bridge does not require any specific filename.

## 🛡️ Rotation tip

If you ever accidentally commit a real config:

1. **Revoke every secret inside it immediately** (API keys, tokens, passwords).
2. Re-create the file from the template.
3. Use `git rm --cached` to untrack it if it's already in git history.
4. Consider rewriting history with `git filter-repo` or BFG Repo-Cleaner.

Future safety: keep `config/*.json` (non-example) in `.gitignore`.
