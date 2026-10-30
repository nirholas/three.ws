# Spec: x402 ↔ MPP bridge

Status: **active**. Contract version: 1. Load-bearing for `api/_lib/bnb/mpp-server.js`,
`api/_lib/bnb/mpp-buyer.js`, and any endpoint that advertises both x402 and MPP.

This is a contract, not a tutorial (for a walkthrough see
[`docs/bnb-payments.md`](../docs/bnb-payments.md)). It pins the wire-level
relationship between the x402 our catalog already speaks and BNB Chain's MPP.

## 1. Protocol identity

MPP's `b402` layer is **x402 v2** (`x402Version === 2`), CDP wire-shape
compatible. There is no separate envelope: the `402` body, the `X-PAYMENT`
request header, and the `X-PAYMENT-RESPONSE` receipt header are identical to
x402 v2. A "dual-protocol" endpoint therefore does not run two payment stacks —
it advertises additional `accepts[]` entries and routes settlement by network.

## 2. Credential mapping

| Credential | x402 (Solana/Base) | MPP (BNB Chain) | Bridged by this repo |
|---|---|---|---|
| EIP-3009 `transferWithAuthorization` | Base (`eip155:8453`) | `eip155:56` / `eip155:97` | **yes** — same primitive, different network/facilitator |
| `permit2-exact` | — | b402 | parseable, not settled here (documented gap) |
| Solana signed `VersionedTransaction` | Solana | — | n/a |

The bridge is **EIP-3009-only**. A b402 `permit2` signature can never double as
an x402 EIP-3009 credential and vice-versa. `mpp-server.js` rejects any non-eip3009
payload on the MPP path with `unsupported_credential` (HTTP 400); `mpp-buyer.js`
refuses to pay a BNB offer that is not eip3009 (`code: 'unsupported_credential'`).

## 3. Network routing (the dispatch rule)

A payment is an **MPP payment** iff its `accepted.network` is a BNB network:

```
MPP_NETWORKS = { bscMainnet: 'eip155:56', bscTestnet: 'eip155:97' }
```

- Server: `looksLikeMppPayment(req)` decodes `X-PAYMENT` and returns true only for
  these networks. A dual-protocol endpoint routes true → `mpp-server.js`
  (b402 facilitator); everything else (Solana, Base, no payment) → the existing
  x402 handler, untouched.
- Buyer: `mpp-buyer.js` only selects `accepts[]` entries whose network is in
  `MPP_BUYER_NETWORKS = ['eip155:56','eip155:97']`.

## 4. Header precedence

There is exactly one `X-PAYMENT` header, so precedence is by **network**, not by
header name:

1. Decode `X-PAYMENT`. If it fails to decode → the endpoint's x402 handler owns
   the request (it may still be a valid x402 payment in another shape).
2. If it decodes to a BNB network → MPP path. The x402 handler is **not** invoked.
3. If it decodes to a non-BNB network → x402 path. The MPP path is **not** invoked.
4. No `X-PAYMENT` → x402 path emits its 402 menu. A dual-protocol endpoint MAY
   also advertise an MPP `accepts[]` entry in that menu and SHOULD set the
   `X-Accept-Payment-MPP: <route>` discovery header.

An endpoint MUST NOT settle the same request on both rails. On the MPP path the
settle order is **verify (off-chain, free) → run the resource → settle
(on-chain)**, mirroring x402, so a failed request never moves funds.

## 5. Requirement pinning (security)

`X-PAYMENT` is attacker-controlled. Before any facilitator call, `mpp-server.js`:

1. Full-shape-gates the decoded payload (`isEip3009PaymentPayload`).
2. Pins every buyer-echoed field to the server's own requirements —
   `network`, `asset`, `payTo`, `amount`, `scheme` must all match. A
   self-consistent payload naming a different recipient/asset/amount is rejected
   **locally** (`offer_mismatch`, HTTP 400), never forwarded.
3. Recovers the payer (`recoverEip3009Payer`) and requires it to equal
   `authorization.from`.

## 6. Replay guarantees

Each EIP-3009 credential carries a single-use 32-byte nonce. `mpp-server.js`
reserves `mpp:nonce:<network>:<asset>:<nonce>` in Redis with `SET NX PX` (15 min
TTL) at verify time; a second presentation returns `replay` (HTTP 409). When
Redis is unavailable it falls back to a process-local guard — defence in depth
only, because the on-chain EIP-3009 nonce is itself single-use, so a landed
transfer can never be doubled even if the off-chain guard is bypassed.

## 7. Settlement outcomes (the caller's state machine)

| Result | HTTP | Meaning |
|---|---|---|
| `ok:true` | 200 | settled; `X-PAYMENT-RESPONSE` attached |
| `no_payment` | 402 | no `X-PAYMENT`; return the challenge |
| `unsupported_credential` / `wrong_network` / `offer_mismatch` / `bad_signature` | 400 | rejected before settle; no funds moved |
| `replay` | 409 | credential already used |
| `verify_failed` / `settle_failed` | 402 | facilitator declined |
| `mpp_not_configured` | 503 | verified but `B402_*` merchant creds absent — no receipt fabricated |
| `facilitator_unreachable` | 502 | settle-phase transport error → state UNKNOWN; **reconcile on-chain** before treating as unpaid |

A 502 from the settle phase is the one non-idempotent case: b402 may already have
broadcast the transfer. The nonce is single-use, so a buyer retry is value-safe,
but the merchant MUST reconcile on-chain rather than assume the payment is absent.

## 8. Referenced code paths

- `api/_lib/bnb/mpp-server.js` — `mppRequirements`, `mppChallenge`, `mppVerify`,
  `mppSettle`, `looksLikeMppPayment`, replay guard.
- `api/_lib/bnb/mpp-buyer.js` — `mppFetch`, `selectRequirement`, cap enforcement.
- `api/x402/three-intel.js` — the reference dual-protocol endpoint.
- `@bnb-chain/b402`: the shared x402 v2 primitives (`buildEip3009Payment`,
  `decodeXPayment`, `recoverEip3009Payer`, `B402Client`).
