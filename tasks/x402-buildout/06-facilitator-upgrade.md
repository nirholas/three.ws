# Task: Upgrade x402-facilitator to three.ws x402Version 2

## Source repo
`https://github.com/nirholas/x402-facilitator-sperax` — clone this, make all changes below, push to `https://github.com/nirholas/x402-facilitator`.

## Overview of changes
1. Replace every occurrence of "Sperax", "SperaxOS", "sperax", "chat.sperax.io", "x402.sperax.io" with "three.ws" equivalents
2. Upgrade `X402_VERSION` from `1` to `2` throughout
3. Update payload types and validation for x402v2 structure
4. Update verify/settle logic for v2 payload format
5. Update package name, README, operator info

---

## File-by-file changes

### `package.json`
```diff
- "name": "@sperax/x402-facilitator",
+ "name": "@threews/x402-facilitator",
  "version": "2.0.0",
- "description": "x402 payment facilitator for Sperax",
+ "description": "three.ws x402 facilitator — verify and settle USDC micropayments on EVM chains",
```

---

### `src/constants.ts`
```diff
- export const FACILITATOR_VERSION = '1.0.0';
- export const X402_VERSION = 1;
+ export const FACILITATOR_VERSION = '2.0.0';
+ export const X402_VERSION = 2;
  export const SUPPORTED_SCHEMES = ['exact'];
  export const SUPPORTED_NETWORKS = ['base', 'base-sepolia', 'arbitrum', 'arbitrum-sepolia', 'ethereum'];
```

---

### `src/types/index.ts`

Replace the `X402Payment` type entirely to support the v2 payload envelope:

```typescript
// x402 v2 payment payload (what the client sends in X-PAYMENT header)
export interface X402PaymentV2 {
  x402Version: 2;
  scheme: 'exact';
  network: string; // e.g. "eip155:8453"
  payload: {
    signature: `0x${string}`;
    authorization: {
      from: `0x${string}`;
      to: `0x${string}`;
      value: string;       // decimal string
      validAfter: string;  // decimal string (unix seconds)
      validBefore: string; // decimal string (unix seconds)
      nonce: `0x${string}`; // 32-byte hex
    };
  };
}

// Keep legacy v1 type for backwards compat during transition
export interface X402PaymentV1 {
  x402Version: 1;
  chainId: number;
  token: string;
  scheme: string;
  authorization: TransferAuthorization;
  signature: `0x${string}`;
}

export type X402Payment = X402PaymentV2 | X402PaymentV1;
```

Update `VerifyResponse` to include `accepted` field (required by v2):

```typescript
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: `0x${string}`;
  accepted?: PaymentRequirements; // v2: echoes back the requirements that were accepted
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  transaction?: string;
  network?: string;
  payer?: `0x${string}`;
}
```

---

### `src/middleware/validate.ts`

Add v2 payload schema alongside v1:

```typescript
// x402 v2 authorization object
export const authorizationV2Schema = z.object({
  from: addressSchema,
  to: addressSchema,
  value: numericStringSchema,
  validAfter: numericStringSchema,
  validBefore: numericStringSchema,
  nonce: hexSchema,
});

// x402 v2 payment payload schema
export const paymentPayloadV2Schema = z.object({
  x402Version: z.literal(2),
  scheme: z.literal('exact'),
  network: z.string(), // "eip155:8453" etc.
  payload: z.object({
    signature: hexSchema,
    authorization: authorizationV2Schema,
  }),
});

// Accept both v1 and v2
export const paymentPayloadSchema = z.union([
  paymentPayloadV2Schema,
  paymentPayloadV1Schema, // existing v1 schema
]);
```

Update `decodePaymentPayload()` to handle both:
```typescript
export function decodePaymentPayload(raw: string): unknown {
  // Try base64 first (standard x402 encoding)
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch {}
  // Fallback: raw JSON
  try {
    return JSON.parse(raw);
  } catch {}
  throw new Error('invalid payment payload encoding');
}
```

---

### `src/core/verifier.ts`

Update to normalize v2 payload into internal format before verification:

```typescript
private normalizePayment(payment: X402Payment): NormalizedPayment {
  if (payment.x402Version === 2) {
    // Extract chainId from network string "eip155:8453" → 8453
    const chainId = parseInt(payment.network.split(':')[1], 10) as SupportedChainId;
    const { authorization, signature } = payment.payload;
    return {
      chainId,
      token: undefined, // resolved from requirements
      scheme: payment.scheme,
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce,
      },
      signature,
    };
  }
  // v1: existing logic unchanged
  return { ...payment, authorization: { ...payment.authorization } };
}
```

