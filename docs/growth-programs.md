# Trading growth programs

Three levers from the pump.fun trading roadmap that reach outside the platform:

| Program | What it does | Roadmap item | Why it is gated |
|---|---|---|---|
| **Big-win X poster** | Posts a notable live agent win to @trythreews with a link to its trade card | 3.8, 13.5 | Posts to an external channel |
| **First-rug softener** | Pays back part of a first-timer's first rug, in $THREE | 12.15 | Sends $THREE |
| **Early-leader program** | Pays a bounded $THREE bonus to the first traders who build a verified record | 13.4 | Sends $THREE |

**All three ship disarmed.** The selection logic runs on live data all the time, and you can see exactly what each one would do right now. The step that posts or pays only runs when the owner sets that program's flag, and even then it stays under a hard cap per period. This page explains each program, how to inspect it, and the exact steps to arm it.

Code: [`api/_lib/growth-programs/`](../api/_lib/growth-programs/). Tests: [`tests/growth-programs.test.js`](../tests/growth-programs.test.js).

---

## See what they would do today

Three ways, all read-only. None of them posts, writes a ledger row, or signs anything.

```bash
# From a checkout with .env.local (DATABASE_URL): a readable summary
node --env-file=.env.local scripts/growth-programs-report.mjs

# The full report as JSON
node --env-file=.env.local scripts/growth-programs-report.mjs --json

# Against production (admin session or the ops secret)
curl -s -H "x-ops-secret: $OPS_SECRET" https://three.ws/api/ops/growth-programs | jq .
```

The report lists:

- **Big-win X:** every live close of +50% or more in the window, the reason each one was or was not picked, the exact text of the post it would send, and the post budget across every automated lane on the account.
- **First-rug softener:** every account with a live trade, whether its first trade qualifies, the dollar amount, and each criterion it failed in plain words.
- **Early leaders:** every agent with a live record, its stats, the criteria it still misses, open slots, and who would be enrolled.
- **Ledger:** payout rows by program and status (empty until a payout program is armed).

The crons return the same dry run in their response body, so the Cloud Scheduler run history shows it too.

---

## Big-win X poster

When a live agent trade closes as a meaningful win, the poster sends one post to @trythreews linking to the trade card at `https://three.ws/trade/<position id>`. The card page ([`api/trade-share.js`](../api/trade-share.js)) and its unfurl image ([`api/trade-og.js`](../api/trade-og.js)) render from the same on-chain row, so the numbers in the timeline are the numbers on the page, and every leg links to Solscan.

An example of the exact text, composed from a real closed trade (the size gate would hold this one back, since it was a 0.001 SOL fill):

```text
Crosshair closed a live pump.fun trade at +224% (3.2x) in 5m: 0.001 SOL in, 0.002 SOL out. A moon-bag is still riding. Both legs link to their on-chain transactions on the card.

https://three.ws/trade/a45efe3a-fdcf-4baa-9471-a6dd2e6c7cc3
```

**What qualifies**

- A live fill: both the buy and the sell carry real on-chain signatures. Paper fills are never posted.
- At least `BIG_WIN_X_MIN_PCT` return, `BIG_WIN_X_MIN_ENTRY_SOL` in, and `BIG_WIN_X_MIN_PNL_SOL` realized, closed in the last `BIG_WIN_X_LOOKBACK_HOURS`.
- A public agent, not closed on an error, and not a trade on a coin the owner launched (the self-dealing rule the Trader Card uses).

**What the post will never say**

- **It never names the traded coin.** $THREE is the only coin the account promotes, so the post has no ticker, no cashtag and no mint address. The card carries the detail for anyone who clicks.
- The text must pass the same filter as the changelog lane on X ([`data/changelog-x-filter.json`](../data/changelog-x-filter.json): no wallet or money-movement internals, no other coins, no gated project names) and the account's voice lint ([`api/_lib/x-content/quality.js`](../api/_lib/x-content/quality.js): no hashtags, emoji, dashes or hype). A post that fails either is held back with the reason.
- The agent's name is set by its owner, so a name containing a cashtag, an @handle, a hashtag or a link disqualifies the post instead of being printed.

