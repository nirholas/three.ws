# MCP registry sentinel

`GET /api/cron/mcp-registry-sentinel` runs daily (06:41 UTC, Cloud Scheduler job synced from `vercel.json` `crons`). It diffs every MCP server we ship against the official registry and npm, and raises one ops alert when the set of gaps changes.

## What it reads

- **Local:** every `server.json` under the repo root, `mcp-bridge/`, `mcp-server/`, `packages/*`, `robinhood/*` and `services/*` whose name starts with `io.github.nirholas/`.
- **Registry:** `https://registry.modelcontextprotocol.io/v0/servers?search=io.github.nirholas&version=latest`, following `metadata.nextCursor` until empty. Rows with `isLatest: false` are skipped.
- **npm:** `registry.npmjs.org/<package>/latest` for each npm package a manifest declares.
- **Hosted remotes:** an MCP `initialize` POST to each manifest's `remotes[].url`. A 404, a 5xx or a timeout counts as down.

## Findings

| Kind | Meaning | Usual fix |
|---|---|---|
| `unpublished` | Local manifest has no registry entry | `mcp-publisher publish` from that directory |
| `behind` | Local version is newer than the registry's latest | republish |
| `repo_mismatch` | `repository.url` differs from the registry's (trailing `.git` ignored) | fix the manifest, republish |
| `registry_only` | Registry name under our namespace with no local manifest | restore the manifest or deprecate the entry |
| `npm_behind` | npm latest is older than the manifest's package version, or the package is missing | `npm publish` first (the registry validates the npm package) |
| `remote_down` | Hosted remote did not answer | check the service |

An npm lookup that errors (not a 404) drops the npm check for that entry for the run, so an npm outage never reads as "missing".

## Alerting and state

The finding keys (`kind:name`) are stored in `app_settings` under `mcp_registry_sentinel`. `sendOpsAlert` fires only for keys that are new since the last run, so a standing gap alerts once. Resolved keys are removed from state silently. The response body lists every current finding, the keys alerted this run and the keys resolved.

## Running it

With `CRON_SECRET` set, call the route with `Authorization: Bearer $CRON_SECRET`. Code: `api/cron/mcp-registry-sentinel.js` (I/O) and `api/_lib/mcp-registry-sentinel.js` (pure diff). Tests: `tests/mcp-registry-sentinel.test.js`.

Related: `scripts/three-ws-presence.mjs` (on-demand presence report), `docs/mcp.md`.
