---
name: budgeted-x402-payments
description: Pay x402 endpoints through a budget-capped three.ws payment session instead of a private key. Use when an agent needs to call a paid API, quote its price, or create, inspect or cancel a spending session.
---

# Budgeted x402 payments

The agent holds no wallet. A payment session is a budget funded from three.ws credits, with an optional per-transaction ceiling and host allowlist, enforced server-side. This plugin registers the MCP server `@three-ws/agentcore-payments-mcp` (Node 20+) via `.mcp.json`.

## Environment

| Variable | Needed for |
| --- | --- |
| `THREE_WS_SESSION` | session management tools: the value of the `__Host-sid` cookie, without the prefix |
| `PAYMENT_SESSION_TOKEN` | default token for `pay_with_session` (`pss_...`) |
| `THREE_WS_BASE` | optional base URL, default `https://three.ws` |
| `THREE_WS_TIMEOUT_MS` | optional timeout, default 30000 |

Never print or log these values.

## Tools

- `create_payment_session`: `budget_usd` (required), `label`, `expiry_seconds` (60 to 7776000, default 3600), `max_per_tx_usd`, `allowed_hosts` (array), `agent_id`, `network` (`solana`), `metadata`. Returns the session and a token shown once.
- `quote_session_payment`: `url`, `method` (GET or POST), `body`, `session_id`. Read-only: probes the endpoint's live price and checks whether the session's remaining budget, ceiling and allowlist would cover it. Moves nothing.
- `pay_with_session`: `url`, `method`, `body`, `token` (falls back to `PAYMENT_SESSION_TOKEN`), `idempotency_key`. Destructive: moves real funds from the session budget. Endpoints that answer without a 402 are called for free.
- `check_payment_session`: `session_id`, `include_executions`. Budget, status, recent payments.
- `list_payment_sessions`: `status`, `limit`.
- `cancel_payment_session`: `session_id`. Refunds the unspent budget.

## Workflow

1. Create a session only when the user has chosen the budget, expiry and allowed hosts. Store the token without echoing it.
2. Call `quote_session_payment` for the endpoint. Show the user the URL, price and remaining budget.
3. Stop for the user's explicit yes. Only then call `pay_with_session` with the same `url` and `method`, plus an `idempotency_key` so a retry cannot double-bill.
4. Call `check_payment_session` to confirm the new balance. Cancel the session when the job is done.

## Example

Quote `https://api.example.com/data` with `session_id`, report "0.02 USD, 9.98 remaining, host allowed", wait for approval, then `pay_with_session` with `idempotency_key: "run-42-fetch-data"`.

Without a package install, run the server from a clone with `node src/index.js` after `npm install`. `npm run inspect` opens the MCP Inspector.
