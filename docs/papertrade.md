# Papertrade

[Papertrade](https://papertrade.xyz) is a synthetic perpetual-futures exchange on HyperEVM (chain 999): BTC and ETH, USDC collateral, up to 1000x leverage, no funding. three.ws reads it for you. You get its live markets, an exact quote for any position before you open it, any wallet's open positions valued at the live price, and the protocol's health, over plain HTTP and as MCP tools an agent can call.

This integration is **read only**. Nothing here signs an order, deposits or withdraws. You trade on Papertrade itself, from your own wallet. three.ws shows you exactly what a trade will do before you place it.

| Surface | Where | Who uses it |
| --- | --- | --- |
| REST | `GET /api/papertrade?view=...` | Your own code, a dashboard, a script. No key needed |
| MCP | `papertrade_*` tools on `/api/mcp-agent` | Claude, or any MCP client you connect. No sign-in needed |

Related reading: [Agent Perps](./perps.md) is the Solana perps desk, where an agent trades with its own wallet. The [MCP guide](./mcp.md#papertrade-synthetic-perps-on-hyperevm) covers connecting a client.

---

## How Papertrade differs from a normal perp

A quote is only useful if it prices the venue's real rules. Papertrade's rules are unusual, and every number this integration returns accounts for them:

- **No order book.** Every trade is a swap against one liquidity provider at Hyperliquid's best-bid/best-ask midpoint. There is no slippage and no spread, and size does not move the price.
- **No funding.** A position costs nothing to hold.
- **Isolated margin, fixed at open.** You cannot add margin later, and a close is always the full position.
- **Hard bust instead of liquidation.** Each position has a bust price set at open: the price where its equity would reach zero, moved about 5 basis points (the market's `bust_buffer_bps`) closer to entry. If the mark crosses it, the whole margin is lost. A $100 long at 100x on a $100,000 market busts at about $99,047.
- **Winners keep less than the raw move.** A winning close passes three steps. First a 0.2 basis-point deadband: a move smaller than that pays nothing. Then an impact haircut that takes a large share of a small move and a small share of a large one. Then the win fee, read live from the exchange contract (2% when this was written). Losses pay nothing extra and never exceed the margin.
- **Payout queue.** Winners are paid from the liquidity provider. When it runs short, the unpaid profit waits in a first-in, first-out queue until there is liquidity. `view=protocol` tells you whether the queue is active.
- **Minimums.** Margin at least $10 and notional (margin times leverage) at least $10,000, so a $10 position needs 1000x.

The haircut is the one that surprises people. On a $10,000 BTC position, a 0.01% move is worth about $0.81 raw but pays about $0.21. A 1% move is worth about $99.80 and pays about $86.39. Every quote shows this ladder, so nobody opens a 1000x scalp expecting the raw number.

---

## REST

One endpoint, four views. All are `GET`, need no authentication, and are rate limited per IP like the other market-data routes.

### `view=markets` (the default)

```bash
curl -s 'https://three.ws/api/papertrade'
```

```json
{
  "venue": "papertrade",
  "chain_id": 999,
  "collateral": "USDC",
  "trading_paused": false,
  "min_margin_usd": 10,
  "min_notional_usd": 10000,
  "win_fee_pct": 2,
  "funding": "none",
  "stale": false,
  "markets": [
    {
      "symbol": "BTC",
      "instrument_id": 0,
      "status": "active",
      "openable": true,
      "mid_price": 83065.5,
      "bid": 83065,
      "ask": 83066,
      "price_source": "hyperliquid_bbo_mid",
      "max_leverage": 1000,
      "max_position_notional_usd": 10000000,
      "bust_buffer_bps": 4.76,
      "open_interest_long_usd": 2073237482.39,
      "open_interest_short_usd": 1622524832.88,
      "volume_24h_usd": 217785554681.2
    }
  ],
  "links": { "app": "https://exchange.papertrade.xyz", "docs": "https://docs.papertrade.xyz" }
}
```

`status` is one of `active`, `close_only`, `paused`, `terminal` or `inactive`. A terminal market prices at the bid and ask frozen when it was paused (`price_source: "frozen_at_pause"`). `stale: true` means Papertrade's API missed one read and the market parameters are from the last good copy, at most 10 minutes old. Prices are never served stale.

### `view=quote`

Prices an open exactly as the exchange would fill it now.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `symbol` | yes | `BTC` or `ETH` (`BTC-USD` and `ETH-PERP` also work) |
| `side` | yes | `long` or `short` |
| `margin_usd` | yes | Isolated margin in USDC |
| `leverage` | yes | Whole number, up to the market's `max_leverage` |

```bash
curl -s 'https://three.ws/api/papertrade?view=quote&symbol=BTC&side=long&margin_usd=100&leverage=100'
```

```json
{
  "symbol": "BTC",
  "side": "long",
  "margin_usd": 100,
  "leverage": 100,
  "notional_usd": 10000,
  "entry_price": 83065.5,
  "bust_price": 82274,
  "bust_distance_pct": 0.9529,
  "loss_at_bust_usd": -100,
  "max_margin_usd": 100000,
  "win_fee_pct": 2,
  "fees_at_open_usd": 0,
  "funding": "none",
  "scenarios": [
    { "move_pct": 0.01, "exit_price": 83073.8, "raw_pnl_usd": 0.806592, "payout_pnl_usd": 0.212458, "kept_pct": 26.34, "busted": false },
    { "move_pct": 1, "exit_price": 83896.1, "raw_pnl_usd": 99.800759, "payout_pnl_usd": 86.384648, "kept_pct": 86.56, "busted": false }
  ],
  "checks": [
    { "id": "market_open", "ok": true, "label": "BTC is active" },
    { "id": "leverage", "ok": true, "label": "Leverage 100x within the 1000x market maximum" },
    { "id": "min_margin", "ok": true, "label": "Margin at least $10" },
    { "id": "min_notional", "ok": true, "label": "Notional at least $10,000" },
    { "id": "capacity", "ok": true, "label": "Margin within the $100,000 the market can take at 100x (max_position_notional)" }
  ],
  "openable": true,
  "blocked_by": [],
  "trade_url": "https://exchange.papertrade.xyz"
}
```

(`scenarios` is shortened here; the response has eight rungs: 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2 and 5 percent.)

- `payout_pnl_usd` is what a close at that price would actually credit: after the deadband, the impact haircut and the win fee. `raw_pnl_usd` is the plain move times notional, for comparison.
- `max_margin_usd` is the most this side and leverage can take right now. The lowest of three limits wins: the per-position notional cap, the side's open-interest cap, and the protocol's net open-interest cap.
- A quote that breaks a rule still returns `200`, with `openable: false` and the failing check ids in `blocked_by` (`market_open`, `leverage`, `min_margin`, `min_notional`, `capacity`), so you can show the user what to change.
- The entry price is the mid at the moment of the quote. A real order fills at the mid when Papertrade's relayer lands it, so it can differ by however far the price moved in between.

### `view=account`

Any wallet's Papertrade account. It is public chain-indexed state, so no signature is needed.

```bash
curl -s 'https://three.ws/api/papertrade?view=account&address=0x44623c92310d1b9b430b3228487a1b88fcc1c517'
```

The response carries `balance_usd`, `available_usd`, `locked_margin_usd`, `queued_payout_usd` (profit waiting in the payout queue), `session_key_active`, and `lifetime` totals (deposited, withdrawn, realized PnL, fees paid, traded notional). `positions` lists every open position, largest first:

```json
{
  "id": "53573",
  "symbol": "ETH",
  "side": "long",
  "margin_usd": 250,
  "leverage": 50,
  "notional_usd": 12500,
  "entry_price": 2512.15,
  "bust_price": 2463.09,
  "mark_price": 2512.15,
  "raw_pnl_usd": 0,
  "close_payout_pnl_usd": 0,
  "risk_pct": 0,
  "bust_crossed": false,
  "margin_from_queue": false,
  "opened_at": "2026-10-10T20:03:36.000Z"
}
```

`risk_pct` runs from 0 (mark at or better than entry) to 100 (mark at the bust price). `close_all_payout_pnl_usd` is what closing everything now would credit in total.

### `view=protocol`

```bash
curl -s 'https://three.ws/api/papertrade?view=protocol'
```

Returns `tvl_usd`, `margin_locked_usd`, `lp_usd` (the liquidity that pays winners), `open_positions`, `lifetime_volume_usd`, `lifetime_fees_usd`, `win_fee_pct`, `payout_queue` (`total_usd`, `entries`, `active`), and `relayer_ready` (whether Papertrade's order relayer is accepting intents). Check it before sizing a large position. A small `lp_usd` next to a big winning position, or an active queue, means a profit may not be paid right away.

### Errors

Errors use the platform's standard shape, `{ "error": "<code>", "error_description": "<what to do>" }`:

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_view` | `view` is not one of the four above |
| 400 | `invalid_side`, `invalid_margin`, `invalid_leverage`, `symbol_required` | A quote parameter is missing or out of range |
| 400 | `invalid_address` | `address` is not a 0x wallet address |
| 404 | `unknown_market` | No such market. `detail.available` lists the real ones |
| 502 | `upstream_unavailable` | Papertrade, HyperEVM or Hyperliquid did not answer. Retry shortly |
| 502 | `upstream_schema_changed` | Papertrade changed its data format. Quotes stay off until the integration is updated, rather than guess |

---

## MCP tools

Four read-only tools on the agent wallet server (`https://three.ws/api/mcp-agent`). They need no sign-in and are in the `perps` policy group at the read tier. Each returns a plain-language summary for the model plus the full REST response as `structuredContent`.

| Tool | Arguments | Same as |
| --- | --- | --- |
| `papertrade_markets` | none | `view=markets` |
| `papertrade_quote` | `symbol`, `side`, `margin_usd`, `leverage` | `view=quote` |
| `papertrade_account` | `address` | `view=account` |
| `papertrade_protocol` | none | `view=protocol` |

```json
{ "name": "papertrade_quote",
  "arguments": { "symbol": "BTC", "side": "long", "margin_usd": 10, "leverage": 1000 } }
```

The model sees the bust price, how far away it is, and the full payout ladder, so it can tell a user plainly that a $10 BTC long at 1000x is gone if BTC drops about 0.05%.

---

## Where the numbers come from

| Figure | Source |
| --- | --- |
| Markets, limits, open interest, minimums | Papertrade API `GET https://exchange.papertrade.xyz/state/trading` |
| Protocol balances, payout queue, 24h volume | Papertrade API `/query/protocol/summary`, `/queue-summary`, `/market-stats` |
| Relayer readiness | Papertrade API `/relayer/health` |
| A wallet's balances and positions | The first frame of Papertrade's live wallet stream, `/state/user/live` |
| Win fee | `winFeeRate()` on the exchange contract `0x6cd5661646289fb6e65ea5c032310fded797d0a2`, read over HyperEVM RPC |
| Entry and mark price | Hyperliquid `l2Book` best bid and ask, the same midpoint the contract prices against |

The position math (`api/_lib/papertrade/math.js`) runs in integer arithmetic at the contract's own scales, so its rounding matches the contract's. Its tests (`tests/papertrade-math.test.js`) include bust prices read from real Papertrade positions, reproduced exactly.

## Risks to tell users about

- Papertrade launched in October 2026. Its contracts are upgradeable by the protocol owner through a timelock.
- Profits depend on one liquidity provider and can wait in the payout queue.
- At high leverage the bust price sits a tiny move from entry, and the haircut means small favourable moves pay little. The quote ladder exists to make both visible before anyone trades.

## Code

| Piece | File |
| --- | --- |
| Position math | `api/_lib/papertrade/math.js` |
| Live client and service | `api/_lib/papertrade/index.js` |
| REST handler | `api/papertrade.js` |
| MCP tools | `api/_mcpagent/papertrade-tools.js` |
| Tests | `tests/papertrade-math.test.js` |
