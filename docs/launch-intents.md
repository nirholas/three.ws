# Funded launch intents

A funded launch intent is a quote you pay once and a coin that launches from it. The agent's own wallet funds the launch, you confirm it from a signed-in browser, and every step is a stage you can poll.

Use it when you want a launch that is priced up front, paid by the agent wallet and replayable without paying twice. For a plain launch with no quote, use the launch tools described in [pump-launcher.md](pump-launcher.md).

## The flow

```
quote -> paid -> submitted -> confirmed -> indexed
```

| Stage | Meaning |
| --- | --- |
| `quote` | The intent exists. Fees are priced from the chain's live fee schedule and the quote is held for 15 minutes. |
| `paid` | The agent wallet funded the launch. The funding signature is stored once and replays safely. |
| `submitted` | The owner confirmed in the approvals inbox and the launch transaction was sent. |
| `confirmed` | The transaction landed on chain. |
| `indexed` | The coin is in the three.ws launch directory and the creator fee recipient is set. |

`failed` and `expired` are the only other terminal stages.

## Who can do what

- A bearer token (API key or CLI login) can **create** an intent, **read** it, and run a **dry run**.
- Only a same-site browser session can **fund** (`pay`) or **confirm** (`confirm`) it. A bearer is refused with `session_required` (403), so a leaked key can never spend.
- Confirming creates a `pump_funded_launch` request in the [approvals inbox](approvals.md). Nothing is submitted until the owner approves it.

## Endpoints

### List the quote assets

`GET /api/pump/pairs?network=mainnet|devnet`

Returns every quote asset a launch can pair with, read from chain state: whether the program will accept it now, the fee schedule at a fresh curve's market cap, the creator-fee rule and a projection of earnings. A pair is `live` only when the program accepts a `create_v2` against it.

### Create an intent

`POST /api/pump/launch-intents`

```json
{
  "agent_id": "agt_...",
  "name": "Example",
  "symbol": "EXMPL",
  "description": "What the coin is for",
  "image_url": "https://example.com/image.png",
  "network": "mainnet",
  "quote": "sol",
  "initial_buy": 0.5,
  "creator_fee_bps": 100
}
```

`creator_fee_bps` is optional. When the program lets the creator choose, it must sit inside the pair's `min_bps..max_bps`. When it does not, the schedule rate applies and a different value is refused.

The response carries the quote, the fee lines, the funding address, the required amount and a `preflight_token` that binds the funding transaction to this intent.

### Read, list and poll

- `GET /api/pump/launch-intents/:id` returns the intent and its stage. Add `?balance=0` to skip the wallet balance read.
- `GET /api/pump/launch-intents?agent=<id>&limit=30` lists your intents.

### Fund and confirm (browser session only)

- `POST /api/pump/launch-intents/:id/pay` with `{ "signature": "...", "preflight_token": "..." }` records the funding proof. Repeating the same call returns `200` with `replayed: true` instead of paying again.
- `POST /api/pump/launch-intents/:id/confirm` asks for the owner's approval and returns the approval request.

### Dry run

`POST /api/pump/launch-intents/:id/dry-run` builds and simulates the launch instructions against the network without sending anything. Create the intent with `"network": "devnet"` to exercise the whole lane with no real funds.

## Errors

| Code | Status | Meaning |
| --- | --- | --- |
| `session_required` | 403 | Funding or confirming needs a signed-in browser session. |
| `quote_expired` | 410 | The 15 minute quote lapsed. Create a new intent. |
| `preflight_mismatch` | 403 | The preflight token does not belong to this intent. |
| `signature_used` / `already_paid` | 409 | The funding proof was already recorded. |
| `funding_insufficient` | 402 | The transaction paid less than the quote. |
| `not_a_funding_tx` | 422 | The signature is not a transfer from the agent wallet to the funding address. |
| `creator_fee_out_of_range` | 400 | Pick a value inside the returned `min_bps..max_bps`. |
| `creator_fee_fixed` | 400 | This quote pays the schedule rate and it cannot be changed. |
| `quote_not_live` | 409 | The program does not accept this quote asset right now. |
| `unknown_quote` | 400 | The quote asset is not one of the listed pairs. |
| `wrong_stage` | 409 | The action does not apply at the intent's current stage. |
| `agent_not_found` / `not_found` | 404 | No such agent or intent for this account. |

## From the command line

```
npx three-ws agent launch --intent --quote usdc --creator-fee 100
npx three-ws agent launch status <id> --watch
```

The CLI prints the quote and the preflight token, opens the intent page for the owner to fund and confirm, and polls the stage. It never signs or pays.

## In the browser

`/launch/intents` is the page that shows the quote, picks the fee, funds the launch from the agent wallet and confirms it.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUMP_CREATOR_FEE_MIN_BPS` | 0 | Lowest creator fee the platform offers. |
| `PUMP_CREATOR_FEE_MAX_BPS` | 1000 | Highest creator fee the platform offers. |
| `PUMP_CREATOR_FEE_DEFAULT_BPS` | 100 | The pre-selected fee. |

The platform range is intersected with what the program allows, so a value the API accepts is one the chain will take.

Code: [api/pump/pairs.js](../api/pump/pairs.js), [api/pump/launch-intents.js](../api/pump/launch-intents.js), [api/_lib/pump-funded-launch.js](../api/_lib/pump-funded-launch.js), [api/_lib/pump-launch-pairs.js](../api/_lib/pump-launch-pairs.js). Tests: [tests/pump-funded-launch.test.js](../tests/pump-funded-launch.test.js).