**Rate:** one post per run, at most `BIG_WIN_X_DAILY_CAP` in 24 hours, one per agent per `BIG_WIN_X_PER_AGENT_HOURS`, and never once the account has made `BIG_WIN_X_ACCOUNT_DAILY_CAP` automated posts in 24 hours across every lane (changelog replies and the content queue count too). A rate limit from X backs the lane off until X's own reset time.

Cron: `/api/cron/big-win-x` at minutes 11 and 41 of every hour. State lives in `app_settings` under `big_win_x`.

---

## First-rug softener

An optional $THREE pool that pays back part of a first-timer's first rug. It is a welcome guarantee for someone new: the first time you trade and the coin turns out to be a rug, you get some of it back.

**Who qualifies.** Every criterion comes from real records, never from what the claimant says:

| Criterion | Rule |
|---|---|
| First trade | The claim is against the account's first-ever live trade (a real on-chain buy by one of its agents), with no earlier copy trade. Paper fills never count. |
| Real loss | It closed at a realized loss of at least `RUG_SOFTENER_MIN_LOSS_SOL`, with at least `RUG_SOFTENER_MIN_ENTRY_SOL` in. |
| Verified rug | The coin has a "rugged" verdict from the Coin Intelligence labeler (`pump_coin_outcomes`, or its long-lived copy `oracle_training_set`). A coin that just went down is a bad trade, not a rug. |
| Not the rugger | The coin's creator is known and is none of the claimant's wallets; the coin was not launched from the claimant's account; none of the claimant's wallets sold the coin at a profit; the trading wallet was not funded by the creator. |
| One person | The trading wallet belongs to exactly one account; the account is at least `RUG_SOFTENER_MIN_ACCOUNT_AGE_HOURS` old and is not a platform account; one claim per account and one per receiving wallet, ever (enforced by unique indexes in the database). |
| Fresh | Claims open for `RUG_SOFTENER_CLAIM_WINDOW_DAYS` after the trade closed. The evidence is saved into the claim when it is made, so a later payout never depends on data that has since aged out. |

**How much.** `RUG_SOFTENER_REIMBURSE_PCT` of the SOL lost, valued in USD when the claim is made, capped at `RUG_SOFTENER_MAX_PER_CLAIM_USD`. It is paid in $THREE at the live price when it goes out. Example with the defaults: a 0.15 SOL loss at $120 per SOL pays 50% of $18, which is $9.00 in $THREE.

**The claim flow.** When the program is armed, an eligible account sees a banner at the top of the Sniper dashboard (`/dashboard/sniper`) with a Claim button. The API behind it:

```bash
# Eligibility for the signed-in account: every criterion, the amount, any claim on file
curl -s -b cookies.txt https://three.ws/api/sniper/rug-softener

# Record the claim (403 program_not_open until the owner arms the program)
curl -s -b cookies.txt -X POST -H "x-csrf-token: $CSRF" https://three.ws/api/sniper/rug-softener
```

While the program is disarmed, the banner never renders and `POST` answers `403 program_not_open`. `GET` always answers, so an account can see where it stands.

---

## Early-leader program

A bounded $THREE bonus for the first `EARLY_LEADER_SLOTS` traders whose record clears every bar below. It creates a supply of credible leaders to copy before organic copy demand exists.

