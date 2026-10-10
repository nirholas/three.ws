# Solana trading tools

Ten tools that let an agent research a Solana token, compare every swap route, check a two-venue arbitrage honestly, and fill a swap from its own wallet. They are callable two ways:

- **MCP**, on the `threews-agent` server at `/api/mcp-agent` (group `trading`). See [the agent wallet MCP server](./mcp-agent.md).
- **REST**, under `/api/v1/trading`. The same handlers, the same input schema and the same refusal codes.

Both surfaces are built from one registry ([`api/_lib/trading-tools/registry.js`](../api/_lib/trading-tools/registry.js)), so they cannot disagree about what a tool takes or how it refuses. A test pins that parity: every REST route must match its MCP schema and its catalog entry.

Solana mainnet is the only chain these tools trade on. Nothing here is a static block: every price, route, signal and verdict is computed at call time from a live source, and carries the time it was computed.

## The tools

| Tool | REST route | Auth | Moves funds |
|---|---|---|---|
| `token_search` | `GET /api/v1/trading/tokens/search` | public | no |
| `get_price` | `GET /api/v1/trading/price` | public | no |
| `get_indicators` | `GET /api/v1/trading/indicators` | public | no |
| `get_market_signals` | `GET /api/v1/trading/signals` | public | no |
| `get_news_feed` | `GET /api/v1/trading/news` | public | no |
| `arbitrage_prices` | `GET /api/v1/trading/arbitrage/prices` | public | no |
| `arbitrage_quote` | `GET /api/v1/trading/arbitrage/quote` | public | no |
| `swap_quote` | `POST /api/v1/trading/swap/quote` | optional (`wallet:read` with `agent_id`) | no |
| `swap_simulate` | `POST /api/v1/trading/swap/simulate` | required (`wallet:read`) | no |
| `swap_execute` | `POST /api/v1/trading/swap/execute` | required (`wallet:trade`) | **yes** |

`GET /api/v1/trading` lists every tool with its full input schema, so a client can build its forms or tool definitions from the live list instead of this table.

GET routes take their arguments in the query string; an array argument takes a comma list (`?indicators=rsi,macd`). POST routes take a JSON body. Responses use the versioned API envelope (`{ "data": …, "meta": { "requestId": … } }`), and a refusal answers with its own status and a stable `error.code`.

Anywhere a token is asked for, you can pass a mint address, a symbol, or `SOL` / `USDC`. A symbol resolves to the most liquid token with that ticker, so for anything that matters, look it up with `token_search` first and pass the mint.

## Research

### `token_search`

Finds a token by symbol, name or mint, ranked by liquidity, with price, market cap, holders and a safety read (mint and freeze authority, holder concentration). `limit` is 1 to 20, default 5.

```bash
curl -s 'https://three.ws/api/v1/trading/tokens/search?query=THREE&limit=3'
```

### `get_price`

Live USD and SOL price for one token, with its 24h change, market cap, liquidity, volume, and the source that answered.

```bash
curl -s 'https://three.ws/api/v1/trading/price?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump'
```

### `get_indicators`

Technical indicators computed over live OHLCV candles: the latest value and a trailing series for each, plus the time of the last candle. `indicators` picks a subset (all when omitted), `interval` defaults to `1h`, `period` to 14 (2 to 200).

```bash
curl -s 'https://three.ws/api/v1/trading/indicators?mint=SOL&indicators=rsi,macd&period=21'
```

### `get_market_signals`

Two views from one tool.

**With a `mint`**: the live read for that token. Launchpad price and graduation, smart-money score, dev-dump flag, momentum, and the conviction score.

