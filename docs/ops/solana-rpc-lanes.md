# Solana RPC lanes: diagnosis, capability, and failover

Every Solana read and every x402 settle in production goes through one rotating
endpoint chain built by `solanaRpcEndpoints()` in
[api/\_lib/solana/connection.js](../../api/_lib/solana/connection.js). When that chain
misbehaves the symptoms are never a clean outage: intermittent 502/503/504 on on-chain
routes, `broadcast_failed` settles, holder gates that refuse a real holder, and a settle
rate that sags without any wallet actually being empty.

This runbook is the whole-tier view. For the single log signature see the `rpc_lanes`
section of [production-log-triage.md](production-log-triage.md); for the money side see
the settle-floor and dispersion notes in the same file.

## Diagnose the whole tier in one sweep

```sh
node --env-file=.env scripts/probe-rpc-lanes.mjs          # lane x method matrix
node --env-file=.env scripts/probe-rpc-lanes.mjs --ws      # also probe logsSubscribe
node --env-file=.env scripts/probe-rpc-lanes.mjs --json    # machine-readable
```

[scripts/probe-rpc-lanes.mjs](../../scripts/probe-rpc-lanes.mjs) resolves every lane in
the exact order `solanaRpcEndpoints()` does, then probes each one against the call
shapes production actually makes: `getLatestBlockhash`, `getBalance`,
`getSignatureStatuses`, `getTokenAccountsByOwner` (programId filter),
`getProgramAccounts`, `getAccountInfo`, and `simulateTransaction` as a read-only
stand-in for `sendTransaction`. It prints the matrix, then every refusal verbatim with
its JSON-RPC code, then a per-lane verdict: `safe as primary`, `usable, NOT safe as
primary - missing <methods>`, `quota spent`, `key rejected`, or `DEAD`. It exits 1 only
on `DEAD` (serves nothing and gives no reason), so a routine daily cap does not cry
wolf. It classifies refusals by importing `isMethodRefusal` from the router itself, so
the matrix and the breaker cannot drift apart.

Measured 2026-08-01 (10 lanes, 8 shapes with `--ws`):

| Lane | shapes served | verdict |
|---|---|---|
| MagicBlock | 7/8 | safe as primary (refuses `getProgramAccounts`) |
| `api.mainnet-beta.solana.com` | 7/8 | safe as primary (refuses `getProgramAccounts`) |
| Alchemy (both apps) | 6/8 | safe as primary; `getProgramAccounts` over CU/s cap |
| PublicNode | 5/8 | not a primary: refuses `getTokenAccountsByOwner` |
| Tatum (both hosts) | 2/8 | free tier gates balance + token + program reads |
| Leo RPC | 2/8 | thin, high latency |
| QuickNode | 0/8 | quota spent (`-32003` daily cap) |
| Helius | 0/8 | quota spent (bare HTTP 429) |

Only MagicBlock and `api.mainnet-beta.solana.com` served `logsSubscribe`.

To probe by hand instead, use a **metered** method on every configured lane:

```sh
gcloud run services describe three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 --format=json \
| jq -r '.spec.template.spec.containers[0].env[]
         | select(.name|test("SOLANA_RPC_URL|SOLANA_RPC_FALLBACK|SOLANA_RPC_FALLBACKS|SOLANA_RPC_LAST_RESORT"))
         | .value' \
| tr ',' '\n' | sed '/^$/d' | while read -r url; do
    printf '%s  ' "$(printf '%s' "$url" | sed -E 's#(api[-_]key=|/v2/)[A-Za-z0-9_-]+#\1***#g')"
    curl -s --max-time 10 "$url" -X POST -H 'Content-Type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"getBalance","params":["WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW"]}' \
    | head -c 160; echo
  done
```

**Never probe with `getHealth`.** It is unmetered and returns `ok` on an endpoint whose
plan is hard-exhausted, which is exactly how a dead tier reads as healthy.

Exhaustion is worded differently by every provider, and the wording is what the breaker
classifies on:

| Provider | Signature | Window |
|---|---|---|
| Helius | HTTP 429 `max usage reached` (also `{"code":-32429,...}`) | plan, until topped up (see the probe note below) |
| QuickNode | HTTP 429 + `{"code":-32003,"daily request limit reached"}` | daily, resets |
| Alchemy | HTTP 429 + `{"code":429,"Monthly capacity limit exceeded"}` | monthly, until the billing month rolls |

## The lanes are not interchangeable

A lane answering `getBalance` does **not** qualify it as a primary. Each free lane
refuses a different subset of methods, and which ones changes without notice.
Re-measured 2026-08-07 (3 samples per cell, p50 of the three):

| Lane | `getBalance` | `getTokenAccountsByOwner` | `getProgramAccounts` | p50 |
|---|---|---|---|---|
| `api.mainnet-beta.solana.com` | 3/3 | 3/3 | 403 IP block | 94ms |
| PublicNode `solana-rpc.publicnode.com` | 3/3 | **20s timeout** | -32010 not indexed | 137ms |
| Leo RPC `?api_key=FREE` | 3/3 | 2/3 (`-32603`) | 429 | 254ms |
| Tatum `api.tatum.io/v3/...` | **-16401 paid only** | **-16401 paid only** | 429 | 58ms |
| Tatum `solana-mainnet.gateway.tatum.io` | **-16401 paid only** | **-16401 paid only** | 429 | 70ms |
| MagicBlock `rpc.magicblock.app/mainnet` | **403 IP block** | **403 IP block** | **403 IP block** | 159ms |