| Criterion | Default |
|---|---|
| Live closed trades on mainnet | at least 30 |
| History from first to latest close | at least 30 days |
| Win rate | at least 55% |
| Capital deployed | at least 1 SOL |
| Realized P&L | above zero |
| Max drawdown (share of capital deployed) | at most 50% |
| Copyable | clears the copy-trading bar in [`copy-eligibility.js`](../api/_lib/copy-eligibility.js) |
| Followers | at least 1 copier (never the leader's own account) with closed copies, whose net copy profit is zero or better, measured the way [copy trading](./copy-trading.md) bills performance fees |
| Eligibility | public agent, has a Solana wallet to pay, not owned by a platform account |

P&L on a coin the trader launched is left out of the record, as on the Trader Card. "First" means by qualification time: the close at which the record first cleared every trading bar. Each owner account can hold one slot, and a slot once taken is kept. The bonus, `EARLY_LEADER_BONUS_USD`, is paid in $THREE at the live price to the agent's Solana wallet.

---

## Flags and caps

Flags arm on exactly `1` or `true`. Anything else, including unset, `yes` or a typo, is off. Every number has a ceiling in code ([`config.js`](../api/_lib/growth-programs/config.js)): the environment can lower a cap but never raise it past the ceiling, so raising one is a reviewed code change.

| Variable | Default | Ceiling | Meaning |
|---|---|---|---|
| `BIG_WIN_X_ENABLED` | off | | Arms posting |
| `BIG_WIN_X_MIN_PCT` | 100 | | Minimum return, in % |
| `BIG_WIN_X_MIN_ENTRY_SOL` | 0.1 | | Minimum SOL in |
| `BIG_WIN_X_MIN_PNL_SOL` | 0.1 | | Minimum SOL realized |
| `BIG_WIN_X_LOOKBACK_HOURS` | 24 | 72 | How far back a close may be |
| `BIG_WIN_X_DAILY_CAP` | 2 | 4 | Posts from this lane per 24h |
| `BIG_WIN_X_PER_AGENT_HOURS` | 24 | 720 | Cooldown per agent |
| `BIG_WIN_X_ACCOUNT_DAILY_CAP` | 15 | 15 | Automated posts per 24h across all lanes |
| `RUG_SOFTENER_ENABLED` | off | | Arms claims and payouts |
| `RUG_SOFTENER_REIMBURSE_PCT` | 50 | 50 | Share of the loss paid back |
| `RUG_SOFTENER_MAX_PER_CLAIM_USD` | 25 | 100 | Cap per claim |
| `RUG_SOFTENER_DAILY_CAP_USD` | 100 | 500 | Rolling 24h cap on everything paid |
| `RUG_SOFTENER_MIN_LOSS_SOL` | 0.02 | | Minimum realized loss |
| `RUG_SOFTENER_MIN_ENTRY_SOL` | 0.05 | | Minimum SOL in |
| `RUG_SOFTENER_CLAIM_WINDOW_DAYS` | 14 | 30 | Days after the close a claim stays open |
| `RUG_SOFTENER_MIN_ACCOUNT_AGE_HOURS` | 24 | | Minimum account age at claim time |
| `EARLY_LEADER_ENABLED` | off | | Arms enrollment and payouts |
| `EARLY_LEADER_SLOTS` | 20 | 50 | Total leaders the program ever pays |
| `EARLY_LEADER_BONUS_USD` | 50 | 250 | Bonus per leader |
| `EARLY_LEADER_WEEKLY_CAP_USD` | 250 | 1000 | Rolling 7-day cap on everything paid |
| `EARLY_LEADER_MIN_SETTLED`, `_MIN_SPAN_DAYS`, `_MIN_WIN_RATE_PCT`, `_MIN_DEPLOYED_SOL`, `_MAX_DRAWDOWN_PCT`, `_MIN_FOLLOWERS` | 30, 30, 55, 1, 50, 1 | | The qualification bar above |

With the defaults, the most the two payout programs can ever send is $100 a day (softener) and $1,000 in total across 20 slots at no more than $250 a week (early leaders).

---

## How a payout is sent

Both payout programs write committed payouts to one ledger table, `growth_program_payouts` (migration [`20260929120000_growth_program_payouts.sql`](../api/_lib/migrations/20260929120000_growth_program_payouts.sql)). `/api/cron/growth-payouts` runs at minute 23 of every hour. Before any program runs, the platform-wide payout kill switch is checked: while the `payouts_paused` runtime flag is on (or `PAYOUTS_PAUSED=true` when no flag row exists), the run answers `{ ok: true, paused: true, reason: 'payouts_paused' }` and claims and sends nothing. An admin flips it with `POST /api/admin-payouts-pause` `{ paused, reason }` (a reason is required to pause; `GET` reads the state; every flip is audited), see [financial controls](financial-controls.md). Queued rows stay `claimed` until payouts resume. For each program it then refuses to send unless all of these hold:

1. The program's flag is set.
2. The dedicated payout key is configured: `THREE_PRIZE_PAYOUT_KEY`, the same funded $THREE wallet the [Arena](./trading-arenas.md) pays tournament prizes from, so there is one payout wallet to watch. The Arena's fallback to the club treasury secret is deliberately not used here: on production that secret is the economy master (funding root) wallet, which these programs must never spend. As of 2026-11-04 (read from the live service, unchanged since 2026-09-29), `THREE_PRIZE_PAYOUT_KEY` is not set on production, so an armed payout program reports `payout_unconfigured` and sends nothing until it is.
3. The recipient is a valid Solana address and not a platform wallet (the treasury, the rewards pool, or the payout wallet itself).
4. The payout fits under the program's rolling cap, summed over everything already sending or sent in the period. The queue is first-come-first-served: a payout that does not fit waits for the window to roll, and a smaller one behind it does not jump ahead.
5. A live $THREE price is available. A payout never goes out at a guessed price.

Each row moves to `sending` in a single compare-and-set before the transfer, so two overlapping runs can never pay it twice. The transfer is a Token-2022-aware `TransferChecked` ([`transferSplTokenChecked`](../api/_lib/solana-transfer.js); the mint-generic treasury rail `transferSolanaUSDC` resolves the mint's token program and decimals the same way), sent through the platform's protected send path on an uncached RPC connection (`fresh: true`), so its reads skip the shared recent-read cache and always go upstream. A row that is left in `sending` after a crash is never retried automatically: reconcile it by hand against the chain.

Row statuses: `claimed` (queued), `sending`, `sent` (with `tx_signature`), `failed` (retried next run), `blocked` (a guard refused it; `note` says why).

---

## Owner steps to arm

Each program is armed on its own. Do not arm anything until you have read today's dry run.

**Before either payout program**

1. Apply the ledger migration: `npm run db:status`, confirm `20260929120000_growth_program_payouts.sql` is the pending one you expect, then `npm run db:migrate`.
2. Set `THREE_PRIZE_PAYOUT_KEY` on the Cloud Run service (it is unset as of 2026-11-04) to a dedicated wallet holding enough $THREE, plus a little SOL for fees and new token accounts, to cover the caps. Store it in Secret Manager like the other keys, and check it with `node scripts/read-service-env.mjs '^THREE_PRIZE_PAYOUT_KEY$' --names`.
3. Deploy the commit that ships this code, following the deploy runbook in `CLAUDE.md`, so both crons exist and Cloud Scheduler has synced them.
4. Read the dry run: `curl -s -H "x-ops-secret: $OPS_SECRET" https://three.ws/api/ops/growth-programs | jq .`

**Arm the first-rug softener**

```bash
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars RUG_SOFTENER_ENABLED=1
```

Eligible accounts then see the claim banner on `/dashboard/sniper`, and claims are paid on the next hourly run.

**Arm the early-leader program**

```bash
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars EARLY_LEADER_ENABLED=1
```

The next hourly run enrolls whoever the dry run listed under `would_enroll` and pays them within the weekly cap.

**Arm the big-win X poster**

The X credentials (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_SECRET`) are already on the service for the changelog lane. Read the `would_post` text in the dry run, then:

```bash
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars BIG_WIN_X_ENABLED=1
```

Always use `--update-env-vars`, never `--set-env-vars`, which replaces the whole environment. To tune a threshold or cap, pass it the same way (for example `--update-env-vars RUG_SOFTENER_DAILY_CAP_USD=50`).

**Disarm** any program at once by removing its flag:

```bash
gcloud run services update three-ws-api --region us-central1 --project aerial-vehicle-466722-p5 \
  --remove-env-vars RUG_SOFTENER_ENABLED
```

Payouts already queued stay in the ledger as `claimed` and are paid only if the program is armed again.

---

## Related

- [Copy trading](./copy-trading.md): the follower economy the early-leader bonus seeds.
- [The Oracle model](./oracle-model.md): the Coin Intelligence labels, including the rug verdict, that the softener reads.
- [The X content pipeline](./x-content-pipeline.md): the reviewed posts that share the account's daily budget with this lane.
- [`STRUCTURE.md`](../STRUCTURE.md): where every surface lives.
