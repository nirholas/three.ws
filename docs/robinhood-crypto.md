# Robinhood Crypto connector

**Connect your own Robinhood Crypto account. Set hard spend caps. Let your agents quote, preview and place crypto orders inside them.**

The connector uses Robinhood's Crypto Trading API with a key you create and own. three.ws never holds your Robinhood login, only the API key and the Ed25519 private key you paste, both encrypted at rest. Crypto pairs only (symbols like `ASSET-USD`).

- **Connect:** [three.ws/settings/robinhood](/settings/robinhood)
- **REST:** `/api/v1/robinhood/crypto/*`
- **MCP tools:** `robinhood_holdings`, `robinhood_quote`, `robinhood_preview_order`, `robinhood_place_order`

Robinhood Chain (the on-chain markets and wallets) is a separate surface: see [Robinhood Chain on three.ws](./robinhood-chain-markets.md).

---

## Connect your account

1. Open [/settings/robinhood](/settings/robinhood) and press **Generate in this browser**. That creates an Ed25519 key pair on your device, shows the public key, and fills the private key into the form. You can also make one yourself:

    ```bash
    node -e "const c=require('crypto');const k=c.generateKeyPairSync('ed25519');console.log('private',k.privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('base64'));console.log('public',k.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'))"
    ```

2. On Robinhood (desktop web), open Account, Settings, Crypto, API Trading. Add a key, paste the **public** key, and pick the permissions you want agents to have.
3. Paste the API key Robinhood shows you, plus your **private** key, into the form. Set your caps and press **Verify and connect**.

three.ws signs a request to Robinhood's account endpoint with the pair before it stores anything. If Robinhood rejects it, nothing is saved and you see why.

## Spend caps

Every buy is checked on the server against two caps you set:

| Cap | Default | Hard ceiling | What it limits |
| --- | --- | --- | --- |
| Per-order | $25 | $10,000 | The value of any one buy |
| Daily | $100 | $50,000 | The total of today's buys (UTC day) |

- The per-order cap can never exceed the daily cap.
- A market buy is valued at Robinhood's live estimated price for that exact quantity. A limit buy is valued at its limit price, the most it can spend. Values round up to the cent.
- Sells are not capped. They reduce your exposure rather than add to it.
- When an order is placed, its value is reserved against the daily cap under a per-account database lock. Two agents placing at the same moment cannot both squeeze into the last dollars of the cap.
- If Robinhood never answers (a timeout or a 5xx), the order is marked `unknown` and **stays counted** against the cap. Check Robinhood before retrying. If Robinhood definitely rejects it, the reservation is released.
- **Pause trading** on the settings page refuses every new preview and order at once. Reads keep working.
- Credentials and caps can only be changed from a signed-in browser. No API key, connector or agent can paste a key or raise its own cap.

## How an order happens

Orders are two steps, so a person sees exactly what will happen before it does.

1. **Preview** (`robinhood_preview_order` or `POST /orders/preview`). Give a pair, a side, and either `quantity` (asset units) or `amount_usd`. A dollar amount is rounded **down** to the pair's quantity step. The preview checks the pair is tradable, the size is within Robinhood's minimum and maximum, and the caps hold. Nothing is sent to Robinhood except price reads. It returns:
    - a `preview_id`, valid for five minutes and usable once;
    - a `confirm` table: venue, account, pair, side, type, quantity, estimated price and total;
    - the caps left today.
2. **Place** (`robinhood_place_order` or `POST /orders`), with the `preview_id` and `confirm_order: true`. An agent may only send this after you approved that exact confirm table. A market buy is re-priced first. If the price rose more than 2% since the preview, the order is refused with `price_moved` and you preview again. The order goes to Robinhood with the ledger row's `client_order_id`, so it is idempotent on Robinhood's side too.

Every preview and order lands in a ledger you can read at `GET /orders` and on the settings page. Disconnecting keeps the ledger.

## REST API

