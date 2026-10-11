# New: Smaller Trades, Multi-Hop Swaps, Pump Coins as Quote Mints, Fees Kept on the Curve

- **Smaller trade instructions.** `buy_v3`, `sell_v3` and `buy_exact_quote_in_v3` on the bonding curve, and `buy_v2`, `sell_v2` and `buy_exact_quote_in_v2` on PumpSwap, do the same trades with 17 accounts, so more fits in one transaction. Same prices, same fees. All existing trade instructions keep working. [Bonding curve v3](docs/instructions/TRADE_V3.md) · [PumpSwap v2](docs/instructions/PUMP_SWAP_TRADE_V2.md)
- **Multi-hop swap.** One PumpSwap instruction, `multi_hop_swap`, trades through two or more pools and bonding curves in a row, for example SOL → coin A → coin B, with no token account for the middle coin. [Multi-hop swap](docs/instructions/MULTI_HOP_SWAP.md)
- **Any pump coin as a quote mint.** `create_v2` can pair a new coin with an existing pump coin. You pass the quote coin's bonding curve (and its pool, if it has migrated) as extra remaining accounts. [Creating a coin paired with a pump coin](docs/instructions/CREATE_WITH_PUMP_COIN_QUOTE.md)
- **Fees stay on the curve and pool.** The new trades keep the protocol fee and the creator fee on the bonding curve or in the pool instead of paying them out on every trade. Anyone can pay them out with the permissionless `sweep_protocol_fee` / `sweep_creator_fee` instructions. Creators, CTOs and fee sharing must sweep the creator fee first. [Fee sweeps](docs/instructions/SWEEP_FEES.md)
- **Why `virtual_quote_reserves` goes negative.** Fees kept in a pool are subtracted from `virtual_quote_reserves`, so the price does not count them. If you already handle it as a signed value, this is not a breaking change for your quotes, and all existing trade instructions work the same way. [Virtual quote reserves and fees](docs/VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md)
- **Synthetic migration: the last buy on the curve has no max size.** With the v3 buys, the buy that empties the bonding curve can ask for more than what is left. It buys the rest from the tokens that would have gone into the PumpSwap pool, at that pool's price, and the pool later opens where that buy stopped. Only the buy that crosses the limit gets this; after it, no buys or sells are possible on the curve until the migration happens. [Synthetic migration](docs/SYNTHETIC_MIGRATION.md)

The IDLs and TypeScript types in [idl](idl) are updated with all of the above. SDK support: `@pump-fun/pump-sdk` 4.0.0, `@pump-fun/pump-swap-sdk` 2.1.0 and `pump-rust-client` 0.4.0, see [SDKs](#sdks).

## SDKs

These releases include builders for everything in the new section at the top: v3 trades, PumpSwap v2 trades, multi-hop swaps, pump coins as quote mints and fee sweeps.

- `@pump-fun/pump-sdk` 4.0.0 (Pump program): https://www.npmjs.com/package/@pump-fun/pump-sdk/v/4.0.0
- `@pump-fun/pump-swap-sdk` 2.1.0 (PumpSwap): https://www.npmjs.com/package/@pump-fun/pump-swap-sdk/v/2.1.0
- `pump-rust-client` 0.4.0 (both programs): https://crates.io/crates/pump-rust-client/0.4.0
