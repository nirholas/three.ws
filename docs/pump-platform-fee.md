# Pump.fun platform trade fee

three.ws charges **1% of trading volume on every customer trade it builds or signs**. The fee is a
**real on-chain transfer inside the same transaction as the trade** (native SOL for SOL-paired
coins, USDC for USDC-paired coins) to the platform treasury. One transaction, no custody, no second
signature.

## Where it applies

| Surface | Path | Fee basis |
|---|---|---|
| Trade modal (your wallet signs) | `src/game/coin-buy.js` → `/api/pump/buy-prep` · `/api/pump/sell-prep` | quote spent (buy) / expected proceeds (sell) |
| Agent wallet trade tab + `/api/agents/:id/solana/trade` | `api/agents/solana-trade.js` `buildTradeInstructions` | SOL spent / minimum SOL out |
| Agent strategies and mirror trading | same builder (`agent-strategy-runtime.js`, `agent-mirror.js`) | SOL spent / minimum SOL out |
| `/api/agents/:id/trade`, the market-maker (`workers/agent-mm`), programmable orders (`workers/agent-orders`) | `api/agents/agent-trade.js` `executeAgentTrade` | SOL spent / minimum SOL out |
| Aggregator and venue swaps by an agent (any SPL pair, `api/_lib/trading-tools/swap.js`, venues in `venues.js`; filled by `workers/agent-orders` for non-launchpad coins) | `api/agents/solana-trade.js` `buildVenueTradeInstructions`: the venue builds the swap, the same fee is appended so no venue can skip it. Quotes report it as `three_ws_fee_bps` | quote spent / minimum out |
| Sniper buys and sells (`workers/agent-sniper/executor.js`) | appended before broadcast; included in the position's cost basis and P&L | SOL spent / slippage-floor proceeds |
| Agent pump.fun buy, sell, AMM swap (`/api/agents/:id/pumpfun/*`) | `api/agents/pumpfun/[action].js` | quote spent / slippage-floor proceeds |
| Coin launches | the dev buy, see [Launch fee](#launch-fee-on-by-default) | dev buy |

Server-signed sells are billed on the **minimum** proceeds the slippage setting guarantees, so a
sell that fills at its floor always covers its own fee.

**Not billed:**
- **Platform-owned agents** (owner account `three-ws@users.three.ws.local` or `@agents.three.ws`,
  `isPlatformOwnedAgent`): the $THREE circulation desk, house sniper fleets and other three.ws
  money movements (`isPlatformOwnedUser` in `api/_lib/pump-platform-fee.js`, cached for 10 minutes per account; `isPlatformOwnedAgent` in `api/_lib/custodial-key-health.js` holds the email rule).
- **Trades made outside three.ws.** A trade on pump.fun, a terminal or another app never touches
  our transaction builders, and the pump.fun program has no third-party fee hook, so there is
  nothing to attach a fee to.
- The embeddable agent-skills SDK's direct client-built trades (`src/agent-skills-pumpfun.js`
  without `serverFlow`): that library signs with the site visitor's own wallet on third-party
  pages. Its `serverFlow` mode goes through `buy-prep`/`sell-prep` and is billed.

## Configuration

| Env var | Effect |
|---|---|
| `PUMP_PLATFORM_FEE_BPS` | Trade fee in basis points. **Default `100` (1%).** `0` turns it off. Hard-capped at 500 (5%). |
| `PUMP_PLATFORM_FEE_WALLET` | Recipient Solana address. Falls back to the platform treasury keypair (`PLATFORM_TREASURY_KEYPAIR` / `TREASURY_KEYPAIR`) pubkey. |

With no recipient resolvable, `buildPlatformFeeInstructions` returns `null`, no fee instruction is
added and quotes report `platform_fee_bps: 0`, so a local environment without the treasury bills
nothing.

## Disclosure

- The trade modal shows a fee line and the exact amount at the wallet-approval step.
- The agent wallet trade tab shows a "three.ws fee" row with the SOL amount before the trade.
- Agent trade previews and results carry `platform_fee` (`bps`, `asset`, `amount`, `recipient`, `basis`),
  and the custody ledger row records it.
- Section 8 of the [Terms](https://three.ws/legal/tos) discloses platform fees on Real-Funds Features.

## Launch fee (on by default)

Coins launched through three.ws (`/launch`, `/api/pump/launch-prep`, `/api/pump/launch-agent`)
carry a separate **launch fee on the dev buy**, set by the owner at 1%.

| Env var | Effect |
|---|---|
| `PUMP_LAUNCH_FEE_BPS` | Rate in basis points on the dev buy. **Default `100` (1%).** `0` turns it off. Hard-capped at 500. |
| `PUMP_PLATFORM_FEE_WALLET` | Same recipient as the trade fee (falls back to the platform treasury pubkey). |

- A launch with no dev buy pays no launch fee.
- The fee is a transfer inside the launch transaction itself (SOL for SOL-paired coins, USDC for
  USDC-paired ones). `launch-prep` returns it as `platform_fee` and `/launch` shows it in the cost
  panel before the wallet prompt.
- `launch-confirm` reads the recipient's balance delta from the confirmed transaction
  (`txPaidPlatformFee`) and refuses to list a launch whose transaction did not pay it.
- On the agent-wallet path, a USDC launch plus the fee can exceed the v0 packet; the coin then
  launches first and the fee follows in its own transaction (`platform_fee.settlement: 'separate'`,
  or `'failed'` if that transfer did not land, in which case nothing was charged).
- `GET /api/pump/launch-config` reports the live `launch_fee_bps` (0 when no recipient resolves).
- Terms: section 8 of `/legal/tos` discloses platform fees on Real-Funds Features.
