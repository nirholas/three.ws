# 12. Agent cards: prepaid and gift cards bought from the agent wallet

Read `docs/prompts/README.md` first.

## The problem

An agent's USDC is spendable on-chain and over x402, and nowhere else. It cannot buy a gift card, a prepaid card, a subscription, or pay a merchant that takes cards. The only mention of gift cards in the repo is incidental (`src/solana/vanity/drop-protocol.js`). Card spend is the bridge from an agent's wallet to the ordinary economy.

## Build

### Provider

This needs a card issuer or gift-card aggregator with an API that settles in USDC or accepts an on-chain payment. Onboarding a new external paid API needs owner approval per `CLAUDE.md`; therefore build the whole surface against a provider adapter interface in `api/_lib/cards/provider.js` (search merchants, search products, quote, create, status, card data, balance, reveal, cancel, refresh, withdraw, connect link), implement the first adapter for the provider you select by these criteria (USDC settlement, API-first, gift cards for major merchants plus a virtual prepaid card, sandbox available), run everything end to end against its sandbox, and list its production credential as the one missing var in the report. Never mention the provider's token, if it has one, in committed code.

### Data and routes

Migrations for `agent_cards` (agent, provider, product, merchant, face value, currency, status, masked number, provider id, created), `agent_card_events` (status changes, reveals with actor and time), and `agent_card_withdrawals`.

Under `api/v1/agents/:id/cards/` with MCP tools under the prompt 03 policy:

- `merchants/search` (`agent_card_search_merchants`), `products/search` (`agent_card_search_gift_cards`).
- `quote` (`agent_card_quote`): product, amount, returns total in USDC including fees and a `quote_id`.
- `create` (`agent_card_create`, financial, `confirm_spend`, fresh `quote_id`): pays from the agent wallet through the x402 self-facilitator or a direct USDC transfer to the provider's settlement address, subject to `enforceSpendLimit` and the anomaly freeze, records the custody event.
- `list`, `get`, `status`, `balance`, `refresh`.
- `data` and `reveal` (`agent_card_reveal`, financial because it exposes the redemption secret, `confirm_reveal`): returns the card number, PIN or redemption code once, logged in `agent_card_events`, never stored in plaintext after the reveal, encrypted at rest with the wallet secret encryption in `api/_lib/agent-wallet.js` before it.
- `cancel` (`agent_card_cancel`, financial), `withdraw` and `withdrawals` (`agent_card_withdraw`, financial, `confirm_withdraw`) for prepaid balances back to USDC where the provider supports it.
- `connect` and `connect-link` (`agent_card_connect`, `agent_card_connect_link`) for providers that need the account holder to complete identity steps in a browser.

### UI

`/agents/:id/cards` (add to `data/pages.json`): merchant search, product picker with the quote, purchase with the confirm table, card list with masked numbers and balances, reveal with a one-time modal and an audit line, withdraw. Every state designed, including "provider needs verification" with the connect link.

## Docs and wiring

`docs/agent-cards.md` (new) linked from `docs/start-here.md`; `docs/api-reference.md` section; `STRUCTURE.md` row; `data/changelog.json` entry tagged `feature`.

## Acceptance

- Full flow on the provider sandbox: search, quote, create (stop at the owner confirmation table for the spend, gate 1), status, reveal once, second reveal refused without a new confirm.
- The reveal is absent from every log and from the database after the call.
- `npm test` green with adapter contract tests using recorded sandbox responses.
