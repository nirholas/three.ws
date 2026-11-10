# backlog-PROGRESS, archive 4 (2026-09-09 to 2026-09-09)

Older entries moved verbatim out of [backlog-PROGRESS.md](backlog-PROGRESS.md) on 2026-11-10 so every file stays under the 50,000-character limit. Read-only record: append new entries to [backlog-PROGRESS.md](backlog-PROGRESS.md), never here.

## 2026-09-09: 01 x402 settle runway (the deploy landed; the fleet is not empty, it is fenced)

Everything below was read live today, not carried forward.

**The deploy the 2026-09-04 entry was waiting on has shipped.** Production is
`880bdcef8` (built 2026-09-08 19:05 UTC), revision `three-ws-api-00418-j26`, so both
the 09-04 top-up ordering fix (`0559bc23f`) and the healthz recovery (`d668ceece`)
are live. Two consequences: `/api/healthz` answers 200 again, so this order's outcome
line is readable for the first time since 09-02, and the ordering fix is confirmed
running rather than assumed. `POST /api/cron/treasury-topup?dry=1` reports
`settleCritical: true` on the `coin-launcher-master+x402-ring-payer` target and skips
with the honest `master_insufficient_spendable`, which are exactly the two things
09-04 changed.

Measured state:

| Fact | Value | Source |
|---|---|---|
| `x402_settle` | **down**, 0.0% (0/129 paid attempts, 3h), `cause: sponsor_floor` | `/api/healthz` |
| Same, 24h window | 18.5% (84 settled / 453 attempts), 369 refusals, every one `cause: floor` | `/api/x402/runway-lab` |
| Settle reject class since boot | `fee_wallet_below_floor` **370 of 370**; `fee_runway_exhausted` **absent** | `/api/healthz` `self_facilitator.settle.fail_reasons` |
| Verify reject class since boot | `simulation_failed` 632 of 1119 (an unfundable fee payer, same root cause) | same, `self_facilitator.verify` |
| Sponsor / economy master `Wwwu…T3WwW` | 1,177,628 lamports, spendable 0 | on chain + runway-lab |
| Ring payer `X4o2…stML` | 812,444 lamports, 4.163 USDC, no wSOL ATA | on chain |
| Observed fee per settle | 5,033 lamports (`observed_median_24h`) | runway-lab |
| `master_deficit_sol` | 0.308822, plan `[]`, reclaim 0 | topup dry run |

**DoD line 2 passes and is now permanent.** `fee_runway_exhausted`, the class this
order is named for, does not appear in the reject book at all. The governor is no
longer the constraint; the hard SOL floor is. The payer drained from 1,253,408
lamports (09-04) to 812,444 today, and 84 settles times the 5,033 lamport observed
fee is 422,743 lamports, which accounts for the drop almost exactly. It is spending
itself to zero and cannot recover on its own.

### The finding: "every reclaim source is at_or_below_floor" was not the same as empty

Three consecutive sessions (09-02, 09-04, and the start of this one) read the reclaim
plan's `at_or_below_floor` on every source and concluded the platform was out of SOL.
Reading the balances on chain instead of the skip reasons says otherwise:

| Wallet | Role | Holds | Its `minSol` | Why reclaim skipped it |
|---|---|---|---|---|
| `wwwww…ccrU` | x402 ring treasury / receiver (`pump-x402-launcher`) | **0.054995 SOL** | 0.1 | under its keep line of 0.11 |
| `wwwqv…HGUn` | relayer + SNS + treasury bundle | 0.016894 SOL | varies | `feed_sink_exempt` (correct, it is the feed sink) |
| `X4o2…stML` | ring payer | 0.000812 SOL | 1 | genuinely empty |

The ring payer is **0.001188 SOL short** of the 0.002 SOL hard floor that stopped
settlement. The treasury alone holds **46 times that**. That SOL is not missing and it
is not the owner's to send; it is platform money sitting behind a `minSol` of 0.1 that
the registry's own comment records as sized for the launch-fee role this wallet was
named for, a role the same comment says "is not in active use". Its live role, signing
treasury to payer sweeps, costs about 5,000 lamports a run.

