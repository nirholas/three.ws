# Agent Perps

Agent Perps lets one of your agents go long or short on perpetual futures with USDC collateral held in its own custodial Solana wallet. Every agent starts in **paper mode**, which fills at live venue prices and moves no funds. **Live mode** stays off until you turn it on for that agent. Every action is previewed first and executed only with an explicit confirmation. A leverage cap and a per-position margin cap always apply, and a kill switch flattens everything at once.

There are three ways in, and all three run the same service (`api/_lib/perps/service.js`), so the guards, previews and results are identical:

| Surface | Where | Who uses it |
| --- | --- | --- |
| The desk page | [/agent-perps](https://three.ws/agent-perps), or `/agents/<agent id>/perps` | The owner, signed in |
| REST | `/api/v1/agents/:id/perps/*` | Your own code, with a session or an API key |
| MCP | `perps_*` tools on `/api/mcp-agent` | Claude, or any MCP client you connect |

Related reading: [agent wallets](./agent-wallets.md) covers the custody and spend-policy model the deposits run under, [custody you can verify](./custody.md) covers the freeze and kill switches, and the [risk acknowledgment](./risk-acknowledgment.md) explains the agreements live mode requires.

---

## Paper and live

| | Paper (the default) | Live |
| --- | --- | --- |
| Prices | The venue's live order book, marks and funding | The same |
| Fills | The platform's paper ledger (`perps_paper_*` tables) | The venue program on Solana mainnet |
| Signing | Nothing is built or signed | The agent's custodial wallet signs, after simulation |
| Turned on by | Nothing: every agent starts here | The owner, signed in, per agent, after signing the real-funds agreements |

Paper mode is not a toy. It follows the same rules the venue does, so a paper result means something:

- A market order fills at the price the venue's own quote walks off the live book, with the taker fee charged.
- A resting limit fills at its limit price once the live book crosses it.
- Take-profit and stop-loss triggers fire on the live mark and fill at the mark. A fill is never worse than the order's execution price; for a stop, that is the trigger moved 3% against the position (the stop slippage the venue allows).
- Funding accrues continuously at the market's live hourly rate. A long pays a positive rate; a short receives it.
- An account whose equity falls under maintenance margin is liquidated at the mark.
- Liquidation prices use the venue SDK's own cross-margin formula. `tests/perps-desk.test.js` checks the paper engine against it.

A paper account can hold up to $1,000,000 of collateral. Deposit some on the desk, then trade.

Live mode needs three things:

1. The owner turns it on (the **Live trading** switch on the desk, or `PUT .../perps/limits` with `live_enabled: true` from a signed-in session). An API key can never turn it on.
2. The owner has signed the real-funds agreements. Until then the switch answers `risk_ack_required` and links to them.
3. The agent wallet holds USDC to deposit, plus at least 0.003 SOL for network fees.

The first live deposit also opens the agent's trader account on the venue (cross margin, subaccount 0), in the same transaction.

---

## Limits every agent has

Each agent stores its perps policy in `agent_identities.meta.perps_limits` (`api/_lib/perps/limits.js`). Every field has a conservative default and a hard ceiling no request can exceed:

| Field | Default | Ceiling | What it bounds |
| --- | --- | --- | --- |
| `live_enabled` | `false` | | Whether live orders are allowed at all |
| `max_leverage` | `2` | `20` | Account leverage (total notional over equity) after the order. The market's own maximum applies if lower |
| `max_margin_per_position_usd` | `25` | `100000` | The margin one position ties up at the leverage cap (position notional over the cap) |
| `max_slippage_bps` | `100` | `1000` | How far a market order may walk the book from the mark |
| `max_quote_move_bps` | `50` | `500` | How far entry or liquidation may move between preview and execute |
| `halted` | `false` | | The perps kill switch. While on, risk-increasing orders are refused |
| `alert_liquidation_distance_pct` | `15` | | Alert when a position's mark is within this percent of its liquidation price |
| `alert_loss_usd`, `alert_gain_usd`, `alert_funding_usd` | `null` (off) | | Alert on total unrealized PnL, or funding paid by one position |

**Only the owner, signed in, can loosen a limit.** Turning live on, resuming after the kill switch, or raising any cap from an API key or MCP is refused with `403 owner_session_required`, and the refusal names the offending keys. Tightening is open to any caller with `wallet:write`, so an agent can lower its own caps or halt itself.

### The guards, in order

Every order preview runs these checks and returns each one with `ok` and a plain-language label:

1. **Mode**: live orders need `live_enabled`.
2. **Perps halt**: `halted` blocks new risk.
3. **Trade kill switch**: the agent-wide switch from the wallet's trade limits.
4. **Wallet freeze**: a frozen wallet opens nothing.
5. **Leverage**: account leverage after the fill is at most the cap.
6. **Position margin**: the position's notional over the leverage cap fits the per-position margin cap.
7. **Free collateral**: the account keeps non-negative free collateral after the fill.
8. **Slippage**: the walk off the book is within `max_slippage_bps`.

In live mode the preview adds two more: the trader account exists, and the wallet holds SOL for fees. Deposits also run the wallet-wide spend policy (per-transaction and daily USD caps, rules and the anomaly guard).

Checks 2 through 8 apply only to orders that **increase** risk. A reduce-only order, a take-profit, a stop-loss, a close or a flatten always goes through, so an owner can get out of any position whatever the switches say.

---

## The two-step execute

Nothing changes in one call. Every action is a **preview**, then an **execute**:

1. The preview prices the action, runs every guard and stores exactly what it showed. It returns:
   - a `preview_id`, valid for 2 minutes for orders or 5 minutes for deposits, withdrawals, cancels and flattens;
   - the numbers: size, entry, margin, account leverage, fees, liquidation price, and the position before and after;
   - `checks`, `blocked_by` and `executable`.
2. The execute takes that `preview_id`, `confirm_trade: true`, and an `Idempotency-Key` header (`idempotency_key` in MCP).
   - Before an order executes, it is quoted again. It is refused with `409 quote_moved` if entry or liquidation moved past `max_quote_move_bps`, or if the size changed. The refusal returns the measured move in `details`. Preview again.
   - A repeated key returns the first result instead of trading twice (`perps_executions`).
   - A preview is used once.

In live mode, every transaction is simulated against current chain state before it is signed. A simulation that fails, or that would spend more USDC than the preview showed or more than 0.005 SOL in fees and rent, is refused (`simulation_failed`, `simulation_out_of_bounds`) and nothing is sent.

```bash
BASE=https://three.ws/api/v1/agents/$AGENT_ID/perps

# 1. Preview: long SOL with $20 of margin at 2x, in paper mode
curl -s -X POST $BASE/order/preview -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"mode":"paper","symbol":"SOL","side":"long","type":"market","margin_usd":20,"leverage":2}'

# 2. Execute exactly that preview, once
curl -s -X POST $BASE/order -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -H "idempotency-key: $(uuidgen)" \
  -d '{"preview_id":"perp_...","confirm_trade":true}'
```

### Order types

| `type` | Required | Notes |
| --- | --- | --- |
| `market` | `size`, or `margin_usd` with `leverage` | Fills now, walking the book up to `slippage_bps` (default: the agent's `max_slippage_bps`) |
| `limit` | `price`, plus `size` or `margin_usd` with `leverage` | Rests on the book. Set `reduce_only: true` to only shrink a position |
| `take_profit` | `trigger_price`, optional `size_percent` (default 100) | Attaches to the open position, always reduce-only. Must trigger on the profitable side of the mark |
| `stop_loss` | `trigger_price`, optional `size_percent` | As above, on the losing side. Fills at most 3% past the trigger |

`size` is in base units of the market (0.5 on SOL is half a SOL). `side` is `long` or `short`. To close a position, place a `market` order on the opposite side with `reduce_only: true`; the desk's **Close** button does exactly that.

---

## The kill switch

`flatten` is the agent's perps kill switch. One preview, one confirmation, then it:

1. sets `halted: true`, so no new risk can open;
2. cancels every resting order and trigger;
3. closes every position at market (reduce-only).

The result lists each step with its signature (live) or fill (paper). Only the owner, signed in, can resume: the **Resume trading** button on the desk, or `PUT .../perps/limits` with `halted: false` from a session.

---

## The live tracker and alerts

`GET /api/v1/agents/:id/perps/stream?mode=paper&interval=4` is a server-sent event stream. Each `frame` event carries:

- the account summary;
- per position: unrealized PnL, funding paid since open, mark, liquidation price and distance to liquidation in percent, and any attached take-profit or stop-loss;
- the open order count and the alerts crossed right now.

`interval` is 2 to 30 seconds. A stream lasts five minutes, then sends `reconnect`, and the page reconnects on its own.

Alerts are evaluated on every frame and, while nobody is watching, by the cron `/api/cron/perps-tick` every two minutes. Each crossing is recorded once per kind, symbol and hour (`perps_alert_events`) and sent to the owner as a `perps_alert` notification. The notification preferences route it to the bell, push and paired chats under **Market alerts**.

| Kind | Fires when | Severity |
| --- | --- | --- |
| `liquidation_distance` | a position's mark is within `alert_liquidation_distance_pct` of liquidation | warning, critical at half the threshold |
| `liquidatable` | equity is under maintenance margin | critical |
| `loss` / `gain` | total unrealized PnL crosses the threshold | warning / info |
| `funding` | one position has paid at least `alert_funding_usd` in funding | warning |

The same cron keeps paper desks honest while you are away: it settles funding, fills limits the live book crossed, fires triggers the mark reached, and liquidates paper accounts under maintenance. For live agents it only reads the venue account. It never builds or signs a transaction.

---

## REST reference

All routes live under `/api/v1/agents/:id/perps` in the standard v1 envelope (`{ ok, data }` or `{ ok: false, error: { code, message, details } }`). Every route takes an optional `venue` (default `phoenix`). Agent routes take `mode` (`paper` or `live`, default: live if enabled, else paper).

| Method | Path | Auth | What it does |
| --- | --- | --- | --- |
| GET | `/markets` | public | Every market: mark, funding, open interest, max leverage, margin rates, fees |
| GET | `/market/:symbol` | public | One market with its book (`depth`), recent trades (`trades`) and funding history (`funding` hours); `0` skips trades or funding |
| GET | `/account` | `wallet:read` | Mode, wallet balances, limits, guards, summary, the full account and current alerts |
| GET | `/positions` | `wallet:read` | Positions, resting orders, triggers and history (paper fills or live executions) |
| GET | `/executions` | `wallet:read` | Every execute this platform ran for the agent, with signatures |
| GET | `/alerts` | `wallet:read` | Alerts delivered recently |
| GET | `/stream` | `wallet:read` | The live tracker (server-sent events) |
| GET / PUT | `/limits` | `wallet:read` / `wallet:write` | Read the policy (with the defaults), or patch it. Loosening needs the owner's session |
| POST | `/order/preview`, `/order` | `wallet:read`, `wallet:write` | Preview and execute an order |
| POST | `/deposit/preview`, `/deposit` | `wallet:read`, `wallet:write` | Move USDC from the agent wallet into collateral (`amount_usd`) |
| POST | `/withdraw/preview`, `/withdraw` | `wallet:read`, `wallet:write` | Move withdrawable collateral back (`amount_usd` or `"max"`) |
| POST | `/cancel/preview`, `/cancel` | `wallet:read`, `wallet:write` | Cancel a limit, take-profit or stop-loss (`order_id`, optional `kind`) |
| POST | `/flatten/preview`, `/flatten` | `wallet:read`, `wallet:write` | The kill switch |

Common error codes: `live_disabled`, `risk_ack_required`, `perps_halted`, `trade_kill_switch`, `wallet_frozen`, `leverage_cap_exceeded`, `position_margin_exceeded`, `insufficient_collateral`, `slippage_too_high`, `quote_moved`, `confirmation_required`, `idempotency_key_required`, `owner_session_required`, `unknown_venue`.

---

## MCP tools

The `perps_*` tools on `/api/mcp-agent` are thin adapters over the same service. They are listed in [the agent MCP server doc](./mcp-agent.md#perpetual-futures). The `perps` guided prompt walks a client through account, market, preview and a confirmed execute, and offers the kill switch.

---

## Venues

A venue is a module that implements the contract in `api/_lib/perps/index.js` (`VENUE_CONTRACT`):

- **reads**: `listMarkets`, `getMarket`, `getMarketData`, `getAccount`;
- **pricing**: `quoteOrder`;
- **instruction builders**: `buildDeposit`, `buildWithdraw`, `buildOrder`, `buildCancel`, `buildFlatten`.

A venue never signs. It returns Solana instructions, and the service simulates them, signs with the agent wallet and confirms. Every registered venue is checked against the contract by `tests/perps-desk.test.js`, so a second venue is one module and one line in the registry. The paper engine needs nothing venue-specific beyond those reads and `quoteOrder`.

### Venue selection

The launch venue (id `phoenix`) is a fully on-chain central-limit-order-book perpetuals exchange on Solana. It was chosen on 2026-09-22 because:

- it publishes a maintained TypeScript SDK;
- its SOL and BTC markets carry deep open interest;
- any wallet can open a trader account through its public registration flow, with no invite code.

Every instruction the module builds was verified on mainnet with `simulateTransaction`, without being sent. The platform trades cross margin on one subaccount per agent, so the guards bound the account's effective leverage rather than a per-order leverage setting.

---

## Testing

`tests/perps-desk.test.js` covers the parts every mode and interface depends on, without touching a network or a wallet:

- the venue contract;
- limit normalization, ceilings and what counts as loosening;
- every order guard;
- quote-move tolerance;
- paper fills (add, partial close, flip, flat), funding, limit crossing and triggers;
- paper liquidation, against the venue SDK's own formula;
- alert evaluation and dedupe.

To exercise the whole flow end to end, use paper mode on a test agent: deposit, preview, execute, attach a take-profit and a stop-loss, then flatten. Never open a live position from a test.
