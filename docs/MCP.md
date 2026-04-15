# 3D Agent MCP Server

The 3D Agent MCP server lets any Model Context Protocol client — Claude Desktop,
Claude Code, custom agents built on the Claude Agent SDK, or any other
MCP-compatible app — list, render, and manage a user's 3D avatars.

- **URL:** `https://3dagent.vercel.app/api/mcp`
- **Transport:** Streamable HTTP (MCP spec `2025-06-18`)
- **Auth:** OAuth 2.1 (end-user) or API key (server-to-server)
- **Docs:** <https://3dagent.vercel.app/docs/mcp>

## Tools

| Name | Scope | Description |
| --- | --- | --- |
| `list_my_avatars`       | `avatars:read`   | Paginated list of the caller's avatars. |
| `get_avatar`            | `avatars:read`   | Fetch one avatar by `id` or `slug`. |
| `search_public_avatars` | —                | Discover public avatars (no auth needed for read). |
| `render_avatar`         | `avatars:read`   | Returns ready-to-embed `<model-viewer>` HTML. Use as a Claude artifact. |
| `delete_avatar`         | `avatars:delete` | Soft-delete an avatar you own. |

## Auth: OAuth 2.1

Claude handles the handshake automatically via dynamic client registration:

1. Client POSTs to `https://3dagent.vercel.app/oauth/register` (RFC 7591).
2. User is redirected to `https://3dagent.vercel.app/oauth/authorize?...` to sign in + consent.
3. Client exchanges the code at `https://3dagent.vercel.app/oauth/token` with PKCE.
4. Resulting access token is a short-lived JWT with `aud=https://3dagent.vercel.app/api/mcp`.

Metadata discovery:

- Authorization Server: `GET /.well-known/oauth-authorization-server`
- Protected Resource:   `GET /.well-known/oauth-protected-resource`

On a 401 from `/api/mcp`, the `WWW-Authenticate` header points clients at the
protected-resource metadata URL, per RFC 9728.

## Auth: API key

For server-to-server usage (scripts, agents, CI), create a key in the dashboard
under *API keys* and pass it as a bearer token:

```bash
curl -X POST https://3dagent.vercel.app/api/mcp \
  -H "authorization: Bearer sk_live_…" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Keys are owned by a single user and inherit that user's plan limits.

## Example: render an avatar in Claude

Once connected, ask Claude:

> List my avatars, then render my `nich-holographic` avatar as an interactive
> 3D viewer.

Claude will call `list_my_avatars`, then `render_avatar({ slug: "nich-holographic" })`,
and emit the returned HTML as an inline artifact.

## Plans & quotas

| Plan | Avatars | Size / file | Total storage | MCP calls / day |
| --- | --- | --- | --- | --- |
| Free       | 10     | 25 MB  | 250 MB   | 1 000     |
| Pro        | 500    | 50 MB  | 25 GB    | 50 000    |
| Team       | 5 000  | 100 MB | 500 GB   | 500 000   |
| Enterprise | 100 000| 500 MB | 10 TB    | 10 000 000|

## Credits

The avatar creator is powered by [Avaturn](https://avaturn.me) via their official
SDK. 3D Agent adds authentication, storage, MCP access, and multi-tenant
infrastructure on top.
