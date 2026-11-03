# Coin Control

Coin Control is where a creator runs the coin their agent launched through three.ws. It turns creator fees into actions holders can see: buybacks, burns, SOL rewards to holders, and bounties paid from the agent wallet. Every action is published with its Solana transaction on a public proof page.

- Owner page: `/coin-control` (pick a coin; `?agent=<id>&network=mainnet|devnet` selects one directly)
- Public proof page: `/coin-control/<mint>`

## What it does

| Action | How it runs | What holders see |
| --- | --- | --- |
| Buy back and burn | A reinvest rule leg (`buyback_burn`). Each period it buys the coin with SOL from the agent wallet, then burns exactly what that buy returned | The buy transaction, the burn transaction and the amount burned |
| SOL rewards to holders | A reinvest rule leg (`holder_rewards`), in `pro_rata` mode (split by holding size) or `lottery` mode (weighted draw) | Every recipient, the SOL each got and the transaction; for a lottery, the seed and blockhash to re-check the draw |
| Buy and hold | The existing `dca_own_coin` leg | The buy transaction |
| Bounties | Posted from Coin Control, paid from the agent wallet when the owner picks a winner | The bounty on the public board and its payout transaction |
| Verified X | The owner connects X once (`/api/auth/x/connect?scope=read&return_to=/coin-control`) | A badge with the creator's handle on the proof page |

The page also shows the fee split for the coin (100% to the creator on a standard launch, the published gasless split on a sponsored launch), the agent's revenue from the [revenue ledger](revenue-ledger.md), the agent wallet balance, and the agent's 3D body, which reacts when the engine acts.

## Rules: nothing moves without a confirm

Engine legs are ordinary [reinvest rules](revenue-ledger.md#reinvest-rules) and get every safeguard those have:

1. A rule runs only after the owner confirms the exact terms from a signed-in browser. Any edit changes the rule hash and clears the confirmation.
2. A per-run cap and a lifetime cap bound every run. Runs under the minimum are skipped.
3. Each period runs once, and every leg has its own idempotency key.
4. Every send passes the agent's spend guards. A guard that wants the owner's yes parks the action in the [approvals inbox](approvals.md).

Owners can start from a preset (burn half, reward the top 10 holders, or burn plus a weekly lottery) and adjust it before saving.

### Buyback and burn

- The burn amount is read from the confirmed buy transaction (the agent's token balance before and after), never from the quote, and is capped at what the wallet holds. Tokens the agent already held are never burned.
- Pump coins are Token-2022; the burn uses the mint's own token program and `burnChecked`.
- A burn is claimed atomically before it is sent, so two workers never burn the same buy. A burn that fails is retried on the next hourly pass (`settleBurns`, up to 5 attempts). A buy that returned nothing records a skipped burn with the reason.

### Holder rewards

- The pot is the leg's capped USD at the live SOL price. With no live price, nothing is sent.
- Eligible holders are wallets (on-curve keys) that hold the coin, from the top 50. The agent wallet, the platform deposit wallet, program-owned accounts such as the bonding curve, and the creator's own wallets are left out.
- `pro_rata`: the top N holders (1 to 20, default 10) split the pot by balance. A share under 0.001 SOL is dropped and the pot re-split; rounding dust goes to the largest holder.
- `lottery`: N winners (default 3) are drawn without replacement from the eligible pool, weighted by balance. The seed is `sha256("<leg key>|<recent finalized blockhash>")`, recorded with the result, so anyone can re-run the draw.
- Sends go out 10 recipients per transaction. If the owner's policy asks for approval, the whole planned list is parked, and the approval pays exactly the list the owner saw.

### Bounties

- A bounty has a title, optional details, a SOL reward (0.001 to 1000) and an expiry (1 to 30 days). It appears on the public bounty board (`/bounty/<id>`).
- Paying is two steps: a preview shows recipient, amount, chain and route; the confirm (signed-in session only, never an API key) sends it. The preview is checked against the chosen winner and the reward before anything moves.
- The bounty is claimed (`open` to `resolving`) before the send, so a double click never pays twice. If the send needs approval, the bounty waits and closes when the approval executes, or reopens if it is denied or expires.
- A winner without a linked Solana wallet cannot be paid; the page says so.

## API

All under `/api/coin-control`, in the v1 envelope (`{ data, meta }`, errors as `{ error: { code, message } }`). Route table: `api/_lib/coin-control/routes.js`.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /public/:mint` | Public | The proof feed: coin, fee split, creator X, engine legs switched on (no caps), totals, events, bounties |
| `GET /coins` | Owner, `wallet:read` | Every coin the owner launched |
| `GET /overview?agent_id&network` | Owner, `wallet:read` | Coin, fee split, earnings, wallet, X, rules, totals, events, bounties with submissions |
| `GET /holders?agent_id&network` | Owner, `wallet:read` | The top 20 wallets a holder reward would reach now |
| `POST /bounties` | Owner, `agents:write` | Body `{ agent_id, network, title, description?, reward_sol, expires_in_days? }` |
| `POST /bounties/:id/payout/preview` | Owner, `agents:write` | Body `{ submission_id }`; returns the confirmation and `preview_id` |
| `POST /bounties/:id/payout/confirm` | Owner, session only | Body `{ submission_id, preview_id }`; pays or parks for approval |

Rules are created and confirmed through `/api/revenue/rules` with legs such as `{ "kind": "buyback_burn", "pct": 40 }` and `{ "kind": "holder_rewards", "pct": 20, "mode": "lottery", "recipients": 3 }`.

## Files

- Pure logic (holder split, lottery, token deltas): `api/_lib/coin-control/core.js`
- Chain actions (holders, burn, SOL airdrop): `api/_lib/coin-control/chain.js`
- Read models and bounties: `api/_lib/coin-control/index.js`
- Routes: `api/_lib/coin-control/routes.js`, mounted at `api/coin-control/[...route].js`
- Engine legs: `api/_lib/revenue-reinvest.js` (run by `api/cron/revenue-reinvest.js`), rule shape in `api/_lib/revenue-ledger-core.js`
- Migration: `api/_lib/migrations/20261103000000_coin_control_bounties.sql`
- Page: `pages/coin-control.html`, `src/coin-control.js`, `src/coin-control.css`
- Tests: `tests/coin-control.test.js`
