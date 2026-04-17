# 19 — Agent-by-address resolver API

## Why

Any host (LobeHub, Claude, our own embed) should be able to ask "what agent belongs to wallet `0xabc...`?" and get the manifest without prior indexing. This closes the on-chain → embed loop.

## Parallel-safety

New endpoint.

## Files you own

- Create: `api/agents/by-address/[addr].js`

## Read first

- [src/erc8004/abi.js](../../src/erc8004/abi.js) — `REGISTRY_DEPLOYMENTS`, `IdentityRegistry` ABI.
- [api/agents/by-wallet.js](../../api/agents/by-wallet.js) — **read this first** — it may already do most of this. If it does, adapt this prompt to extend or redirect to it rather than duplicate. Note in report.
- [api/_lib/db.js](../../api/_lib/db.js).

## Deliverable

### `GET /api/agents/by-address/:addr`

- Public, rate-limited `120/min per IP`.
- Query params: `?chainId=<n>` (optional, default: try all known chains).
- Steps:
  1. Normalize `addr` to lowercase, validate checksum-less hex.
  2. DB-first: look up `agents` / `user_wallets` joined rows where the wallet owns the agent. Return if found.
  3. Chain fallback: for each chain in `REGISTRY_DEPLOYMENTS`, call `IdentityRegistry.agentsByOwner(addr)` via an RPC read. Use the same RPC URLs `agent-registry.js` uses.
  4. For each on-chain agentId, fetch `agentURI` and resolve the manifest.
  5. Return `{ agents: [{ id, chainId, agentURI, manifestUrl, onChain: boolean, source: 'db'|'chain' }] }`.
- 404 with `{ agents: [] }` if none found (still 200, empty array, per REST convention — use 200).

## Constraints

- No new deps. Use `ethers` already in use.
- RPC calls must have a 3s timeout each; don't block forever.
- Cache per-address results in-memory for 60s to avoid thundering the RPC.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- curl with a known-on-chain address → returns the agent.
- curl with a random address → `{ agents: [] }`.

## Report

- Overlap with `by-wallet.js` — what you inherit, what's new.
- Per-chain RPC latency you saw.
