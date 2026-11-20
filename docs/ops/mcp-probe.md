# MCP connector probe

A synthetic client connects to every Grok-facing MCP connector every five minutes, the same way Grok and Cursor do, and records whether it worked. The results feed a healthz subsystem, an ops page, and the public uptime numbers we can quote in a marketplace listing.

## What is probed

The server list is read at run time from the deployed [`public/.well-known/mcp.json`](../../public/.well-known/mcp.json). A server is Grok-facing when it is the `grok-bot` client's `recommendedServer`, or when it connects with no credential and publishes an OAuth sign-in URL (`signIn`). Today that is `https://three.ws/api/mcp-grok` and `https://three.ws/api/mcp-studio`. A server added to the manifest in that shape is probed with no code change.

Each probe runs these steps over Streamable HTTP (JSON-RPC 2.0 over `POST`). Each step has a 10 second timeout and is timed on its own:

| Step | Passes when |
|---|---|
| `initialize` | HTTP 200, a JSON-RPC result with a `protocolVersion` and the `tools` capability. The `Mcp-Session-Id` it issues and the negotiated `MCP-Protocol-Version` are echoed on every later request, as the official SDK transports do. |
| `notifications/initialized` | Any 2xx. Anything other than 202 with an empty body is recorded as a conformance warning (spec 2025-06-18), not as a failure. |
| `tools/list` | At least one tool listed. |
| `tools/call` | One read-only call returns content and no `isError`. `search_docs` on `/api/mcp-grok` (an in-process index read, the cheapest tool it lists), `search_catalog` on `/api/mcp-studio`. |
| `oauth_challenge` | An unauthenticated `initialize` on the `?auth=oauth` sign-in URL answers **401** with a `Bearer` `WWW-Authenticate` challenge naming `resource_metadata`. A 401 here is the healthy answer. |
| `oauth_metadata` | That protected-resource document answers 200 JSON with a `resource` and at least one `authorization_servers` entry. |

No tool that writes, generates, spends or touches an account is ever called, and no credential is ever sent.

## Code

| Piece | Path |
|---|---|
| Probe library | [`api/_lib/mcp-probe.js`](../../api/_lib/mcp-probe.js) |
| Ledger (insert, prune, uptime aggregates) | [`api/_lib/mcp-probe-store.js`](../../api/_lib/mcp-probe-store.js), migration `20261120205747_mcp_probe_results.sql` |
| Cron, every 5 minutes | [`api/cron/mcp-probe.js`](../../api/cron/mcp-probe.js), declared in `vercel.json` `crons` |
| Healthz subsystem `mcp_probe` | [`api/_lib/mcp-probe-health.js`](../../api/_lib/mcp-probe-health.js) |
| Public uptime feed | [`api/status/mcp.js`](../../api/status/mcp.js), rendered on [/status](https://three.ws/status) under "Connector uptime" |
| Operator CLI | [`scripts/grok-mcp-probe.mjs`](../../scripts/grok-mcp-probe.mjs) |
| Tests (real handlers in process, PGlite) | `tests/mcp-probe.test.js`, `tests/mcp-probe-cron.test.js`, `tests/mcp-probe-health.test.js` |

Each run writes one `mcp_probe_results` row per server (`checked_at`, `server`, `ok`, `failed_step`, `latency_ms` jsonb per step, `error`, `detail` jsonb with the protocol version, session issue, tool count and warnings). The same run deletes rows older than 90 days.

## Thresholds

The healthz subsystem `mcp_probe` judges each server on its two newest rows, and the worst server sets the status:

| Status | When |
|---|---|
| `ok` | The newest probe passed. |
| `degraded` | The newest probe failed once. The next run decides. |
| `down` | Two consecutive failures, or no probe in 15 minutes (the cron stopped). |
| `unknown` | No probe has ever run (the scheduler job does not exist yet), or the table is missing. |

The cron pages ops (`sendOpsAlert`) on the second consecutive failure of a server and again when it recovers. A single failed run pages nobody.

## Reading the uptime endpoint

`GET https://three.ws/api/status/mcp` is public and credential-free, CORS `*`, cached 60 seconds. It answers per server. This is the real answer from a local server on the isolated database after six cron runs (the first run includes the cold module load, which is why p95 sits far above p50 on so few samples; the second server and the 7d/30d windows have the same shape):

```json
{
  "generatedAt": "2026-11-20T21:55:26.651Z",
  "probeIntervalSeconds": 300,
  "servers": [
    {
      "name": "Grok",
      "path": "/api/mcp-grok",
      "server": "http://localhost:3297/api/mcp-grok",
      "last": { "checkedAt": "2026-11-20T21:55:20.112Z", "ok": true, "failedStep": null },
      "windows": {
        "24h": { "probes": 6, "passed": 6, "successRate": 1, "handshakeP50Ms": 171, "handshakeP95Ms": 4020, "toolCallP50Ms": 33, "toolCallP95Ms": 219 }
      }
    }
  ]
}
```

- `successRate` is `passed / probes` in the window (null when there were no probes).
- `handshakeP50Ms` and `handshakeP95Ms` cover `initialize` + `notifications/initialized` + `tools/list`: how long a connector waits from opening a session to seeing the tool list. Percentiles cover passing probes only.
- `toolCall*` is the one read-only `tools/call`.
- No error text or request detail is published. The failing step's name is.
- An empty `servers` array means no probe has run yet. A 503 `uptime_unavailable` means the ledger could not be read; the probe keeps running.

## Before a marketplace submission

```
npm run grok:mcp-probe                                  # one run against https://three.ws
npm run grok:mcp-probe -- --runs 20                     # p50/p95 handshake over 20 runs
npm run grok:mcp-probe -- --base http://localhost:3280  # a dev server
npm run grok:mcp-probe -- --json probe.json             # keep the evidence
```

It runs the exact probe the cron runs, from this machine, and prints one row per server with the median per-step latency, the handshake p50/p95 and the tool it called. It exits 1 if any run of any server failed. Every `FAIL` line names the step and the reason.

For a broader compatibility sweep of every hosted server (SDK client, SSE fallback, API key mode, PKCE), use `npm run probe:mcp-clients`. That is a different tool with a wider scope.

## Production setup

1. Apply the migration: `npm run db:status`, then `npm run db:migrate` (it applies at once, no dry run).
2. Deploy (`npm run deploy:gcp:full`). The post-deploy `deploy:gcp:sync-crons` step creates the missing `cron--api-cron-mcp-probe` Cloud Scheduler job. `npm run check:cron-drift` reports it as MISSING until then.
3. Check: `curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[] | select(.name=="mcp_probe")'` and `curl -s https://three.ws/api/status/mcp | jq`.
