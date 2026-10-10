# Staked Event Markets on Solana

Status: built and tested on a local validator. Not deployed to any cluster. Off by default (`EVENT_MARKETS_STAKING_ENABLED` unset). The free-to-play picks remain the public product; staking is a second, separate panel that only appears for eligible viewers once the owner turns it on.

Legend: **[Rec]** is my recommended default, chosen so the owner is not interviewed. **[Owner]** is a decision only the owner (and counsel) can make. Every default lives in [api/_lib/event-markets/staking/config.js](../api/_lib/event-markets/staking/config.js) or on-chain config, so changing one is a one-line edit.

## What was built

| Piece | Where |
| --- | --- |
| Anchor program: create pool, stake, lock, resolve, claim, refund, void, permissionless expiry void | [contracts/event-markets-stake/](../contracts/event-markets-stake/README.md) |
| Server: unsigned stake and payout transactions, preview, gate, caps, ledger, reconciliation | [api/_lib/event-markets/staking/](../api/_lib/event-markets/staking/) |
| Routes | `GET/POST /api/event-markets/:slug/staking[/attest\|/stake\|/payout\|/record]` |
| Admin API and page | `/api/event-markets/staking-admin`, `/admin/event-markets-staking` |
| Owner CLI (every fund-moving command is dry-run until `--yes`) | [scripts/event-markets-stake-admin.mjs](../scripts/event-markets-stake-admin.mjs) |
| Stake panel on the market page | [src/event-markets/staking-panel.js](../src/event-markets/staking-panel.js) |
| Tests | [tests/event-markets-staking.test.js](../tests/event-markets-staking.test.js), [tests/event-markets-staking.chain.test.js](../tests/event-markets-staking.chain.test.js) |

The server never holds funds and never signs a stake. It returns a base64 transaction with the staker as fee payer and no signatures; the staker's own wallet signs after an explicit confirm. The only keys the platform holds are the program authority (config changes) and the resolver (create pool, lock, resolve, void). Neither can move a staker's funds to anywhere except the pool's own payouts and the fee destinations recorded in the pool at creation.

## Decision record

### 1. Model: parimutuel, 3% fee [Rec]

All stakes on a market go in one pool. Winners split the pool, minus the fee, in proportion to their stake on the winning outcome. There is no house counterparty and no price to take, so the platform carries no market risk.

```
fee      = floor(total * fee_bps / 10000)
payout   = floor(stake * (total - fee) / winning_total)
```

Rounding dust (a few base units) stays in the vault. The JS preview and the program use the same integer math; the chain test asserts equality to the base unit for every payout. Fee 3% (300 bps) [Rec]; the program hard-caps it at 10% so a bad config cannot take more. [Owner]: confirm the rate.

### 2. Stake tokens: USDC and $THREE [Rec]

One token per pool, chosen when the pool is created. Classic SPL and Token-2022 mints both work. USDC gives a stable unit; $THREE keeps the platform coin at the center. Devnet uses the devnet USDC mint and the real $THREE mint address from `THREE_TOKEN_MINT`. [Owner]: confirm the token list.

### 3. Fee split and buyback share [Rec]

50% of the fee goes to a $THREE buyback wallet, 50% to the treasury. Both destinations and the split are snapshotted into each pool at creation, so a later config change cannot redirect a live pool. The program transfers the fee at resolve time; the platform does not hold it. The buyback wallet only receives the fee token; executing the actual buyback is a separate owner-gated action and is not built here. [Owner]: split ratio, and the two destination wallets.

### 4. Limits [Rec]

| | USDC | $THREE |
| --- | --- | --- |
| Min stake | 1 | 1,000 |
| Max per account per market | 100 | 1,000,000 |
| Max pool per market | 5,000 | 50,000,000 |
| Daily per account (server) | 250 | 2,500,000 |

Min, per-account and pool caps are enforced on-chain as well as by the server. The daily cap is server-side. Small on purpose for a first launch. [Owner]: raise after the audit.

### 5. Timing [Rec]

- Staking closes at the market's `locks_at` (the on-chain `lock_ts`). The resolver can also lock early.
- The owner resolves on-chain after the platform market resolves; the winner is read from the platform's resolved row, never typed in.
- If the pool is not resolved within 7 days of the lock, anyone can void it (`void_expired`) and every staker refunds. This bounds the damage of a lost or compromised resolver key to a delay, never a loss.

### 6. Void, refund and the no-winner cases [Rec]

