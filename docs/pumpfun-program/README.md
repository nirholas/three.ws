# pump.fun program reference (vendored snapshot)

Read-only reference copy of pump.fun's public program docs + IDLs, vendored into
this repo so on-chain work (instruction builders, fee logic, swap routing) can be
diffed against the source of truth without a network round-trip.

- **Source:** https://github.com/pump-fun/pump-public-docs
- **Commit:** `2293f9a66c654e9fe82dc5e8f4618538f24bb35f`
- **Vendored:** 2026-10-09 (docs; IDLs come from `npm run pump:refresh-idls`). Em and en dashes are rewritten to hyphens on copy, and links to files not vendored here (the `.ts` IDL types, the retired `bondingCurve.ts`) point at the upstream commit or the published SDK. Nothing else is changed.
- **Maintainers (npm publishers of `@pump-fun/*`):** `oussama-baton`, `security-baton`

This is a snapshot, not a dependency. Do not edit these files to "fix" anything —
re-vendor from upstream to update. Nothing here is imported by application code.

## What's in here

| Path | What it covers |
| --- | --- |
| `UPSTREAM-v3-trades-fee-sweeps-announcement.md` | **The pump-sdk 4.0 / pump-swap-sdk 2.1 release** (2026-10-09): 17-account `buy_v3` / `sell_v3` and PumpSwap `buy_v2` / `sell_v2`, `multi_hop_swap`, pump coins as quote mints, creator and protocol fees kept on the curve and pool until swept, and synthetic migration. |
| `docs/instructions/TRADE_V3.md`, `PUMP_SWAP_TRADE_V2.md`, `MULTI_HOP_SWAP.md` | The smaller trade instructions and the multi-hop swap. |
| `docs/instructions/SWEEP_FEES.md` | `sweep_creator_fee` / `sweep_protocol_fee` on both programs, and the `CreatorFeesNotSwept` errors a collect, distribution, CTO or fee-sharing change hits without them. |
| `docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md` | `create_v2` paired with an existing pump coin. |
| `docs/SYNTHETIC_MIGRATION.md` | The completing v3 buy that continues into the pool's tokens, and the `PostCompleteBuyEvent` indexers must add to its `TradeEvent`. |
| `docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md`, `NEGATIVE_VIRTUAL_QUOTE_RESERVES.md` | Why pool `virtual_quote_reserves` goes negative (kept fees are subtracted from it). |
| `docs/HOLDER_REWARDS_README.md` | Holder-reward coins. |
| `UPSTREAM-buy-sell-v2-announcement.md` | **The v2 trade-instruction announcement** — `buy_v2` / `sell_v2` / `buy_exact_quote_in_v2`, the move to a unified interface, and USDC-as-quote support. (Upstream's root README.) |
| `UPSTREAM-pumpswap-virtual-quote-reserves.md` | **PumpSwap virtual quote reserves** (2026-07-20) — quotes price on `quote_vault_balance + virtual_quote_reserves`. The double-count and silent-default traps, and every three.ws surface that had to change. |
| `idl/pump.json` | Bonding-curve program IDL (canonical account/arg shapes). |
| `idl/pump_amm.json` | PumpSwap AMM (graduated pools) IDL. |
| `idl/pump_fees.json` | Fee program IDL (`fee_config`, `sharing_config`, creator-fee sharing). |
| `docs/instructions/BUY.md`, `SELL.md` | `buy_v2` / `sell_v2` full account lists + arg validation + TS/Rust SDK calls. |
| `docs/instructions/COIN_CREATION.md` | `create` / `create_v2` (Token-2022 base mints). |
| `docs/instructions/CLAIM_CASHBACK.md`, `COLLECT_CREATOR_FEE.md`, `CREATOR_FEE_SHARING.md` | Cashback + creator-fee flows. |
| `docs/PUMP_SWAP_README.md`, `PUMP_SWAP_SDK_README.md` | AMM swap mechanics + SDK. |
| `docs/FEE_PROGRAM_README.md`, `FEE_RECIPIENTS.md`, `PUMP_CASHBACK_README.md`, `PUMP_CREATOR_FEE_README.md` | Fee program, recipient address lists, cashback, creator fees. |
| `docs/BREAKING_FEE_RECIPIENT.md`, `CPI_README.md`, `FAQ.md` | Breaking changes, CPI integration, FAQ. |

## Latest change: fees kept on the curve and pool (pump-sdk 4.0, 2026-10-09)

v3 bonding-curve trades and PumpSwap v2 trades no longer pay the creator fee
into the creator vault. It accrues on `BondingCurve.creator_fee` or
`Pool.creator_fees` until a permissionless `sweep_creator_fee` moves it. How
three.ws handles it:

- **Every claim sweeps first.** The creator-fee collect paths (connected
  wallet, agent wallet, the auto-claim cron, the coin treasury claimer, the
  in-browser skill, and the `pump-fun-skills/coin-fees` scripts) put sweeps in
  front of the collect, sized to fit one transaction. Distribution and
  fee-sharing changes sweep first too, since the programs refuse them with
  `CreatorFeesNotSwept` while a bucket is nonzero. Shared code:
  `src/solana/pump-creator-sweep.js`.
- **Balances count unswept fees.** The my-coins rewards, fee-info, the coin
  page's creator earnings and the earnings snapshot add the curve and pool
  buckets to the vault balance, so a fee that has not been swept yet still
  reads as unclaimed, not as claimed.
- **Trades fold synthetic migration.** The trade firehose, the MCP trade tools
  and the whale watcher add each `PostCompleteBuyEvent` to the `TradeEvent`
  before it (`src/pump/trade-events.js`). Graduation detection keys on
  `CompleteEvent`, which is still emitted, so it needed no change.
- **Our own trade builders stay on `buy_v2` / `sell_v2`.** Those keep paying the
  creator fee per trade and remain fully supported upstream.

## Earlier change: unified v2 trade instructions

pump.fun is migrating to **unified v2 bonding-curve trade instructions**
(`buy_v2`, `sell_v2`, `buy_exact_quote_in_v2`) so the same account interface works
for both SOL-paired and **USDC-paired** ("stable paired") meme coins. Key points:

- All accounts are mandatory and passed in the same order regardless of coin type
  (no more optional-account branching).
- `quote_mint` is now explicit — pass wrapped SOL
  (`So11111111111111111111111111111111111111112`) for SOL-paired coins, or the
  USDC mint for USDC-paired coins.
- New mandatory accounts on every buy/sell: `sharing_config`,
  `global_volume_accumulator`, `user_volume_accumulator`, `fee_config`,
  `fee_program`, plus a `buybackFeeRecipient`.
- `create_v2` coins use **Token-2022** base mints
  (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).
- SDK helpers: `PUMP_SDK.getBuyV2InstructionRaw(...)` / `buy_v2_instructions(...)`
  (and the `sell_v2` equivalents).

Our code already references `buy_v2`/`sell_v2`, `user_volume_accumulator`, and
`sharing_config`, so we appear aligned — but a focused audit against these docs is
tracked in `tasks/pumpfun-upstream/01-v2-trade-instructions-usdc-audit.md`.
