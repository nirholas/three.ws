---
name: preflight-x402-seller
description: Check whether an x402 seller can currently settle payments before an agent signs anything, and fetch through a guard that refuses unpayable sellers. Use before paying any x402 endpoint, or to monitor a seller's payability.
---

# Preflight an x402 seller

x402 says what a resource costs, not whether the seller can settle. `@three-ws/x402-preflight` fetches the seller's signed, time-bounded payability attestation from `/.well-known/x402-preflight`, verifies it offline (ed25519 signature, digest, expiry, subject), and reports per-network verdicts. Node 18+.

## CLI

```bash
npx @three-ws/x402-preflight https://seller.example
npx @three-ws/x402-preflight https://seller.example --network solana:mainnet && ./pay.sh
```

Flags: `--network <caip2>`, `--issuer <pubkey>` (pin the signer you trust), `--timeout <ms>` (default 5000), `--json` (raw envelope for jq), `--help`.

Exit codes: `0` payable, `1` verified and NOT payable, `2` could not be verified (no attestation, bad signature, expired, timeout). Treat 2 as "do not pay" too.

## Library

```js
import { preflight, assertPayable, guardedFetch, PreflightError } from '@three-ws/x402-preflight';

const { report } = await preflight('https://seller.example');
report.networks['solana:mainnet'];  // { payable, reason, retry_after, settle: { rate, attempts, window_hours, confidence }, alternates }

try {
  await assertPayable('https://seller.example', 'solana:mainnet');
} catch (err) {
  if (err instanceof PreflightError) {
    err.reason; err.alternates; err.retryAfter;  // pay on an alternate rail, or retry later
  }
}

const fetch402 = guardedFetch({ prefer: ['solana:mainnet'], onSkip: (info) => console.warn(info) });
const res = await fetch402('https://seller.example/api/resource');
```

## Rules

- `payable` is three-valued: `true`, `false`, `"unknown"`. Unknown counts as not payable. `allowUnknown: true` opts out and should be a conscious decision.
- `guardedFetch` passes through origins that publish no attestation (most of the ecosystem). Set `requirePreflight: true` to fail closed.
- `guardedFetch` sets an `x-preflight-network` header so sellers can answer a 402 with only the rail you can pay.
- Verification alone is available without I/O: `import { verifyPreflight } from '@three-ws/x402-preflight/verify'`; it never throws and returns `{ valid, reason, issuer, digest, expired }`.
- An attestation is the seller's best assessment at a moment, not a guarantee.

This skill only reads and verifies. It never signs or spends. Any actual payment still needs the user's explicit approval of recipient, amount and network.