- **Void** (platform void, tie, cancellation, or expiry): every staker refunds their full stake. No fee is taken.
- **Nobody picked the winner:** the pool is voided and everyone refunds in full. The house does not keep losers' stakes when no one could have won. The CLI refuses to resolve in this case and points at `void`.
- **No contest** (every stake on the winner): nobody loses, so the pool refunds with no fee.
- Claims, refunds and `void_expired` can never be blocked by the kill switch or by pausing the program.

### 7. Safety controls

- Per-account and per-market caps (above), plus the daily cap.
- Instant kill switch: the admin page, or `pause` in the CLI. It stops new pools and new stakes only.
- Admin reconciliation page: for every pool, vault balance against `totalStaked - feePaid - paidOut`, and on-chain totals against recorded stakes. A short vault is flagged as the alarm case.
- Staked and free-to-play never share a leaderboard. Stakes are not points, never enter scoring, and the panel states this.
- Token names, symbols and entrant labels are untrusted data: a stake or payout is only ever built from the signed-in user's own request, the pool's recorded outcome ids and the user's wallet.

### 8. Jurisdiction and age gating [Owner]

I am not a lawyer and this is not legal advice. Staking real tokens on event outcomes is likely regulated as gambling, a wagering product or a derivative in many places. Open questions for counsel:

1. Which jurisdictions may the product serve at all, and is a licence needed anywhere it is offered?
2. Is a parimutuel prediction pool on platform-internal events (Arena results, bounties) treated differently from sports or political outcomes?
3. Minimum age. Default 21 [Rec] (the strictest common threshold).
4. Do the terms, KYC or sanctions screening need more than a self-attestation?
5. Does a buyback funded by wagering fees change how $THREE is characterized?

Defaults shipped [Rec], all editable by env: blocked regions `US,GB,FR,AU,SG,CN,KP,IR,CU,SY,RU,BY,MM,SD,SS` (`EVENT_MARKETS_STAKING_BLOCKED_COUNTRIES`); minimum age 21 (`EVENT_MARKETS_STAKING_MIN_AGE`). Region comes from the edge geo header, never from the client; an unknown region counts as blocked. Eligibility needs a signed-in account, a current attestation (age, lawful in region, terms version) and a matching region. Everyone else sees the free picks only. Because the gate relies on a geo header, VPN use defeats it; that is a legal question above, not an engineering one.

### 9. Reusable audited code [finding]

I searched for an audited, reusable parimutuel or escrow program. The repo has [contracts/knock-escrow/](../contracts/knock-escrow/README.md), a two-party escrow that cannot express pools, per-outcome totals or proportional payouts. `solana-agent-sdk` and `agent-payments-sdk` build and send transfers but ship no on-chain program. I found no audited open-source parimutuel pool that supports both token programs and the void rules above, so the program is new and minimal (about 600 lines). It is **unaudited**.

## Owner steps (one command each)

Nothing below has been run. Fund-moving commands print recipient, amount, token and chain, and do nothing without `--yes` (and `--confirm-mainnet` on mainnet).

1. **Audit.** Have the program reviewed externally. Local suite: `npm run test:stake-program`.
2. **Generate the keys** (authority and resolver, hardware-backed in production): `solana-keygen new -o ~/.config/three-ws/stake-authority.json` and the same for the resolver; set `EVENT_MARKETS_STAKE_AUTHORITY_KEYPAIR` and `EVENT_MARKETS_STAKE_RESOLVER_KEYPAIR` to the file paths.
3. **Deploy the program.** `cd contracts/event-markets-stake && cargo build-sbf && solana program deploy target/deploy/event_markets_stake.so --program-id target/deploy/event_markets_stake-keypair.json --url mainnet-beta` (devnet first with `--url devnet`). Set `EVENT_MARKETS_STAKE_PROGRAM_ID`.
4. **Apply the migration.** `npm run db:status` then `npm run db:migrate` (20261013000000).
5. **Initialize the config.** `node --env-file=.env scripts/event-markets-stake-admin.mjs init --treasury <wallet> --buyback <wallet> --yes`
6. **Create a pool for a market.** `... create-pool --market <slug> --token usdc --yes`
7. **Enable the flag.** `gcloud run services update three-ws-api --region us-central1 --update-env-vars EVENT_MARKETS_STAKING_ENABLED=1,EVENT_MARKETS_STAKE_CLUSTER=mainnet`
8. **After a market resolves:** `... resolve --market <slug> --yes` (or `void` if nobody picked the winner).
