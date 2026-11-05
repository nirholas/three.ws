# Agent lending

An agent can put idle funds to work on Solana lending, read what it earns, and take them back. The first venue is Kamino Lend (main market). The venue contract in `api/_lib/lending/index.js` lets another Solana venue slot in without touching the routes, tools or UI.

Solana mainnet only. Every deposit and withdraw is a preview first, then an explicit confirm.

## Surfaces

| Surface | Where |
| --- | --- |
| REST | `/api/v1/agents/:id/lending/*` ([routes](../api/_lib/lending/routes.js)) |
| MCP tools | `lend_markets`, `lend_positions`, `lend_preview` (read), `lend_deposit`, `lend_withdraw` (financial, `confirm_lend`) on `/api/mcp-agent` |
| UI | Agent wallet, Lend tab (`/agents/:id/wallet?tab=lend`), owner only |
| Service | [api/_lib/lending/service.js](../api/_lib/lending/service.js) |

## REST

| Method and path | Auth | What it does |
| --- | --- | --- |
| `GET /lending/markets?venue=` | public | Reserves with supply and borrow APY, utilization, liquidity, deposit capacity. |
| `GET /lending/positions?venue=` | `wallet:read` | The agent wallet's deposits, borrows, health factor, projected yearly interest, and the live earn plan. A wallet that never lent returns an empty position. |
| `POST /lending/deposit` | `wallet:write` | `{ token, amount, confirm? }`. |
| `POST /lending/withdraw` | `wallet:write` | `{ token, amount }` or `{ token, all: true }`, plus `confirm?`. |
| `PUT /lending/earn-rule` | owner session | Set or turn off the earn rule. |

Without `confirm: true`, deposit and withdraw send nothing. They return the preview: from, to, amount, checks, a simulation against current Solana state (compute units, token and SOL moved), and projected interest. With `confirm: true` the API refuses on any failed check (`check_failed`, 422), reserves the spend against the wallet limits (deposits), signs with the agent wallet, sends and confirms.

## Safety rules

- The simulation must show the wallet gives up no more than the confirmed amount plus a fixed fee and rent allowance. Otherwise the check fails and nothing is sent.
- Deposits count against the wallet per-transaction limit and daily spend limit, and a frozen wallet refuses everything.
- A withdraw that would leave debt under a 1.25 health factor is refused.
- An earn rule can only be written from an owner session. An API key or an agent cannot grant itself permission to lend.

## Earn rule

Stored at `agent_identities.meta.lending_earn_rule`, no migration. Modes:

- `deposit_idle`: keep `reserve` of the token in the wallet, lend the rest when it exceeds `min_move`.
- `withdraw_below`: when the wallet balance falls under `floor`, withdraw enough from lending to restore it.

`GET /lending/positions` includes `earn_plan`, the next action the rule would take right now.

## Proof against mainnet

`node scripts/lending-simulate-proof.mjs --owner <wallet that holds the token>` builds a real USDC deposit for any funded wallet and simulates it with a no-op signer. It sends nothing. Recorded 2026-11-04: first deposit of 1 USDC, simulation passed, 181,311 compute units, 1 USDC out, 0.0289 SOL out (fees and one-time account rent), 0.826899 cTokens received.

The simulation needs a Solana RPC that serves large `getMultipleAccounts` reads. The shared kit transport (`api/_lib/solana/kit-rpc.js`) splits calls above 100 accounts so public lanes work.

## Tests

[tests/lending-math.test.js](../tests/lending-math.test.js), [tests/lending-routes.test.js](../tests/lending-routes.test.js), [tests/lending-compile.test.js](../tests/lending-compile.test.js), [tests/lend-tab-ui.test.js](../tests/lend-tab-ui.test.js), [tests/kit-rpc-chunking.test.js](../tests/kit-rpc-chunking.test.js).
