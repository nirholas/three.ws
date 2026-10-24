# Creator payouts

Creator fees from an agent's coins are claimed into the agent's custodial wallet. Creator payouts send the creator's share of each claim to a wallet you register, and record every distribution so you can see what was sent, what is waiting and why.

Use it to get your share out of the agent wallet on a schedule, with a full audit trail. The page is [/creator/payouts](https://three.ws/creator/payouts).

## The flow

```
earnings refresh -> fee collection -> distribution -> reconciliation
```

| Stage | Cron | What it does |
| --- | --- | --- |
| Earnings refresh | `/api/cron/creator-earnings-snapshot` | Reads what each coin has earned from pump.fun and the on-chain vault. |
| Fee collection | `/api/cron/launcher-claimer` | Claims accrued creator fees into the agent wallet once they pass the claim threshold, and records the claim with its buyback earmark. |
| Distribution | `/api/cron/creator-payout-distribute` | Records each new claim's creator share, then sends what can be sent to the payout wallet. |
| Reconciliation | `/api/cron/creator-payout-reconcile` | Checks the on-chain vault balances and sent transfers against the records, and alerts on drift. |

Cadences are read from the cron definitions in `vercel.json` by `GET /api/creator-payouts?info=1`, so the page never shows a stale schedule.

## Where $100 of claimed fees goes

Generated from `CREATOR_FEE_CLAIM_POLICY` in `api/_lib/token/config.js`, the same policy the claimer uses to earmark the platform $THREE buyback. The remainder is your share, sent to the payout wallet.

## The payout wallet

- Register it on the page by connecting the wallet. The wallet signs a challenge message that names the agent, the wallet, a one-use nonce and a timestamp (Ed25519, valid for five minutes).
- A step-up confirms the owner is at the keyboard: account password or an emailed code, through the same grant mechanism as the [destination allowlist](destination-whitelist.md).
- Only a signed-in browser session can register. A bearer token or API key is refused, so a leaked key can never redirect payouts.
- The nonce is spent once, so a captured signature cannot register twice.
- The first wallet is active immediately. Changing it stages the new wallet for 48 hours, and payouts are held until it takes effect. The owner can cancel the change during the wait, and is notified.

## Why a share is held

| Reason | Meaning |
| --- | --- |
| `wallet_not_registered` | No payout wallet yet. Register one and the share is sent. |
| `cooldown` | A wallet change is waiting out its 48 hour protection window. |
| `below_minimum` | Unsent shares total less than the minimum payout (0.01 SOL). They add up across claims. |
| `payouts_paused` | Payouts are not switched on. Shares are recorded and sent once they are. |

A held share notifies the owner once per reason change, not once per run.

## Safety properties

- Every claim has exactly one distribution row (`claim_id` is unique), so the cron can re-run without double-recording.
- A batch moves `pending` to `sending` to `sent` with the transfer signature. A run that dies after sending is reconciled from the chain, not re-sent.
- The agent wallet keeps a small reserve for fees.
- Sending is gated by `CREATOR_PAYOUTS_LIVE=true` and is off by default.

## API

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/creator-payouts?info=1` | none | Stage cadences and the per-$100 flow. |
| `GET /api/creator-payouts?agent=<id>` | owner session | Payout wallet, pending change, totals, held reasons, recent distributions. |
| `GET /api/creator-payouts?agent=<id>&format=csv` | owner session | Every distribution as CSV. |
| `POST /api/creator-payouts` `{ action: "challenge" }` | owner session | The message the wallet must sign. |
| `POST /api/creator-payouts` `{ action: "register" }` | owner session + step-up grant | Register or stage a wallet change. |
| `POST /api/creator-payouts` `{ action: "cancel" }` | owner session | Drop a staged wallet change. |

`GET /api/agents/:id/earnings` carries a public `payouts` block with the registered wallet and the sent, pending and held totals. A staged change stays on the owner page.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `CREATOR_PAYOUTS_LIVE` | unset (off) | Set to `true` to send. Until then shares are recorded and held as `payouts_paused`. |

## Files

- Logic: `api/_lib/creator-payouts-core.js` (pure), `api/_lib/creator-payouts.js` (database and chain).
- Endpoint: `api/creator-payouts.js`. Crons: `api/cron/creator-payout-distribute.js`, `api/cron/creator-payout-reconcile.js`.
- Migration: `api/_lib/migrations/20261023190000_creator_payouts.sql`.
- Page: `pages/creator-payouts.html`, `src/creator-payouts-page.js`.
- Tests: `tests/creator-payouts.test.js`.
