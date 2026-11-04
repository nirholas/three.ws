# x402 autonomous loop failure baseline, 2026-11-04

Re-measurement of the autonomous loop's failure classes against the code as of
2026-11-04, after the July fixes (per-payment nonce, fresh blockhash, empty-payer
classification, method guard, dance-tip GET, `server/index.mjs` keepAliveTimeout
620s, 402 challenge refresh). Source: production `x402_autonomous_log` (Neon,
SELECT only), Cloud Run logs for `three-ws-api`, live Solana mainnet balances,
`/api/healthz`. Scope rule from work order 267: a class at or below 1 percent of
the 48 hour calls is recorded and left alone; `fee_runway_exhausted` belongs to
work order 902.

## Pre-fix distribution (48h window, 2026-11-02 02:56Z to 2026-11-04 02:54Z)

24,387 calls. Error strings carry payloads (`fee_runway_exhausted:3570355+10000>3578558`),
so classes are grouped on the text before the first colon.

| Class | Calls | Share | In scope |
|---|---:|---:|---|
| ok | 19,438 | 79.71% | |
| fee_runway_exhausted | 2,939 | 12.05% | no, order 902 |
| insufficient_payer_usdc | 394 | 1.62% | **yes, fixed below** |
| http_503 | 235 | 0.96% | no (below 1%) |
| missing_fee_payer | 235 | 0.96% | no (below 1%) |
| resolve_http_404 | 216 | 0.89% | no |
| sponsor_fee_wallet_floor | 148 | 0.61% | no |
| settlement fee_wallet_below_floor | 106 | 0.43% | no |
| http_400 | 106 | 0.43% | no |
| http_502 | 85 | 0.35% | no |
| not_settled | 76 | 0.31% | no |
| rpc_error | 76 | 0.31% | no |
| http_501 | 61 | 0.25% | no |
| breaker_tripped | 47 | 0.19% | no |
| settlement paced | 45 | 0.18% | no |
| everything else (17 classes) | 130 | 0.53% | no |

### Classes from the July briefs

| Class | July 2026 (48h) | Now | Status |
|---|---:|---:|---|
| http_502 | 20,030 | 85 (48h), 189 (7d) | resolved by the keepAliveTimeout fix |
| http_405 | 3,026 | 0 (7d) | resolved (dance-tip GET, method guard) |
| http_400 | 2,798 | 106 | below threshold |
| http_402 with payment | 1,911 | 1 (48h); 8,258 (7d) | resolved inside the window by the challenge refresh (`api/_lib/x402/challenge-refresh.js`, `tests/x402-challenge-refresh.test.js`) |
| sponsor_sol_floor | 2,527 | 0; successor `sponsor_fee_wallet_floor` 148 | below threshold |
| wallet_unconfigured | 471 | 0 across the whole retained table (261,199 rows since 2026-10-04) | resolved; a roster persona without a wallet now resolves to `null` in `ensureRosterAgent` and is skipped, so nothing emits this class |
| insufficient_payer_usdc | n/a | 394 | fixed below |

### Pipelines, 7 days

| Pipeline | ok | total |
|---|---:|---:|
| ring-tick ("Ring Tick") | 3,513 | 3,842 |
| ring-agents | 3,350 | 6,492 |
| agents (float top-up, pool funding) | 6,335 | 6,336 |
| reliability | 14,014 | 15,834 |
| volume | 9,581 | 16,238 |
| health | 1,852 | 13,502 |
| oracle | 740 | 6,525 |
| forge (reported separately, rebuilt elsewhere) | 60 | 636 |

Ring Tick, zero successes in July, now settles 91 percent of its calls. It stays
on the roster.

## insufficient_payer_usdc: mechanism and fix

