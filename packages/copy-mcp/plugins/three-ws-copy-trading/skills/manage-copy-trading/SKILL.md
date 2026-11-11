---
name: manage-copy-trading
description: Follow and unfollow three.ws copy-trade leaders, tune sizing and guard rules, work the copy-intent inbox and check fees owed through the copy-mcp MCP server. Use when the user wants to manage copy-trading follows from an agent.
---

# Manage three.ws copy trading

The `copy` MCP server (`@three-ws/copy-mcp`, started by this plugin's `.mcp.json` with `npx -y @three-ws/copy-mcp`) is the headless version of the three.ws copy dashboard. It is non-custodial: it never signs and holds no wallet key. When a followed leader trades, the engine produces a sized, guard-checked copy INTENT. The user acts on it from their own wallet, then records the outcome.

## Setup

1. Mint an API key (`sk_live_...` or `sk_test_...`) or OAuth access token at https://three.ws/dashboard/developers.
2. Export it in the shell before starting Claude Code: `export THREE_WS_API_KEY=sk_live_...`.
3. Optional env vars: `THREE_WS_BASE` (default `https://three.ws`) and `THREE_WS_TIMEOUT_MS` (default 20000).

Without the key, account-scoped tools fail with `missing_credential`. Only `get_earnings` with an `agent_id` works without a key.

## Tools

| Tool | Use |
| --- | --- |
| `list_subscriptions` | Every leader followed, with status, sizing rule, guard rules and pending/acted counts. |
| `create_subscription` | Follow a leader (upserts per leader). Needs `leader_agent_id` (UUID) and the user's own Solana `copier_wallet` address. |
| `update_subscription` | Patch by `id`: `status` (`active`, `paused`, `stopped`), sizing and guard fields. |
| `cancel_subscription` | Soft-stop a follow by `id`; history is kept. |
| `get_executions` | The intent inbox. `status` is `pending` (default), `acted`, `dismissed`, `skipped`, `expired` or `all`; `limit` 1-100. |
| `record_execution` | Mark a pending intent `acted` (optional fill signature) or `dismissed`. |
| `get_earnings` | Fees owed across leaders; with `agent_id`, a leader's public aggregate earnings. |

## Sizing and guard fields

`sizing_rule` is `fixed` (with `fixed_sol`), `multiplier` (with `multiplier`, default 0.1) or `pct_balance` (with `pct_balance`, 0-100). Guards: `per_trade_cap_sol` (default 0.5), `min_order_sol` (default 0.02, cannot exceed the cap), `daily_budget_sol` (default 1), `max_open_copies` (1-100, default 5), `mcap_floor_usd`, `mcap_ceiling_usd`, `copy_sells`, `require_safety_pass`, `min_oracle_score` (0-100), `perf_fee_bps` (0-3000, default 1000), `telegram_chat_id`. `network` is `mainnet` (default) or `devnet`.

## Workflow

1. Before following, call `get_earnings` with the leader's `agent_id` to see their copier track record.
2. Show the user the leader, wallet, sizing rule and caps, then call `create_subscription`. Never ask for or accept a private key, only a public wallet address.
3. Periodically call `get_executions` with `status: "pending"`. Present each intent (coin, direction, planned SOL size). The user executes the trade themselves, then call `record_execution` with `action: "acted"` and the signature, or `"dismissed"`.
4. To stop, `update_subscription` with `status: "paused"` to keep the follow, or `cancel_subscription` to end it.

Example: "follow leader 0b1c... with 0.1 SOL per copy and a 0.5 SOL daily budget" becomes `create_subscription` with `sizing_rule: "fixed"`, `fixed_sol: 0.1`, `daily_budget_sol: 0.5`, `copier_wallet: <user address>`.

Performance fees are charged on realized copy profit above a high-water mark and settle in $THREE. Discovery of leaders is done with the sibling intel server (`@three-ws/intel-mcp`, tool `copy_smart_wallets`).
