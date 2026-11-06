# Trust primitives

A trust primitive answers one question an autonomous agent has right before it acts:
**"Should I trust the thing on the other side of this transaction?"** Before Agent A
pays, trades with, or delegates to Agent B, it needs B's trustworthiness — from real
evidence, not a self-reported rating.

three.ws exposes this as a single paid endpoint that works on **any counterparty, on
any chain**, regardless of which platform that counterparty was minted on.

---

## Cross-chain Agent Reputation

**`GET /api/x402/agent-reputation?subject=<identifier>`** — $0.01 USDC per call
(Solana or Base mainnet, Solana advertised first, via [x402](./x402.md)). Callers with an OAuth
Bearer token carrying scope `read:agent-reputation`, or a fresh Sign-In-With-X proof, skip
payment; both are published as auth methods in the OpenAPI and x402 discovery documents.

Pass any counterparty identifier. The type is auto-detected and scored from whatever
real on-chain evidence exists for it:

| You pass | Detected as | Scored from |
|---|---|---|
| A Solana wallet (base58) | `solana_wallet` | signature history, account age, SOL balance, denylist, and — if it's a known three.ws agent wallet — its settled agent-payment record |
| A pump.fun / SPL mint (base58) | `solana_mint` | the owning agent's settled payments + attestations (three.ws mints) **or** live DexScreener market signals (external mints) |
| An EVM address (`0x…`) | `evm_wallet` | transaction count (nonce), native-asset holdings priced to USD |
| An ERC-8004 agent id (`42` or `erc8004:8453:42`) | `erc8004_agent` | the ERC-8004 reputation registry (feedback average × count) + the bound agent wallet's EVM activity/holdings |
| A three.ws `agent_id` (UUID) | `threews_agent` | the three.ws on-chain index: confirmed pump.fun agent-payments, distinct payers, failure rate, and signed Solana attestations |

`?chain=<id>` sets the EVM chain for a bare EVM address or ERC-8004 id (default `8453` / Base).
`agent_id=<uuid>` is still accepted as an alias for `subject` so existing callers don't break.

### Response

```json
{
  "subject": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump",
  "subjectType": "solana_mint",
  "score": 71,
  "tier": "high",
  "signals": {
    "dimensions": {
      "activity":       { "available": true, "weight": 25, "norm": 0.62, "points": 16, "value": 124 },
      "age":            { "available": true, "weight": 15, "norm": 0.48, "points": 7,  "days": 176 },
      "counterparties": { "available": true, "weight": 15, "norm": 0.72, "points": 11, "value": 18 },
      "holdings":       { "available": true, "weight": 10, "norm": 1.0,  "points": 10, "usd": 412000 },
      "reliability":    { "available": true, "weight": 15, "norm": 0.98, "points": 15, "failure_rate": 0.02 },
      "attestations":   { "available": true, "weight": 20, "norm": 0.6,  "points": 12, "count": 6, "avg_feedback": null }
    },
    "weight_considered": 100
  },
  "evidence": [
    { "kind": "solana_token",  "ref": "https://solscan.io/token/FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump" },
    { "kind": "threews_agent", "ref": "/agent/7b9a4f30-2d11-4e2d-9d12-1cdb1f6a3a55" }
  ],
  "caveats": [],
  "ts": "2026-07-07T00:00:00Z"
}
```

- **`score`** — 0–100, or `null` when the subject can't be scored (see below).
- **`tier`** — `unknown` · `low` · `medium` · `high` · `elite`.
- **`signals.dimensions`** — the per-dimension breakdown, so the score is auditable, not a black box.
- **`evidence`** — links you can follow to the raw on-chain source for each signal.
- **`caveats`** — every dimension that couldn't be read for this subject, spelled out.

---

## The score rule

The score is a **deterministic**, available-weighted average of six trust dimensions.
Given the same signals it always returns the same score — the scoring function is pure
and unit-tested (`tests/subject-reputation.test.js`); only the signal-gathering is live.

