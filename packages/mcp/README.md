# @three-ws/mcp

One stdio MCP server for every three.ws tool. It is a thin, dependency-free proxy: each JSON-RPC message on stdin is forwarded to the unified endpoint `https://three.ws/mcp`, and the answers (JSON or SSE) come back on stdout. The tool list, scopes, tiers and pricing are decided by the server, so this package never goes stale.

## Use

```json
{
  "mcpServers": {
    "three-ws": {
      "command": "npx",
      "args": ["-y", "@three-ws/mcp"],
      "env": { "THREE_WS_API_KEY": "your key" }
    }
  }
}
```

Without a key, only the public tools are listed. Financial tools stay off until you enable them (see [docs/mcp.md](../../docs/mcp.md)).

## Environment

| Variable | Meaning |
|---|---|
| `THREE_WS_API_KEY` | Sent as `Authorization: Bearer`. Create one at https://three.ws/dashboard/api-keys. |
| `THREE_WS_MCP_URL` | Override the endpoint (default `https://three.ws/mcp`). |

## Test

`npm test` spawns the CLI against a local Streamable HTTP server (`node --test test/proxy.test.mjs`).

Publishing (`npm publish --access public`) is an owner step; `prepublishOnly` runs the test first.