**`api.mainnet-beta.solana.com` is now the best free primary**, and it is the only
keyless lane serving both `getBalance` and `getTokenAccountsByOwner`.

Three lanes that a naive latency ranking would promote are traps:

- **MagicBlock was the recommended primary until 2026-08-07**, when it began answering
  every method with HTTP 403 "Your IP or provider is blocked from this endpoint". It is
  pruned from `FREE_KEYLESS_MAINNET` entirely: a hard egress block never recovers on a
  cooldown, so re-probing it only burns a real request to relearn the block.
- **Both Tatum hosts** are the fastest numbers in the table and the least useful: they
  gate `getBalance` and `getTokenAccountsByOwner` behind a paid plan (`-16401`) and cap
  the keyless tier at 5 requests/minute. They now rank last, behind mainnet-beta.
- **PublicNode** serves `getBalance` perfectly while refusing precisely the calls behind
  $THREE holder gating and token balances
  ([api/\_lib/balances.js](../../api/_lib/balances.js),
  [api/\_lib/coin/holders.js](../../api/_lib/coin/holders.js),
  [api/\_lib/embed-gate.js](../../api/_lib/embed-gate.js),
  [api/scene/gate-check.js](../../api/scene/gate-check.js)), and it does so by *hanging*
  rather than erroring, so each first call costs the full attempt timeout before the
  method demotion parks it. Putting it in front of those readers takes the feature down
  while every dashboard still reads green.

### `getTokenLargestAccounts`: the shape with no free primary (measured 2026-08-12)

Holder distribution reads that shape and nothing else can substitute for it:
[api/\_lib/crypto-token-holders.js](../../api/_lib/crypto-token-holders.js) behind
`/api/crypto/holders`, and the concentration half of `/api/crypto/security`. With
Helius at `max usage reached` and Alchemy at `Monthly capacity limit exceeded` on
the same day, the keyless tail had to carry it, and every lane in front failed in a
different way:

| Lane | `getTokenLargestAccounts` |
|---|---|
| PublicNode | hangs forever (no answer at 35s) |
| `api.mainnet-beta.solana.com` | HTTP 429 |
| Leo RPC | `-32603 Internal JSON-RPC error.` on every call |
| Solana Vibe Station `public.rpc.solanavibestation.com` | serves it; throttles to a few requests, then `-32005` |
| Tatum (both hosts) | serves it, at 5 requests/minute |

Three fixes landed together, and the endpoint went from roughly one success in three
to 8/8 on a warmed instance:

- **`-32603` is now a failover signal** ([classifyRpcBody](../../api/_lib/solana/connection.js)).
  It is the JSON-RPC spec's "internal error", the node's own fault rather than a
  deterministic verdict, so unlike `-32601`/`-32602` the next lane may well serve it.
  Unclassified, Leo's envelope was handed back as though it were the chain's answer
  and the lanes that do serve the shape were never tried.
- **A hang past the attempt bound demotes the (lane, method) pair**, not the lane
  (`throwDisposition`). Charging PublicNode's silent refusal to the whole lane benched
  the free chain's primary for every other method. This is the behaviour this runbook
  already described; before 2026-08-12 the code cooled the lane instead.
- **Solana Vibe Station joined `FREE_KEYLESS_MAINNET`**, behind Leo and ahead of the
  Tatum pair. Verified real mainnet (genesis `5eykt4Us...`, slot within 1 of
  mainnet-beta). Its throttle answers `-32005`, which the capacity classifier already
  parks correctly, so it is depth rather than a primary.

**`-32020` (2026-10-09) is a free failover too.** PublicNode and Solana Vibe Station
keep a short ledger, so a `getSignaturesForAddress` whose `until` or `before` cursor is
older than their history answers `-32020 Transaction <sig> not found` while
mainnet-beta answers the same call normally. Handed back as the chain's verdict, it left
both leak scanners unable to read any controlled wallet for six days once their cursors
aged past PublicNode's window. `classifyRpcBody` now rotates on it with `noPenalty`:
nothing is cooled or demoted, because the same lane serves the method for every cursor
it does hold.

The standing cost is unchanged and is a billing decision, not a code one: while both
metered lanes sit at their monthly ceiling, this shape is served only by throttled
free nodes, so it stays the first read to degrade.

A balance read that cannot reach a lane must never be recorded as a balance of zero.
[scripts/audit-service-wallets.mjs](../../scripts/audit-service-wallets.mjs) reports an
unreadable wallet as `‼ unreadable`, and
[scripts/gcp-triage.mjs](../../scripts/gcp-triage.mjs) classifies that as `investigate`,
never as the `owner` "fund this wallet" finding. On 2026-08-07 the older behaviour turned
one throttled lane into four fake below-floor money emergencies.

[scripts/audit-wallet-flows.mjs](../../scripts/audit-wallet-flows.mjs) follows the same
rule as of 2026-08-11. It used to coerce every wallet in a chunk whose lane threw to
`0`, so a single failed chunk silently shrank the fleet total by whatever those wallets
held and still exited clean. It now leaves them unread, excludes them from every total,
lists them under `UNVERIFIED`, and exits `2`. A `null` account inside a *successful*
`getMultipleAccounts` response is still a real zero: that account does not exist on
chain. Only a call that threw is an unread.