Every row came from one wallet: the curator ring agent
(`b5896140-5d56-4959-85ae-b5d40e2cb643`, wallet `GyDwo9K9wd9re8hpBwkpdSMpX5b9CGq72QYLqZp6bDuX`).
It spent its float on billboard slots and reached 0 USDC at 2026-11-03 00:38Z,
then failed every purchase (`0<50000` billboard, `0<1000` skill-marketplace) for
26 hours. The agora-citizen and endpoint-shopper agents kept being topped up
(`ring_float_move` log lines 2026-11-03 09:19Z, 11:27Z, 2026-11-04 00:53Z); the
curator's last top-up was 2026-11-02 11:24Z.

Live balances at measurement (USDC atomic): treasury `wwwwwDxF…` 60,500;
curator 0; agora-citizen 1,676,000; endpoint-shopper 840,000; seed payer
`X4o2UuVN…` 2,953,718.

Mechanism: `floatTopUp` (`api/_lib/x402/pipelines/ring-rebalance.js`) asked
the treasury for the agent's whole deficit (target 2.0 minus balance) in one
transfer. The treasury-to-payer sweep runs every 60 s with a 0.1 USDC threshold
and holds the treasury between 0.06 and 1.3 USDC (`ring_rebalance_swept` lines),
so a 2.0 USDC request failed preflight on every run, while agents only ~1.0 USDC
under target still fit in the gaps. The failed move was returned in the run's
`moves` array, which never reaches `x402_autonomous_log`, so the run reported
success.

Fix (test-first, `tests/x402-ring-agents.test.js`, observed failing with
`expected 2000000 to be 1279000` and `orderFloatMembers is not a function`
before the change):

- `planFloatMove` takes `availableAtomic` and caps a top-up to what the treasury
  holds; sweeps are never capped.
- `orderFloatMembers` runs sweeps first (they refill the treasury) and then the
  emptiest agent first.
- `floatTopUp` reads the treasury balance once, decrements it per move, records
  `treasury_short` when a capped move is below the 0.1 USDC minimum, and logs
  `ring_float_move_failed` so a failing transfer is visible in Cloud Run logs.

Landed in commit `c22ef1e01` (swept into a concurrent session's commit together
with unrelated fresh-worker edits; the ring-rebalance, persona-math, persona-kit
and test hunks are this fix).

## Other checks

- **Redis cache:** `/api/healthz` reports `cache: ok, upstash healthy` (SRH proxy
  `three-ws-redis-proxy` in front of Memorystore `three-ws-redis`, READY). 587
  `[cache] redis` fallback lines in 48h, overwhelmingly `SET ... aborted due to
  timeout`, 4 `SRH: Unable to connect`; the per-instance counter showed 4 SET
  failures and 0 circuit opens. Sporadic write timeouts, not an outage; no
  change made. The in-memory fallback in `api/_lib/cache.js` is unchanged.
- **Economy rebalance:** Cloud Scheduler `cron--api-cron-economy-rebalance`,
  `*/30 * * * *`, ENABLED, last attempt 2026-11-04 06:00Z.
- **RPC lanes:** healthz showed `rpc_lanes: degraded`, both paid lanes cooling
  (Helius back in 6h). Accounts for some of the `rpc_error` rows; below threshold.
- **Revenue readout:** `npm run readout:revenue` not run; the settle rate above is
  read directly from the log table.

## Predicted post-fix (after deploy, two loop windows)

| Class | Pre-fix | Predicted |
|---|---:|---:|
| insufficient_payer_usdc | 1.62% | under 0.2% (only transient, between a spend and the next 120 s top-up) |
| ok | 79.71% | about 81% (curator's ~390 calls per 48h settle) |
| fee_runway_exhausted | 12.05% | unchanged, order 902 |
| every other class | at or below 0.96% | unchanged |

## Post-deploy re-measurement

Pending the owner deploy (`git push threews main`, then `npm run deploy:gcp:full`).
Re-run after two full loop windows:

```sql
select case when success then 'ok' else split_part(error_msg, ':', 1) end c, count(*)
from x402_autonomous_log where ts > now() - interval '48 hours' group by 1 order by 2 desc;
```

and confirm `ring_float_move` lines for agent `b5896140-…` in Cloud Run logs.
