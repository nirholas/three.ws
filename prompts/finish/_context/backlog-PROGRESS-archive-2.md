# backlog-PROGRESS, archive 2 (2026-09-01 to 2026-09-02)

Older entries moved verbatim out of [backlog-PROGRESS.md](backlog-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [backlog-PROGRESS.md](backlog-PROGRESS.md), never here.

## 2026-09-01: retirement sweep, every order re-measured against code and production

Production `ad7b54c16` (2026-08-28), `main` `73c8ccbb7`. Nothing below was taken from
earlier entries in this log; each line was re-read.

Retired (deleted after verification):

- 02 Solana RPC capacity: `scripts/probe-rpc-lanes.mjs` runs and prints the lane x method
  matrix with verbatim refusals; `api/_lib/solana/connection.js` routes per-method
  capability (`blockedMethods`) with `tests/solana-rpc-method-capability.test.js`; healthz
  `rpc_lanes.lanes[]` exposes `recoversAt` / `recoversIn`; `docs/ops/solana-rpc-lanes.md`
  documents the matrix and the `getHealth` trap; changelog 2026-08-02. This log never had an
  entry for 02; the code shipped in `893c9f49d` and `801be9857`.
- 03 Sponsor runway: `api/_lib/x402/sponsor-runway.js` (`measureSponsorBurn`,
  `formatSponsorRunwayAlert`) with `tests/x402-sponsor-runway.test.js` and
  `tests/x402-sponsor-runway-monitor.test.js`; `x402-settle-health.js` separates
  `sponsor_floor` from `rail` and healthz reports `cause: sponsor_floor` today; failed
  reclaims write `inflow_failed` ledger rows (71,998 present); `docs/ops/payment-outcomes.md`
  "The runway alert"; changelog 2026-08-01.
- 04 Benchmark run: `GET /api/fact-check-benchmark` answers `ran: true`,
  `source: "database"`, 40 claims, generated 2026-08-10; `docs/fact-check.md` documents the
  bypass; changelog 2026-08-02 (two entries). Observation for the next accuracy pass: the
  weekly cron's lock key was touched 2026-08-31 but `latest_run` has not advanced since
  2026-08-10, and the live score is 40%, not the 55% recorded above.
- 06 LLM lanes: `tests/api/llm-free-chain-reachability.test.js` injects transport failures
  on every free rung; `scripts/audit-llm-metering.mjs` + `api/_lib/llm-metering-rule.js`
  fail a lane that reports $0 with traffic; `docs/ops/llm-lanes.md` carries the key-arrival
  command and the corrected Vertex Claude status; the OpenRouter Claude mirror is behind
  `isPaidModel()` and off by default; changelog 2026-08-02. Owner rows unchanged
  (Model Garden terms, OpenAI billing, OpenRouter funding, revoke fallback key #1).

Kept, with the measured reason:

- 01: `x402_settle` 5.9% with `cause: sponsor_floor`; `fee_runway_exhausted` is 98% of
  failures since boot. The recurrence guard, fee admission, key rotation and their tests are
  all live. Still open in code: `reclaimIdleAgentSol` in `api/_lib/economy-sweepback.js`
  returns the dry-run plan before `recoverSolanaAgentKeypair` runs, so the plan still counts
  sealed wallets. Owner: fund the sponsor wallet.
- 05: `ISSUES.md` item 9 still open; `scripts/set-r2-cors.mjs` is ready; needs the R2 admin
  token in `.env.local`.
- 07: testnet config endpoint answers `deployed: false`; `contracts/.env` does not exist, so
  the 2026-08-02 throwaway deployer has no key here and its on-chain balance is zero. Any
  funding must go to a freshly generated key.
- 08: the chat-bot worker directory is committed with its Cloud Run config and 29 tests;
  `bot_heartbeat` has no row for it and healthz reports "no heartbeat reported yet", so the
  host has never run. Owner: the deploy, the OTP login, an AI-provider key on the service.
- 09: premise is a sibling repository that is not present in this workspace; unverifiable
  from here. The 2026-08-01 entry above claims both feeds run on Cloud Run; nothing in this
  repo can confirm or refute that.
- 10: upstream pull request merged 2026-08-11 (state MERGED, checks green); live
  `/discovery/resources` paging and `/supported` match what it registered. Verified shipped.
  The file's content and this pack's index row sit behind the CLAUDE.md commit gate, so the
  deletion waits for the owner's yes; nothing else remains.

## 2026-09-02: 01 x402 settle runway (the phantom reclaim plan is fixed; capital is still the whole remaining story)

Measured live at 05:19 UTC, prod `ad7b54c16` / revision `three-ws-api-00404-ph7`
(107 commits behind `main`, so nothing below ships until the next deploy):

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **degraded, 55.0%** (55/100 paid attempts, 3h), `cause: sponsor_floor` | `GET /api/healthz` |
| Since-boot settle book | ok 1,709 / failed 50,575: `fee_runway_exhausted` 48,788, `fee_wallet_below_floor` 1,259, `not_confirmed` 371, `broadcast_failed` 20 | same, `x402.self_facilitator` |
| Governed skips in window | 1,220 against 45 rail faults and 175 `no_solana_accept` | same, `x402_settle.metrics` |
| Sponsor fee wallet `Wwwu…T3WwW` | 0.003727883 SOL, spendable 1,727,883 lamports over a 2,000,000 floor | `GET /api/x402/runway-lab` |
| Ring payer `X4o2…stML` | 1,998,408 lamports, i.e. **1,592 lamports under the floor** | same, and the live refusal string `fee_wallet_below_floor:1998408<2000000` |
| Live governor config | `runway_days: 1`, `min_budget_lamports: 10,000,000`, `governor_enabled: true`, intraday pacing ON | same, `config` |
| Measured burn | `fee_total_lamports` 13,327,231 over 24h = **0.0133 SOL/day spent**; median fee 10,001 lamports | same, `observed` |
| Demand | 177 attempts/hour = ~4,248/day, against `projected_settles_per_day` 172 | same |

Three corrections to the work order, all measured:

1. **Levers 1 and 2 are already applied in production.** `runway-lab` reports
   `runway_days: 1` today, and the 2026-08-01 entry above records
   `ECONOMY_MASTER_OPERATING_SOL=0.3` landing with it. Do not re-apply them, and
   do not size anything from lever 2: at a 0.0037 SOL balance the 10,000,000
   lamport heartbeat floor already exceeds spendable, so runway days are inert
   (the 2026-08-02 entry struck this lever for the same reason).
2. **The headline is no longer 25.9% or 5.9%.** Settle is 55.0% and the
   subsystem is `degraded`, not `down`. `fee_runway_exhausted` still dominates
   the since-boot book, but that book has never been reset; in the live 3h
   window the split is 1,220 governor skips, 175 withdrawn Solana accepts, 45
   rail faults. The fee-admission gate shipped 2026-08-01 is doing its job:
   unfundable calls are refused in one step instead of after five RPC round
   trips.
3. **Demand has collapsed to 177/hour** from the 3,726/hour of 2026-08-02, so
   the honest funding ask is now ~0.043 SOL/day to serve every attempt
   (4,248 x 10,001 lamports), not the 0.45 SOL/day that entry quoted. 1 SOL is
   roughly three weeks at current demand. The "1 to 2 SOL/day" figure the work
   order warns about is still wrong, by more than the order of magnitude it says.

Did (the one agent-doable item the 2026-09-01 sweep left open in code):

- **`reclaimIdleAgentSol` no longer advertises SOL it cannot move.**
  `api/_lib/economy-sweepback.js` returned the raw `planAgentReclaim` output in
  dry-run mode without ever touching a wallet key, so the 8 custodial wallets
  sealed under the WALLET_ENCRYPTION_KEY retired in the 2026-07 migration were
  reported as reclaimable on every tick while the real leg failed all of them at
  the recover stage. The recover-and-verify step is now a function both modes
  call: the dry run opens each planned wallet's key (passing NO audit context, so
  a plan-only read on the every-minute economy tick does not write a custody row
  per wallet), drops the ones that do not decrypt into `failed` at stage
  `recover`, and sums `reclaimedSol` from the survivors. `agent_reclaim.failed`
  in the `?dry=1` response now carries them, so the existing blocked-vs-nothing
  classification in `api/cron/treasury-topup.js` sees the same truth a real run
  would.
- **Recurrence guard, with a test.** `tests/economy-reclaim-dryrun-key-gate.test.js`
  (7 cases) pins dry/real parity on which wallets are unreachable, that
  `reclaimedSol` counts only openable wallets, that a fully sealed fleet plans
  nothing at all, the address-mismatch case, and that the dry run signs nothing
  and writes no custody row.
- **The healthz hint that produced the loop is corrected.** The `sponsor_floor`
  hint ended at "Owner SOL is needed only when every reclaim source reports
  `at_or_below_floor`". A sealed wallet reports `secret_undecryptable` and never
  `at_or_below_floor`, so that sentence read as "the cron will fix it" for a
  condition no cron can fix, which is exactly what two earlier sessions
  concluded. It now names `agent_reclaim.failed`, `secret_undecryptable` and
  `WALLET_ENCRYPTION_KEY`, with a test in
  `tests/api/x402-settle-health.test.js` that fails if the old promise returns.
- Runbook step 3 in `docs/ops/payment-outcomes.md` updated to match, plus a
  `data/changelog.json` entry (`fix`, `infra`) and `npm run build:pages`.

Verification: `check:rules` clean on the 6 touched paths, `audit:docs` clean,
`test:gate` and `test:gate-3d` green (559 + gate suites), targeted suites 96/96.
`npm run gate` does NOT pass end to end in this worktree, and none of it is this
change: `audit:mcp`, `audit:mcp-golden` and `audit:mcp-safety` fail on
`packages/{herald,knock,metaplex-agent}-mcp`, `audit:routes` on
`/events/build-3d-agents-live`, `audit:links` on `pages/tty.html`,
`pages/knock-door.html`, `src/api.js`, `src/avatar-artifact.js`,
`audit:inline-handlers` on `src/deploy-onchain.js`, `audit:x402-catalog` on
`/api/x402/{knock,preflight}`, and `audit:tokens` on five pages. Every one of
those is a concurrent agent's in-flight work; this diff touches none of those
files.

Left, and it is all capital, all owner-owned:

1. **The settle rate cannot reach 90% from here.** Two wallets are starved and
   both are tiny: the ring payer is **1,592 lamports** (0.0000016 SOL) under its
   2,000,000 floor, and the sponsor has 1,727,883 spendable lamports against a
   10,000,000/day heartbeat budget. Sustaining current demand needs ~0.043
   SOL/day. Send SOL to the economy master
   `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` (never to per-agent wallets)
   and treasury-topup distributes within minutes.
2. **0.49 SOL stays stranded behind the retired key**, 0.35 of it customer money
   in two user-owned agents that display a balance their owners cannot move. The
   dry plan now says so out loud instead of counting it. If the retired key can
   be produced, `WALLET_ENCRYPTION_KEY_PREVIOUS` recovers it with no migration
   (`docs/ops/wallet-key-migration.md`); if it cannot, the two customers need a
   decision, which is not an agent's to make.
3. **`gcloud` auth is dead in this workspace** (`Reauthentication failed. cannot
   prompt during non-interactive execution`), and `.env` carries no
   `CRON_SECRET`, so neither the config levers nor `POST /api/cron/treasury-topup?dry=1`
   could be exercised from here. One `gcloud auth login` restores both. Nothing
   in this entry needed them: every number above came from public endpoints.
4. **This work is behind the deploy gap.** The dry-run fix and the corrected hint
   are on `main`, not in production; prod still runs `ad7b54c16` from 2026-08-28.
   The next deploy carries them.

Definition-of-done status: the recurrence guard, its test, the changelog entry and
this log are done. The three outcome lines (settle above 90%, `fee_runway_exhausted`
no longer top, a non-zero reclaim plan) cannot be closed by an agent: at a 0.0037
SOL sponsor balance there is no non-zero *executable* reclaim plan to produce, and
that is now the honest answer the endpoint gives rather than the phantom one.

## 2026-09-02: 07 bnb-testnet-deploys (re-verified end to end; the public broadcast is still one human faucet claim away)

Everything in this entry was re-measured against the current tree at 18:57 UTC, not
carried over from the 2026-08-02 or earlier-today notes.

| Fact | Value | Source |
|---|---|---|
| Deployer | `0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871`, key present in gitignored `contracts/.env` (mode 600) | `node scripts/bnb-testnet-deploy-prove.mjs` |
| Deployer balance | **0 tBNB** | same, live `data-seed-prebsc-1-s1` RPC |
| Live testnet gas price | 0.1 gwei (`100000000` wei), head block `128730981` | `cast gas-price` / `cast block-number` |
| `DeployGreenfieldVault` dry run | green, **1,711,362 gas** = 0.0001711362 BNB | preflight simulation against the live RPC |
| `DeployWorldMoves` dry run | green, **566,068 gas** = 0.0000566068 BNB | same |
| `forge test` WorldMoves | **19/19** | `forge test --match-path test/WorldMoves.t.sol` |
| `forge test` GreenfieldVault | **41/41** | `forge test --match-path test/GreenfieldVault.t.sol` |
| `/api/bnb/world-config?network=testnet` | `address: null, deployed: false` | live production endpoint |

Two corrections to earlier text in this pack:

1. **The index's "the throwaway key generated on 2026-08-02 no longer exists" line and the
   2026-09-01 status line "`contracts/.env` does not exist" are both out of date.** The file
   exists today and carries `BNB_TESTNET_DEPLOYER_KEY` for `0x1C49...3871`. The retired
   2026-08-02 address `0xC4e63FdF188D94059C877b957866726A888e1240` still holds 0 tBNB, so
   nothing was ever stranded on it. **Fund `0x1C49...3871`, not the retired address.**
2. **The work order's bare dry-run commands cannot pass as written.** `forge script
   script/DeployGreenfieldVault.s.sol` with no `--rpc-url` runs against chain id 31337 and
   reverts with `no known Greenfield hub addresses for this chain id`, by design: the script
   only knows hubs for 56 and 97. The dry run that means anything is the one the preflight
   runs, against the live chain-97 RPC.

**The `--broadcast` path was re-validated end to end today** against a fresh local
`anvil --chain-id 97`, with the deployer funded by `anvil_setBalance`, so a funded public
run will not be the first time this code executes. One command did all of it
(`BSC_TESTNET_RPC_URL=http://127.0.0.1:8555 node scripts/bnb-testnet-deploy-prove.mjs --broadcast`):
both contracts deployed, then 1 `join`, 3 `move` and 1 `leave` mined through the real
`api/_lib/bnb/world-moves.js` sender, decoded live by `src/bnb/world-presence-reader.js`
(1 Joined, 3 Moved, 1 Left, zero reader errors), with `createGhostTracker` holding 1 ghost
before the leave and 0 after. Local addresses are deliberately not recorded here: they are
anvil-local and mean nothing on the public chain.

**The faucet still has no agent path, re-probed today, not remembered.**
`POST https://testnet.bnbchain.org/api/claim` answers `403` from the CDN edge (no claim API
behind it), `https://www.bnbchain.org/en/testnet-faucet` serves its reCAPTCHA page, and the
Stakely endpoint answers `500`. Four EOAs known to this workspace
(the current deployer, the retired 2026-08-02 one, the CREATE2 factory deployer
`0x4022de2D...C0564f402`, and the platform validator `0x93Bc7EfB...01b1CD04`) all hold
0 tBNB on chain 97, so there is nothing here to route funds from either.

Definition-of-done status: dry runs re-verified (done), unit suites green (done), the
broadcast path proven on a local chain-97 node (done). The three remaining lines are the
same single dependency they have always been, and it is not an agent's to close: one human
faucet claim to `0x1C4918894dfA5eE11cfF9629B458b5169Cfa3871`, then the owner's explicit yes
on the spend, then `node scripts/bnb-testnet-deploy-prove.mjs --broadcast` deploys both,
proves all three paths against the public deployment, and prints the exact
`gcloud run services update ... --update-env-vars WORLD_MOVES_ADDRESS_TESTNET=0x...` to flip
the endpoint to `deployed: true`.

## 2026-09-02 (19:00 UTC): 01 x402 settle runway (re-measured; the rail is now suppressed, not burning, and the fleet is empty)

Every number here was read at 18:52 to 19:05 UTC from public endpoints, mainnet
RPC and the production ledger. Nothing is carried over from the 05:19 entry
above, and three of that entry's headline numbers have moved.

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **down, 6.1%** (3 of 49 paid attempts, 3h), `cause: sponsor_floor` | `GET /api/healthz` |
| Solana accept in that window | **withdrawn from 324 challenges**, 153 floor refusals, 46 rail faults, 0 governor skips | same, `metrics` |
| Since-boot facilitator book | ok 851 / failed 33,176: `fee_runway_exhausted` 31,489, `fee_wallet_below_floor` 1,493, `not_confirmed` 133 | same, `x402.self_facilitator` |
| Sponsor / economy master `Wwwu...T3WwW` | **1,567,667 lamports (0.001568 SOL)**, spendable **0** under the 2,000,000 floor | `GET /api/x402/runway-lab` + `getBalance` |
| Ring payer `X4o2...stML` | 1,893,408 lamports, **106,592 under the floor**, holding 3.969 USDC it cannot spend | `getBalance`, `getTokenAccountsByOwner` |
| x402 receiver `wwwww...ccrU` | 0.054995 SOL against its 0.1 SOL `minSol`, 0.056 USDC | same |
| All 8 registry engine wallets | **0.204507 SOL total** | `getBalance` over the map in `scripts/audit-wallet-flows.mjs` |
| Self-heal, running every 60s | `agent_reclaim` books **`blocked`**: deficit **1.4696 SOL**, 110 of 112 agent wallets `at_or_below_floor`, **2** unreadable at stage `recover`, **0 SOL reclaimed** | `economy_master_ledger`, latest row 19:00:45 UTC |
| Prod commit | `ad7b54c16` (2026-08-28), revision `three-ws-api-00404-ph7` | `GET /api/version` |

Three corrections to the 05:19 entry, all measured:

1. **The rail moved from `degraded` to `down`.** 55.0% then, 6.1% now. The
   sponsor crossed its floor during the day (1,727,883 spendable lamports then,
   0 now), and `sponsorKnownBelowFloor()` now withdraws the Solana accept from
   every 402 challenge, which is why paid attempts collapsed to 49 in 3 hours
   while 324 challenges went out with nothing payable on them. The low rate is a
   suppressed rail, not a burning one. That is the design working: the platform
   stops charging for what it cannot settle.
2. **The reclaim leg is not merely unproductive, it is provably empty.** The
   production ledger records a real (not dry) run every minute with the same
   verdict: 110 of 112 agent wallets are at or below their floor and only 2 fail
   at `recover`. The whole platform holds 0.2045 SOL across every registry
   wallet against a 1.4696 SOL deficit. There is no reachable SOL left to move,
   so no cron cadence, RPC tier, or config change can lift the settle rate.
3. **The funding ask is smaller than the fleet deficit suggests.** Serving every
   payable intent at the observed 10,001 lamport 2-signature fee costs roughly
   0.03 SOL/day at the current 124 payable intents/hour. 0.1 SOL restarts
   settlement within one topup tick; 2 SOL clears the entire 1.4696 SOL fleet
   deficit and leaves weeks of runway.

Did (no code change was warranted; the code side of this order shipped in
`afd349790` this morning and its guards are green):

- Re-verified the order's guards: `tests/economy-reclaim-dryrun-key-gate.test.js`,
  `tests/x402-wallet-fee-governor.test.js` and `tests/api/x402-settle-health.test.js`
  pass **60/60**.
- **Repaired the shared git index**, which held the pre-`afd349790` content for
  every file that commit touched (`api/_lib/economy-sweepback.js`,
  `api/_lib/ops/x402-settle-health.js`, its test, `data/changelog.json`, both
  public feeds, `CHANGELOG.md`) plus a staged DELETION of the new test file. Any
  peer running `git commit -a` would have reverted this order's fix and removed
  its recurrence guard from the tree. Proven stale before touching it (index
  blob == `afd349790^` blob, disk blob == `HEAD` blob for each path), then
  unstaged path by path; no worktree content was altered.
- Updated the status block at the top of
  [01-x402-settle-runway.md](../902-backlog-01-x402-settle-runway.md) so the next
  session opens on the 19:00 UTC numbers rather than the 05:19 ones.

Left, all owner-owned, unchanged in kind and sharper in number:

1. **SOL to `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW`** (the economy master,
   which is also the x402 sponsor fee wallet). Never to per-agent wallets.
   0.1 SOL restarts the rail, 2 SOL clears the fleet deficit. Moving platform
   funds is stop-and-ask gate 1, and there is nothing to move anyway.
2. **A deploy.** `afd349790` (the honest dry-run reclaim plan and the corrected
   `sponsor_floor` hint) is on `main`; production still runs `ad7b54c16` from
   2026-08-28, so the hint live on healthz right now is still the old one that
   promises the cron will fix it.
3. **`gcloud` auth is still dead here** (`Reauthentication failed. cannot prompt
   during non-interactive execution`) and `.env` carries no `CRON_SECRET`, so
   the treasury dry run and any env change remain out of reach from this
   session. Every number above was read without them.

Follow-up worth someone's time, deliberately not done here because it changes a
choice the 05:19 session made on purpose: the blocked `agent_reclaim` summary row
is appended to the hash-chained ledger once a minute (1,440 identical rows/day,
112 RPC balance reads each) for as long as the fleet stays empty. Writing it only
when the verdict changes would keep the "it ran and found nothing" signal without
the noise.

## 2026-09-02 (evening): 11 agent index, EVM lane census, plus a shared-index hazard cleared

Session note first, because it changes how this entry should be read: 49 peer sessions were
live on this worktree, and one of them was editing `api/cron/[name].js` while I was reading
it (the file changed under me at 19:01 UTC, mid-edit). Order 11 is actively owned by that
session, so I stopped touching its files and wrote the measurement down instead of racing it.
Nothing below is committed into order 11's code.

### The hazard, fixed: the shared git index was staged to revert two landed commits

Measured with `git diff --staged --stat` and a per-path `git diff HEAD -- <file>`:

| Path | Index held | Worktree held |
|---|---|---|
| `api/_lib/economy-sweepback.js` | pre-`afd349790` blob | identical to HEAD |
| `api/_lib/ops/x402-settle-health.js` | pre-`afd349790` blob | identical to HEAD |
| `tests/economy-reclaim-dryrun-key-gate.test.js` | staged DELETE | file present, identical to HEAD |
| `docs/ops/payment-outcomes.md`, `data/changelog.json`, `CHANGELOG.md`, `public/changelog.{json,xml}` | pre-`afd349790` blobs | identical to HEAD |
| `src/spotlight.js`, `src/spotlight-entry.js`, `api/spotlight-og.js` | pre-`fe30b61bc` blobs | identical to HEAD |

Nine of ten paths matched HEAD in the worktree and differed only in the index, so this was
stale index state, not anyone's intended staging. Left alone, the next peer to run a bare
`git commit` would have reverted `afd349790` (the reclaim dry-run key gate) and `fe30b61bc`
(the spotlight fixes) and DELETED `tests/economy-reclaim-dryrun-key-gate.test.js`, under
whatever message that peer wrote. Cleared with a path-scoped `git reset --` over exactly
those paths, which restores the index to HEAD and touches no worktree file; `git diff
--staged` is empty after it. Worth adding to the reflex list in this pack: read
`git diff --staged --stat` when you arrive, not only before you commit.

### The three stalled EVM cursors, diagnosed per lane

Order 11 task 3 asks whether the stale chains' RPC URLs still answer. They do, and that is
why the stall was misread. The refusal is not reachability, it is retention. Measured by
replaying the crawl's OWN filter (`eth_getLogs` on `chain.registry` with `REGISTRY_TOPICS`)
at each cursor's real resume height, per lane, at 8000/4000/2000/1000/500/200/100 blocks:

| chain_id | resume block | behind | lane verdicts at the resume height |
|---|---|---|---|
| 56 | 101,261,625 | 17.4M | 2 lanes `-32005: limit exceeded` at every width down to the 100 floor; 1 lane HTTP 429 on `eth_blockNumber`; 1 lane HTTP 403 whose BODY says archive access needs a paid token |
| 97 | 127,171,609 | 1.56M | 1 lane `-32701: History has been pruned`; 2 lanes `-32005: limit exceeded` down to the floor |
| 137 | 86,112,155 | 7.0M | 1 lane HTTP 401 `API key disabled, tenant disabled` (permanently dead); 1 lane serves ONLY at exactly 100 blocks and refuses 200 and above; 1 lane caps `eth_getLogs` at 50 blocks; 1 lane `History has been pruned` |

Four findings the fix should not lose:

1. **Every lane answers `eth_blockNumber` except two**, so a reachability check would have
   called all three chains healthy. The wall is at `eth_getLogs` on old blocks only.
2. **Shrinking the window cannot help chain 56 or 97.** Both were refused at the 100-block
   floor, so the backoff loop was always going to walk the whole ladder and end at the
   floor-exhausted branch, which by design leaves the cursor untouched. That branch's comment
   says the next tick retries against the failover RPC; it has now said that for 89 and 127
   days respectively.
3. **Chain 137 is the one case where a lane does hold the history, and it is still not
   recoverable by backfill.** That lane serves exactly the 100-block floor. At 100 blocks a
   tick against a head advancing roughly 36,000 blocks per 15-minute tick, the backlog grows
   every tick forever. Resume-at-head with the gap reported is the only outcome that indexes
   anything, which is what the in-flight `prunedSkip` path already does. Whoever finishes 11
   should expect chain 137 to skip rather than backfill, and should say so in the docs.
4. **Chain 137's FIRST lane is dead, not slow**: it answers HTTP 401 `API key disabled,
   tenant disabled` to every method, so every call on that chain pays a dead lane before it
   reaches a live one. Dropping it is a one-line failover-list edit in
   `api/_lib/erc8004-chains.js`, and it sits behind the CLAUDE.md commit gate because that
   file names chains other than `$THREE`. Owner: approve or decline that one edit. The lane
   is identified by its position in that chain's `rpcUrls` array, not named here, so this log
   stays inside the gate.

The peer session had, independently and in the same window, landed the two fixes this
diagnosis points at (archive wording folded into the pruned-history predicate, and the
JSON-RPC error body read before the HTTP status so a 403's reason survives). Their code was
in the worktree uncommitted at 19:01 UTC. This entry exists so the per-lane evidence outlives
whichever session commits it.

### Re-verified, so nobody re-derives it

- **`gcloud` auth is ALIVE again** (`gcloud auth list` returns `nich@sperax.io`). The
  2026-09-02 05:19 entry above records it dead; that is now stale. Cloud Run and Secret
  Manager reads work from this workspace.
- **Order 05 is still blocked on exactly one credential.** `gcloud secrets list` over the
  whole project matches nothing on r2, cloudflare, bucket or cors, and neither `.env` nor
  `.env.local` carries an R2 or Cloudflare admin variable. `node scripts/set-r2-cors.mjs
  --probe` still reports 5 drifted origins (`www.three.ws`, `*.app.github.dev` and
  `localhost:5173` refused a read they should get; `example.org` and `localhost:8080` are
  refused writes correctly but reads too). Unchanged owner action: mint the token.
- **Solana leg of the agent index: 190 of 1,604 cursors erroring (11.8%)**, and 185 of those
  185 carry one class, `failed to get signatures for address: Transaction <sig> not found`.
  That is the same unresolvable-cursor stall order 11 fixes, re-accumulating at roughly 14 an
  hour because production still runs `ad7b54c16` and re-wedges an agent on every sweep. The
  remaining 5 are one-off provider 429s and a TLS fault. Do NOT read a low number here as the
  fix working: it will climb back toward 1,100 until the deploy lands. I did not run
  `scripts/heal-agent-event-cursors.mjs --apply`, deliberately, so the owning session's
  before/after numbers stay meaningful.

Left: order 11 belongs to the session that was editing it. Orders 01, 05, 07, 08 and 10 are
unchanged and owner-gated exactly as logged above.

## 2026-09-02 19:20 UTC: order 11 (agent index) closed in code; one deploy remains

`agent_index` was `down` with no owner. Root cause on both legs was the same and it was never
capacity: **the stored cursor pointed at history the answering provider no longer serves, and
the cursor is only written on the success path**, so every later tick re-presented the same
dead value and got the same error forever while the crons kept returning 200.

### Solana leg, before and after (live prod DB)

| Read | `errored` / `agents` | rate | median lag | dominant error class |
|---|---|---|---|---|
| 2026-09-01 (order written) | 1,092 / 1,602 | 68.2% | 87 min | unresolvable cursor |
| 2026-09-02 18:50 (session start) | 190 / 1,604 | 11.8% | 63 min | unresolvable cursor (185 of 190) |
| 2026-09-02 19:17 (after recovery) | **0 / 1,604** | **0.0%** | 24 min | none |

Error-class table as measured, and what each turned out to be:

| Class | Count at 18:50 | Verdict |
|---|---|---|
| `failed to get signatures for address: Transaction <sig> not found` | 185 | The whole stall. Lane router rotates providers with different retention, so a cursor one lane wrote is unreadable by the next. Now self-heals: drop `until`, re-scan from head, and write the null THROUGH the upsert's `COALESCE` so the dead value is actually cleared. |
| `solana rpc 429 @ <host>` | 3 | Transient. Note for the next session: running the sweep or the heal script back to back from this workspace exhausts the shared free lanes and manufactures 168 of these. They clear on the next tick. |
| `solana rpc provider error -16401 @ <host>` | 1 | Lane gates the method behind a paid tier. Capability routing already covers it. |
| `fetch failed (ERR_SSL_...) @ <host>` | 1 | One-off transport fault. |

`scripts/heal-agent-event-cursors.mjs --apply` drained the backlog in one pass: 170 healed, 0
still failing, 0.0% erroring. Zero unresolvable-cursor rows remain, which is the recovery
proving itself against live data rather than against a fixture.

### Sweep capacity: the batch was the cap, not the budget

Timed against the live lane router: one agent costs ~370 ms. The sweep was taking 120 per
10-minute tick and spending 45 s of a 120 s budget, so it left three quarters of every tick
idle while the 1,604-agent directory cycled in 140 minutes against a 90-minute threshold.
Batch raised to 240 behind a 4-worker pool. One real tick, measured:

```
{"agents":240,"scanned":0,"inserted":0,"rejected":0,"failed":0,
 "truncated":false,"batch":240,"concurrency":4,"elapsedMs":25862}
```

25.9 s against the 120 s budget (4.6x headroom), `truncated: false`, zero failures. Cycle is
now **70 min** (7 ticks) for a 35-minute median floor, proved by two consecutive reads of the
cursor table across that tick: median lag 42 min -> 22 min.

### EVM leg: all three stalled chains had ONE cause, and it was not the scheduler

Both crawl crons are alive (`gcloud scheduler jobs list`: `cron--api-cron-erc8004-crawl` and
`cron--api-cron-solana-attestations-crawl`, both ENABLED, last attempt minutes old). The three
stale chains were sitting behind a provider retention wall that the code could not classify:

- The keyless lanes answer an old range with `Archive requests require a personal token` under
  an **HTTP 403**, and `erc8004RpcCall` threw on the status before reading the body, so the
  reason was reduced to `HTTP 403 from <host>` and no predicate could act on it.
- On another chain the FIRST lane said plainly that the blocks were pruned while the LAST lane
  answered a generic `limit exceeded`; the call surfaced only the last lane's error, so the
  retention diagnosis never reached the recovery. That chain sat stale for eight days, another
  for four months.

Fixes: read the JSON-RPC body before the status; keep a retention diagnosis from any lane
ahead of a later lane's generic failure; fold the archive-paywall wording into
`isPrunedHistoryRejection`. Proved live against all three chains before committing: each one
now classifies as retention, skips to head, and scans real logs (the busiest returned 47 logs
on its first post-skip window).

Skipping closes the backlog, which would have made the loss invisible: a chain at head reports
zero blocks behind and reads as healthy. Migration
**`20260902190000_erc8004_history_gap.sql`** (applied) adds `history_gap_blocks`,
`history_gap_to`, `history_gap_at` to `erc8004_crawl_cursor`; the crawl accumulates the skipped
span there and the sensor reports it (`evm.historyGapChains`, `evm.historyGapBlocks`) without
ever scoring it, because it is history no tick can recover.

I did NOT touch the failing chains' `rpcUrls`. The retention skip resolves all three without
it, and the earlier entry above is right that editing that file sits behind the commit gate.

### Sensor

`indexLagVerdict()` was already split out and pure. It now also carries the history-gap line.
An EVM-only fault still caps at `degraded` with the reason in `detail`, and the Solana error
rate is scored in its own right. `tests/agent-index.test.js`: 78 passing, including the pool's
budget and truncation edges driven by a hand-cranked clock (no doubles), the archive wording,
and the assertion that a full cycle, not just the median, fits inside the fresh threshold.

### Commits

| SHA | What |
|---|---|
| `6cd247926` | Solana cursor recovery + `scripts/heal-agent-event-cursors.mjs` |
| `a27a668ed` | Sweep batch 240 + concurrency ceiling |
| `5283235a8` | Keep the retention-wall error instead of the last lane's generic one |
| `c6b6c2c02` | The history-gap migration and the archive wording |
| `88270c25a`, `771761928` | Concurrent sweepers carried the rest of the same work (pool, sensor, tests, runbook) into their commits |
| `33160c660` | Changelog entry |

`docs/ops/agent-index.md` is the runbook, linked from `docs/ops/README.md`.

### OWNER-ACTIONS: one deploy closes the last three boxes

Production still runs `ad7b54c16` (2026-08-28), so none of the above is live yet. The Solana
error rate will climb back from 0% at roughly 14 cursors an hour until it lands, and
`agent_index` will keep reporting `down` rather than `degraded` because the old sensor has
neither the EVM-only cap nor the error-rate score. The migration is already applied, so
`db:check` will pass.

```sh
npm run clean:worktrees -- --apply
npm run prep:worktree -- --apply
npm run build:gcp
npm run deploy:gcp:submit
npm run deploy:gcp:purge-cdn
curl -s https://three.ws/api/version
```

After it lands, the two remaining checks are reads, not work: `agent_index.metrics.solana.errored`
under 5% on two healthz reads an hour apart, and `evm.behindChains` not growing across two
reads (the busiest secondary chain should skip to head on its first tick and bank ~18.4M blocks
into `history_gap_blocks`).


## 2026-09-02: 10 x402scan listing (facilitator listing done; one deploy + one signature left)

Measured, no credentials used anywhere:

| Fact | Value | Command |
|---|---|---|
| PR #1032 | **`MERGED` 2026-08-11T20:01:45Z**, 4 commits, 0 reviews | `gh pr view 1032 --repo Merit-Systems/x402scan` |
| Facilitator page | live, both fee payers rendered | `https://www.x402scan.com/facilitator/three-ws` |
| Attribution | 18,636 transactions, $1,055.01 USDC, latest settle 2026-09-02T08:59:12Z | that page's payload |
| Our origin page | 60 resources, 0 deprecated, re-crawled by them 2026-08-27 | `.../server/17cbd874-52ac-4920-a020-b22ff2489a07` |
| Discovery crawl | 46 pages, 4,519 fetched, `total` stable at 4,519, 0 duplicate identities | their `listAllFacilitatorResources` replayed against production |
| Merged config | url, `discoveryConfig`, both addresses, logo 200, `docsUrl` 200 | `gh api .../facilitators/threews.ts`, `curl` |
| CDP Bazaar | three.ws in **0 of 15,127** catalog resources | full paged sweep |

**The blocked step is moot.** The PR merged without the reviewer-verification comment, so
the classic PAT this work order has been waiting on since 2026-07-17 is no longer needed for
anything. Their transfer sync is doing exactly what the PR set it up to do.

Two upstream facts worth carrying forward. Their facilitator crawl is still paused
(`FACILITATOR_SYNC_PAUSED = true` in `apps/scan/src/app/api/resources/sync/route.ts`,
re-checked today), so being a registered facilitator buys settlement attribution, not catalog
ingestion. And their registration flow reads **`/openapi.json`**, not our facilitator catalog.

Did: that second fact exposed the real reason the origin has sat at 60 resources since
2026-07-11. `/openapi.json` hand-enumerated **24 of the 75** live paid services, so 52
endpoints answered a spec-valid 402 in production and could not be registered by anyone.
`catalogPaidPaths()` in `api/openapi-json.js` now projects every live paid service from
`api/_lib/service-catalog/` (already the written-once source of truth for the x402 discovery
doc and the OKX storefront) into the document, spread BEFORE the hand-authored paths so the
24 richer entries keep their exact wording. `/api/x402/*` operations went 24 to 79; diffed
against the live production document, **zero existing paths changed**. Five guards added to
`tests/openapi-aggregator.test.js` (16 pass): catalog coverage, price parity with the
dynamic-price exemption, hand-authored entries preserved verbatim, GET/POST input projection,
and the JSON Schema required list surviving onto query parameters. This also fixes the
AgentCash discovery lane, which reads the same document.

Also corrected two docs that were wrong against measurement: `docs/open-source-ecosystem.md`
claimed the CDP Bazaar indexes our catalog (it does not, and cannot until a Base settle runs
through the CDP facilitator), and both it and `docs/open-source-footprint.md` still described
the merged PR as pending. Added a measured 2026-09-02 block to the registration log in
`docs/ops/x402-discovery-listings.md`. Changelog entry added, feeds rebuilt.

Not a bug, worth knowing: five endpoints answer 503 `settlement_unavailable` instead of a 402
while the sponsor wallet is under its SOL settle floor (`dance-tip`, `feed-health`,
`ring-settle`, `spend-session`, `three-buy`). They are Solana-only, so the floor removes their
only rail; every Base-carrying endpoint keeps its 402 through the same outage. They cannot be
probe-registered until work order 01 lands capital. Eight ring endpoints are absent from our
own discovery catalog on purpose (`discoverable: false`, plus `service` as a dynamic per-agent
dispatcher and `ring-settle` as the internal volume primitive); that was checked before
assuming drift, and no descriptors were added for them.

Left:
- **The deploy.** A deploy landed mid-session (`7f0ef6251`, revision `three-ws-api-00405-z6c`)
  but predates this fix, so `curl -s https://three.ws/openapi.json` still reports 24 paid
  paths against the tree's 79. Registration sees 24 endpoints until the next deploy ships.
  Owner-gated.
- **One SIWX wallet signature** (no funds move) to re-register origin `https://three.ws` at
  `https://www.x402scan.com/resources/register` after that deploy. The 53 endpoints that
  answer a valid 402 today and are missing from the listing: `/api/agents/endpoint-shopper-run`,
  `/api/agents/unstoppable-status`, and under `/api/x402/`: `analytics`, `api-key-health`,
  `auth-health`, `avatar-optimize-batch`, `bazaar-feed`, `billboard`, `club-cover`,
  `cross-chain`, `defi-radar`, `embody`, `gas-oracle`, `hack-check`, `llm-proxy`,
  `market-categories`, `market-chains`, `market-chart`, `market-coin`, `market-coins`,
  `market-defi`, `market-derivatives`, `market-dex-volumes`, `market-exchanges`, `market-fees`,
  `market-gas`, `market-global`, `market-hacks`, `market-heatmap`, `market-mood`,
  `market-pulse`, `market-stablecoins`, `market-trending`, `market-yields`, `mcp-tool-catalog`,
  `model-validation-sweep`, `news-pulse`, `notify`, `pipeline-gameready`, `pipeline-rembg`,
  `pipeline-remesh`, `pipeline-rig`, `pipeline-stylize`, `rate-limit-probe`, `remix-asset`,
  `robinhood-portfolio`, `schema-check`, `solana-register-health`, `stablecoin-health`,
  `telegram-health`, `token-intel`, `wallet-connect`, `yield-scan`.
- **CDP keys / a funded Base buyer** for the optional Base leg. Additive only.

Solana settlement is unchanged and still self-hosted. Nothing in this session re-pointed,
demoted, or touched the Solana rail.

Gate: fails on 6 `/materialize` link findings from a concurrent agent's uncommitted print
work (`pages/certificate.html`, `src/certificate-page.js`), none of it in a file this session
touched. `npm run check:claude` was failing on a stale cron count (111 vs the 112 in
vercel.json) and is fixed. `npm run check:rules` clean on every file touched here.
`npm run audit:docs` reports only two pre-existing unpublished-doc findings, neither mine.

Commit gate: this entry and the doc updates name a third-party registry and are NOT staged.
One note the owner needs: the `api/openapi-json.js` change was swept into commit `cb9af5cd2`
("docs(openai): publish the partner announcement copy and the visibility map") by a
concurrent agent's `git add -A` at 19:07:29 UTC, before the gate could be cleared and under a
message that describes it as "schema entries for the newly listed tools", which it is not.
Nothing was amended or reset in response.