Both audits prune hosts with a hard egress block from their own lane chains rather than
trusting `SOLANA_RPC_URL` blindly, because that var still points at MagicBlock in `.env`
and on the Cloud Run service. Pointing an audit at a 403 lane is how it came to read
every wallet as empty in the first place.

## Why a refusal must rotate, and when it must not

The breaker splits JSON-RPC errors into two classes:

- **Provider-specific** (capacity, quota, auth, tier gate, policy block). The next lane
  serves the same call, so rotate.
- **Deterministic** (invalid request, method not found, genuinely invalid params, tx
  simulation failed). Every lane fails it identically, so rotating just burns the chain.

Three real phrasings sat on the wrong side of that split until 2026-07-30, each fixed in
`connection.js` and locked down in
[tests/solana-rpc-priority-and-breaker.test.js](../../tests/solana-rpc-priority-and-breaker.test.js):

1. **Alchemy's monthly cap matched no quota phrase.** It took the 10 minute transient
   cooldown instead of the 6 hour quota one, so a lane that could not answer until the
   billing month rolled over re-entered rotation every ten minutes. It was also
   `SOLANA_RPC_URL`, so nearly every Solana call in production began by failing over
   (236 lane failures in 6h).
2. **PublicNode `getProgramAccounts` answers HTTP 200** with
   `{"code":-32010,"… excluded from account secondary indexes; this RPC method
   unavailable for key"}`. A 200 fires no status-driven rotation and `-32010` was not a
   capacity code, so the error surfaced to the caller instead of failing over.
3. **PublicNode `getTokenAccountsByOwner` answers `-32602`** with `"Request blocked.
   Details: blocked parameter: params.1.programId"`. That is a `-32602` which is *not*
   invalid params. Only the wording separates it from a genuine client error, which is
   why the matcher keys on text and a real invalid-params error still refuses to rotate.

Cooldown windows are asymmetric and worth knowing: quota 6h, rate limit 10m, auth 30m,
5xx 2m. One quota trip removes a premium lane for six hours. The one exception is the bare
429 `max usage reached`: Helius words a per-second burst and a spent plan identically, so
the first sighting parks the lane for a 30s probe only, and the 6h quota window applies
when the lane fails with the same body again before it has served a request
(`markEndpointCooldown`, `clearEndpointStreak`). A burst no longer takes the whole
Solana tier offline for six hours. Verdicts are published to
the shared cache (`rpccool:v1`) so a cold Cloud Run instance inherits them instead of
re-burning a request against a provider already over its cap.

## A refusal demotes the METHOD, not the lane

Benching a lane because it refused one call shape is the wrong disposition, and it was
the live behaviour until 2026-08-01. Two defects compounded: the rotating fetch read the
response body only on a 429, so on PublicNode's `403 blocked parameter` the classifier
saw an empty string and fell through to the **auth** branch, parking a healthy free
primary for 30 minutes on traffic the balance readers generate constantly. The rotation
then cascaded onto the exhausted paid lanes the free chain exists to protect.

The router now tracks capability per `(lane, method)`:

- A refusal demotes that pair for **15 minutes**. The lane keeps serving every other
  shape and never enters cooldown. It is never an auth fault.
- Endpoint selection runs three passes: skip cooling + skip demoted, then forgive
  cooling, then forgive both. The widest pass exists so stale bookkeeping can never
  strand a request that every lane has refused at some point.
- A JSON-RPC batch is skipped on a lane demoted for **any** method it carries: one
  refused member breaks the whole reply.
- Demotions are process-local by design. Re-discovering one on a cold instance costs one
  request that transparently fails over; re-discovering a quota block costs a request
  against a plan already over its cap, which is what keeps a daily cap pinned. That
  asymmetry is why the quota verdict is fleet-shared and this one is not.

**Breadth is what separates a policy block from a ban.** `Your IP or provider is blocked
from this endpoint` is emitted per-method by MagicBlock and `api.mainnet-beta.solana.com`
(for `getProgramAccounts` alone, while serving six other shapes) **and** caller-wide by a
node that has genuinely banned our egress. The wording is identical, so the text cannot
decide it. A lane that accumulates **4 or more** distinct demotions is refusing the
caller, not the call, and takes the full auth-window lane bench, published fleet-wide.
Four is the threshold because the widest legitimate refusal set we run is three (Tatum's
free tier gates three shapes while still serving `getLatestBlockhash` and
`getSignatureStatuses`, which are worth keeping).

## Reading the cooldown state instead of re-diagnosing it

