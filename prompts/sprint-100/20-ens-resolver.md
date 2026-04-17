# 20 — ENS name resolver API

## Why

Humans paste `vitalik.eth`, not `0xd8da...`. Resolving ENS → address → agent lets embeds use readable names.

## Parallel-safety

New endpoint. Does not touch the by-address resolver (sibling prompt 19).

## Files you own

- Create: `api/agents/ens/[name].js`

## Read first

- [src/erc8004/agent-registry.js](../../src/erc8004/agent-registry.js) — confirm the ethers version + existing RPC setup.

## Deliverable

### `GET /api/agents/ens/:name`

- Public, rate-limited `60/min per IP`.
- Steps:
  1. Validate `name` ends with `.eth` and is a sensible ENS label (`[a-z0-9-]+` across labels).
  2. Use `ethers.getDefaultProvider('mainnet')` or a configured `MAINNET_RPC_URL` to call `provider.resolveName(name)` → address. If null, 404.
  3. Proxy/forward to `/api/agents/by-address/:addr` logic — NOT via an HTTP hop; factor the shared logic out into a small helper if convenient, OR duplicate the read-through with a TODO to dedupe later. Note the decision in the report.
  4. Return `{ name, address, agents: [...] }`.
- Cache ENS → address resolution for 5 minutes in-memory.

## Constraints

- No new deps.
- 3s RPC timeout; on timeout return `503 ens-timeout`.
- Never throw on invalid names — return 400 with a clear message.

## Acceptance

- `node --check` clean.
- `npm run build` clean.
- curl `/api/agents/ens/vitalik.eth` → returns address (and `agents: []` because he's not registered with us).
- curl `/api/agents/ens/notarealname-zzz.eth` → 404.

## Report

- Whether the mainnet RPC used was the public default or an env-configured one (recommend env).
- Cache eviction behavior.
