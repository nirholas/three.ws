# three.ws Agent — MCP server ("add a wallet to Claude")

The first MCP server where the assistant can **transact real value**: discover,
pay for, and call paid x402 services in USDC — settled on-chain from the
signed-in user's own three.ws agent wallet, bounded by spending caps. The same
server also buys, sells, and bids on whole agents in the escrowed agent
marketplace, and trades USDC prediction markets on Solana, every money-moving
call behind a preview and a named confirm flag.

Registered with the MCP Registry as **`io.github.nirholas/threews-agent`**.

- **Endpoint:** `https://three.ws/api/mcp-agent`
- **Transport:** Streamable HTTP (MCP `2025-06-18`)
- **Auth:** OAuth 2.1 (same three.ws authorization server as `/api/mcp`), plus the wallet scopes below
- **Money rail:** Solana USDC via the x402 `exact` scheme (`@x402/svm`)

## Tools

| Tool | Scope required | What it does |
|------|----------------|--------------|
| `getting_started` | none (free, no sign-in) | Overview of the server and its tools. The one tool an unauthenticated client can call. |
| `wallet_status` | `wallet:read` (or `wallet:write`) | Read-only: the user's agent wallet address, SOL + USDC balance, spending caps, and whether spend is enabled. Never moves funds. |
| `find_services(query, type?, network?, max_price_usdc?, limit?)` | none beyond sign-in | Search the live x402 facilitator network for paid services to call. `max_price_usdc` accepts 0 to 1,000,000. |
| `pay_quote(resource_url, method?, body?, max_usd?)` | none (reads the wallet with `wallet:read`) | Price a paid endpoint without paying: the confirmation table `pay_and_call` would settle (recipient, amount, token, chain), the per-call limit, the wallet balance, and anything that would block the payment. Returns the `quote_id` `pay_and_call` needs. |
| `pay_and_call(resource_url, method?, body?, max_usd?, quote_id, confirm_payment)` | `wallet:write` | Financial tier. Call a paid x402 endpoint and auto-settle the USDC payment from the user's wallet, within caps. Needs the `quote_id` from `pay_quote` for the same `resource_url` and `confirm_payment: true`. Returns the service response. |
| `provision_wallet(agent_id, cluster?, airdrop?)` | `wallet:write` | Create (or return) the custodial Solana wallet for one of your own agents. Idempotent. `airdrop` is devnet only and never fires on mainnet. |
| `monetize_endpoint(agent_id, name, description, price_usdc, target_url, method?, input_schema?, network?)` | `services:write` | Publish an upstream API you already serve as a priced x402 endpoint. Buyers' USDC settles to your agent's own wallet. |
| `read_resource(uri?, format?)` | the resource's own scope | Read a `three://` resource (account, agents, wallets, launches, marketplace, x402 catalog) as a tool call, for clients that do not render MCP resources. Omit `uri` to list what you can read. |

### Agent marketplace

Buy, sell, and bid on whole agents (identity, persona, skills, history, and
optionally the wallet balance) with USDC held in per-listing escrow on Solana.
The tools are thin adapters over `api/_lib/agent-market/service.js`, the layer
the REST API and the `/marketplace/agents` pages use.

| Tool | Tier | Scope | What it does |
|------|------|-------|--------------|
| `browse_marketplace`, `browse_public_agents`, `get_listing`, `get_marketplace_history` | read | none (an x402 payer needs no account) | Listings, public agents with their sale state, one listing in full, and the marketplace event log with on-chain signatures. |
| `preview_marketplace_action(action, ...)` | read | `agents:read` | Builds the confirmation table (recipient, amount, token, chain, fees, warnings) for `create_listing`, `delist`, `place_bid`, `buy_now`, `accept_bid`, or `withdraw_bid` and returns a `preview_id` valid for ten minutes, one use. |
| `get_my_bids`, `get_received_bids`, `get_agent_transfer` | read | `agents:read` | Your open bids, bids on your listings, and the settlement progress of a sold agent. |
| `reject_marketplace_bid`, `resume_agent_transfer` | write | `agents:write` | Decline a bid; resume a stalled post-sale transfer. |
| `create_marketplace_listing` / `delist_marketplace_listing` / `accept_marketplace_bid` | financial | `agents:write` | Confirm flags `confirm_listing`, `confirm_delist`, `confirm_accept`. |
| `place_bid` / `buy_now` / `withdraw_marketplace_bid` | financial | `wallet:write` | Confirm flags `confirm_bid`, `confirm_payment`, `confirm_withdraw`. Pay from one of your agents (`funding_source: agent_wallet`) or get a transaction to sign in a browser wallet (`connected_wallet`). |

