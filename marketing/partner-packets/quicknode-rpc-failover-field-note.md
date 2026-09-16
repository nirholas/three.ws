# Field note: running a Solana RPC failover chain in production

*three.ws, September 2026. One page, written for the Quicknode Startup Program team and for any
builder running more than one RPC provider. Every sentence below is checked against
[`api/_lib/solana/connection.js`](../../api/_lib/solana/connection.js),
[`api/_lib/solana/rpc-fallback.js`](../../api/_lib/solana/rpc-fallback.js),
[docs/solana.md](../../docs/solana.md), and the production service on 2026-09-16.*

---

three.ws gives AI agents Solana wallets, reads balances for them, and verifies agent-to-agent payments.
All of that is JSON-RPC, and none of it may depend on a single endpoint. Server-side calls build one
priority-ordered chain and rotate past any lane that is rate-limited or cooling down.

**The chain, in order.** An explicit endpoint a call site passes; the operator's `SOLANA_RPC_URL`; a
dedicated Quicknode endpoint when `QUICKNODE_RPC_URL` is set; other keyed providers; operator-supplied
free fallbacks; a curated keyless public set ending with the most-throttled public cluster; and last,
`SOLANA_RPC_LAST_RESORT_URLS`, the metered reserve that serves only when every free lane is down. In
production today the Quicknode endpoint sits in that reserve slot on purpose.

**Lesson 1: dedupe order is policy.** The chain removes duplicate URLs and keeps the first occurrence.
Until 2026-07-28 production named the metered Quicknode endpoint as both `SOLANA_RPC_URL` and the
reserve. It was therefore the primary, took all traffic, and hit its daily cap
(`-32003 daily request limit reached`) while the free lanes sat idle. The fix was configuration: a
reserve URL appears in the reserve list and nowhere else. A second guard stops a bare public-cluster
default (roughly 35 call sites wrote one) from jumping ahead of every paid lane.

**Lesson 2: size the bench to the failure.** `cooldownMsFor()` parks a lane for 6 hours on quota
exhaustion, 30 minutes on a bad key or dead URL, 10 minutes on a plain 429, 2 minutes on a provider
5xx, and 30 seconds on a network error. Park too long and you waste paid capacity; too short and every
caller rediscovers the outage.

**Lesson 3: a 403 is not always a bad key.** Some providers answer HTTP 403 "Request blocked" for one
call shape, such as `getTokenAccountsByOwner` filtered by program, while serving everything else. We
used to bench the whole lane for 30 minutes on it, so routine balance reads evicted a healthy primary.
Now that call fails over alone and only that method is demoted on that endpoint, for 15 minutes.
Deterministic errors such as invalid params never rotate, because every lane would fail them the same
way.

**Lesson 4: breakers must be fleet-wide.** Cooldowns are mirrored through a shared cache, so a new
Cloud Run instance inherits "this lane is out of quota" instead of spending a request to learn it. A
lane-health sensor now reports whether any paid lane is still serving. Before 2026-07-29 the only
sensor watched one provider from per-instance memory, and it missed every paid lane being exhausted at
once. When every lane fails, the last good answer for the same read is served with an
`x-solana-rpc-stale` age header rather than an error.

**What is still hard.** Failover moves load; it does not create capacity. At 16:01Z on 2026-09-16 the
production health check reported all three paid lanes and all nine lanes cooling. A change committed
2026-09-15, not yet deployed, makes the outer wrapper probe once through cooldowns when everything is
parked, after warm instances returned fast 502s while fresh ones reached a healthy lane. The
remaining lever is plan sizing, which is where a provider conversation helps more than code.

*Code: [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), Apache-2.0. Docs:
[three.ws/docs/solana](https://three.ws/docs/solana).*

---

## Source check for every claim

| Claim | Source | Checked |
|---|---|---|
| Chain order, Quicknode slot after `SOLANA_RPC_URL`, reserve last | `solanaRpcEndpoints()` in `connection.js` | 2026-09-16 |
| Quicknode endpoint is in the production reserve list; `QUICKNODE_RPC_URL` and `SOLANA_RPC_URL` unset | `node scripts/read-service-env.mjs` (host name only inspected) | 2026-09-16 |
| The 2026-07-28 misconfiguration and `-32003` | [docs/solana.md](../../docs/solana.md) | 2026-09-16 |
| About 35 call sites with a public-cluster default | docs/solana.md | 2026-09-16 |
| Cooldown windows | Constants at `connection.js` lines 199 to 203; docs/solana.md table | 2026-09-16 |
| Method demotion, 15 minutes | `METHOD_DEMOTION_MS` in `connection.js` | 2026-09-16 |
| Deterministic errors do not rotate | docs/solana.md | 2026-09-16 |
| Fleet-wide cooldowns, lane-health sensor, 2026-07-29 blind spot | `rpcLaneHealth()` comment in `connection.js`; docs/solana.md | 2026-09-16 |
| Last-good serve with `x-solana-rpc-stale` | `serveLastGood()` in `connection.js` | 2026-09-16 |
| All paid lanes and all nine lanes cooling | `GET https://three.ws/api/healthz`, `rpc_lanes` subsystem, `checkedAt` 2026-09-16T16:01Z | 2026-09-16 |
| Recovery-probe change committed, not deployed | Commit `ac1ba86ad` (2026-09-15) is not an ancestor of live commit `58224bd69` from `https://three.ws/api/version` | 2026-09-16 |

**Before sending:** re-run `curl -s https://three.ws/api/healthz` and `curl -s https://three.ws/api/version`.
If the recovery-probe change has shipped, change "not yet deployed" to "deployed on [date]". If the lanes
are healthy, keep the incident sentence but say it was a point-in-time reading.

**Naming rule used here:** other RPC providers are described generically on purpose. Naming them in a
note sent to one provider is unnecessary and would put other companies' outages in writing.