`rpc_lanes` reports which lanes are parked and when each returns, on `/api/healthz` and
on the public [/status](https://three.ws/status) page:

```sh
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[] | select(.name=="rpc_lanes")'
```

The `detail` line carries a census (`1/3 paid lanes serving; mainnet.helius-rpc.com back
in 4h12m, …`) and the `lanes` array carries `recoversAt` (absolute, so a cron-parked
snapshot stays true), `recoversIn`, `paid`, and `blockedMethods` per lane. URLs are
masked to scheme + host, so no API key leaves the process. A quota cooldown clears
itself: read these before concluding the tier is dead.

## Config traps

- **A reserve named anywhere else is not a reserve.** `solanaRpcEndpoints()` dedupes to
  the FIRST occurrence, so a URL in both `SOLANA_RPC_URL` and
  `SOLANA_RPC_LAST_RESORT_URLS` is the primary and absorbs 100% of traffic until its cap
  blows. A reserve must appear in `SOLANA_RPC_LAST_RESORT_URLS` and nowhere else.
- **`ALCHEMY_API_KEY` is not the Solana Alchemy lane.** The Solana URL lives inside
  `SOLANA_RPC_FALLBACK_URLS`; `ALCHEMY_API_KEY` stays load-bearing for EVM and NFT paths
  even when Solana capacity is spent, so do not remove it to "clean up". Since 2026-09-09
  the EVM balance read in [api/\_lib/balances.js](../../api/_lib/balances.js) has a keyless
  rung behind it (public EVM RPC for native value, Blockscout for token discovery), so a
  spent Alchemy quota degrades a portfolio instead of answering 503, but the key is still
  the fast path and the only one that covers every chain.
- **Update single keys with `--update-env-vars`.** `--set-env-vars` replaces the entire
  env set on the service.

## Recovery

```sh
# Repoint the primary at a healthy lane (config only, takes effect on the new revision).
# Re-probe with the capability table above before picking one: the right answer
# changes as free providers gate methods. As of 2026-08-07 mainnet-beta is the only
# keyless lane serving getBalance AND getTokenAccountsByOwner.
gcloud run services update three-ws-api --region us-central1 \
  --project aerial-vehicle-466722-p5 \
  --update-env-vars SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```

Then confirm the tier view recovered:

```sh
curl -s https://three.ws/api/healthz | jq '.subsystems.subsystems[] | select(.name=="rpc_lanes")'
```

Beyond that, only two things actually clear a quota: **money** (top up or upgrade the
plan) or **less volume** (`X402_RING_TICK_CONCURRENCY` and the ring cadence knobs, which
are config-only and free). Everything else just moves which free node absorbs the
throttling.

### Confirmation poll cadence (the hottest RPC consumer we control)

Every server-signed send, x402 settle, and launch confirms through
`pollConfirmation()` in [api/\_lib/solana/confirm.js](../../api/_lib/solana/confirm.js).
At a flat cadence over the 90s ceiling, one transaction that never lands costs ~75
`getSignatureStatuses` calls plus ~25 `getBlockHeight` calls, and a transaction that
never lands is exactly what happens when the tier is throttled, so the flat cadence spent
the most requests precisely when requests were scarcest.

It now serves the opening polls at the base cadence (where nearly every healthy confirm
lands, so the common path is unchanged) and backs off geometrically after that. Same 90s
ceiling, roughly a third of the requests. All four knobs are read per call, so retuning
is a config-only `--update-env-vars` with no rebuild:

| Var | Default | Meaning |
|---|---|---|
| `SOLANA_CONFIRM_POLL_INTERVAL_MS` | `1200` | opening cadence |
| `SOLANA_CONFIRM_FAST_POLLS` | `3` | polls at that cadence before backing off |
| `SOLANA_CONFIRM_POLL_BACKOFF` | `1.5` | multiplier per poll after that (clamped to >= 1) |
| `SOLANA_CONFIRM_POLL_MAX_INTERVAL_MS` | `6000` | ceiling (clamped to >= the base) |

Expiry is decided against the ledger, not the node's recent-status cache. Once the block height passes `lastValidBlockHeight` with no status seen, `pollConfirmation()` asks `getSignatureStatuses` with `searchTransactionHistory`. A transaction found there resolves (or surfaces its revert), an RPC error on that lookup retries on the next poll, and only a ledger miss throws `tx_expired`. A caller can therefore trust `tx_expired` as "never landed" before it rebroadcasts.

**GCP credits cannot help here.** Blockchain Node Engine is Ethereum-only and the
BigQuery `blockchain-analytics-*` datasets are EVM chains plus analytics, so the standing
"prefer GCP, credits are pre-approved" rule has nothing to offer this lane. Do not spend
time re-checking it.

## When every lane fails at the wire

Ten unrelated hosts do not die in the same millisecond. On 2026-08-27 the fleet
logged `all 10 endpoints failed this request, fetch failed` about 2,000 times an
hour while a direct probe of the same lanes from the same region answered fine:
when every lane fails with a transport error (DNS, refused socket, reset) inside
one request, the weather is on our side of the wire (instance egress, resolver,
socket pool) and it clears in well under a second. `connection.js` stacks three
answers, cheapest first:

- **The error names the errno.** A thrown fetch carries the undici cause code
  (`ECONNRESET`, `EAI_AGAIN`, `ENOTFOUND`, ...) and the lane it died on, so
  `fetch failed` alone no longer sends a reader hunting for a week. `EAI_AGAIN` is
  a resolver problem, `ECONNRESET` a socket one.
- **One jittered re-sweep.** When the first sweep was transport-only, every lane
  is tried once more after a 250-700 ms pause. An HTTP 429 or a quota body is a
  verdict about the lane, not the wire, and never triggers it.
- **A TLS refusal is a lane verdict too.** A handshake alert or an untrusted
  certificate (`ERR_SSL_*`, `ERR_TLS_*`, `CERT_*`, see `isTlsLaneFault`) means the
  connection reached the provider and the provider's own TLS terminator said no;
  every retry gets the same answer. Those lanes cool for 30 minutes (published to
  the fleet) and never arm the re-sweep. On 2026-10-08 a disabled QuickNode
  endpoint in `SOLANA_RPC_LAST_RESORT_URLS` answered every handshake with
  `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR`; read as a 30-second blip it re-qualified
  twice a minute, was the last lane standing whenever the rest were cooling, and
  re-hammered the 429-cooling free lanes on every request through the re-sweep.
  If `curl -v` against a lane ends in `TLS alert, internal error`, the endpoint is
  dead: remove or replace it in the service env.
- **Last-good reads instead of a 502.** Idempotent read methods (`getBalance`,
  `getAccountInfo`, `getMultipleAccounts`, `getTokenAccountsByOwner`,
  `getTokenLargestAccounts`, `getProgramAccounts`, `getSignaturesForAddress`,
  `getTransaction`, the DAS `getAsset*` family, and a few more) answer from the
  last body a lane returned for the identical call, kept in the shared cache for
  15 minutes and marked with an `x-solana-rpc-stale` header carrying its age in
  ms. Blockhash and slot reads are excluded on purpose: a stale blockhash
  produces a transaction that fails later and worse. A success republishes its
  body at most once a minute per call shape, so the steady state costs one cache
  write a minute per distinct read, not one per RPC call.

A batch that a lane refuses for its own per-batch cap (`maximum number of calls
in a batch`, `batch too large`) is split into at most 64 single requests, four at
a time, instead of failing the whole call; the cap is remembered per (lane,
method) for 30 minutes so the next batch goes straight to the split, and a batch
too wide to split rotates to a lane that takes it whole.
[tests/solana-rpc-transport-fallback.test.js](../../tests/solana-rpc-transport-fallback.test.js)
and [tests/solana-rpc-rotating-fetch.test.js](../../tests/solana-rpc-rotating-fetch.test.js)
pin this behaviour.

## Fewer calls: coalescing, the fresh-read cache, and spend accounting

Five mechanisms in `connection.js`, [api/\_lib/solana/shared-reads.js](../../api/_lib/solana/shared-reads.js)
and [api/\_lib/solana/rpc-spend.js](../../api/_lib/solana/rpc-spend.js)
cut and attribute quota spend before a lane is ever picked:

- **Coalescing.** Identical concurrent reads (same method and params, commitment included,
  JSON-RPC id excluded) share one upstream promise, so a burst of page loads reading the
  same balance costs one call.
- **Fresh-read cache.** A successful live answer to a hot read is reused for a few seconds
  per method (`getLatestBlockhash` 2s, `getBalance` / `getAccountInfo` /
  `getMultipleAccounts` / `getTokenAccountsByOwner` / `getTokenAccountBalance` 4s,
  `getTokenSupply` / `getTokenLargestAccounts` 5s, network constants 60s; finalized
  `getSignatureStatuses` 30s). It is process-local on purpose. Writes, batches, errors,
  stale last-good answers and any caller passing `fresh: true` (settle, send and verify
  paths) bypass it, and a devnet connection is never handed a mainnet answer.
- **Fleet-wide shared reads.** The fresh-read cache is per instance, so a client scanning
  one mint across `/api/crypto/holders`, `/security`, `/bonding` and `/whales` within a few
  seconds paid for the same reads once per Cloud Run instance it landed on.
  `sharedRpcRead()` keeps public, non-money reads in the shared cache (`rpcshared:v1`,
  keyed by method and params): the mint `getAccountInfo` and `getTokenLargestAccounts`
  for 30s, the holder-owner `getMultipleAccounts` for 120s, the metadata PDA for 300s.
  Only a live, error-free envelope is stored; a stale last-good answer is returned but
  never republished. `/api/crypto/security` also keeps its whole verdict per mint
  (`crypto:security:v1`): fresh for 60s, then served marked stale for up to 6h while
  every source is down. Never route a balance a settle, send or verify acts on through it.
- **Spend accounting.** Every upstream call is counted under (caller, method, lane) in
  hourly buckets in the shared cache (`rpcspend:v1`). The caller is the API route template
  or cron path (`script:<name>` outside the API server); `cache` and `coalesced` are
  pseudo-lanes reported as saved, never as calls. Readers that POST to a lane URL
  directly instead of going through the rotating fetch (the Helius DAS walk in
  `balances.js`, `getSplTokenBalance` in `embed-gate.js`) call `noteRpcSpend(url, body)`
  first so their calls are counted too. Read it to find who spent a quota event:
  `GET /api/ops/rpc-spend?hours=1..48&top=1..100` (ops secret or admin session) ranks
  the (caller, method) pairs and lists per-lane totals and budgets, and
  `node scripts/rpc-spend-report.mjs --base https://three.ws --hours 6` prints the same
  board from a terminal with `OPS_SECRET`.
- **Per-lane daily budget guard.** `RPC_LANE_BUDGETS` is a JSON object keyed by lane host
  whose value is the daily call quota or `{ "daily": n, "fraction": f }`. Once fleet calls
  for the UTC day cross `fraction x daily` (default `RPC_LANE_BUDGET_FRACTION`, else 0.8),
  non-money callers try that lane last so the remainder is kept for settles, sends and
  verifies. Unset, the guard is off; invalid JSON logs a warning and disables it. Saved
  reads (`cache`, `coalesced`) never count against a lane. Pinned by the lane budget guard
  suite in [tests/solana-rpc-priority-and-breaker.test.js](../../tests/solana-rpc-priority-and-breaker.test.js).
- **Attempt cap per non-money request.** A read that is not on a money path (no
  `fresh: true`, not `sendTransaction`/`simulateTransaction`/`requestAirdrop`) tries at
  most `RPC_READ_MAX_ATTEMPTS` lanes (default 3) across the cooldown passes, and at most
  that many again in the one egress re-sweep, then falls back to last-good or a clean
  error. Before the cap, a read arriving while every lane cooled walked the whole chain in
  the cooldown-forgiving pass, so each routine read cost up to 11 provider calls and
  re-armed the bench on lanes that were already exhausted. Money callers still walk every
  lane. Pinned by [tests/solana-rpc-attempt-cap.test.js](../../tests/solana-rpc-attempt-cap.test.js).
- **Health detail.** `/api/healthz` and `/api/ops/health` carry the same ledger in the
  `rpc_lanes` subsystem: the detail line ends with `N calls/24h, top <caller> (<n>)`, and
  the metrics hold `calls_24h`, `saved_24h`, `top_caller`, `top_caller_calls_24h`, plus
  `calls_24h` on every lane row. The ledger read is capped at 1.5s; when the cache is
  unreachable the metrics say `spend: "unavailable"` and the lane verdict is unaffected.

### Measured offenders and the source cuts (2026-11-04)

The ledger did not exist yet in production, so the baseline was measured from the Cloud
Run request log for one full hour (2026-11-04 10:00 to 11:00 UTC, `gcloud logging read`
on `three-ws-api`), with each route mapped to the RPC reads its handler makes:

| Route                      | Requests/h | RPC reads per uncached request                                               | Notes                                                  |
| -------------------------- | ---------: | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| `/api/crypto/holders`      |      2,089 | 3 (mint `getAccountInfo`, `getTokenLargestAccounts`, `getMultipleAccounts`)  | already had a 60s per-mint result tier                 |
| `/api/crypto/security`     |      1,811 | 3 (mint `getAccountInfo`, `getTokenLargestAccounts`, metadata `getAccountInfo`) | no server cache at all                              |
| `/api/crypto/bonding`      |      1,759 | 0 normally (launchpad HTTP API), RPC only when both HTTP sources miss         | not an RPC offender                                    |
| `/api/crypto/whales`       |      1,654 | 0 (launch feed)                                                              | not an RPC offender                                    |
| `/api/pump/smart-money`    |      1,014 | 0 (database)                                                                 | not an RPC offender                                    |

One client IP sent 87% of that traffic, walking 755 mints and hitting all four
`/api/crypto/*` routes for each one; 67% of same-mint requests arrived within 5 seconds of
the previous request for that mint, on a different route and usually a different
instance. That is why the process-local fresh-read cache could not catch it, and why the
holders and security routes paid for the same mint `getAccountInfo` and
`getTokenLargestAccounts` twice.

The cuts, at the source:

1. **Shared mint reads.** `/holders` and `/security` read the mint account and the largest
   accounts through `sharedRpcRead()` with identical params, so the second route and every
   other instance reuse the first answer for 30s (owners 120s, metadata 300s).
2. **Security verdict cache.** `/api/crypto/security` serves a per-mint verdict for 60s
   (`x-security-cache: hit`), and the last good verdict for up to 6h, marked
   `x-security-stale: 1`, when every source is down.
3. **Holders.** Unchanged result tier; its keyless fallback now rides the shared reads.

Replaying the same hour against the new tiers (every request, in timestamp order, with
the TTLs above) gives:

| Window (UTC)            | Holders + security RPC reads before | After | Reduction |
| ----------------------- | ----------------------------------: | ----: | --------: |
| 2026-11-04 10:00-11:00  |                              10,479 | 5,968 |     43.0% |

The holders baseline assumes the keyless path. When the Helius DAS walk answers, holders
already skipped the largest-accounts and owners reads, so the real saving on holders is
the shared mint read only. **Verify after deploy:** run
`node scripts/rpc-spend-report.mjs --base https://three.ws --hours 24` once a full day has
been recorded and compare `/api/crypto/holders` + `/api/crypto/security` calls against
the 10,479/h baseline (about 251k/day), then record the measured figure here. Check that
`blockhash_expired` in the settle outcomes stays at or below its baseline of 3, since
every send and settle path passes `fresh: true` and never touches these caches.

### Measured after deploy, and the second round of cuts (2026-11-12)

The ledger has been live in production since the 2026-11-04 deploy, so this is the first
measurement from the ledger itself (`node scripts/rpc-spend-report.mjs --base
https://three.ws --hours 24`, window 2026-11-11 16:00 to 2026-11-12 16:00 UTC, 143
instances):

| #   | Caller                                | Method                    | Calls/24h | Saved/24h | Share |
| --- | ------------------------------------- | ------------------------- | --------: | --------: | ----: |
| 1   | `/api/pump-fun-mcp`                   | `getTransaction`          |   249,658 |         0 | 19.1% |
| 2   | `/api/cron/solana-attestations-crawl` | `getSignaturesForAddress` |   140,729 |         0 | 10.8% |
| 3   | `/api/crypto/security`                | `getTokenLargestAccounts` |   102,602 |     2,739 |  7.9% |
| 4   | `/api/crypto/holders`                 | `getTokenLargestAccounts` |    65,022 |     3,885 |  5.0% |
| 5   | `/api/crypto/security`                | `getAccountInfo`          |    64,385 |    25,812 |  4.9% |
| 6   | `/api/crypto/due-diligence`           | `getSignaturesForAddress` |    54,565 |        40 |  4.2% |
| 7   | `/api/crypto/bonding`                 | `getAccountInfo`          |    45,719 |    16,691 |  3.5% |
| 8   | `/api/cron/recompute-reputation`      | `getTokenAccountsByOwner` |    44,156 |         0 |  3.4% |
| 9   | `/api/crypto/holders`                 | `getMultipleAccounts`     |    39,684 |     3,581 |  3.0% |
| 10  | `/api/cron/run-buyback`               | `getTokenAccountBalance`  |    39,544 |         0 |  3.0% |

Total: 1,304,108 provider calls in 24h (about 54,300/h), with 78,828 reads (5.7%) served
by the fresh-read cache and coalescing. Lanes: Helius 361,387, Alchemy 359,805,
mainnet-beta 345,898, publicnode 157,044, the rest under 60k each.

**The 40% target is not met, and the 2026-11-04 baseline cannot be compared one to one.**
Holders plus security made 295,336 calls in the 24h window (about 12,306/h), against the
10,479/h baseline. Request volume halved over the same period: the request log for
2026-11-12 15:00 to 16:00 UTC shows 917 holders and 833 security requests (1,750/h, one
client IP at 97.9% of `/api/crypto/*`), against 3,900/h on 2026-11-04. That works out to
about 7 provider calls per request now, against the 2.69 logical reads per request the
baseline modeled. The gap has two causes. First, the baseline counted logical reads
from handler code, while the ledger counts every lane attempt (`recordRpcSpend` runs
per attempt), so a read that fails over across three lanes counts three times. Second,
both paid lanes spent the window cycling through quota and rate-limit cooldowns. So the
per-request logical saving from shared reads and the verdict cache is real (security
`getAccountInfo` saved 25,812), but failover amplification swamps it while the paid lanes
are exhausted. Settles were unaffected: the self-facilitator's verify reject reasons on
`/api/healthz` show `blockhash_expired` at 0 (baseline 3), since every send, settle and
verify path passes `fresh: true`.

The two top offenders are new, so this round cuts them at the source:

1. **`/api/pump-fun-mcp` claims scan** (`getTransaction` 249,658 against 36,759
   `getSignaturesForAddress`, about 6.8 reads per scan; logically about 15 per poll before
   amplification). A null `getParsedTransaction` (the transaction has not landed on that
   lane yet) now ends the scan the way a failed read already did, instead of reading on.
   The per-poll budget `CLAIM_TX_FETCH_BUDGET` drops from 40 to 12. An incomplete answer is
   now memoized fleet-wide for `CLAIM_INCOMPLETE_MEMO_TTL_S` (5s), so a creator polled
   twice a second costs at most one 12-read scan step per 5s instead of a full-budget scan
   per poll, and a complete answer is reused for `CLAIM_SCAN_MEMO_TTL_S` (30s, up from 10s).
   Per creator, that caps the read rate during a backfill at 2.4/s, against the roughly
   30/s that a 2 Hz poller cost before. Tests: `tests/pump-fun-mcp-claims-cache.test.js`.
2. **Solana agent sweep** (`getSignaturesForAddress` 140,729). The sweep re-read the whole
   directory every 90 minutes at 240 agents per tick (1,440 logical reads/h), and 1,945 of
   the roughly 2,026 agents have had no event in the last week. `nextAgentBatch` now only
   returns agents that are due: active agents (an event within
   `SOLANA_ACTIVE_WINDOW_DAYS`, 7) every `SOLANA_ACTIVE_RECRAWL_MIN` (20 min), dormant ones
   every `SOLANA_DORMANT_RECRAWL_MIN` (240 min). That is about 81 x 3 + 1,945 / 4, or about
   730 logical reads/h, a 49% cut, while active agents are now re-read more often than
   before. The freshness sensor (`api/_lib/ops/index-lag.js`) scores the minutes the most
   overdue agent is past its schedule (`SOLANA_OVERDUE_DEGRADED_MIN` 60,
   `SOLANA_OVERDUE_DOWN_MIN` 240) instead of the median cursor age, which is now multi-hour
   by design. Tests: `tests/agent-index.test.js`.

Deferred, in order of the table: `/api/crypto/security` and `/holders`
`getTokenLargestAccounts` (already shared; the remaining cost is amplification), lane
amplification itself (counting and capping attempts per logical read), `recompute-reputation`
and `run-buyback` (per-mint balance reads that can batch through `getMultipleAccounts`).

**Verify after deploy:** after 24h live, run the report again and record the
`/api/pump-fun-mcp` `getTransaction` and `/api/cron/solana-attestations-crawl`
`getSignaturesForAddress` figures against 249,658 and 140,729, plus the total against
1,304,108.

### Second window and the attempt cap (2026-11-13)

Production was still on commit `0d4c38210` (built 2026-11-11, `/api/version`), so neither
the 2026-11-12 source cuts above nor the attempt cap were live. Revision
`three-ws-api-00533-zjh` of 2026-11-12 was a config-only update. The report for
2026-11-12 15:00 to 2026-11-13 15:00 UTC (94 instances) is therefore a second pre-cut
baseline: 1,265,666 provider calls, 77,887 (5.8%) saved. Top pairs: `/api/pump-fun-mcp`
`getTransaction` 155,947, `/api/cron/solana-attestations-crawl` `getSignaturesForAddress`
132,366, `/api/crypto/security` `getTokenLargestAccounts` 99,536, `/api/crypto/due-diligence`
`getSignaturesForAddress` 71,771. Lanes: Helius 349,935, Alchemy 349,436, mainnet-beta
347,609, publicnode 137,817. The three heaviest lanes taking near-equal shares while the
paid pair sat in quota cooldown is the failover walk itself, which is why the deferred
lane-amplification item landed now as the attempt cap above.

`blockhash_expired` stayed at 0 on `/api/healthz`. Verify did show 0 ok since 2026-11-10
16:01 UTC, but those rejects (`simulation_failed:AccountNotFound` and
`InstructionError [2, InvalidAccountData]`) come from an unfunded x402 sponsor and a
seeder with no USDC account, not from RPC routing. `simulateTransaction` is never cached
or capped, and verifies kept succeeding for four days after the read cache shipped
(revision 00526, 2026-11-06).

**Verify after deploy:** the same 24h report, against 1,265,666 total and the per-pair
figures above. The attempt cap alone should bring holders and security from about 7
provider calls per request back toward the 2.69 logical reads per request the 2026-11-04
model counted.

### Third round of source cuts (2026-11-13)

A third pre-cut window (2026-11-12 17:00 to 2026-11-13 17:00 UTC, 93 instances,
production still on `0d4c38210`) read 1,332,768 provider calls, 83,038 (5.9%) saved.
The `rpc_lanes` health detail agreed: 1,330,689 calls/24h, top `/api/pump-fun-mcp`. The
2026-11-12 deferred list was worked through at the source, each cut test-first:

| Caller | Calls/24h before | What changed | Expected after |
| --- | ---: | --- | ---: |
| `/api/cron/run-buyback` | 45,290 (37,016 `getTokenAccountBalance` + 8,274 `getAccountInfo`) | Every one of the 2,333 runs that day was `skipped` on an empty vault (92 coins), each coin reading its curve and all three vaults one at a time. The sweep now reads every curve, then every buyback vault, in `getMultipleAccounts` batches of 100 (`api/_lib/pump-buyback-prefetch.js`) and records empty or below-threshold coins from that. A funded vault is still re-read fresh before any swap or burn, and a failed batch falls back to the per-coin read. Tests: `tests/pump-buyback-prefetch.test.js`, `tests/run-buyback-lease.test.js`. | about 2 to 4 logical calls per run, under 300/day |
| `/api/crypto/due-diligence` | 72,434 `getSignaturesForAddress` | 67 requests in 12h over 16 mints cost about 540 calls each. Profiles were already shared, but every five-minute recompute re-paged the mint's launch and all twenty holders' first receipts. Both are now shared fleet-wide once complete (`cachedLaunch` 7 days, `cachedAcquisition` 6 hours, keyed by launch slot); unresolved, incomplete or empty answers are never shared. Tests: `tests/token-due-diligence.test.js`. | a repeat mint costs only new holders and funders |
| `/api/cron/recompute-reputation` | 62,427 (43,283 `getTokenAccountsByOwner` + 19,144 `getBalance`) | The cron scored 40 agents every 10 minutes over 1,068 wallet agents, re-scoring each about every 4.4 hours at about 11 calls per score. `listStaleAgents` now skips current-version scores younger than `REPUTATION_RECOMPUTE_MIN_AGE_H` (default 12). A viewed agent still refreshes its durable score on view. Tests: `tests/reputation-recompute-floor.test.js`. | about 89 scores/h instead of 240, about 23k calls/day |

Together these remove roughly 120k calls a day (about 9% of the window) on top of the
2026-11-12 claims and sweep cuts and the attempt cap, none of which are live yet.
Still uncut, in order: `/api/crypto/security` and `/holders` `getTokenLargestAccounts`
(already shared; the residual is amplification the attempt cap addresses),
`/api/cron/economy-reconcile` `getTransaction` (37,758) and `/api/agents/[id]`
`getTokenAccountsByOwner` (30,294).

**Verify after deploy:** the same 24h report against 1,332,768 total, with
`/api/cron/run-buyback`, `/api/crypto/due-diligence` and `/api/cron/recompute-reputation`
against the figures in this table.

## Knock-on effects to expect

RPC starvation does not stay in the RPC layer:

- **x402 settles fail as `broadcast_failed`.** The payer signs against their own RPC, so
  a lagging node of ours has never seen that blockhash and preflight falsely rejects a
  valid payment, after the paid handler already ran. `settleRingPayment()` now resends
  with `skipPreflight: true` for that one error class and lets the validator decide.
- **The treasury self-heal stalls**, which strands the x402 sponsor under its SOL floor,
  which withdraws the Solana accept from every 402 challenge and stops the ring.
