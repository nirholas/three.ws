# pump-fun-trade

Signing actions for pump.fun. Pairs with the read-only `pump-fun` skill.

| Tool | Use it for |
|---|---|
| `quoteTrade` | Simulate buy/sell, get price impact and route |
| `buyToken` | Buy via bonding curve or PumpSwap AMM (auto-routed) |
| `sellToken` | Sell by token amount or % of holdings |
| `createToken` | Launch a new token, optional dev buy |

## Wallet

Host runtime must inject `ctx.wallet` with `{ publicKey, sendAndConfirm(tx, conn) }`.
No keys are accepted via tool args.

## Safety caps

- `manifest.config.maxSpendSol` hard-caps any single `buyToken` call.
- `slippageBps` defaults to 100 (1%); override per call.
- All trades are noted in `ctx.memory` for the orchestrator to audit.

## Suggested pairing

Compose with `pump-fun` (read-only) — research first, then act:

1. `pump-fun.searchTokens` → pick mint
2. `pump-fun.getCreatorProfile` → reject on rug flags
3. `pump-fun-trade.quoteTrade` → check impact
4. `pump-fun-trade.buyToken` → execute under cap
