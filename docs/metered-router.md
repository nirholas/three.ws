# Pay-per-request model access over x402

`POST https://three.ws/api/v1/chat/completions` is OpenAI-compatible. With an API key it bills the account's credits ([inference-billing.md](./inference-billing.md)). With **no key and no session** a wallet can pay for one request instead, using the x402 `upto` scheme on Solana ([x402-upto.md](./x402-upto.md)). The caller authorizes a cap, three.ws runs the completion, and only the metered tokens are charged. The rest of the cap goes back to the wallet.

| Piece | Source |
|---|---|
| Price table (data, one row per model) | [api/_lib/pricing/inference-models.js](../api/_lib/pricing/inference-models.js) over the published rate in [api/_lib/pricing/catalog.js](../api/_lib/pricing/catalog.js) |
| Cap sizing, admission, settlement, stream watching | [api/_lib/metered-router.js](../api/_lib/metered-router.js) |
| Endpoint | [api/v1/chat/completions.js](../api/v1/chat/completions.js) |
| Price sheet and `pay_per_request` metadata | `GET /api/v1/models` ([api/v1/models.js](../api/v1/models.js)) |
| Tests | [tests/metered-router.test.js](../tests/metered-router.test.js) |

## How a request flows

1. **402.** A request with no `Authorization` header and no session answers `402 Payment Required` with a standard x402 v2 body and `PAYMENT-REQUIRED` header. Its one `upto` accept carries `amount`, the **cap**: the model's worst case for this request.
2. **Sign and retry.** The client signs a channel `open` that deposits the cap and resends the same request with `PAYMENT-SIGNATURE` (or `X-PAYMENT`).
3. **Escrow, then run.** The deposit settles before any model call, so the work is always covered.
4. **Claim.** When the model loop reports its final usage, the claim settles `input_tokens x input price + output_tokens x output price` (never below the model's minimum call, never above the cap). The program pays three.ws that amount and refunds the rest.
5. **Failure or no output.** A completion that produced no token settles a claim of zero: the whole deposit returns.

The cap is `max_rounds` model rounds, each reading your prompt plus the room a round may add (`context_allowance_round`) and writing up to `max_output_tokens_round`. A request that brings its own `tools` is one round bounded by `max_tokens`. A longer prompt means a larger cap. The cap is only a ceiling; you pay for tokens used.

## Streaming

`stream: true` works the same way. The deposit is escrowed before the first byte. The claim is made when the loop reports final usage, which is before the closing frames, so the last `chat.completion.chunk` (with `stream_options: { include_usage: true }`) carries a `billing` object: `paid_via`, `charged_atomics`, `charged_usd`, `refunded_atomics`, `transaction`. If the client drops the connection mid-stream, the claim settles the tokens already sent (counted from the streamed text, plus the prompt) and nothing more. Non-streaming responses carry the same object base64-encoded in the `x-payment-response` header.

## Prices

`GET /api/v1/models` lists each model with `pricing` (USD per million tokens, input and output, and the minimum call) and a `pay_per_request` block (`enabled`, scheme, network, asset, and the round limits that size the cap). Pay-per-request and keyed credits use the same per-token price.

## curl

```sh
curl -i https://three.ws/api/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"three-ws/agent","messages":[{"role":"user","content":"Say hello."}],"stream":false}'
```

```
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...

{"x402Version":2,"error":"Payment required: ...","accepts":[{"scheme":"upto","network":"solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp","asset":"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","amount":"50260", ...}]}
```

Signing needs a client library; the curl above shows the challenge. To pay, use the SDK.

## SDK

```js
import { x402Client } from '@x402/core/client';
import { wrapFetchWithPayment } from '@x402/fetch';
import { UptoSvmScheme } from '@x402/svm/upto/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';
import OpenAI from 'openai';

const signer = await createKeyPairSignerFromBytes(secretKeyBytes); // a Solana wallet holding USDC
const client = new x402Client().register('solana:*', new UptoSvmScheme(signer));

const openai = new OpenAI({
  baseURL: 'https://three.ws/api/v1',
  apiKey: 'x402', // unused; the wallet pays
  fetch: wrapFetchWithPayment(fetch, client),
});

const reply = await openai.chat.completions.create({
  model: 'three-ws/agent',
  messages: [{ role: 'user', content: 'Say hello.' }],
});
```

## Operating notes

- Enabled when the deployment runs `upto` (`X402_UPTO_ENABLED=true`, `X402_FEE_PAYER_SECRET_BASE58`, `X402_PAY_TO_SOLANA`, `X402_ASSET_MINT_SOLANA`). Otherwise an unauthenticated request keeps answering `401 missing_api_key`.
- Unauthenticated calls are rate limited per IP. Naming an `agent_id` needs the agent's owner, so it needs a key.
- Every deposit, claim and cancel is written to the x402 audit log under the route `/api/v1/chat/completions`.
- A crash between the deposit and the claim leaves the channel open until the payer's withdraw delay passes; the payer can then withdraw the deposit.