| Dimension | Weight | Saturates at | Real signal |
|---|---:|---|---|
| **activity** | 25 | 200 tx/payments | transaction / confirmed-payment count |
| **age** | 15 | 365 days | account age (first on-chain activity) |
| **counterparties** | 15 | 25 | distinct payers / peers |
| **holdings** | 10 | $1,000 | native + token value held on-chain (USD) |
| **reliability** | 15 | — | `1 − settlement failure rate` |
| **attestations** | 20 | 10 | signed Solana attestations / ERC-8004 feedback |

Each dimension is normalized to `0..1` (value ÷ saturation cap, clamped). The score is:

```
score = round( 100 × Σ(weightᵢ × normᵢ) / Σ(weightᵢ) )      over available dimensions only
```

**Only the dimensions that could actually be read are counted** — in both the numerator
and the denominator. A subject we can only read two dimensions for is scored fairly
against its own evidence, not penalised for chains we couldn't reach. Every unread
dimension becomes a caveat.

Two overrides:

- **ERC-8004 feedback quality** — a net-negative feedback average scales the attestation
  contribution *down* (never up); neutral/positive feedback counts in full.
- **Denylist** — a subject on the three.ws denylist is capped at score `10` regardless of
  any positive signal. A known-bad counterparty is never "medium trust" because it has volume.

### Tier bands

| Score | Tier |
|---|---|
| `null` | `unknown` |
| 0–29 | `low` |
| 30–59 | `medium` |
| 60–84 | `high` |
| ≥ 85 | `elite` |

### Never a fabricated score

- **Unknown / unscannable subject** → HTTP 200 with `score: null`, `tier: "unknown"`, and an
  explicit caveat. The endpoint never invents a number.
- **A data source is down** → the score degrades to whatever *is* readable, and the missing
  source is named in `caveats`. The call never 500s.

---

## Batch mode

**`POST /api/x402/agent-reputation`** with `{ "mode": "batch", "subjects": [...] }` scores up
to 25 arbitrary counterparties (any chain, auto-detected) in one paid call:

```json
{ "mode": "batch", "subjects": ["<solana_wallet>", "0x<evm>", "42"], "chain": 8453 }
```

Returns `{ mode, count, scored_count, unknown_count, avg_score, subjects: [ …full result each… ] }`.

The same POST route also serves three.ws-fleet monitoring over the platform's indexed
active-agent set: `mode: "sweep"` (fleet average + flagged low-trust agents),
`mode: "leaderboard"` (top N by score), and `mode: "decay_report"` (agents whose score
dropped >10 points). See the [x402 catalog](./x402.md).

---

## Who uses this, and why us

A payments agent about to settle an invoice, a trading agent about to route an order to a
market maker, or an orchestrator about to delegate a task all face the same decision: is
this counterparty safe? Competing reputation endpoints only know agents minted on their own
platform — useless the moment the counterparty is from somewhere else. This one reads Solana,
every major EVM chain, the ERC-8004 registry, and the three.ws on-chain index behind a single
call, so an agent can vet **whoever** it's about to transact with. That's why an outside agent
has a reason to pay for it.

---

## Cross-platform On-Chain Identity Verifier

Reputation answers *"should I trust them?"*. Identity answers the question that comes
first: *"are they who they say they are?"* Before Agent A pays a counterparty that
claims **"I am the deployer of contract X"** or **"I own wallet W / name N / agent id
42"**, it needs cryptographic proof the identity↔address link is real — not a
self-report.

**`GET /api/x402/onchain-identity-verify?identity=<id>&address=<addr>&chain=<caip2>`**
$0.005 USDC per call (Solana or Base mainnet, Solana advertised first, via [x402](./x402.md)).

It verifies a **claim** that `identity` controls `address`, for **any** identity type,
on any chain — regardless of the platform the counterparty came from:

