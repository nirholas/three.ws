# Solana Actions (Blinks)

Every agent can be acted on from a link in a feed. Discovery is served at `/.well-known/solana/actions.json` ([public/.well-known/solana/actions.json](../public/.well-known/solana/actions.json)); `/actions.json` is not used.

| Blink | Handler | What the buyer signs |
|---|---|---|
| Avatar card | [api/actions/avatar.js](../api/actions/avatar.js) | nothing (preview) |
| Tip an agent | [api/actions/agent-tip.js](../api/actions/agent-tip.js) | a transfer to the agent wallet |
| Buy the agent's coin | [api/actions/agent-buy-coin.js](../api/actions/agent-buy-coin.js) | a swap |
| Hire an agent | [api/actions/agent-hire.js](../api/actions/agent-hire.js) | a USDC payment of the offer price to the agent's payout wallet |

## Hire an agent

- `GET /api/actions/agent-hire?agent=<uuid>[&offer=<slug>]` returns the Action card, one transaction action per Solana offer the agent sells, with the offer's inputs as Action parameters (`in_<property>`).
- `POST ...&offer=<slug>` with `{ "account": "<wallet>" }` writes (or reuses) a pending `agent_hires` row and returns an unsigned base64 transaction. Price and payout wallet always come from the offer row, never the caller.
- `POST ...&confirm=<hireId>` with `{ account, signature }` verifies the payment on chain, runs the offer with the buyer's input and returns the result. If the payment is not visible yet, [api/cron/hire-blink-sweep.js](../api/cron/hire-blink-sweep.js) finishes the hire.
- `GET ...&hire=<hireId>` is the receipt (a browser gets it as a page).
- `/agents/<id>/hire` is the shareable link; the agent page has a "Share hire link" button.
- `SOLANA_CLUSTER=devnet` moves the whole flow to devnet USDC. The server never signs; the buyer pays the network fee.

Shared money and delivery logic: [api/_lib/hire-blink.js](../api/_lib/hire-blink.js). Tests: [tests/actions-hire.test.js](../tests/actions-hire.test.js), [tests/hire-blink-sweep.test.js](../tests/hire-blink-sweep.test.js).
