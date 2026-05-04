# three.ws endpoint issue

## Problem

Your x402 endpoint at `https://three.ws/api/mcp` returns a valid 402 challenge but fails when processing payments.

**What works:**

```
GET https://three.ws/api/mcp → 402 (correct)
```

Returns proper x402 payment requirements for both Solana and Base.

**What fails:**
When a client sends a signed payment via `X-PAYMENT` header, the server returns:

```
"facilitator /verify 500: No facilitator registered for scheme: exact and network: base"
```

This means your x402 middleware can issue 402 challenges but has no facilitator configured to verify incoming payments on-chain.

## How to fix

You need to point your x402 middleware at a working facilitator. The public Coinbase facilitator works:

```
https://facilitator.payai.network
```

### If you're using `@x402/server` (Node/Express)

```js
import { x402 } from '@x402/server';

app.use(x402({
  payTo: '0x0C70c0e8453C5667739E41acdF6eC5787B8ff542',
  facilitatorUrl: 'https://facilitator.payai.network',  // ← add this
  network: 'base',
  // ... your other config
}));
```

### If you're using `@x402/next` (Next.js/Vercel)

```js
import { paymentMiddleware } from '@x402/next';

export default paymentMiddleware({
  payTo: '0x0C70c0e8453C5667739E41acdF6eC5787B8ff542',
  facilitatorUrl: 'https://facilitator.payai.network',  // ← add this
  network: 'base',
  // ... your other config
});
```

### If you support multiple networks (Solana + Base)

The same facilitator handles both:

```js
facilitatorUrl: 'https://facilitator.payai.network'
```

No separate setup needed — it supports `exact` scheme on both `base` and `solana`.

## How we verified

```bash
# Your 402 challenge works fine
curl -s https://three.ws/api/mcp
# → 402 with valid accepts array (solana + base)

# But payment verification fails
curl -s -X POST https://three.ws/api/mcp \
  -H "X-PAYMENT: <signed-payment>" \
  -d '{}'
# → "No facilitator registered for scheme: exact and network: base"

# The public facilitator at payai.network works
curl -s -X POST https://facilitator.payai.network/verify \
  -H "Content-Type: application/json" \
  -d '{"paymentPayload":{...},"paymentRequirements":{...}}'
# → proper validation response (not "unsupported network")
```