All routes return the v1 envelope: `{ data, meta }` on success, `{ error: { code, message, details }, meta }` on failure.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /api/v1/robinhood/crypto` | session or `wallet:read` | Connection status, caps, today's spend |
| `PUT /api/v1/robinhood/crypto/credentials` | session only | `{ api_key, private_key, per_order_cap_usd?, daily_cap_usd? }` |
| `DELETE /api/v1/robinhood/crypto/credentials` | session only | Disconnect (voids open previews, keeps the ledger) |
| `PATCH /api/v1/robinhood/crypto/settings` | session only | `{ per_order_cap_usd?, daily_cap_usd?, trading_enabled? }` |
| `GET /api/v1/robinhood/crypto/holdings` | session or `wallet:read` | Positions valued at the live bid |
| `GET /api/v1/robinhood/crypto/quote?symbol=ASSET-USD` | session or `wallet:read` | Best bid and ask (repeat or comma-separate `symbol`, up to 50) |
| `GET /api/v1/robinhood/crypto/orders?limit=25` | session or `wallet:read` | The ledger, newest first |
| `POST /api/v1/robinhood/crypto/orders/preview` | session or `wallet:trade` | `{ symbol, side, type?, quantity \| amount_usd, limit_price? }` |
| `POST /api/v1/robinhood/crypto/orders` | session or `wallet:trade` | `{ preview_id, confirm_order: true }` |

Browser writes need the `X-CSRF-Token` header (the site's `apiFetch` adds it). A bearer key needs the scope in the table; MCP connector keys never carry `wallet:trade`.

Preview a $10 buy with an API key that has `wallet:trade`:

```bash
curl -s https://three.ws/api/v1/robinhood/crypto/orders/preview \
  -H "authorization: Bearer $THREE_WS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"symbol":"ASSET-USD","side":"buy","amount_usd":10}'
```

Replace `ASSET-USD` with a pair Robinhood lists for you.

### Error codes

| Code | Status | Meaning and fix |
| --- | --- | --- |
| `not_connected` | 409 | No key saved. Connect at /settings/robinhood |
| `credentials_rejected` | 424 | Robinhood refused the key or signature. Check the registered public key matches, or replace the key |
| `credentials_unreadable` | 424 | The saved key can no longer be decrypted. Paste it again |
| `trading_paused` | 403 | Trading is paused on the settings page |
| `over_per_order_cap`, `over_daily_cap` | 403 | The buy is over a cap. `details.caps` shows what is left |
| `confirm_required` | 400 | `confirm_order: true` was missing |
| `preview_not_found`, `preview_used`, `preview_expired` | 404, 409, 410 | Preview again |
| `price_moved` | 409 | A market buy rose over 2% since the preview. Preview again |
| `bad_quantity`, `below_minimum`, `above_maximum`, `pair_not_tradable` | 400 | Resize, or pick another pair |
| `order_rejected` | 4xx | Robinhood definitely refused the order. Nothing was spent |
| `order_status_unknown` | 502 | Robinhood did not answer. The spend stays reserved. Check Robinhood before retrying |
| `rate_limited` | 429 | Slow down and retry |

## MCP tools

| Tool | Tier | Scope | What it does |
| --- | --- | --- | --- |
| `robinhood_holdings` | read | `wallet:read` | Holdings priced at the live bid |
| `robinhood_quote` | read | `wallet:read` | Bid, ask and mid for up to 50 pairs |
| `robinhood_preview_order` | write | `wallet:trade` | Size, price and cap-check an order; returns the confirm table |
| `robinhood_place_order` | financial | `wallet:trade` | Place a previewed order with `confirm_order: true` |

All four belong to the **Trading** group. `robinhood_place_order` is a financial tool, so it is off until you turn the Trading group on at [/settings/mcp-tools](/settings/mcp-tools). Connector keys (the keys MCP clients get by default) never see it.

## Security

- Both keys are sealed with the platform secret box (AES-256-GCM) before they reach the database. They are never returned by any API, shown again, or written to a log. The settings page shows only the last four characters of the API key and the public key.
- Requests are signed per call with your Ed25519 key, as Robinhood specifies: the signature covers the API key, a timestamp, the path, the method and the body.
- Reads retry on a 429 or 5xx. Order placement never retries, so a retry cannot double an order.
- To cut access completely, disconnect here **and** delete the key on Robinhood.

## Code

| Piece | Path |
| --- | --- |
| Signed client | [api/_lib/robinhood/crypto-client.js](../api/_lib/robinhood/crypto-client.js) |
| Cap rules | [api/_lib/robinhood/spend-caps.js](../api/_lib/robinhood/spend-caps.js) |
| Order sizing | [api/_lib/robinhood/order-sizing.js](../api/_lib/robinhood/order-sizing.js) |
| Service (ledger, reservation, secrets) | [api/_lib/robinhood/service.js](../api/_lib/robinhood/service.js) |
| REST handler | [api/v1/robinhood/crypto.js](../api/v1/robinhood/crypto.js) |
| MCP tools | [api/_mcp/tools/robinhood-crypto.js](../api/_mcp/tools/robinhood-crypto.js) |
| Settings page | [public/settings/robinhood/index.html](../public/settings/robinhood/index.html) |
| Migration | [api/_lib/migrations/20261110090000_robinhood_crypto_connector.sql](../api/_lib/migrations/20261110090000_robinhood_crypto_connector.sql) |
| Tests | [tests/robinhood-crypto-client.test.js](../tests/robinhood-crypto-client.test.js), [tests/robinhood-crypto-service.test.js](../tests/robinhood-crypto-service.test.js) |