**Without a mint**: the whole Solana launch ecosystem, derived from data the platform already ingests around the clock (every launch the pump feed sees with its first-90-second order flow, every graduation, labelled coin outcomes, proven-wallet participation, and the conviction engine's scores). It has three sections, all on by default:

- `macro`: launch rate, graduation rate, net SOL flow and active wallets for the `window` (`15m`, `1h`, `6h` or `24h`), each against its own baseline.
- `movers`: the coins that moved most in the window.
- `anomalies`: hourly metrics whose z-score against their trailing baseline crosses the alert line, with the z-score itself.

Every signal carries its inputs (source table, window bounds, sample size) and an `as_of` time. A source that has gone quiet is reported as `stale`, never as a zero, so a dead feed cannot read as a dead market. Token names and symbols come from their issuers and are returned as data, never interpreted.

```bash
curl -s 'https://three.ws/api/v1/trading/signals?window=6h&sections=macro,anomalies'
```

### `get_news_feed`

The aggregated crypto news feed, optionally filtered to one token (a mint is resolved to its ticker) or a category. Each article has its source, publish time, tickers and sentiment. `limit` is 1 to 50, default 15.

```bash
curl -s 'https://three.ws/api/v1/trading/news?token=SOL&limit=5'
```

## Swaps: compare, simulate, confirm

### `swap_quote`: every route, and why one won

`swap_quote` prices the trade on every aggregator at once (Jupiter, LI.FI and Raydium today) and returns each route side by side:

- `out_amount` and `min_out`: what the router quotes, and the floor at your `slippage_bps` (default 100, 1 to 5000).
- `price_impact_pct`: the router's own impact figure.
- `net_out`: what you actually end up with after the three.ws fee and the network fee. `net_basis` states exactly how it was computed, because the honest comparison differs by direction: selling into SOL subtracts both fees from the output; buying with SOL scales the output to the SOL you really spend; a pair with no SOL leg compares router output and lists the network fee separately.
- `costs`: the three.ws fee, the network fee in lamports, every fee the router itself discloses, and any refundable deposit (account rent) the route opens.

`best` is the route with the highest net output, `selected` is the one this quote would fill, and `why` is the plain-language reason: how many basis points more one route delivers than the next, or that two routes tie and which has the lower impact. A router that could not price the pair is listed in `unavailable` with its reason, so a missing route is visible rather than silently dropped.

`dex` picks the route:

- `auto` (default) takes the best net output.
- `jupiter`, `lifi` or `raydium` takes that router even when another nets more; `why` still says what you gave up.
- `dex:<label>` restricts the route to one venue, using the venue ids `arbitrage_prices` returns.

```bash
curl -s -X POST https://three.ws/api/v1/trading/swap/quote \
  -H 'content-type: application/json' \
  -d '{ "input_mint": "SOL", "output_mint": "USDC", "amount": 0.1 }'
```

Without `agent_id` this is a price comparison only and needs no account. **With `agent_id`** (an agent you own, API key scope `wallet:read`), the quote also:

1. Runs the full trade guard chain against that agent's wallet in preview mode: kill switch, per-trade cap, daily budget, USD ceiling, price-impact breaker, rug firewall and SOL headroom. Anything that would block the fill comes back in `execution.blocked_by` with its code, before you ask anyone to confirm.
2. Returns a `confirmation` table: the wallet, the recipient (the agent wallet itself), what it pays, what it should receive and the minimum it will accept, the route, the slippage, the three.ws fee and the network fee.
3. Returns a signed `quote_id` and its `expires_at`, five minutes out.

Agent-wallet swaps keep SOL on one side of the pair, because the spend guards meter in SOL. Any other pair is compared and explained, and comes back with `execution.code: "unsupported_pair"`; route it through SOL in two swaps.

```bash
curl -s -X POST https://three.ws/api/v1/trading/swap/quote \
  -H "authorization: Bearer $THREE_WS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{ "input_mint": "SOL", "output_mint": "USDC", "amount": 0.1, "agent_id": "<your agent id>" }'
```

### `swap_simulate`: a dry run with nothing signed

Takes the `quote_id`, re-prices the pinned route live, runs every guard, builds the exact transaction the fill would send and simulates it on chain. It returns `would_succeed` or `would_fail` with the compute units and the tail of the program logs. Nothing is signed or sent, no ledger row is written, and the `quote_id` stays valid, so the user can still confirm it.

```bash
curl -s -X POST https://three.ws/api/v1/trading/swap/simulate \
  -H "authorization: Bearer $THREE_WS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{ "quote_id": "<quote_id from swap_quote>" }'
```

### `swap_execute`: the only tool that moves funds

The flow is always preview, then confirm:

1. Call `swap_quote` with `agent_id`.
2. Show the user its `confirmation` table: wallet, amount paid, minimum received, route, chain.
3. Only after a clear yes, call `swap_execute` with that `quote_id` and `confirm_swap: true`.

A quote is never filled stale:

- **Expiry.** A `quote_id` older than five minutes is refused with `410 quote_expired`.
- **Fresh price.** The pinned route is re-priced at fill time. If the market now delivers less than the minimum the user approved, the fill is refused (`quote_moved`) and nothing is sent. Slippage is tightened so the on-chain floor can never be lower than that approved minimum.
- **Once only.** Each `quote_id` fills at most once; its nonce is the idempotency key on the custody ledger, so a retried request replays the original result instead of trading twice.
- **Same executor.** The fill goes through the guarded executor every other agent trade uses ([`api/agents/solana-trade.js`](../api/agents/solana-trade.js)), so the spend caps, the price-impact breaker, the rug firewall and the protected sender apply unchanged.
- **Router transaction check.** Before signing, the router's transaction is decompiled and refused if it needs any signer other than the agent wallet, is split across more than one transaction, or moves anything out of the wallet beyond the trade and the fees the router disclosed.

If the fill is refused before it reaches the chain (a guard said no, the price moved, the wallet is short), the `quote_id` stays spendable while it is fresh, so the owner can fix the cause and confirm it again. If the transaction was sent but not confirmed in time, the response is `submitted_unconfirmed` with the signature and an explorer link: check it before doing anything else, and never re-quote and resend blindly.

On MCP, `swap_execute` is off until the session turns on the `trading` group, the policy gate refuses it without `confirm_swap: true`, and the tool itself refuses any `quote_id` it did not sign for that user. On REST it needs an API key with `wallet:trade`. Either way, the account must have signed the real-funds agreements (`risk_ack_required` otherwise).

```bash
curl -s -X POST https://three.ws/api/v1/trading/swap/execute \
  -H "authorization: Bearer $THREE_WS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{ "quote_id": "<quote_id the user confirmed>", "confirm_swap": true }'
```

## Arbitrage, honestly

### `arbitrage_prices`

The buy and sell price for one pair on every Solana venue that can fill it at this size, discovered live rather than from a fixed list, with fees and price impact included. It also returns the aggregated best route as a baseline and the widest cross-venue spread. `amount` is in the `quote` token (default 1 SOL). Each venue's id (`dex:<label>`) can go straight into `swap_quote` as `dex`.

```bash
curl -s 'https://three.ws/api/v1/trading/arbitrage/prices?token=USDC&quote=SOL&amount=1'
```

### `arbitrage_quote`

The best buy-here, sell-there route, with the expected profit after both legs' network fees. It never executes, and it is written to talk you out of a bad trade:

- **The legs are not atomic.** Leg 2 is quoted and signed after leg 1 confirms. It can fail, reprice or be front-run, leaving you holding the token. Every response carries `risk.atomic: false` and the specific risk factors.
- **A simulated worst case from real re-quotes.** `worst_case.scenarios` prices three outcomes: `expected` (both legs fill as quoted), `both_legs_slip` (each leg fills at its 1% slippage floor), and `spread_closes` (the tokens sell at the weakest venue that quoted, which is also what you hold if leg 2 fails and you unwind later). It reports `max_loss` and `max_loss_pct`.
- **A verdict to act on.** `viable` only when the expected edge is positive and larger than the worst-case loss; `risk_exceeds_edge` when the worst case loses at least what the edge earns; `unprofitable` when the edge does not clear both legs and their fees.
- **A size cap that refuses by default.** Above $100 the quote is refused with `size_above_cap` unless `accept_size_risk: true`; above $1000 it is always refused (`size_above_hard_cap`). A size that cannot be priced in USD is refused too (`size_unpriced`), rather than waved through.

Each leg comes back as ready-made `swap_quote` arguments, so if you do act on one, each leg goes through its own quote, its own confirmation and its own guard chain.

```bash
curl -s 'https://three.ws/api/v1/trading/arbitrage/quote?token=USDC&quote=SOL&amount=0.05'
```

## Error codes

A refusal carries a stable `code` and a message written for the user. The ones you will meet most:

| Code | Status | Meaning |
|---|---|---|
| `validation_error` | 400 | An argument failed the tool's schema; `details.field` names it. |
| `no_route` | 502 / 422 | No aggregator, or not the one you chose, could price the pair. |
| `quote_expired` | 410 | The `quote_id` is older than five minutes. Quote again. |
| `quote_moved` | 409 | The live route now delivers less than the approved minimum. Nothing was sent. |
| `route_unavailable` | 503 | The pinned router could not re-price the trade. Nothing was sent. |
| `confirmation_required` | 400 | `swap_execute` without `confirm_swap: true`. |
| `insufficient_scope` | 403 | The API key lacks `wallet:read` or `wallet:trade`. |
| `risk_ack_required` | 403 | The account has not signed the real-funds agreements; the response carries the link to sign. |
| `size_above_cap`, `size_above_hard_cap`, `size_unpriced` | 400 | The arbitrage size checks above. |

Guard refusals from the executor (spend caps, the price-impact breaker, the rug firewall, a short balance) pass through with their own codes, the same ones a trade from the dashboard returns.

## Checking the routes live

```bash
npm run check:trading-routes -- --wallet <a funded wallet's public key>
npm run check:trading-routes -- --wallet <pubkey> --in SOL --out USDC --amount 0.01 --json
```

For every aggregator it runs the path a real swap takes up to the signature, and stops there: quote, build the router's unsigned transaction, pass it through the same transaction check `swap_execute` uses, and simulate it on mainnet with signature checks off. No key is loaded and nothing is signed; the wallet is a public key only, and needs to hold the input amount for the simulation to pass. A router that does not list the pair is reported as `SKIP`, not a failure. Exit code 0 means every router with a route passed.

## Related

- [The agent wallet MCP server](./mcp-agent.md): connecting a client, scopes, and the tool policy.
- [Agent wallets](./agent-wallets.md) and [custody](./custody.md): the wallet a swap fills from and its limits.
- [The agent wallet control API](./agent-wallet-api.md): orders, intents and the anomaly guard on the same wallet.
- [The Trading Copilot](./trading-copilot.md): the conversational surface that proposes trades a human confirms.
- [API reference](./api-reference.md#solana-trading-tools-api).
