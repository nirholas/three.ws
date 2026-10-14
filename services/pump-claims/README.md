# pump-claims

Real-time listener for GitHub social-fee-PDA claims (`claim_social_fee_pda`) on
the PumpFees program. Decodes and attributes each claim to a coin using the
same evidence rules as the rest of the claims feed, then writes it into the
`pump_fee_claims` Postgres table. Backs `api/_lib/pump-claims.js`'s table-first
read path so `GET /api/pump/first-claims` (and the Telegram claims channel it
feeds, see `docs/pump-claims-channel.md`) no longer depend on `PUMPFUN_BOT_URL`
for GitHub claims.

## Why a standalone service

A claim can land on-chain at any moment; a request-scoped serverless function
cannot hold a subscription open between invocations. This process holds one
instead, is deployed with `--min-instances=1 --no-cpu-throttling`, and is
designed to run forever.

## How it works

```
PumpFees program logs
        │  Connection.onLogs (listener.js)
        ▼
decodeClaim() / processLogEntry()        pipeline.js
   ├── isSocialClaimLog / parseSocialFeeClaim   api/_lib/pump-events.js
   └── attributeGithubClaim                     api/_lib/pump-claims.js
        │
        ▼
store.insertClaim()                      store.js
   └── insert into pump_fee_claims ... on conflict (signature) do nothing
```

- **`listener.js`**: `ClaimListener` wraps `Connection.onLogs` (reusing the
  repo's RPC-failover-aware `Connection`, not a hand-rolled WebSocket client)
  with an app-level heartbeat watchdog. Claim events are too rare to serve as a
  liveness signal on their own, so the watchdog pings `connection.getSlot()` on
  an interval; after `maxMissedHeartbeats` consecutive failures it tears down
  and resubscribes, then calls `onReconnect` so the caller can gap-fill.
- **`pipeline.js`**: pure decode/attribute. `decodeClaim` filters a log entry
  to GitHub claims only; `processLogEntry` additionally resolves the paying
  coin via `attributeGithubClaim`. No I/O of its own beyond what those shared
  functions already do (RPC reads, GitHub API, pump.fun metadata).
- **`store.js`**: `makeStore` takes a `DATABASE_URL` (or an injectable `sql`
  tagged-template function, for tests) and exposes `toRow`/`insertClaim`/
  `countSince`. The insert is idempotent on `signature`.
- **`dedupe.js`**: `SeenSignatures`, a bounded in-memory ring so a resubscribe
  or a gap-fill overlapping the live stream never double-processes a claim
  before it even reaches the idempotent insert.
- **`index.js`**: process entrypoint. Wires `ClaimListener` to the decode/
  store pipeline, runs gap-fill on cold start and after every forced
  reconnect, and serves `GET /health`.
- **`backfill.js`**: one-off script. Walks the PumpFees program's signature history
  back N days (default 7) through the exact same `createClaimHandler` pipeline
  the live listener uses, so the table isn't empty on day one. Safe to re-run.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `SOLANA_RPC_URL` | yes | Mainnet HTTPS RPC endpoint. |
| `SOLANA_RPC_WS_URL` | no | Dedicated WSS override; otherwise derived from `SOLANA_RPC_URL` the same way `api/_lib/solana/connection.js`'s `resolveWsEndpoint` does for every other Solana reader in this repo. |
| `DATABASE_URL` | yes | Neon Postgres connection string. |
| `PORT` | no | Health server port, default `8080`. |

## Run locally

```sh
cd services/pump-claims
npm install
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com DATABASE_URL=postgres://... npm start
```

Backfill the last 7 days before the first live run:

```sh
SOLANA_RPC_URL=... DATABASE_URL=... npm run backfill -- --days=7
```

Or as a container, built from the **repo root** (it reaches across into
`api/_lib` and `src/pump`):

```sh
docker build -f services/pump-claims/Dockerfile -t pump-claims .
docker run --env-file .env pump-claims
```

Deploy:

```sh
gcloud builds submit --config services/pump-claims/cloudbuild.yaml .
```

## Tests

```sh
cd services/pump-claims
npm test
```

`pipeline.test.js`, `listener.test.js`, and `store.test.js` run on `node:test`
(not the root vitest suite) and need no live database or RPC endpoint: the
listener's log subscriber and the store's `sql` function are both injectable.
`tests/pump-claims-worker-image.test.js` (root vitest suite) guards the
Dockerfile's `COPY` list against the service's real import graph, transitively
(it caught `api/_lib/pump-claims-github.js -> api/_lib/pump-search.js ->
src/ipfs.js`, a chain a one-hop check would miss).

## Related

- [api/_lib/pump-claims.js](../../api/_lib/pump-claims.js) - `scanFirstClaims`, table-first with RPC fallback
- [api/_lib/pump-events.js](../../api/_lib/pump-events.js) - the typed Pump/PumpFees event decoder this service and the API share
- [api/_lib/pump-claims-attribution.js](../../api/_lib/pump-claims-attribution.js) - the evidence rules and the impersonation hold
- [api/_lib/migrations/20261015080000_pump_fee_claims.sql](../../api/_lib/migrations/20261015080000_pump_fee_claims.sql) - the table this service writes
- [docs/pump-claims-channel.md](../../docs/pump-claims-channel.md) - the channel and API this service feeds
- [services/pump-graduations/](../pump-graduations) - the sibling listener this service's `ClaimListener` pattern builds on