Update `verify()` return to include `accepted` field:
```typescript
return {
  isValid: true,
  payer: signer,
  accepted: requirements, // echo back for v2
};
```

---

### `src/core/settler.ts`

Same normalization as verifier — call `normalizePayment()` before settlement. No other changes needed since settlement is chain-level (viem `writeContract` call).

---

### `src/routes/info.ts`

```diff
- name: 'SperaxOS x402 Facilitator',
+ name: 'three.ws x402 Facilitator',
  version: FACILITATOR_VERSION,
  x402Version: X402_VERSION,
  ...
- operator: { name: 'SperaxOS', url: 'https://chat.sperax.io' },
+ operator: { name: 'three.ws', url: 'https://three.ws' },
```

---

### `src/routes/supported.ts`

```diff
- x402Version: 1,
+ x402Version: 2,
```

---

### `src/routes/well-known.ts`

```diff
- name: 'SperaxOS x402 Facilitator',
+ name: 'three.ws x402 Facilitator',
- operator: { name: 'SperaxOS', url: 'https://chat.sperax.io' },
+ operator: { name: 'three.ws', url: 'https://three.ws' },
  x402Version: X402_VERSION, // now 2
```

---

### `.env.example`

```diff
- # SperaxOS x402 Facilitator — Environment Variables
+ # three.ws x402 Facilitator — Environment Variables

  FACILITATOR_PRIVATE_KEY=0x...

+ # RPC endpoints (defaults to public nodes if not set)
  BASE_RPC_URL=https://mainnet.base.org
  ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
  ETHEREUM_RPC_URL=https://eth.llamarpc.com

  PORT=3402
  HOST=0.0.0.0
  CORS_ORIGINS=*
  LOG_LEVEL=info
```

---

### `README.md`

Full rewrite — keep the technical content, replace all branding:

```markdown
# three.ws x402 Facilitator

Verify and settle x402 micropayments (USDC) on EVM chains. Implements x402Version 2.

Deployed at: **https://facilitator.three.ws**

## Supported chains

| Chain | Network ID | USDC |
|-------|-----------|------|
| Base | eip155:8453 | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| Arbitrum | eip155:42161 | 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 |
| Ethereum | eip155:1 | 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 |

## Quick start

\`\`\`bash
git clone https://github.com/nirholas/x402-facilitator
cd x402-facilitator
cp .env.example .env
# set FACILITATOR_PRIVATE_KEY
npm install
npm run dev
\`\`\`

## API

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness check |
| `GET /info` | Facilitator metadata |
| `GET /supported` | Supported payment kinds |
| `POST /verify` | Verify payment signature off-chain |
| `POST /settle` | Settle payment on-chain |
| `GET /balances` | Facilitator gas + token balances |
| `GET /.well-known/x402` | x402 discovery |

## x402Version 2 payload format

\`\`\`json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:8453",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0x<payer>",
      "to": "0x<payTo>",
      "value": "1000",
      "validAfter": "0",
      "validBefore": "1234567890",
      "nonce": "0x<32bytes>"
    }
  }
}
\`\`\`

## Deployment

Deploy to Railway — set `FACILITATOR_PRIVATE_KEY` and fund the address with ETH on each chain for gas.

## Operator

[three.ws](https://three.ws) — AI agent infrastructure
```

---

### `Dockerfile`

```diff
- LABEL maintainer="SperaxOS"
+ LABEL maintainer="three.ws"
```

---

## Deploy target

After pushing, add a custom domain `facilitator.three.ws` in Railway pointing to this service. Update in `3D-Agent`:

```
X402_FACILITATOR_URL_EVM=https://facilitator.three.ws
```

## Definition of done

- All "Sperax" / "SperaxOS" strings removed — grep confirms zero matches
- `X402_VERSION = 2` in constants
- v2 payload accepted by `/verify` and `/settle`
- `/info` returns `x402Version: 2` and `operator.url: "https://three.ws"`
- `/verify` response includes `accepted` field
- `npm run build` passes with no errors
- `npm test` passes
- Deployed to Railway at `facilitator.three.ws`
