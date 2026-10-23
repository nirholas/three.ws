# Install three.ws in your agent

> three.ws is a set of hosted MCP servers (Streamable HTTP, JSON-RPC 2.0). Add one URL to any MCP client, or run one command to configure several clients at once.

## One command

Signs you in, writes the servers into every MCP client it finds, and verifies each with a live `tools/list`. Requires Node.js 20.12 or newer.

```bash
npx three-ws setup
```

One command signs you in (OAuth or API key), writes these servers into Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, Codex, Gemini CLI or Hermes, prints a ready Grok Bot connector (npx three-ws setup --client grok-bot), and verifies each with a live tools/list.

Full CLI reference: https://three.ws/docs/cli.md

## Per client

### Claude (claude.ai and Claude desktop)

Server: https://three.ws/api/mcp. Auth: oauth2.1.
Where: Customize, Connectors, Add custom connector.

- name: three.ws
- url: https://three.ws/api/mcp

### Claude Code

Server: https://three.ws/api/mcp. Auth: oauth2.1.
Where: claude mcp add, or /mcp inside Claude Code.

```bash
claude mcp add --transport http three-ws-main https://three.ws/api/mcp
```

### ChatGPT

Server: https://three.ws/api/mcp. Auth: oauth2.1.
Where: Settings, Apps and Connectors, Advanced settings (turn on Developer mode), then Create.

- name: three.ws
- url: https://three.ws/api/mcp
- authentication: OAuth

### Cursor

Server: https://three.ws/api/mcp. Auth: oauth2.1.
Where: mcp.json or the Add to Cursor button on the connect page.

```json
{
  "mcpServers": {
    "three-ws": {
      "url": "https://three.ws/api/mcp"
    }
  }
}
```

### VS Code

Server: https://three.ws/api/mcp. Auth: oauth2.1.
Where: .vscode/mcp.json or the Add to VS Code button on the connect page.

```json
{
  "servers": {
    "three-ws": {
      "type": "http",
      "url": "https://three.ws/api/mcp"
    }
  }
}
```

### Grok Bot (xAI)

Server: https://three.ws/api/mcp-grok. Auth: none.
Where: Connectors, add a custom MCP connector.

- transport: streamable-http
- url: https://three.ws/api/mcp-grok
- authentication: none

The URL must be public: Grok Bot connects from xAI's cloud, so a localhost URL never works.

Add sign-in later for the account's agent, memory, skill and avatar tools; never a wallet or payment tool: https://three.ws/api/mcp-grok?auth=oauth

### IBM Bob

Server: https://three.ws/api/mcp-studio. Auth: none.
Where: .bob/mcp.json in the project, or ~/.bob/settings/mcp.json for every workspace (Bob panel, MCP tab, Edit Project MCP or Edit Global MCP).

```json
{
  "mcpServers": {
    "three-ws": {
      "type": "streamable-http",
      "url": "https://three.ws/api/mcp-studio"
    }
  }
}
```

Bob Shell reads the same files but names the URL key httpURL.

Add sign-in later for the account's agents, memory, wallets and x402 tools, through Bob's built-in OAuth on first connect: https://three.ws/api/mcp

## Hosted MCP servers

| Server | Endpoint | Auth |
|---|---|---|
| three.ws | https://three.ws/api/mcp | OAuth 2.1 (end-user), API key (server-to-server), or x402 pay-per-call |
| 3D Studio | https://three.ws/api/mcp-3d | OAuth 2.1 or x402 pay-per-call |
| 3D Studio (free) | https://three.ws/api/mcp-studio | none |
| Grok | https://three.ws/api/mcp-grok | OAuth 2.1 or a connector API key for the account's agent tools; none needed for the free 3D tools |
| Agent wallet | https://three.ws/api/mcp-agent | OAuth 2.1 |
| x402 Bazaar | https://three.ws/api/mcp-bazaar | OAuth 2.1 or x402 |
| pump.fun | https://three.ws/api/pump-fun-mcp | none for the read-only tools; API key or x402 for pumpfun_upload_metadata |
| IBM x402 | https://three.ws/api/ibm-mcp | x402 pay-per-call (authenticated three.ws principals call without per-call payment) |

No account is needed for the keyless servers (3D Studio free, read-only pump.fun tools).

## More

- [Connect page](https://three.ws/connect): one-click install for Claude, Cursor and VS Code.
- [MCP directory](https://three.ws/.well-known/mcp.json): every endpoint, machine-readable.
- [MCP guide](https://three.ws/docs/mcp.md): tools, authentication and local testing.
- [llms.txt](https://three.ws/llms.txt): curated index for AI agents.
