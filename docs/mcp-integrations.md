# MCP integrations: connect an agent to third-party MCP servers

An agent on three.ws can use tools from other MCP servers: GitHub, Linear, Notion,
documentation servers like DeepWiki, search, CRM, payments, and any public HTTPS
MCP server you point it at. You connect a server once per agent, choose which of
its tools the agent may call, and from then on the agent sees those tools next to
its own during every run.

Page: [/mcp-integrations](https://three.ws/mcp-integrations)

## How it works

1. **Pick a server.** The page lists a vetted catalog (`data/mcp-catalog.json`,
   80+ servers in 18 categories). Hosted servers connect from the page. Local-only
   servers (filesystem, git, and similar stdio servers) are listed with install
   instructions for your own MCP client, because they cannot run on three.ws.
2. **Sign in.** Each server declares how it authenticates:
   - **No sign-in** (DeepWiki and most documentation servers): connects at once.
   - **OAuth**: you sign in at the vendor and approve access. Servers that support
     dynamic client registration work everywhere; servers that need a platform
     client (GitHub) work when the deployment has `MCP_OAUTH_<VENDOR>_CLIENT_ID`
     and `_CLIENT_SECRET` set. Without them the page offers the token path.
   - **Access token**: paste a personal access token. Many OAuth servers also
     accept one.
   Tokens and OAuth credentials are stored encrypted (`api/_lib/secret-box.js`),
   refreshed automatically before they expire, and never returned by any API.
3. **List and classify tools.** three.ws calls `tools/list` on the server and puts
   every tool in a tier:
   - **read**: looks things up.
   - **write**: creates or changes data in the other service.
   - **financial**: moves money or cannot be undone (deletes, merges, payments).
   First match wins: your own per-tool override, then the catalog entry's `tiers`
   globs, then built-in name rules (`delete_*`, `create_*`, and so on). A server's
   own MCP annotations can only move a tool toward caution, never into the read
   tier, because they are the server's claim about itself. Anything unrecognised
   is treated as write, so it starts off.
4. **Turn tools on.** A catalog server starts with only its read tools on. Write
   and financial tools stay off until you turn each one on and acknowledge what it
   can do. The API refuses to enable an unacknowledged write or financial tool
   (`409 acknowledgement_required`).
5. **The agent uses them.** During a run the enabled tools are mounted as
   `ext_<name>_<tool>` (for example `ext_deepwiki_ask_question`). Results are
   capped at 12,000 characters and wrapped as untrusted external content, so text
   that a third-party server returns is treated as data, never as instructions.

### Custom servers

Add any public HTTPS MCP server by URL (Streamable HTTP or SSE). Requests go
through an SSRF guard (`api/_lib/mcp-connections/safe-fetch.js`): private,
loopback and link-local addresses are refused, including after DNS resolution and
on redirects. A custom server starts in **Needs your review** with every tool off.
The page shows a review table with each tool's name, tier and what it says it
does; you approve the server, then turn tools on one by one.

### Connection states

| Status | Meaning | What to do |
| --- | --- | --- |
| Connected (`active`) | Tools listed, enabled ones are available to the agent | Nothing |
| Waiting for sign-in (`pending_auth`) | Added, OAuth not finished | Press Reconnect, or paste a token |
| Needs your review (`pending_review`) | Custom server, tools listed | Read the table, press Approve server |
| Sign-in expired (`needs_auth`) | The vendor revoked or expired the token | Reconnect |
| Error (`error`) | The last call to the server failed | Read the error, press Try again |
| Paused (`disabled`) | You paused it; the agent sees none of its tools | Resume |

An agent can hold up to 25 connections.

## From the CLI

The [three-ws CLI](cli.md) wraps the same API with an API key that has the
`agents:write` scope:

```bash
three-ws mcp install deepwiki --agent Nova          # no sign-in, connects at once
three-ws mcp install github --agent Nova            # opens the browser for OAuth
three-ws mcp install github --agent Nova --token "$GITHUB_PAT"
three-ws mcp install https://mcp.example.com/mcp --agent Nova --label "Team wiki"
three-ws mcp installed --agent Nova                 # status and tool counts
three-ws mcp uninstall deepwiki --agent Nova
```

`--agent` takes an agent id or name. `--json` prints machine-readable output.
An unknown name exits with code 2 and suggests close matches; a local-only server
exits with its install instructions. Custom URLs land in review, so finish them on
the page (the CLI prints the link).

## From an MCP client

The [agent MCP server](mcp-agent.md) (`/api/mcp-agent`) exposes three tools so an
assistant can manage connections for you:

- `list_integrations`: the catalog, and with `agent_id`, what is connected.
- `install_integration`: connect a catalog server to an agent (returns a sign-in
  link for OAuth servers).
- `remove_integration`: disconnect a server and delete its stored credentials.

## HTTP API

All routes use the v1 envelope (`{ data, meta }`, errors as
`{ error: { code, message, details } }`). Session calls need CSRF on writes;
API keys need `agents:read` or `agents:write`.

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/mcp-connections/catalog` | | Public catalog with `runtime`, `connectable`, `oauthAvailable` |
| GET | `/api/v1/agents/:id/mcp` | | The agent's connections |
| POST | `/api/v1/agents/:id/mcp` | `{ catalog_id }` or `{ server_url, transport, label }`, optional `bearer_token` | The new connection (201) |
| GET | `/api/v1/agents/:id/mcp/:conn` | | One connection with tools |
| PATCH | `/api/v1/agents/:id/mcp/:conn` | `{ enabled_tools, tier_overrides, acknowledge, label, reviewed, disabled }` | The connection |
| DELETE | `/api/v1/agents/:id/mcp/:conn` | | `{ id, deleted }` |
| POST | `/api/v1/agents/:id/mcp/:conn/auth` | `{ return_to }` or `{ bearer_token }` | `{ authorization_url }` or `{ connection }` |
| POST | `/api/v1/agents/:id/mcp/:conn/refresh` | | The connection with a fresh tool list |

The OAuth callback is `/api/mcp-connections/callback`. It returns the browser to
`return_to` (default `/mcp-integrations`) with `?mcp_connected=<id>`, or with
`?mcp_error=invalid_state|wrong_account|denied|exchange_failed`.

A connection never carries credentials: every response goes through
`presentConnection` in `api/_lib/mcp-connections/store.js`, an allowlist that
reports only `has_credentials` and `token_expires_at`.

## Add a server to the catalog

The catalog is `data/mcp-catalog.json`. Add an entry:

```json
{
	"id": "example",
	"name": "Example",
	"vendor": "Example Inc.",
	"category": "productivity",
	"description": "One sentence on what the tools do.",
	"transport": "streamable-http",
	"url": "https://mcp.example.com/mcp",
	"package": null,
	"auth": { "type": "oauth", "registration": "dynamic" },
	"toolCount": null,
	"docs": "https://example.com/docs/mcp",
	"tiers": { "financial": ["delete_*"], "write": ["create_*", "update_*"] },
	"official": true
}
```

- `transport` is `streamable-http`, `sse`, or `stdio` (local-only, needs
  `package` and no `url`).
- `auth.type` is `none`, `bearer` (add `tokenHelp`; `optional: true` if the token
  is optional) or `oauth`. OAuth needs `registration: "dynamic"`, or
  `registration: "platform"` plus `clientEnv` (the env prefix for the platform
  client) and `scopes`. Add `alt: "bearer"` when the server also takes a token.
- `tiers` maps tool-name globs to `write` or `financial`. Anything unmatched falls
  back to the tool's annotations and name. Be conservative: a glob that wrongly
  marks a write tool as read is a bug.
- `category` must be one of the ids in the file's `categories` list.

Then run:

```bash
npm run check:mcp-catalog                 # schema and tier checks, also runs in prebuild
node scripts/vet-mcp-integrations.mjs     # network check: URL is live, package exists
```

## Source map

| Piece | Path |
| --- | --- |
| Page | `pages/mcp-integrations.html`, `src/mcp-integrations.js` |
| Routes | `api/_lib/mcp-connections/routes.js`, mounted by `api/v1/agent-mcp.js` |
| Safety rules and state machine | `api/_lib/mcp-connections/service.js` |
| Tier classification | `api/_lib/mcp-connections/classify.js` |
| OAuth (PKCE, dynamic registration, refresh) | `api/_lib/mcp-connections/oauth.js`, `api/mcp-connections/callback.js` |
| MCP client and SSRF guard | `api/_lib/mcp-connections/client.js`, `safe-fetch.js` |
| Runtime mounting (`ext_` tools) | `api/_lib/mcp-connections/runtime.js`, used by `api/agent/run.js` |
| Agent MCP tools | `api/_mcpagent/integrations-tools.js` |
| CLI | `packages/three-ws-cli/src/commands/mcp.js` |
| Tests | `tests/mcp-connections-lifecycle.test.js`, `packages/three-ws-cli/tests/mcp-install.test.js` |
