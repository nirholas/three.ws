# Solana agent stack — operations

Single source of truth for what's deployed, what env vars enable it, what cron schedules it, and what the wire formats are. No demo paths, no mocks — every endpoint listed here writes to or reads from the same Postgres + Solana RPC.

## Endpoints (Vercel auto-routed by file path)

| Path | Method | Purpose |
|---|---|---|
| `/api/agents/solana-register-prep` | POST | Build unsigned Metaplex Core createV1 tx for the user's wallet. Optional vanity (`asset_pubkey`, `vanity_prefix`). |
| `/api/agents/solana-register-confirm` | POST | Verify on-chain confirmation, upsert `agent_identities` row with `meta.sol_mint_address`. |
| `/api/agents/onchain/prep` + `/confirm` | POST | Unified EVM + Solana variant. Stores `meta.onchain` block. |
| `/api/agents/solana-card` | GET | A2A-compatible agent card (`identity`, endpoints, schemas). |
| `/api/agents/solana-attestations` | GET | Read indexed attestations. Cold cache → inline RPC crawl. |
| `/api/agents/solana-reputation` | GET | Computed reputation: feedback (raw / verified / credentialed / event-attested), validation, tasks, pump-payments, token activity. |
| `/api/agents/solana-reputation-history` | GET | Daily score buckets for sparkline. `?days=1..90`. |
| `/api/agents/solana-attest-event` | POST | **Webhook bridge.** HMAC-verified, idempotent, claims-table-serialised. |

## Required env vars

| Var | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | all | Neon Postgres. |
| `SOLANA_RPC_URL` | reads + crawler | Mainnet RPC. |
| `SOLANA_RPC_URL_DEVNET` | reads + crawler | Devnet RPC. |
| `PUMPKIT_WEBHOOK_SECRET` | `solana-attest-event` | HMAC-SHA256 secret shared with the upstream pumpkit monitor. |
| `ATTEST_AGENT_SECRET_KEY` | `solana-attest-event` | bs58-encoded 64-byte Ed25519 secret of the server-side attester wallet. **Must hold SOL** on the target network to pay memo tx fees (~0.000005 SOL/tx). |
| `CRON_SECRET` | all `/api/cron/*` | Manual cron trigger auth. Vercel Cron uses `x-vercel-cron: 1` instead. |
| `PUMPFUN_BOT_URL` (optional) | `pumpfun-signals` | Upstream pumpfun-claims-bot MCP endpoint. |
| `PUMPFUN_BOT_TOKEN` (optional) | `pumpfun-signals` | Bearer token for the MCP endpoint. |

## Cron schedule (vercel.json)

| Path | Schedule | Job |
|---|---|---|
| `/api/cron/solana-attestations-crawl` | `*/5 * * * *` | Crawl SPL Memo attestations into `solana_attestations`. |
| `/api/cron/erc8004-crawl` | `*/15 * * * *` | EVM IdentityRegistry crawler. |
| `/api/cron/pumpfun-signals` | `*/15 * * * *` | Pull claim/graduation signals from upstream MCP. *Optional* — only enabled if `PUMPFUN_BOT_URL` is set. |
| `/api/cron/pump-agent-stats` | `*/10 * * * *` | Refresh pump.fun token state per agent (graduation flag, AMM/curve snapshots, recent trades). |
| `/api/cron/pumpfun-monitor` | `*/3 * * * *` | **In-house event-attested source.** Diffs `pump_agent_stats` vs cursor; mints real on-chain `threews.*` memos with `payload.source = 'pumpfun.*'` whenever graduation or authority flips. No upstream bot required. |
| `/api/cron/solana-attest-event-cleanup` | `*/10 * * * *` | Reap stale claim rows (>1h, signature null). |

## Database tables

Migrations are under `api/_lib/migrations/<date>-<name>.sql`, applied with:
```
psql "$DATABASE_URL" -f api/_lib/migrations/<file>.sql
```

The new ones are:
- `2026-04-29-attest-event-bridge.sql` — `solana_attest_event_claims` + the partial unique index `solana_attestations_event_id_uniq`.
- `2026-04-29-pumpfun-monitor-cursor.sql` — `pumpfun_monitor_cursor` for the in-house monitor.

Pre-existing relevant tables: `solana_attestations`, `solana_attestations_cursor`, `solana_credentials`, `pump_agent_mints`, `pump_agent_payments`, `pump_agent_stats`, `pump_agent_trades`, `pumpfun_signals`, `agent_identities`, `usage_events`.

## Webhook contract — `/api/agents/solana-attest-event`

```http
POST /api/agents/solana-attest-event
content-type: application/json
x-pumpkit-timestamp: <unix-seconds>
x-pumpkit-signature: <hex hmac_sha256(secret, "<ts>.<raw-body>")>

{
  "event_id":    "<unique per event>",
  "event_type":  "graduation" | "fee_claim" | "whale_trade" | "cto_detected",
  "agent_asset": "<base58 Metaplex Core asset pubkey>",
  "network":     "mainnet" | "devnet",
  "token_mint":  "<base58 spl mint>",
  "task_id":     "<correlation id>",
  "detail":      { ... }      // optional, opaque
}
```

**Responses:**
- `201 { data: { signature, kind, deduped: false } }` — new attestation minted on-chain.
- `200 { data: { signature, deduped: true } }` — duplicate `event_id` for this agent; previous signature returned.
- `202 { data: { deduped: true, status: 'in_progress' } }` — leader still processing; retry later.
- `401 unauthorized (missing|stale|bad_timestamp|bad_signature)` — HMAC failed.
- `404 not_found` — `agent_asset` not registered.
- `429 rate_limited` — IP exceeded the auth-IP bucket.
- `500 internal` — `PUMPKIT_WEBHOOK_SECRET` or `ATTEST_AGENT_SECRET_KEY` not configured.

**Replay window:** 5 minutes (timestamp skew). **Body limit:** 64 KB.

## Trust tiers (read by `solana-reputation`)

In order of Sybil resistance (strongest first):

1. **Credentialed** — feedback from attesters holding `threews.verified-client.v1` SAS credentials.
2. **Verified** — feedback whose `task_id` has a matching `threews.accept.v1` from the agent owner.
3. **Event-attested** — feedback whose `payload.source` starts with `pumpkit.` (external webhook) or `pumpfun.` (in-house monitor cron).
4. **Community** — raw memo feedback.

The passport (`/agent-passport.html`) renders all four tiers and computes a top-level **A/B/C/D trust grade** from the strongest available tier, penalised by disputes and validation-failure rate.

## Live UI surface

| Page | Reads from |
|---|---|
| `/agent-passport.html?asset=<asset>&network=<n>` | card + reputation + attestations + history. 8s polling. |
| `/agent-badge.html?asset=<asset>&network=<n>&theme=<light\|dark>` | card + reputation. Iframe-friendly. |
| `/agent/index.html?id=<agent-id>` | $AGENT pump.fun token widget. Real-time bus updates. |

## Verifying production wiring

```bash
# 1. Schema present
psql "$DATABASE_URL" -c "\d solana_attest_event_claims"
psql "$DATABASE_URL" -c "\di solana_attestations_event_id_uniq"

# 2. Attester funded
solana balance "$ATTESTER_PUBKEY" --url devnet  # or mainnet-beta

# 3. Webhook reachable + reject without HMAC
curl -i -X POST https://<host>/api/agents/solana-attest-event \
  -H 'content-type: application/json' -d '{}'   # expect 401 unauthorized

# 4. Cron auth
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  https://<host>/api/cron/solana-attest-event-cleanup
# expect { "deleted": 0, ... } on a healthy table
```
