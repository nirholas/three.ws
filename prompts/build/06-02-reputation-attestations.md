# 06-02 — Reputation attestations write path

## Why it matters

An onchain identity (06-01) without reputation is just a name. Reputation attestations are how hosts, other agents, and users vouch for an agent — "this agent helped me", "this agent delivered a tool call". Persisting these onchain makes reputation portable: another host can show the badge without asking us.

## Context

- Reputation contract: [contracts/src/ReputationRegistry.sol](../../contracts/src/ReputationRegistry.sol).
- ABI: [src/erc8004/abi.js](../../src/erc8004/abi.js).
- Reputation helper: [src/erc8004/reputation.js](../../src/erc8004/reputation.js).
- Requires: 06-01 merged (`agents.onchain_id`).

## What to build

### Attestation shape

```jsonc
{
  "subject":  "<onchain_id>",
  "issuer":   "<wallet>",
  "topic":    "helpful" | "accurate" | "delivered" | "<custom>",
  "score":    -1 | 0 | 1,                    // -1 = report, 0 = neutral, 1 = endorse
  "context":  "optional opaque CID or string",
  "issued_at": <unix>
}
```

Issuer signs with EIP-712. The contract verifies the signature, stores `(subject, issuer, topic, score, context, issued_at)`, and emits `Attestation`.

### Endpoint — `POST /api/agents/:id/attest`

- Session-authed. Computes the EIP-712 typed data the issuer must sign. Returns the typed data and the registry address to the client.
- Client signs with their wallet, then POSTs `/api/agents/:id/attest/submit { signature, typed_data }`.
- Server submits the tx (paymaster/relayer-friendly — keep the submission pathway pluggable) OR returns calldata for the client to submit, consistent with 06-01's pattern. **Match 06-01: client submits.**

### Reading — `GET /api/agents/:id/attestations`

- Public. Server listens for `Attestation` events on the registry (or queries a subgraph if configured) and returns rolled-up counts: `{ endorses, neutrals, reports, by_topic: { helpful: 12, … }, recent: [ … ] }`.
- Cache 60s. Pagination via `before`/`after` block cursors.

### Dashboard UI (viewing)

On the public agent page [public/agent/index.html](../../public/agent/index.html):

- Badge row showing top topics + counts.
- Clicking opens a drawer with the recent attestations (issuer address or ENS, topic, relative time).

### Dashboard UI (issuing)

On a public agent page, if the viewer is authenticated and has a primary wallet:

- "Endorse" / "Report" / "Mark as helpful" buttons.
- Each triggers the sign-and-submit flow; UI rolls up optimistically and re-verifies after the tx confirms.

### Rate limits and anti-spam

- Server-side: an issuer may attest to the same `(subject, topic)` at most once per 24h (DB-checked before returning typed data).
- Contract-side: trust it for dedup — duplicates overwrite prior score (per ERC-8004 convention) or are rejected; match contract behavior.

## Out of scope

- Weighted attestations (trust graph).
- Paying issuers / tokens as rewards.
- Off-chain computation of aggregate scores beyond count rollups.

## Acceptance

1. Endorse an agent from a second wallet on testnet → tx confirms → agent page badge increments within 60s.
2. Attempt the same endorsement again within 24h → 409 `duplicate_attestation`.
3. Report / endorse / neutral mix rolls up correctly into `{ endorses, neutrals, reports }`.
4. Attempt to submit a forged `signature` → contract rejects; endpoint returns the revert reason.
5. `node --check` passes on new files.