The reason this was invisible is that the bare string `at_or_below_floor` covers two
opposite operator situations, a wallet holding nothing (needs owner capital) and a
wallet holding real SOL behind a configured floor (needs a floor reviewed), and it
printed identically for both. The settle-health hint and the triage runbook both ended
on "Owner SOL is needed when every reclaim source reports at_or_below_floor", which
fired today while the platform owned enough SOL to restart the rail many times over.

### Landed (no funds moved, deployable, `check:rules` clean)

- Floor skips carry their numbers, in the `<have><<need>` shape `below_swap_rent`
  already used: `at_or_below_floor:0.054994966<0.11`, plus `heldSol`, `floorSol` and
  `keepSol` fields, on **both** reclaim legs (`api/_lib/economy-sweepback.js`).
- `reclaimKeepLineSol()` is now the single source of the keep line, read by the sizing
  and by the message, so the number an operator is shown is by construction the number
  that blocked the sweep.
- `floorHeldSol` on every reclaim result and `skipped_floor_held_sol` on the ledger's
  summary row total the fenced SOL. **Zero is the only state that needs owner money.**
  Today's production numbers through the real function: **0.05580741 SOL fenced**.
- The ledger's `skipped_reasons` histogram now buckets on the class before the colon
  (`api/_lib/economy-ledger.js`). Without this the numbered reasons would have given a
  fleet-wide run one bucket per wallet balance (110 buckets of one) and destroyed the
  count the field exists for. Covered by its own test.
- Both `diagnoseSettleDrop` hints and `docs/ops/production-log-triage.md` now qualify
  the capital sentence with `skipped_floor_held_sol 0` instead of asserting money is
  required (`api/_lib/ops/x402-settle-health.js`).
- Four tests in `tests/economy-sweepback.test.js` (fenced vs empty distinguishable,
  message and sizing read one keep line, the fenced total, the histogram not
  fragmenting). 167 tests green across all 14 suites that touch these modules.
- `docs/economy-master.md` gained "A floor skip says whether the wallet is empty or
  fenced"; `data/changelog.json` entry added; `npm run audit:docs` clean.

### Left, and it is one owner decision, not a diagnosis

Both options restart settlement. Both move SOL, so both are stop-and-ask gate 1.

1. **Free, from money the platform already owns.** Release the treasury's fenced SOL by
   lowering `pump-x402-launcher`'s `minSol` from 0.1 to about 0.02 (still ~4,000 sweeps
   of headroom at 5,000 lamports each), then run `POST /api/cron/treasury-topup`
   without `?dry=1`. Path: `wwwww…ccrU` to the economy master `Wwwu…T3WwW`, then master
   to the ring payer `X4o2…stML` (settle-critical, funded first since 09-04). Roughly
   0.035 SOL moves internally; no owner capital.
2. **Owner capital.** Send SOL to the economy master
   `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` and nowhere else. 0.1 SOL clears the
   payer's floor and restarts settlement; 2 SOL clears the fleet's deficit with real
   runway.

Option 1 was deliberately NOT taken here: lowering a floor to release funds is a
capital decision wearing a config costume, and this order explicitly warns against
lowering a floor to make a symptom go away. The diagnostic work above is what makes it
an informed choice rather than a guess, and it is reversible in one edit either way.

DoD lines 1 and 3 stay open behind that decision (line 3's reclaim plan cannot be
non-zero while every source is fenced or empty). Line 2 passes. Lines 4 to 6 are done.
The prompt file stays on disk.

`npm run gate` fails at three steps this session, none of them from this work:
`audit:motion-drift` (171 vs baseline 162, from the in-flight stylesheet migration in
`public/home-scene.css` and `src/home/home.css`), `audit:guards`
(`scripts/check-windows-widget.mjs` unregistered) and `check:images`
(`src/render-lab.js:772`). All three are other agents' open work in this shared tree.
