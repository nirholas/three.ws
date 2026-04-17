# 25 — Claim / transfer flow module

## Why

Agents minted by ops (e.g., CZ's pre-registered agent) need a user-signed transfer to flip ownership. Also the foundation for any future "gift an agent" flow.

## Parallel-safety

Pure client module. No app wiring — sibling prompt 22 (CZ landing) imports it.

## Files you own

- Create: `src/claim-transfer.js`

## Read first

- [src/erc8004/abi.js](../../src/erc8004/abi.js) — look for a `transferOwnership` or equivalent function on `IdentityRegistry`.
- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — signer/provider helpers.

## Deliverable

```js
export async function claimAgent({ agentId, fromAddress, toAddress, signer, onStep })
// Executes the on-chain ownership transfer. fromAddress is the ops/mint wallet;
// toAddress is the claimer. Requires the target contract to support a claim
// or transferOwnership entry point.
//
// onStep({ step: 'permit'|'sign'|'broadcast'|'confirm', pct, txHash? }).
// Returns { ok: true, txHash, blockNumber }.

export async function buildClaimPayload({ agentId, toAddress, chainId })
// Pure builder — returns { to, data, value } suitable for eth_sendTransaction.
// Used when the flow is split across a server-side payload build + client sign.

export class ClaimError extends Error {} // .code: 'wrong-owner'|'already-claimed'|'user-rejected'|'network'|'unsupported-chain'
```

Behavior:
- If the registry contract doesn't have a transfer entry point on the target chain, resolve by creating a new identity record on the claimer's wallet and marking the old one `superseded_by` — record that in `POST /api/cz/claim` (or the equivalent). If no server endpoint, throw `ClaimError('unsupported-chain')`.
- Never skip user signing. Every state change requires signer interaction.

## Constraints

- No new deps.
- Never hardcode contract addresses; read from `REGISTRY_DEPLOYMENTS`.
- Handle `chainId` mismatch by asking wallet to switch (EIP-3326).

## Acceptance

- `node --check src/claim-transfer.js` clean.
- `npm run build` clean.
- With a Base Sepolia wallet + testnet funds: the full dry-run against a deployed IdentityRegistry succeeds.

## Report

- Which contract function(s) you called.
- Gas usage and confirmation latency on Base Sepolia.
- Whether the registry truly supports transfer on every listed chain.
