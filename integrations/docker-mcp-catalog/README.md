# three.ws in the Docker MCP Catalog

The entry that lists the hosted three.ws MCP server in [Docker's MCP Catalog](https://hub.docker.com/mcp) (Docker Hub server pages and the MCP Toolkit in Docker Desktop). Docker's catalog is built from [docker/mcp-registry](https://github.com/docker/mcp-registry); a remote server is listed by a pull request that adds `servers/<name>/` there.

```
servers/three-ws/
├── server.yaml   # remote entry: https://three.ws/mcp, Streamable HTTP, OAuth
├── tools.json    # [] (tools are discovered live after sign-in)
└── readme.md     # docs link Docker renders on the server page
```

## What a Docker Desktop user gets

1. MCP Toolkit, Catalog, search "three.ws", Add.
2. Docker's gateway runs OAuth against three.ws: it reads the 401 challenge on `https://three.ws/mcp`, registers itself through `/api/oauth/register` (RFC 7591) with a loopback redirect, and opens the three.ws consent screen with PKCE.
3. After consent, every client Docker connects (Claude Desktop, Cursor, VS Code and the rest) sees the unified server's tools: Forge 3D generation, avatar rigging, the CC0 asset catalog, glTF validation, agents, memory and wallets. Tools that move funds are opt-in on the consent screen and in [tool settings](https://three.ws/settings/mcp-tools).

The same flow by CLI:

```bash
docker mcp server enable three-ws
docker mcp oauth authorize three-ws
docker mcp gateway run
```

## The scope requirement

Docker's gateway does not read `scopes_supported` from the protected-resource document. It takes the scope list from the `scope` parameter of the 401 challenge (or a non-standard `scopes` field), and registers with no scope when neither is present. three.ws stores a scope-less registration as `avatars:read`, so before 2026-11-28 a Docker user would have got a one-permission token. `bearerChallenge` in [`api/_mcp/auth.js`](../../api/_mcp/auth.js) now names each hosted server's advertised scope set in its challenge, as the MCP authorization spec (2025-11-25) recommends; [`tests/api/oauth-scope-discovery.test.js`](../../tests/api/oauth-scope-discovery.test.js) pins challenge and document together.

## Verify

```bash
npm run check:integrations -- docker-mcp-catalog
```

Clones docker/mcp-registry into `~/.cache/three-ws/`, stages this entry, runs Docker's own `cmd/validate` on it, and fails if the live `https://three.ws/mcp` challenge names no scope. Needs Go 1.24+ and npx.

Submitting: [SUBMITTING.md](./SUBMITTING.md).