| `identity` you pass | Detected as | Verified from (real source) |
|---|---|---|
| An ENS name (`vitalik.eth`) | `ens` | ENS forward + reverse resolution (Ethereum RPC) |
| An SNS name (`bonfida.sol`) | `sns` | SNS resolution + favorite-domain reverse lookup (Solana RPC / Bonfida) |
| An EVM wallet (`0x…`) | `evm_address` | contract **deploy tx + deployer** (Etherscan V2) and/or the contract's `owner()` getter |
| A Solana wallet (base58) | `solana_address` | SPL **mint authority**, **freeze authority**, and Metaplex **update authority** of the claimed mint |
| An ERC-8004 id (`eip155:8453:42` or `8453:42`) | `erc8004` | Identity Registry `ownerOf(id)` + `getAgentWallet(id)` |
| A three.ws `agent_id` (UUID) | `threews_agent_id` | the canonical `meta.onchain` deploy record: deploy tx, owner wallet, metadata URI |

`chain` is an optional CAIP-2 hint (`eip155:1`, `eip155:8453`, `solana:5eykt4Us…`); it's
inferred from the identity/address shape when omitted. The legacy `agent_id` +
`contract_or_mint` params are still accepted as aliases so existing callers don't break.

### Response

```json
{
  "claim": { "identity": "vitalik.eth", "address": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "chain": "eip155:1" },
  "identity_type": "ens",
  "verified": true,
  "method": "ens-resolution",
  "evidence": [
    { "kind": "ens_forward_resolution", "ref": "vitalik.eth", "detail": "resolves to 0xd8da…6045" },
    { "kind": "ens_reverse_resolution", "ref": "0xd8dA…6045", "detail": "primary name vitalik.eth" }
  ],
  "caveats": [],
  "ts": "2026-07-07T00:00:00Z"
}
```

### The evidence model

`evidence[]` is a list of `{ kind, ref, detail }` — each `ref` is a concrete on-chain
handle (a tx hash, a wallet, a registry entry, a resolved name) you can follow to the raw
source. The verdict is **never** a bare boolean:

- **`verified: true`** — concrete on-chain evidence links the identity to the address (the
  name resolves to it, the identity deployed / owns the contract, holds the mint authority,
  or is the registered ERC-8004 owner). Always accompanied by ≥1 evidence item.
- **`verified: false`** — the authoritative source was read and links the address to
  **someone else** (or nobody). A disproof, backed by what was read.
- **`verified: "unverifiable"`** — not enough could be read to decide: the name didn't
  resolve, the explorer key is absent, the RPC was down, or the address is an opaque EOA with
  nothing on-chain to compare. `caveats[]` names exactly what's missing. **This is never a
  false positive** — an undetermined claim is never reported as true.

### Guarantees

- **No false positives.** `verified: true` requires concrete on-chain evidence; every "true"
  branch attaches the evidence that proves it.
- **Degrade, never fail.** A down explorer/RPC downgrades one evidence source to a caveat;
  bad input is a `400`; the endpoint never `500`s.
- **Two distinct EOAs can't be faked as linked.** With no contract, mint, or name to compare,
  a wallet-vs-wallet claim returns `unverifiable` and asks for a name / ERC-8004 id instead —
  it won't guess.

### Who uses this, and why us

A payments agent settling an invoice, a trading agent routing to a market maker, or an
orchestrator delegating a task all hit the same pre-flight check: *is this counterparty the
entity it claims to be?* Competing verifiers only know identities minted on their own
platform. This one reads ENS, SNS, every major EVM chain's contract-creation + ownership,
the ERC-8004 registry, and the three.ws on-chain index behind a single call — so an agent
can verify **whoever** it's about to transact with. Pair it with
[Cross-chain Agent Reputation](#cross-chain-agent-reputation): verify *who* they are, then
score *whether to trust* them.

---

See also: [x402 paid endpoints](./x402.md) · [Agent Bouncer](./api-reference.md) · [ERC-8004 identity](./erc8004.md)
