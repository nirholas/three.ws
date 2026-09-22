# 16. Self-funded inference: an agent pays for its own model usage from its wallet

Read `docs/prompts/README.md` first.

## The problem

Model usage is billed to the account's credits (`api/credits/`, `api/billing/`, metering in `api/_lib/llm-metering-rule.js`). An agent holding USDC cannot top up the credits that keep it thinking, and a developer running an agent through the SDK or a gateway has to leave the product to buy credits. The best platforms let the agent wallet fund inference directly, and let a developer bring an inference budget with one call.

## Build

### Wallet-funded credits

- `POST /agents/:id/credits/topup/preview` and `/topup` (`fund_inference`, financial, `confirm_deposit`, fresh `preview_id`): moves USDC from the agent wallet to the platform treasury through the x402 self-facilitator (`api/_lib/x402/self-facilitator.js`) and credits the account at the published rate, no fee, recorded in the custody ledger and `credits` tables with the signature. Subject to `enforceSpendLimit` and the anomaly freeze.
- A wallet intent action `fund_inference` with a trigger `credits_below` so an agent keeps itself running: "when credits fall below 100, top up 5 USDC from the wallet, at most once a day". Built on `api/_lib/wallet-intents.js`.
- Per-agent inference budgets: `PATCH /agents/:id` gains `inferenceBudget` (daily and monthly credits); the metering rule refuses model calls past the budget with a clear error and a notification, and `stop`s the agent's automations rather than silently failing runs.

### Provisioning for developers

- `POST /me/inference/provision` (`provision_inference`, financial, `confirm_deposit`): creates an API key scoped to inference, funds it from a chosen agent wallet in one call, and returns the key once. In the CLI: `three-ws fund --amount 5 --agent <id>` and `three-ws provider use three-ws`, which writes the key into the client config so a model provider switch is immediate, no restart. Show the exact table and wait for the yes before the on-chain move.
- The OpenAI-compatible endpoint that serves the agent runtime (`api/agent/run.js` is OpenAI-wire compatible) is documented as a drop-in base URL for any client that accepts one, billed from those credits, with the model catalog from prompt 05.

### Visibility

- `three://agents/{id}/usage` (prompt 02) and `GET /me/usage` show credits, burn rate, days remaining at the current rate, and the last top-ups with signatures.
- The wallet page and the agent page show a "credits" tile with the top-up action and the auto-fund toggle. Every state designed, including "budget exhausted" with the exact action to recover.

## Docs and wiring

`docs/inference-billing.md` (new) linked from `docs/start-here.md` and `docs/agent-wallets.md`; `docs/api-reference.md` and `docs/cli.md` sections; `data/changelog.json` entry tagged `feature`.

## Acceptance

- Preview a 1 USDC top-up on the QA agent and stop at the owner confirmation table (gate 1); with the yes, credits increase by the published rate and the signature is on the ledger.
- Set a daily budget of 1 credit and watch the next model call refuse with the budget error and a notification.
- `three-ws provider use three-ws` makes a client's next completion bill against the funded key.
- `npm test` green.