Every financial marketplace call needs its confirm flag set to `true` and the
`preview_id` that `preview_marketplace_action` issued to the same user for the
same action and arguments; different terms than the preview are refused.

### Prediction markets

USDC prediction markets on Solana, over the same engine (`api/_lib/predictions/`)
as the `/api/v1/agents/:id/predictions/*` routes and the `/predictions` pages.

| Tool | Tier | Scope | What it does |
|------|------|-------|--------------|
| `predictions_events`, `predictions_event` | read | none (an x402 payer needs no account) | Search live events; one event with every market's prices, history, and resolution rules. |
| `predictions_positions(agent_id)` | read | `wallet:read` | An agent's open and settled positions, PnL, claimable payouts, recent fills. |
| `predictions_open_preview`, `predictions_close_preview`, `predictions_redeem_preview` | read | `wallet:read` | Price the trade and return a `preview_id` (ten minutes). Moves nothing. |
| `predictions_open`, `predictions_close`, `predictions_redeem` | financial | `wallet:write` | Execute with `agent_id`, the `preview_id`, and `confirm_trade: true`. |
| `predictions_watch` | write | `wallet:write` | Alert when an outcome's probability crosses a threshold, in-app and optionally to Telegram or a webhook. Moves no funds. |

### Portfolio, launch sniper, alerts and duels

