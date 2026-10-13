---
name: connect-three-ws-mcp
description: Connect any MCP client (Claude Code, Claude Desktop, the Agent SDK, or a custom one) to the three.ws MCP servers, so the model can generate 3D models and avatars, read and write agent data, and pay for services. Use when you or the user want to connect, add, install, configure, wire up, or debug three.ws MCP, an MCP server for 3D or avatars or agent wallets, a .mcp.json entry, or "give Claude access to three.ws". Also use to pick which of the hosted servers to add, and to test a connection that is not working.
when_to_use: The user wants the tools available inside their client rather than shelling out to curl. Start with the free server when no account exists yet. For one-off calls over plain HTTP instead, the 3D skills already show the JSON-RPC form.
license: MIT
metadata:
  category: platform/agents
  cross-platform-safe: false
  pack: three-ws-skills
---

# Connect a client to three.ws MCP

three.ws publishes a machine-readable directory of its hosted MCP servers. Fetch it
rather than trusting a list in any document, including this one:

```bash
curl -s https://three.ws/.well-known/mcp.json
```

Each entry carries `name`, `endpoint`, `transport`, `auth`, and its documentation link. As
of this writing the directory lists **7 hosted servers** over Streamable HTTP, and dozens
more install-and-run servers are published on npm under the `@three-ws` scope and
registered in the MCP registry (`https://registry.modelcontextprotocol.io/?q=io.github.nirholas`).

## Which server to add

| Goal | Server | Auth |
| --- | --- | --- |
| Free text or image to 3D, rigged avatars, talking personas | `https://three.ws/api/mcp-studio` | none |
| Avatars, glTF validation and inspection, agent data, memory | `https://three.ws/api/mcp` | API key or OAuth |
| Paid 3D lanes: higher-tier generation, retexture, optimization | `https://three.ws/api/mcp-3d` | OAuth or x402 |
| The agent's custodial wallet: balance, find and pay services, monetize an endpoint | `https://three.ws/api/mcp-agent` | OAuth |
| Discover and price paid agent services across the network | `https://three.ws/api/mcp-bazaar` | OAuth or x402 |

**Start with the free one.** `https://three.ws/api/mcp-studio` needs no account, no key,
and no payment, and it already covers the whole generate-and-rig path. Add the
authenticated server only when the user wants their own library, agents, or money.

## Claude Code

Project scope, in `.mcp.json` at the repo root (Claude Code auto-discovers it):

```json
{
  "mcpServers": {
    "three-ws-studio": {
      "type": "http",
      "url": "https://three.ws/api/mcp-studio"
    }
  }
}
```

With an API key, reference an environment variable rather than pasting the secret into a
file that gets committed:

```json
{
  "mcpServers": {
    "three-ws": {
      "type": "http",
      "url": "https://three.ws/api/mcp",
      "headers": { "Authorization": "Bearer ${THREE_WS_MCP_TOKEN}" }
    }
  }
}
```

Then `export THREE_WS_MCP_TOKEN='sk_live_...'` in the shell that starts Claude Code, and
restart the session so the client re-reads the file. The same block works in
`~/.claude/settings.json` under `mcpServers` when the user wants it on every project.

## Claude Desktop

Add to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "three-ws": {
      "command": "npx",
      "args": ["-y", "@three-ws/mcp-server", "--url", "https://three.ws/"]
    }
  }
}
```

That npm package handles the OAuth dance locally, which is what a desktop client wants.
`--url` also lets the user point at a local dev server (`http://localhost:3000/`).

## Any other client

`POST` JSON-RPC 2.0 to the endpoint. The server is stateless beyond the `initialize`
handshake, so nothing else needs to be set up:

```bash
curl -s -X POST https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

For the Agent SDK, register the same URL as an HTTP MCP server in the SDK's `mcpServers`
option and pass the `Authorization` header if the server needs one.

## Get a key when one is needed

1. Sign in at `https://three.ws/login`.
2. Open [three.ws/dashboard/api](https://three.ws/dashboard/api), create a key, and copy
   the secret. It is shown **once**: the server stores only a SHA-256 hash and the
   12-character prefix.
3. Scopes are fixed at creation. Pick from `avatars:read`, `avatars:write`,
   `avatars:delete`, `profile`, `memory:read`, `memory:write`, `agents:read`,
   `agents:write`. A read-only client should get read scopes only.
4. Secrets look like `sk_live_...` (or `sk_test_...`). Minting is limited to 30 keys per
   hour, per account.

Never write a key into a file inside the user's repo. Environment variable, or the
client's own secret store.

## Verify it worked

Ask the client to list tools, or run the curl above. A healthy free server answers with
its tool set, which currently includes `forge_free`, `text_to_avatar`, `mesh_forge`,
`rig_mesh`, `forge_avatar`, `refine_model`, `check_job`, `look_at_model`,
`create_agent_persona`, `get_agent_persona`, and `persona_say`. Call `tools/list` for the
live set rather than assuming this list is current.

Then prove the round trip with real work, not a ping:

```bash
curl -s -X POST https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"forge_free","arguments":{"prompt":"a small brass desk lamp"}}}'
```

## When it does not connect

| Symptom | Cause | Fix |
| --- | --- | --- |
| Client shows the server but no tools | Config added while the client was running | Restart the client session; `.mcp.json` is read at startup |
| `401 unauthorized` | No header, a revoked key, or a typo in the variable name | Echo the variable in the same shell; mint a fresh key if needed |
| `403 insufficient_scope` | The key lacks the scope the tool needs | Scopes cannot be edited: mint a new key with the right set |
| `402 Payment Required` | A paid tool on `mcp-3d` or `mcp-bazaar` | Expected. Pay with the `pay-for-service` skill, or use the free studio server |
| `429 rate_limited` | Per-account quota | Honor `retry_after`; do not retry in a loop |
| Works in curl, not in the client | The client is reading a different config file | Check project vs. user scope, and that the JSON parses |

## Related

- **The tools themselves**: `generate-3d-model`, `create-3d-avatar`, `rig-a-model`,
  `find-3d-assets` all describe the MCP tool and the plain HTTP call side by side.
- **Paying for tools**: `pay-for-service` and `x402` handle a `402` challenge.
- **Full reference**: [three.ws/docs/mcp](https://three.ws/docs/mcp).
