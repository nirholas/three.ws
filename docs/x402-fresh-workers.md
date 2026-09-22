# Fresh-wallet workers: x402 volume from wallets that never existed before

The ring economy proves the x402 rail continuously, but it does so from a
handful of long-lived wallets, and most of what it buys is a canary: a $1
settlement that returns a receipt and nothing else. The fresh-wallet workers
lane changes both halves of that.

- **Every payment comes from a brand-new wallet.** A keypair is generated for
  one job, funded with exactly that job's price plus its own fees, pays once,
  and is emptied and closed within the same minute. It never pays twice.
- **Every payment buys real work.** A job is either a paid text-to-3D
  generation that lands in the public [/forged](https://three.ws/forged)
  library, or a paid dataset from the market-data storefront that lands on
  the [/data-desk](https://three.ws/data-desk) page with its receipt.

Both are the platform buying from itself, and both are labeled internal in
every log row, the same way the ring is. What is new is that the money does
something on the way round.

Code: [api/_lib/x402/fresh-workers/](../api/_lib/x402/fresh-workers/) (four
modules: `plan.js` pure planning, `chain.js` on-chain legs, `jobs.js` the job
catalog and its sinks, `wallets.js` the lifecycle store, `run.js` the tick),
driver [api/cron/x402-fresh-workers.js](../api/cron/x402-fresh-workers.js),
fired every minute by the economy heartbeat
([api/cron/economy-tick.js](../api/cron/economy-tick.js)).

## One wallet's life

```
mint ──▶ fund ──▶ pay ──▶ sweep + close
 keypair   1 tx      1 tx     1 tx (self-paid)
 encrypted SOL+ATA   USDC     USDC leftover → treasury
 at rest   +USDC     to the   ATA rent → funder
                     treasury every lamport but 5,000 → funder
```

1. **Mint.** `Keypair.generate()`, secret-box encrypted with
   `WALLET_ENCRYPTION_KEY` (the same scheme as custodial agent wallets and the
   ring payer pool), stored in `x402_fresh_wallets` as `minted`. The row also
   carries the wallet's USDC associated token account (ATA) address so nothing
   downstream has to derive it.
2. **Fund.** One transaction per tick funds every wallet the tick minted:
   a system transfer of `rent-exempt minimum + worst-case pay fee + sweep fee`
   lamports from the SOL funder (`X402_FEE_PAYER_SECRET_BASE58`, the sponsor
   and economy master), an idempotent ATA create paid by the funder, and a
   USDC transfer of the job's exact price from the treasury
   (`X402_TREASURY_SECRET_BASE58`). Both funders sign; the treasury only as
   token authority. State `funded`.
3. **Pay.** The wallet calls its endpoint through the shared `payX402` client
   with `selfPay: true`: one signature, its own fee, no sponsor co-sign. The
   `onAccept` hook refuses any 402 whose `payTo` is outside the controlled
   wallet set before a byte is signed. On success the response goes to its
   sink and the wallet is `paid`; otherwise `pay_failed`. Either way the call
   is a row in `x402_autonomous_log` tagged `pipeline='fresh-workers'`.
4. **Sweep.** One self-paid transaction: leftover USDC to the treasury,
   `closeAccount` on the ATA with the funder as rent destination, and a system
   transfer of `balance - 5,000` lamports to the funder. The compute price is
   zero so the fee is exactly the base fee and the wallet ends at exactly
   zero. State `closed`.

Net cost per job: three base fees, roughly 15,000 lamports. The ATA rent
(2,039,280 lamports) leaves the funder in step 2 and comes back in step 4.
The USDC leaves the treasury in step 2 and returns as the endpoint's revenue
in step 3, so the treasury's USDC position is flat across a job.

### Nothing strands

Every stage writes the wallet's state before it moves money, so an
interrupted tick leaves a row that says exactly where it stopped. The next
tick's **reclaim pass** claims rows that are `funded`, `paid`, `pay_failed`
or `sweep_failed` and untouched for `X402_FRESH_WORKERS_RECLAIM_AFTER_S`
(default 90 s), waits for a pending payment to confirm, and sweeps them. The
claim is a single `UPDATE ... FOR UPDATE SKIP LOCKED` that bumps `attempts`
and `updated_at`, so two instances never sweep the same wallet at once.

A wallet whose sweep keeps failing is marked `stranded` after
`X402_FRESH_WORKERS_MAX_SWEEP_ATTEMPTS` (default 20) and raises one ops
alert naming the pubkey. Its key is still in the table; a manual reclaim is
`node scripts/x402-fresh-workers-run.mjs 1` once the cause (usually RPC) is
fixed, because the reclaim pass runs at the top of every tick.

`fund_failed` rows (the funding transaction never confirmed) are left alone
by the reclaim pass on purpose: nothing was moved. If a slow funding
transaction lands after the tick gave up, the row's balances are non-zero
but its state is terminal, so the on-chain leak scanner still sees the
wallet as internal (below) and the money sits under a key the platform
holds; `npm run audit:wallet-flows` surfaces it and the run script's next
tick sweeps any row you flip back to `funded`.

## What gets bought

Planned per tick by `planTickJobs()`: on every
`X402_FRESH_WORKERS_FORGE_EVERY_N_TICKS`-th tick (default 10) the first job
is a Forge generation; every other slot is the next dataset in rotation.

| Kind | Endpoint | Price | Where it lands |
| --- | --- | --- | --- |
| forge | `POST /api/x402/forge`, standard tier, prompt from the same prop catalog the hourly forge pipeline walks, keyed by the tick counter so consecutive props differ | $0.15 | `forge_autonomous_props` via the forge pipeline's own `persistProp`, so the prop appears on [/forged](https://three.ws/forged) with the fresh wallet as payer and a **fresh wallet** badge on the card. Queued (async) generations are resolved to `done` by the same `resolveQueuedJobs` poll the lane runs at the top of every tick. |
| data | the 18 datasets in `DATA_JOBS` (`jobs.js`): global snapshot, trending, gas, DeFi TVL, stablecoins, news pulse, fees, DEX volumes, mood, hacks, yields, DeFi radar, chains, crypto intel, market pulse, heatmap, $THREE intel, coin markets | $0.001 to $0.01 | `x402_data_desk`, one row per purchase with the trimmed payload, payer, price and settlement signature. `/api/data-desk` serves the newest row per dataset; [/data-desk](https://three.ws/data-desk) renders each with a slug-specific layout and its receipt. |

Every data job's request contract (path, method, query, body, default price)
is read from the ring catalog ([api/_lib/x402/ring-catalog.js](../api/_lib/x402/ring-catalog.js)),
which is derived from the handlers themselves, so a purchase never pays for
a request the endpoint would reject. `tests/x402-fresh-workers.test.js`
fails if a listed dataset is missing from the catalog.

At the defaults (3 wallets a minute, a prop every 10 ticks) a full day is
about 4,300 fresh wallets, 144 new library props and 4,100 datasets, for
roughly $26 of USDC that recirculates to the treasury and about 0.07 SOL of
network fees. `X402_FRESH_WORKERS_DAILY_CAP_ATOMIC` (default $40) is the hard
ceiling on the USDC side.

## Safety

The lane inherits every guard the ring has, in this order:

- **Kill switches.** `X402_AUTONOMOUS_ENABLED=false` (global) or
  `X402_FRESH_WORKERS_ENABLED=false` (this lane) skip cleanly.
- **Spend invariants.** `assertRingSpendInvariants()`: external spending off,
  no charity split, the facilitator resolves to self. A violation no-ops the
  tick and raises the same CRITICAL alert the ring raises.
- **Config gate.** `validateRingConfig()` errors block the tick.
- **Funder headroom.** The SOL funder must cover every wallet's SOL plus one
  ATA rent each plus the funding fee *above* `X402_SPONSOR_SOL_FLOOR_LAMPORTS`.
  Below that the tick skips with `funder_headroom`, one throttled alert, and
  resumes on its own once the master is funded. The treasury must hold the
  tick's USDC or the tick skips with `treasury_usdc_short`.
- **Recipient gate.** `payX402`'s `onAccept` hook refuses a `payTo` outside
  `ringAllowedAddresses()` before signing.
- **Time budget.** `X402_FRESH_WORKERS_TICK_BUDGET_MS` (default 50 s, under
  the heartbeat's 60 s abort). Stages that would not finish in time are
  deferred to the reclaim pass instead of racing the clock.

### The controlled-wallet set

The on-chain leak scanner classifies every debit from a ring wallet by its
counterparty, and the master's funding transfer to a fresh wallet is exactly
such a debit. Fresh wallets are therefore members of `ringAllowedAddresses()`
for `X402_FRESH_WORKERS_MEMBERSHIP_HOURS` (default 36) after minting: the
allowlist reads `pubkey` and `usdc_ata` straight from `x402_fresh_wallets`,
so the set grows by a bounded window rather than forever, and no ATA is
re-derived per call. Fresh wallets are deliberately **not** mirrored into
`x402_ring_wallets`, so the scanner never enumerates thousands of dead
wallets and treasury sweepback never sees them.

Because a fresh wallet self-pays, the facilitator's wallet fee governor
sees it as a governed wallet with the heartbeat budget, which is far above
one fee, and the sponsor floor does not apply to it (the sponsor is not the
fee payer of a self-paid settle).

## Watching it

- [/data-desk](https://three.ws/data-desk): the datasets, the ledger of
  recent purchases, and the lane's 24 h numbers.
- [/forged](https://three.ws/forged): props with the **fresh wallet** badge.
- `GET /api/fresh-workers`: wallets minted, paid and closed (24 h and all
  time), USDC recirculated, SOL actually burned as fees, rent recycled, and
  the newest wallets with their fund, pay and sweep signatures on Solscan.
- `GET /api/data-desk`: the feed behind the page; `?slug=<dataset>` for one
  dataset's purchase history.
- Logs: `fresh_tick_complete` per tick, `fresh_funder_headroom` when the
  lane paused for SOL, `fresh_fund_failed` / `fresh_reclaim_claim_failed`
  for chain and DB faults.
- DB: `x402_fresh_wallets` (every wallet, every state), `x402_data_desk`
  (every dataset bought), `x402_autonomous_log WHERE pipeline='fresh-workers'`
  (every call), `x402_ring_ledger` rows of kind `fund` and `sweep` for the
  USDC legs.

## Running it

```bash
# What a tick would buy and what the funders must hold. No I/O.
node scripts/x402-fresh-workers-run.mjs --plan

# One real tick against production endpoints from this machine (needs the
# ring env: funders, WALLET_ENCRYPTION_KEY, DATABASE_URL).
X402_FRESH_WORKERS_PER_TICK=1 node scripts/x402-fresh-workers-run.mjs 1
```

Production needs nothing beyond the ring env it already has: the lane is on
by default, fired by the economy heartbeat, and the tables are created by
migration `20260922100000_x402_fresh_workers.sql` (with an idempotent guard
in code for a tick that runs first).

## Env

| Var | Default | Meaning |
| --- | --- | --- |
| `X402_FRESH_WORKERS_ENABLED` | `true` | `false` pauses the lane |
| `X402_FRESH_WORKERS_PER_TICK` | `3` | fresh wallets minted and jobs bought per minute |
| `X402_FRESH_WORKERS_FORGE_EVERY_N_TICKS` | `10` | one Forge generation every N ticks; the rest are datasets |
| `X402_FRESH_WORKERS_DAILY_CAP_ATOMIC` | `40000000` ($40) | USDC the lane may spend per UTC day |
| `X402_FRESH_WORKERS_TICK_BUDGET_MS` | `50000` | wall-clock budget per tick |
| `X402_FRESH_WORKERS_RECLAIM_AFTER_S` | `90` | how long a mid-flight wallet is left to its tick before reclaim |
| `X402_FRESH_WORKERS_MAX_SWEEP_ATTEMPTS` | `20` | sweep retries before a wallet is stranded and alerted |
| `X402_FRESH_WORKERS_MEMBERSHIP_HOURS` | `36` | how long a fresh wallet stays in the controlled-wallet set |
| `X402_FRESH_WORKERS_RECLAIM_BATCH` | `12` | reclaims attempted per tick |

## Related

- [x402 ring economy](./x402-ring-economy.md): the closed loop this lane
  runs inside, its governors, and the payer pool it complements
- [Autonomous x402](./autonomous-x402.md): the catalog sweeper and the
  hourly forge pipeline whose sink this lane shares
- [Economy wallet rotation](./ops/economy-wallet-rotation.md): the funders
- [STRUCTURE.md](../STRUCTURE.md): surface map
