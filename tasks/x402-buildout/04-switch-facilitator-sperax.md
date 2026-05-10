# Task: Switch EVM x402 Facilitator to x402.sperax.io

## Context

The current EVM x402 facilitator is `https://facilitator.payai.network`. The project owner has built and deployed their own facilitator at `https://x402.sperax.io` (repo: `https://github.com/nirholas/x402-facilitator`). It is fee-free, supports Base, Arbitrum, and Ethereum mainnet, and is already live.

Solana payments must remain on `https://facilitator.payai.network` — the sperax facilitator does not support Solana.

## Architecture

The facilitator URL is consumed in two places:

1. **`api/_lib/x402-spec.js`** — builds the 402 response spec. The facilitator URL is not embedded here directly, but the `extra` fields and payment structure must match what the facilitator expects.

2. **`api/x402-pay.js`** — calls the facilitator for `verify` and `settle`. Look for `X402_FACILITATOR_URL_BASE` env var and the `verifyPayment` / `settlePayment` calls. Currently defaults to payai for both chains.

3. **`api/_lib/x402-verify.js`** or similar — may contain facilitator fetch logic. Check all files under `api/`.

## What to change

### Code

Find every reference to `facilitator.payai.network` in `api/`. For each:

- If it's used for EVM (eip155) payments → replace with `process.env.X402_FACILITATOR_URL_EVM || 'https://x402.sperax.io'`
- If it's used for Solana payments → keep `process.env.X402_FACILITATOR_URL_SOLANA || 'https://facilitator.payai.network'`
- If a single `X402_FACILITATOR_URL` env var controls both → split it into two separate vars as above

### Env vars

Add to `.env`:
```
X402_FACILITATOR_URL_EVM=https://x402.sperax.io
X402_FACILITATOR_URL_SOLANA=https://facilitator.payai.network
```

Add the same two vars to Vercel environment variables (production).

### Verify the sperax facilitator works

Before switching, confirm the endpoint is live:
```bash
curl https://x402.sperax.io/health
curl https://x402.sperax.io/info
```

Check that it supports the `exact` scheme on `eip155:8453` (Base).

### x402.sperax.io API compatibility

The sperax facilitator implements the standard x402 facilitator spec:
- `POST /verify` — verifies a payment payload off-chain
- `POST /settle` — broadcasts the on-chain transaction

Confirm request/response shape matches what `api/x402-pay.js` currently sends to payai. If there are differences, adapt the calling code.

## Definition of done

- `curl https://x402.sperax.io/health` returns 200
- `api/x402-pay.js` uses sperax for EVM, payai for Solana
- `.env` updated with both facilitator vars
- Vercel env vars set
- A test EVM x402 call to `three.ws/api/mcp` (via `/pay` page or `scripts/trigger-bazaar.mjs`) succeeds end-to-end through the sperax facilitator
- No regressions in Solana payment flow
