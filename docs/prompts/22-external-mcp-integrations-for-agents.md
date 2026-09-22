# 22. External MCP servers as agent tools: an integrations catalog with one-command install

Read `docs/prompts/README.md` first.

## The problem

Our agents use our tools. They cannot be connected to the hundreds of third-party MCP servers that exist for Stripe, Notion, Linear, Slack, GitHub, Google Workspace, Cloudflare, Supabase, Sentry and the rest, so an agent cannot file an issue, read a doc, or check a payment for the person it serves. The best agent products ship a catalog of vetted servers with `install <name>` and per-user OAuth.

## Build

- **Catalog:** `data/mcp-catalog.json` with at least sixty vetted remote or stdio MCP servers (name, vendor, transport, URL or npm package, auth type, scopes, tool count, category, docs link), validated at build, rendered on `/integrations` (in `data/pages.json`) with search and categories.
- **Per-agent connections:** migration `agent_mcp_connections` (agent, catalog id or custom URL, auth state, encrypted credentials with the wallet secret encryption, enabled tools, tier overrides). Routes `GET/POST/DELETE /agents/:id/mcp` and `POST /agents/:id/mcp/:conn/auth` (OAuth flow with the platform as the client, tokens stored encrypted, refresh handled). Custom servers accepted by URL with a safety review step that lists the tools before enabling.
- **Runtime:** the server loop and the local runtime mount connected servers' tools under `ext_<name>_` names, each classified into the prompt 03 tiers by a rules file in the catalog entry (write tools off by default for a new connection). Tool results from external servers are untrusted data.
- **CLI and MCP:** `three-ws mcp install <name> --agent <id>`, tools `list_integrations`, `install_integration`, `remove_integration` (prompt 05 integrations become this).
- **Docs:** `docs/integrations.md` linked from `docs/start-here.md`; catalog contribution guide; changelog entry tagged `feature`.

## Acceptance

- Connect an agent to a public documentation MCP server and a GitHub MCP server through OAuth; the agent answers a question that needs each.
- A write tool on a newly connected server is hidden until enabled.
- `npm test` green with catalog validation and connection lifecycle tests.