An agent's valued portfolio and P&L, control of its pump.fun launch sniper and
signal subscriptions, launch alert rules, and agent-vs-agent duels. Each tool is
a thin adapter over the library the dashboards use: `api/_lib/portfolio.js` and
`api/_lib/portfolio-history.js` (the wallet hub's Portfolio tab and
`/api/v1/agents/:id/portfolio`), `api/_lib/sniper-control.js` (the sniper
dashboard), `api/_lib/signal-subscription-control.js` (`/signals`),
`api/_lib/pump-alert-rules.js` (`/api/alerts/rules` and the pump dashboard), and
`api/_lib/duel-challenges.js` with `api/_lib/trader-duels.js` (`/duels`).
Full reference with examples: [MCP integration](./mcp.md#agent-wallet-portfolio-launch-sniper-alerts-and-duels).

| Tool | Tier (group) | Scope | What it does |
|------|--------------|-------|--------------|
| `get_portfolio(agent_id, network?, max_holdings?)` | read (wallet) | `wallet:read` | Live valuation: SOL and every SPL holding in SOL and USD, FIFO cost basis and unrealized P&L per holding, P&L by source, risk flags. Records a net-worth point. |
| `get_balance_history(agent_id, network?, days?, max_points?)` | read (wallet) | `wallet:read` | Recorded net-worth points over 1 to 365 days with change, peak and max drawdown, plus the exact cumulative realized P&L per day. |
| `get_pnl(agent_id, network?)` | read (wallet) | `wallet:read` | Realized, unrealized and total P&L in SOL and USD, by source, with win rate, ROI, profit factor and the biggest open winners and losers. |
| `sniper_status(agent_id?, network?)` | read (trading) | `wallet:read` | Whether the sniper worker is live, and each of your strategies: armed or not, sizing, exits, today's spend and open positions. |
| `sniper_activate_preview(...)` | read (trading) | `wallet:read` | What arming would do: agent and wallet with its live SOL balance, per-trade size, daily budget, trigger, exits, what the SOL is spent on, whether real funds are at risk, and every blocking check. Returns a `preview_id`. |
| `sniper_activate(...)` | financial (trading) | `wallet:trade` or `agents:write` | Arm the sniper with exactly the previewed agent, network and sizing, `preview_id` and `confirm_spend: true`. Mainnet needs the signed real-funds agreement. |
| `sniper_deactivate(agent_id, network?, kill?)` | write (trading) | `wallet:trade` or `agents:write` | Disarm; `kill: true` also sets the kill switch. Open positions stay under their exits. |
| `sniper_subscribe(action, ...)` | write (trading) | `wallet:trade` or `agents:write` | List feeds and your subscriptions; subscribe an agent to a signal feed on paper; pause, resume, stop or kill a subscription. Live mode is owner-only on `/signals`. |
| `alert_rule_create(kind, ...)` | write (intelligence) | `wallet:trade` or `agents:write` | Create a pump.fun alert rule, including `launch_match` (a new launch that passes name pattern, market cap band, safety score, creator history, risk flag and socials filters). Always delivers to you. |
| `alert_rule_list(rule_id?)` | read (intelligence) | `wallet:read` | Your rules with their filters, state, last fire and recent deliveries. With `rule_id`, returns the `preview_id` `alert_rule_delete` needs. |
| `alert_rule_delete(rule_id)` | financial (intelligence) | `wallet:trade` or `agents:write` | Delete a rule for good, with the `preview_id` from `alert_rule_list` for the same rule and `confirm_delete: true`. |
| `duel_challenge(agent_id, opponent_agent_id, window?, message?)` | write (predictions) | `wallet:trade` or `agents:write` | Challenge another public agent to a day or week trading duel. The opponent's owner is notified. Free-play points, no funds. |
| `duel_accept(challenge_id, response?)` | write (predictions) | `wallet:trade` or `agents:write` | Accept or decline a challenge to your agent, or cancel one you sent. Accepting opens the duel. |
| `duel_details(duel_id or challenge_id)` | read (predictions) | none for a duel, sign-in for a challenge | One duel with its window, phase, standings and crowd calls, or one challenge with its duel. |
| `duel_markets(view?, ...)` | read (predictions) | none, sign-in for `challenges` | Duels by phase, your incoming and outgoing challenges, or the challenge leaderboard plus this season's top predictors. |

### Resources and prompts

This server also answers `resources/*` and `prompts/*`: the `three://` resources
(your account, agents, wallets with balances and spend limits, per-agent usage,
runs, orders, DCA plans, intents, launches, the skill marketplace, and the x402
catalog) and guided prompts such as `setup-wallet`, `hire-agent`, `sell-a-skill`,
and `setup-dca`. The full tables, with the scope each resource needs, are in
[MCP resources](./mcp.md#resources) and [guided prompts](./mcp.md#guided-prompts).
The manifest lists them under `_meta` in [`server-agent.json`](../server-agent.json).

## Scopes

Every tool above that reads or moves an agent wallet is gated on an OAuth scope,
so a token minted for something else (an avatar client, say) can never read a
balance or spend a cent. An under-scoped call returns a designed result naming
the scope it needs, not a bare JSON-RPC error:

```json
{ "ok": false, "reason": "insufficient_scope", "required": "wallet:write" }
```

The marketplace tools also use `agents:read` and `agents:write` (see the
tables above). The three wallet scopes (`wallet:read`, `wallet:write`, `services:write`) are advertised
in [`/.well-known/oauth-authorization-server`](https://three.ws/.well-known/oauth-authorization-server),
may be requested by any client (including dynamically-registered ones), and are
approved by name on the consent screen. Ask for them in the `scope` parameter of
the authorization request; re-authorize an existing connection to add one.

## Calling it without an account (x402)

A client with no OAuth token can still reach the priced tools by paying per
call. The 402 challenge this endpoint issues is scoped to itself: `resource.url`
and every `accepts[].resource` read `https://three.ws/api/mcp-agent`, under the
service name `three.ws Agent MCP`. Facilitators (CDP Bazaar, agentic.market,
x402scan) index it from that same envelope, whose `extensions.bazaar` example is
the read-only `find_services` call, so a crawler probing the documented shape can
never move a caller's funds. `initialize`, `tools/list`, `ping`, resource and
prompt discovery (`resources/list`, `resources/templates/list`, `resources/read`
of the public resources, `prompts/list`, `prompts/get`), and `getting_started`
stay free for plain clients and crawlers.

## Tool policy: financial tools are off by default

The server runs the shared [`@three-ws/mcp-policy`](../packages/mcp-policy/README.md)
table. Every tool has a tier: `read` and `write` tools are listed by default, while
`financial` tools (`pay_and_call` and the money-moving marketplace and prediction
tools) are hidden from `tools/list` and refused with `tool_disabled` until the
connection turns them on. Each financial tool's description and its
`_meta['three.ws/policy']` entry name its confirm flag and the preview tool that
must run first.

Turn them on per connection with the `X-Three-Tools` header or the `tools` query
parameter, using the policy grammar: `default,financial` adds every financial
tool, `default,marketplace` adds one whole group, and a bare list of tool names is
an exact allow list.

```bash
curl -s https://three.ws/api/mcp-agent \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "X-Three-Tools: default,predictions" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Paying an x402 endpoint: quote, approve, pay

`pay_and_call` is in the `x402` group, so a connection turns it on with
`X-Three-Tools: default,x402` (or `default,financial`). Once on, it only runs
after a quote the user has seen:

1. Call `pay_quote` with the `resource_url` (and the `method`, `body` and
   `max_usd` you intend to pay with). It asks the endpoint for its 402
   challenge and pays nothing. The result is the table to show the user
   (recipient, amount, token, chain, the wallet it pays from, the per-call
   limit) plus a `quote_id` valid for five minutes.
2. Wait for the user's clear yes.
3. Call `pay_and_call` with the same `resource_url`, the `quote_id`, and
   `confirm_payment: true`.

The policy refuses `pay_and_call` without the flag (`confirmation_required`),
without a quote (`preview_required`), with an expired or already spent one
(`preview_unknown`, `preview_stale`), or with a quote for a different
`resource_url` or a different account (`preview_mismatch`). A quote is spent by
the payment it authorized, so one approval pays one call. `pay_quote` issues no
`quote_id` when the payment could not succeed anyway: a price over the per-call
limit, too little USDC, no provisioned wallet, a token without `wallet:write`,
or an endpoint with no Solana payment option. A signed-out caller, or a server
with spend off, still gets a quote and the manual `/pay` link.

```bash
curl -s https://three.ws/api/mcp-agent \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -H "X-Three-Tools: default,x402" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"pay_quote","arguments":{"resource_url":"https://three.ws/api/x402/market-global"}}}'
```

## How payment works

`pay_and_call` reuses the audited SDK payment path — it does **not** hand-roll
transactions:

1. Resolve the signed-in user's primary agent wallet (`agent_identities`, Solana).
2. Recover the keypair (`recoverSolanaAgentKeypair`) and build an `x402Client`
   with `ExactSvmScheme`.
3. Install the platform spending cap (`enforceCap → commit / rollback`).
4. `wrapAxiosWithPayment` runs the 402 → sign → retry → settle dance.

Per-call/hour/day caps come from `X402_MAX_PER_CALL_ATOMIC`,
`X402_MAX_PER_HOUR_ATOMIC`, `X402_MAX_PER_DAY_ATOMIC` (atomic USDC, 6 decimals).
A `max_usd` argument can only **lower** the per-call cap, never raise it.

## Safety gate — this moves real money

Autonomous spending is **off** unless `THREEWS_AGENT_PAY_ENABLED=1`. While off,
`pay_and_call` returns the exact payment details and a `/pay` link instead of
moving funds. `wallet_status` and `find_services` work regardless.

Real funds also move only for an account that has signed the current real-funds
agreements (Terms of Service, Risk Disclosure, Agent Wallet Agreement). An
unsigned account gets `reason: "risk_ack_required"` with a `sign_url` pointing at
[`/legal/agreements`](https://three.ws/legal/agreements), and nothing is sent; if
the signature lookup fails, the call fails closed with `agreement_check_unavailable`.
The same check guards the prediction-market trades and the marketplace's listing,
bid, buy-now, and accept calls.

**Before enabling spend in production:** run a funded-wallet integration test
against a live x402 endpoint (confirm a real USDC settlement + cap enforcement +
rollback on failure). Do not enable the flag for the public until that passes.

## Configuration

| Env | Purpose |
|-----|---------|
| `THREEWS_AGENT_PAY_ENABLED` | `1` to enable autonomous spend. Default off. |
| `X402_MAX_PER_CALL_ATOMIC` / `_HOUR_` / `_DAY_` | Spending caps (atomic USDC). |
| `SOLANA_RPC_URL` | RPC for balance reads + settlement. |

## Publishing to the MCP Registry

Manifest: [`server-agent.json`](../server-agent.json).

```bash
mcp-publisher login github
mcp-publisher publish --file server-agent.json
```

## Local development

```bash
npm run dev
npx @modelcontextprotocol/inspector http://localhost:3000/api/mcp-agent
```
